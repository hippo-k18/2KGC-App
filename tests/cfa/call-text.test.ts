/**
 * The call's formatted text and "Show on website" on the dashboard (T277),
 * against the emulator.
 *
 * Run with: npm run test:cfa
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COLLECTIONS, type CallDoc } from '@kgc/shared';
import { db } from '@/lib/firestore';
import { getCall, saveCall, type SaveCallInput } from '@/lib/calls';

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Use: npm run test:cfa');
  }
});

beforeEach(async () => {
  for (const name of [COLLECTIONS.calls, COLLECTIONS.auditLog]) {
    const snap = await db().collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
});

const input = (over: Partial<SaveCallInput> = {}): SaveCallInput => ({
  title: 'Call for Presentations. KGC 2027',
  instructions: '',
  status: 'published',
  opensAtLocal: '2026-11-01T00:00',
  closesAtLocal: '2099-02-28T23:59',
  sessionTypes: ['talk', 'workshop'],
  trackIds: [],
  allowOtherTrack: false,
  blindReview: 'single-blind',
  reviewsPerSubmission: 3,
  reminderDaysBefore: [],
  notifyEmails: [],
  actor: 'organizer@kgc.test',
  ...over,
});

const read = async (id: string) => (await db().collection(COLLECTIONS.calls).doc(id).get()).data() as CallDoc;

describe('Show on website: one call at a time', () => {
  it('turning it on for one call turns it off for the others, and the save says so', async () => {
    const a = await saveCall(input({ title: 'Call A', showOnWebsite: true }));
    const b = await saveCall(input({ title: 'Call B' }));
    if (!a.ok || !b.ok) throw new Error('setup');
    expect((await read(a.id)).showOnWebsite).toBe(true);

    const res = await saveCall(input({ id: b.id, title: 'Call B', showOnWebsite: true }));
    expect(res.ok && res.message).toContain('“Call A” is no longer shown on the website.');
    expect((await read(a.id)).showOnWebsite).toBe(false);
    expect((await read(b.id)).showOnWebsite).toBe(true);
  });

  it('can be turned off again, and a save that does not send it leaves it alone', async () => {
    const a = await saveCall(input({ showOnWebsite: true }));
    if (!a.ok) throw new Error('setup');
    await saveCall(input({ id: a.id, showOnWebsite: undefined }));
    expect((await read(a.id)).showOnWebsite).toBe(true);
    await saveCall(input({ id: a.id, showOnWebsite: false }));
    expect((await read(a.id)).showOnWebsite).toBe(false);
  });

  it('tells the organizer a draft call is not on the website yet', async () => {
    const res = await saveCall(input({ status: 'draft', showOnWebsite: true }));
    expect(res.ok && res.message).toContain('appears on the website once the call is published');
  });
});

describe('the formatted text', () => {
  const MIN = 'We want talks about real work.\nNo product pitches.\n\n- Talks: 25 minutes\n- Workshops: 90 minutes';

  it('opens a plain-text call in the editor as the same paragraphs and bullets, without writing anything', async () => {
    const a = await saveCall(input({ instructions: MIN }));
    if (!a.ok) throw new Error('setup');
    const row = await getCall(a.id);
    expect(row?.instructionsDoc.content.map((b) => b.type)).toEqual(['paragraph', 'bulletList']);
    expect((await read(a.id)).instructionsDoc).toBeUndefined();
  });

  it('never rewrites the text when the editor sent nothing (saving a date on Min\'s call)', async () => {
    const a = await saveCall(input({ instructions: MIN }));
    if (!a.ok) throw new Error('setup');
    await saveCall(input({ id: a.id, instructions: '', closesAtLocal: '2099-03-31T23:59' }));
    const doc = await read(a.id);
    expect(doc.instructions).toBe(MIN);
    expect(doc.instructionsDoc).toBeUndefined();
  });

  it('sanitises what the browser sent and saves a plain-text copy beside it', async () => {
    const sent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Formats' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bold', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: 'red' } }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'bad link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: '<script>alert(1)</script>' }] },
        { type: 'iframe', attrs: { src: 'https://evil.example' } },
      ],
    };
    const a = await saveCall(input({ instructionsDoc: JSON.stringify(sent) }));
    if (!a.ok) throw new Error('setup');
    const doc = await read(a.id);
    expect(JSON.parse(doc.instructionsDoc!)).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Formats' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'bad link' },
          ],
        },
      ],
    });
    expect(doc.instructions).toBe('Formats\n\nBold and bad link');
  });

  it('refuses a body that is not JSON rather than saving it', async () => {
    const res = await saveCall(input({ instructionsDoc: '<p onclick=x>hi</p>' }));
    expect(res.ok).toBe(false);
  });
});
