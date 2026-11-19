import { describe, expect, it } from 'vitest';
import type { ChangeRequestDoc } from '@kgc/shared';
import {
  PUBLIC_LIST_MAX,
  STATUSES,
  emailForTransition,
  publicChangeRequests,
  publicSummary,
  toPublicChangeRequest,
  type PublicSource,
} from './change-requests-core';
import { CHANGE_REQUEST_SEED, SEED_SENDER, seedChangeRequests, type SeedStore } from './change-requests-seed';

/** The public list on /request (T433) and the two seeded requests. */

/** A full stored request, with every private field filled, as the list's input sees it. */
function stored(over: Partial<ChangeRequestDoc & { createdAtMs: number }> = {}) {
  return {
    email: 'secret.sender@example.com',
    description: 'Make the speaker photos bigger.',
    pageUrl: 'https://www.knowledgegraph.tech/speakers?ref=private-host-detail',
    screenshots: ['change-requests/abc1234567/shot-1.png'],
    notes: 'internal: probably a sponsor',
    ipHash: 'deadbeefdeadbeefdeadbeefdeadbeef',
    updatedBy: 'owner@harness.test',
    status: 'new' as const,
    createdAtMs: 1_700_000_000_000,
    ...over,
  };
}

/** Hand the whole stored object through, as a careless caller might. */
const src = (d: ReturnType<typeof stored>) => d as unknown as PublicSource;

describe('the public change request list (T433)', () => {
  it('lists new, building, built and live, and never declined', () => {
    for (const status of STATUSES) {
      const row = toPublicChangeRequest('id1234567890', src(stored({ status })));
      if (status === 'declined') expect(row).toBeNull();
      else expect(row?.status).toBe(status);
    }
  });

  it('never lists a request an owner hid', () => {
    expect(toPublicChangeRequest('id1234567890', src(stored({ hiddenFromPublic: true })))).toBeNull();
    expect(toPublicChangeRequest('id1234567890', src(stored({ hiddenFromPublic: false })))).not.toBeNull();
    expect(toPublicChangeRequest('id1234567890', src(stored()))).not.toBeNull();
  });

  it('carries only an id, the summary, the status and the date: never email, notes, screenshots, ip or the page link', () => {
    const row = toPublicChangeRequest('id1234567890', src(stored()))!;
    expect(Object.keys(row).sort()).toEqual(['id', 'sentMs', 'status', 'summary']);
    const json = JSON.stringify(row);
    for (const secret of ['secret.sender', '@example.com', 'internal', 'shot-1', 'deadbeef', 'knowledgegraph.tech', 'private-host', 'owner@']) {
      expect(json).not.toContain(secret);
    }
  });

  it('drops an unknown status or an empty description', () => {
    expect(toPublicChangeRequest('id1234567890', src(stored({ status: 'weird' as never })))).toBeNull();
    expect(toPublicChangeRequest('id1234567890', src(stored({ description: '   \n ' })))).toBeNull();
  });

  it('keeps markup as plain text for React to escape', () => {
    const row = toPublicChangeRequest('id1234567890', src(stored({ description: '<img src=x onerror=alert(1)> please' })))!;
    expect(row.summary).toBe('<img src=x onerror=alert(1)> please');
  });

  it('is newest first and stops at the limit, after hidden and declined are dropped', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: `id${String(i).padStart(10, '0')}`,
      source: src(stored({ createdAtMs: i * 1000, status: i % 7 === 0 ? 'declined' : 'live', hiddenFromPublic: i % 5 === 0 })),
    }));
    const out = publicChangeRequests(rows);
    expect(out).toHaveLength(PUBLIC_LIST_MAX);
    expect(out.map((r) => r.sentMs)).toEqual([...out.map((r) => r.sentMs)].sort((a, b) => b - a));
    expect(out.some((r) => (r.status as string) === 'declined')).toBe(false);
    expect(out[0].sentMs).toBe(99_000);
  });
});

