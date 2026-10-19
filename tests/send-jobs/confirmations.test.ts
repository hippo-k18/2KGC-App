/**
 * Attendee confirmations report what happened (T258 #15), against the
 * emulator: the import counts real outcomes, and running the same file again
 * mails only the registrations with no `sent` confirmation.
 *
 * Mail is captured to files (`EMAIL_CAPTURE_DIR`, no API key), which `send()`
 * logs as `sent`; with no capture and no key every send is `skipped`.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ requireOrganizer: async () => 'organizer@example.com', requirePassphrase: () => false }));
vi.mock('../../apps/organizer/node_modules/next/cache.js', () => ({ revalidatePath: () => {} }));

import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@kgc/shared';
import { db as dashDb } from '@/lib/firestore';
import { commitAttendeeImport } from '@/lib/import-attendees';
import { resendConfirmation } from '@/lib/attendee-admin';

let db: Firestore;
const csv = 'name,email\nAda Lovelace,ada@example.com\nBo Diddley,bo@example.com\n';

beforeAll(() => {
  db = dashDb() as unknown as Firestore;
});

beforeEach(async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_CAPTURE_DIR;
  for (const c of [COLLECTIONS.registrations, COLLECTIONS.emailLog, COLLECTIONS.auditLog, COLLECTIONS.users]) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
});

const run = () =>
  commitAttendeeImport({ text: csv, actor: 'organizer@example.com', allowPartial: false, sendEmails: true });

const sentRows = async () =>
  (await db.collection(COLLECTIONS.emailLog).get()).docs.filter(
    (d) => d.get('template') === 'purchase-confirmation' && d.get('status') === 'sent',
  );

describe('the attendee import', () => {
  it('counts nothing as emailed when nothing was sent', async () => {
    const out = await run();
    expect(out).toMatchObject({ created: 2, emailed: 0, emailFailed: 2 });
  });

  it('finishes on a re-run: only people with no sent confirmation are mailed', async () => {
    // First run with no way to send: both registrations exist, no mail went.
    await run();
    expect(await sentRows()).toHaveLength(0);

    process.env.EMAIL_CAPTURE_DIR = mkdtempSync(path.join(tmpdir(), 'kgc-t265-'));
    const second = await run();
    expect(second).toMatchObject({ created: 0, updated: 2, emailed: 2, emailFailed: 0 });
    expect(await sentRows()).toHaveLength(2);

    const third = await run();
    expect(third).toMatchObject({ emailed: 0, emailFailed: 0 });
    expect(await sentRows()).toHaveLength(2);
  });
});

describe('Resend confirmation', () => {
  it('says it was not sent when it was not', async () => {
    await run();
    const reg = (await db.collection(COLLECTIONS.registrations).get()).docs[0];
    const res = await resendConfirmation(reg.id, 'organizer@example.com');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('nothing was sent');
  });

  it('says sent when the provider took it', async () => {
    await run();
    process.env.EMAIL_CAPTURE_DIR = mkdtempSync(path.join(tmpdir(), 'kgc-t265-'));
    const reg = (await db.collection(COLLECTIONS.registrations).get()).docs[0];
    const res = await resendConfirmation(reg.id, 'organizer@example.com');
    expect(res).toMatchObject({ ok: true });
  });
});
