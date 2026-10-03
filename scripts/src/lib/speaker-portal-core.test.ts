import { describe, expect, it } from 'vitest';

import {
  approvalPlan,
  draftChanges,
  isOurOwnImage,
  linkIsLive,
  normaliseDraft,
  portalLinkOpens,
  trackerCounts,
} from './speaker-portal-core.js';

/**
 * Speaker self-service, minus Firestore.
 *
 * The two failures worth writing tests against are the ones that are silent:
 * a cleared field that quietly keeps its old value (AGENTS.md gotcha 9, which
 * has been found live in this repo three times), and a link that keeps working
 * after somebody pressed Revoke.
 */

describe('linkIsLive', () => {
  it('lets every link through while nothing has been revoked', () => {
    expect(linkIsLive(1_000, undefined)).toBe(true);
  });

  it('kills a link minted before the revocation', () => {
    expect(linkIsLive(999, 1_000)).toBe(false);
  });

  it('keeps a link minted after it', () => {
    expect(linkIsLive(1_001, 1_000)).toBe(true);
  });

  it('keeps a link minted in the same millisecond as the revocation', () => {
    // Revoke and re-send is one press on the dashboard, and both writes can
    // land inside one millisecond. A `>` here would mail a link that is already
    // dead, which reads as "the link you sent me does not work".
    expect(linkIsLive(1_000, 1_000)).toBe(true);
  });
});

/**
 * The check every entry point makes, reading and writing alike.
 *
 * It exists because revocation used to be checked on the page and nowhere
 * else: "Revoke link" 404'd the page while the save action, which verified the
 * signature and nothing more, kept writing that speaker's bio, company, photo
 * link and slides links for the remaining 180 days of the token. A 180-day
 * capability has exactly one control and it covered half the feature.
 */
describe('portalLinkOpens', () => {
  const EVENT = 'kgc-2027';

  it('opens a live link for a speaker on this programme', () => {
    expect(portalLinkOpens({ iat: 1_000, speakerEventId: EVENT, eventId: EVENT })).toBe(true);
  });

  it('refuses a revoked link, which is the half the write path used to skip', () => {
    expect(
      portalLinkOpens({
        iat: 999,
        linksValidFrom: 1_000,
        speakerEventId: EVENT,
        eventId: EVENT,
      }),
    ).toBe(false);
  });

  it('refuses a speaker who is not on this event, or not there at all', () => {
    expect(portalLinkOpens({ iat: 1_000, speakerEventId: 'kgc-2026', eventId: EVENT })).toBe(false);
    expect(portalLinkOpens({ iat: 1_000, speakerEventId: undefined, eventId: EVENT })).toBe(false);
  });
});

describe('normaliseDraft', () => {
  const sessions = ['ses-keynote', 'ses-workshop'];

  it('trims what was typed', () => {
    const { draft, errors } = normaliseDraft(
      { title: '  Principal Engineer  ', company: ' Acme Graphs ' },
      sessions,
    );

    expect(errors).toEqual([]);
    expect(draft.title).toBe('Principal Engineer');
    expect(draft.company).toBe('Acme Graphs');
  });

  it('keeps an emptied box as an empty string rather than dropping it', () => {
    // The whole of gotcha 9 in one assertion. An absent key means "left alone";
    // an empty string means "clear it". Collapsing the two to `undefined` is
    // what makes a form say Saved and change nothing.
    const { draft } = normaliseDraft({ title: '   ' }, sessions);

    expect(draft.title).toBe('');
    expect('company' in draft).toBe(false);
  });

  it('accepts an https link and refuses anything that is not a web address', () => {
    expect(normaliseDraft({ website: 'https://ada.example' }, sessions).draft.social?.website).toBe(
      'https://ada.example',
    );

    const bad = normaliseDraft({ website: 'ada.example' }, sessions);
    expect(bad.draft.social?.website).toBe('');
    expect(bad.errors[0]).toMatch(/web address/);
  });

  it('refuses a javascript: URL', () => {
    // These strings are rendered as hrefs on the public website and in the app.
    const { draft, errors } = normaliseDraft(
      { photoURL: 'javascript:alert(document.cookie)' },
      sessions,
    );

    expect(draft.photoURL).toBe('');
    expect(errors).toHaveLength(1);
  });

  it('drops a slides link against a session this speaker is not on', () => {
    // The only way to send one is to edit the form's field names by hand.
    // Dropped rather than refused: naming the session ids that do exist would
    // answer a question nobody holding this link should be asking.
    const { draft, errors } = normaliseDraft(
      { slides: { 'ses-keynote': 'https://slides.example/k', 'ses-someone-else': 'https://x.example' } },
      sessions,
    );

    expect(draft.slides).toEqual({ 'ses-keynote': 'https://slides.example/k' });
    expect(errors).toEqual([]);
  });

  it('caps a bio that would not fit on any page', () => {
    const { draft, errors } = normaliseDraft({ bio: 'x'.repeat(2500) }, sessions);

    expect(draft.bio).toHaveLength(2000);
    expect(errors[0]).toMatch(/too long/);
  });
});

describe('draftChanges', () => {
  it('lists only what is genuinely different', () => {
    const changes = draftChanges(
      { title: 'Engineer', company: 'Acme', bio: 'Same bio' },
      { title: 'Principal Engineer', company: 'Acme', bio: 'Same bio' },
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: 'title', before: 'Engineer', after: 'Principal Engineer' });
  });

  it('shows a clearance as a change with nothing after it', () => {
    const changes = draftChanges({ company: 'Acme' }, { company: '' });

    expect(changes).toHaveLength(1);
    expect(changes[0].before).toBe('Acme');
    expect(changes[0].after).toBeUndefined();
  });

  it('ignores a field the speaker never touched', () => {
    expect(draftChanges({ bio: 'On file' }, { title: 'New title' }).map((c) => c.field)).toEqual([
      'title',
    ]);
  });

  it('names the session a slides link belongs to', () => {
    const changes = draftChanges(
      { slides: {} },
      { slides: { 'ses-keynote': 'https://slides.example/k' } },
    );

    expect(changes[0].field).toBe('slides:ses-keynote');
    expect(changes[0].after).toBe('https://slides.example/k');
  });
});