describe('publicSummary (T433)', () => {
  it('flattens line breaks and keeps a short text whole', () => {
    expect(publicSummary('Fix\n\nthe   typo.')).toBe('Fix the typo.');
  });

  it('cuts a long text at a word, with an ellipsis and no em dash', () => {
    const long = 'word '.repeat(60);
    const out = publicSummary(long);
    expect(out.length).toBeLessThanOrEqual(141);
    expect(out.endsWith('word…')).toBe(true);
    expect(out).not.toContain('—');
  });

  it('cuts one very long word at the limit', () => {
    expect(publicSummary('x'.repeat(300))).toBe(`${'x'.repeat(140)}…`);
  });
});

/** An in-memory store that counts writes. */
function memoryStore() {
  const docs = new Map<string, ChangeRequestDoc>();
  let writes = 0;
  const store: SeedStore = {
    exists: async (id) => docs.has(id),
    create: async (id, doc) => {
      if (docs.has(id)) throw new Error('already-exists');
      writes++;
      docs.set(id, doc);
    },
  };
  return { store, docs, writes: () => writes };
}

describe('seeding the two live requests (T433)', () => {
  const stampFor = (i: number) => ({ toMillis: () => 1_763_510_400_000 - i * 1000 });

  it('writes nothing on a dry run', async () => {
    const m = memoryStore();
    const lines = await seedChangeRequests(m.store, { apply: false, stampFor });
    expect(lines.map((l) => l.action)).toEqual(['would-create', 'would-create']);
    expect(m.writes()).toBe(0);
  });

  it('creates both as Live from contact@, with both emails already claimed', async () => {
    const m = memoryStore();
    await seedChangeRequests(m.store, { apply: true, stampFor });
    expect([...m.docs.keys()]).toEqual(CHANGE_REQUEST_SEED.map((s) => s.id));
    for (const doc of m.docs.values()) {
      expect(doc.status).toBe('live');
      expect(doc.email).toBe(SEED_SENDER);
      expect(doc.emailed?.built).toBeTruthy();
      expect(doc.emailed?.live).toBeTruthy();
      expect(doc.screenshots).toEqual([]);
    }
    expect([...m.docs.values()].map((d) => d.description)).toEqual([
      'Add a sponsor offers tick box to the ticket checkout',
      "Add 'How did you hear about the conference?' to the ticket checkout",
    ]);
    // The sponsor box is the newer, so the public list shows it first.
    const [a, b] = [...m.docs.values()].map((d) => (d.createdAt as unknown as { toMillis(): number }).toMillis());
    expect(a).toBeGreaterThan(b);
  });

  it('is idempotent: a second run writes nothing and leaves an owner change alone', async () => {
    const m = memoryStore();
    await seedChangeRequests(m.store, { apply: true, stampFor });
    m.docs.get(CHANGE_REQUEST_SEED[0].id)!.hiddenFromPublic = true;
    const lines = await seedChangeRequests(m.store, { apply: true, stampFor });
    expect(lines.map((l) => l.action)).toEqual(['exists', 'exists']);
    expect(m.writes()).toBe(2);
    expect(m.docs.get(CHANGE_REQUEST_SEED[0].id)!.hiddenFromPublic).toBe(true);
  });

  it('can never owe an email: no status move from Live sends one', async () => {
    const m = memoryStore();
    await seedChangeRequests(m.store, { apply: true, stampFor });
    for (const doc of m.docs.values()) {
      for (const a of STATUSES) for (const b of STATUSES) expect(emailForTransition(a, b, doc.emailed)).toBeNull();
    }
  });

  it('uses ids the dashboard accepts, and lists on the public page', () => {
    for (const { id, description } of CHANGE_REQUEST_SEED) {
      expect(id).toMatch(/^[A-Za-z0-9]{10,40}$/);
      expect(toPublicChangeRequest(id, { description, status: 'live', createdAtMs: 1 })?.summary).toBe(description);
    }
  });

  it('does not import the mailer', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const text = readFileSync(fileURLToPath(new URL('./change-requests-seed.ts', import.meta.url)), 'utf8');
    expect(text).not.toMatch(/from ['"][^'"]*email/);
  });
});
