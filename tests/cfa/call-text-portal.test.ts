/**
 * The call's formatted text on the public page (T277), against the emulator:
 * old plain-text calls render as before, formatted ones are sanitised again and
 * get their dates filled in.
 *
 * Run with: npm run test:cfa
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COLLECTIONS, EVENT_ID } from '@kgc/shared';
import { db } from '@/lib/firestore';
import { loadCall } from '@/lib/submissions';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:cfa');
  }
});

beforeEach(async () => {
  const snap = await db().collection(COLLECTIONS.calls).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
});

const PLAIN = 'We want real work.\nNo pitches.\n\n- Decisions by [DECISION DATE].\n\nSubmissions close [CLOSE DATE].';

async function seed(id: string, over: Record<string, unknown>) {
  await db()
    .collection(COLLECTIONS.calls)
    .doc(id)
    .set({
      eventId: EVENT_ID,
      title: 'Call for Presentations. KGC 2027',
      instructions: PLAIN,
      status: 'published',
      timeZone: 'America/New_York',
      opensAtLocal: '2026-10-01T00:00',
      closesAtLocal: '2099-01-31T23:59',
      opensAt: new Date('2026-10-01T04:00:00Z'),
      closesAt: new Date('2099-02-01T04:59:00Z'),
      sessionTypes: ['talk'],
      trackIds: [],
      form: [],
      formVersion: 1,
      cfp: { closeDate: '2027-01-31' },
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    });
}

describe('loadCall and the formatted text', () => {
  it('leaves a plain-text call exactly as before: no document, same filled text', async () => {
    await seed('plain', {});
    const call = await loadCall('plain');
    expect(call?.instructionsDoc).toBeUndefined();
    expect(call?.instructions).toBe('We want real work.\nNo pitches.\n\nSubmissions close Sunday 31 January 2027.');
  });

  it('sanitises a stored document again and fills its dates', async () => {
    await seed('rich', {
      instructionsDoc: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'How we review' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Close: ' },
              { type: 'text', text: '[CLOSE DATE]', marks: [{ type: 'bold' }] },
              { type: 'text', text: '. Decisions by [DECISION DATE].' },
            ],
          },
          { type: 'image', attrs: { src: 'https://evil.example/x.png' } },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
          },
        ],
      }),
    });
    const call = await loadCall('rich');
    expect(call?.instructionsDoc?.content).toEqual([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'How we review' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Close: ' },
          { type: 'text', text: 'Sunday 31 January 2027', marks: [{ type: 'bold' }] },
          { type: 'text', text: '.' },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
    ]);
    expect(call?.instructions).toBe('How we review\n\nClose: Sunday 31 January 2027.\n\nx');
  });

  it('falls back to the plain text when the stored document is unreadable', async () => {
    await seed('broken', { instructionsDoc: '{nope' });
    expect((await loadCall('broken'))?.instructionsDoc).toBeUndefined();
  });
});