describe('approvalPlan', () => {
  const sessions = ['ses-keynote'];

  it('writes only the fields that changed', () => {
    const plan = approvalPlan(
      { title: 'Engineer', company: 'Acme' },
      { title: 'Principal Engineer', company: 'Acme' },
      sessions,
    );

    expect(plan.speaker).toEqual({ title: 'Principal Engineer' });
    expect(plan.sessions).toEqual({});
  });

  /**
   * ⚠️ The photo is the one field an approval does not publish.
   *
   * Approving a link to somebody else's server approves a promise rather than
   * a picture: every visitor to the public speakers page would hand that host
   * their IP address and the page they came from, and whatever was approved
   * can be swapped afterwards with no second decision. So the draft holds it,
   * the organizer sees it, and the picture reaches the website the way every
   * other image in this product does.
   */
  it('does not publish a photo link pointing at somebody else', () => {
    const plan = approvalPlan(
      { photoURL: 'https://firebasestorage.googleapis.com/v0/b/kgc/o/speakers%2Fada.png' },
      { photoURL: 'https://cdn.elsewhere.example/ada.jpg', title: 'Principal Engineer' },
      sessions,
    );

    expect(plan.speaker).toEqual({ title: 'Principal Engineer' });
    expect(plan.heldPhotoURL).toBe('https://cdn.elsewhere.example/ada.jpg');
  });

  it('publishes a photo we host ourselves, and still lets one be cleared', () => {
    const ours = 'https://firebasestorage.googleapis.com/v0/b/kgc/o/speakers%2Fada.png';
    expect(approvalPlan({}, { photoURL: ours }, sessions)).toMatchObject({
      speaker: { photoURL: ours },
    });
    // Clearing is not held back: there is nothing for a browser to fetch.
    const cleared = approvalPlan({ photoURL: 'https://cdn.elsewhere.example/a.jpg' }, { photoURL: '' }, sessions);
    expect(cleared.speaker).toEqual({ photoURL: null });
    expect(cleared.heldPhotoURL).toBeUndefined();
  });

  it('knows one of our own image links from anybody else’s', () => {
    expect(isOurOwnImage('https://firebasestorage.googleapis.com/v0/b/kgc/o/a.png')).toBe(true);
    expect(isOurOwnImage('https://firebasestorage.googleapis.com.evil.example/a.png')).toBe(false);
    expect(isOurOwnImage('http://firebasestorage.googleapis.com/a.png')).toBe(false);
    expect(isOurOwnImage('https://cdn.elsewhere.example/a.jpg')).toBe(false);
  });

  it('turns a cleared field into a deletion rather than an absent key', () => {
    // `undefined` on a merge write stores no key, the old value survives and
    // the organizer is told it saved. `null` is what each caller turns into its
    // own copy of FieldValue.delete().
    expect(approvalPlan({ company: 'Acme' }, { company: '' }, sessions).speaker).toEqual({
      company: null,
    });
  });

  it('rebuilds the whole social map so the other two links are not lost', () => {
    // Nested maps merge key by key under `merge: true`, so writing only the
    // changed key would look right and quietly keep a stale LinkedIn URL.
    const plan = approvalPlan(
      { social: { linkedin: 'https://li.example/ada', x: 'https://x.example/ada' } },
      { social: { website: 'https://ada.example' } },
      sessions,
    );

    expect(plan.speaker.social).toEqual({
      linkedin: 'https://li.example/ada',
      x: 'https://x.example/ada',
      website: 'https://ada.example',
    });
  });

  it('deletes the social map when the last link is cleared', () => {
    expect(
      approvalPlan({ social: { website: 'https://ada.example' } }, { social: { website: '' } }, sessions)
        .speaker.social,
    ).toBeNull();
  });

  it('writes a slides link onto the session, and only a session the speaker is on', () => {
    const plan = approvalPlan(
      {},
      { slides: { 'ses-keynote': 'https://slides.example/k', 'ses-other': 'https://x.example' } },
      sessions,
    );

    expect(plan.sessions).toEqual({ 'ses-keynote': 'https://slides.example/k' });
  });

  it('clears a slides link the speaker emptied', () => {
    expect(
      approvalPlan({ slides: { 'ses-keynote': 'https://old.example' } }, { slides: { 'ses-keynote': '' } }, sessions)
        .sessions,
    ).toEqual({ 'ses-keynote': null });
  });
});

describe('trackerCounts', () => {
  it('counts each stage once', () => {
    const counts = trackerCounts([
      { status: 'sent', canBeSent: true },
      { status: 'opened', canBeSent: true },
      { status: 'submitted', canBeSent: true },
      { status: 'submitted', canBeSent: true },
      { status: 'approved', canBeSent: true },
      { canBeSent: true },
    ]);

    expect(counts).toMatchObject({ sent: 1, opened: 1, submitted: 2, approved: 1, notSent: 1 });
  });

  it('keeps a speaker with no address out of the chase list', () => {
    // "42 not sent" is a job. "42 not sent, 11 of them with no address on file"
    // is a job and a different job, and folding the two together hides the one
    // this screen cannot do anything about.
    const counts = trackerCounts([{ canBeSent: false }, { canBeSent: false }, { canBeSent: true }]);

    expect(counts.noAddress).toBe(2);
    expect(counts.notSent).toBe(1);
  });
});
