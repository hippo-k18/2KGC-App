import { describe, expect, it } from 'vitest';
import { readLearnPage, type LearnBlock, type LearnPageContent, type LearnPageDoc, type LearnSection } from '@kgc/shared';

import { LEARN_PAGE_DEFAULT, LearnConflict, planPublish, planReplaceDraft, planSave, readStoredDoc } from './learn-page-core';
import {
  LEARN_SCHEDULE_MAX_LEAD_MS,
  LearnOpRejected,
  SCHEDULED_CHANGED_NOTE,
  SCHEDULED_NOTE,
  learnPreviewUrl,
  planCancelSchedule,
  planPreviewToken,
  planRevokePreview,
  planSchedule,
  planScheduledPublish,
} from './learn-page-ops-core';
import { startEditFromBlock, startEditFromLibrary } from './learn-library-edit-core';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const TOKEN = 'a'.repeat(43);

function page(title: string): LearnPageContent {
  return { ...structuredClone(LEARN_PAGE_DEFAULT), seoTitle: title };
}

/** A stored doc at revision 1 with draft "A". */
function saved(): LearnPageDoc {
  return planSave(null, page('A'), 0, 'a@x', NOW - HOUR);
}

describe('planSchedule', () => {
  it('stores the time, who set it and the draft revision', () => {
    const doc = planSchedule(saved(), NOW + HOUR, 1, 'b@x', NOW);
    expect(doc).toMatchObject({ scheduledPublishAt: NOW + HOUR, scheduledBy: 'b@x', scheduledRevision: 1, revision: 1 });
    expect(doc.draft.seoTitle).toBe('A');
  });

  it('moves an existing schedule rather than adding a second', () => {
    const first = planSchedule(saved(), NOW + HOUR, 1, 'b@x', NOW);
    const moved = planSchedule(first, NOW + 2 * HOUR, 1, 'c@x', NOW);
    expect(moved).toMatchObject({ scheduledPublishAt: NOW + 2 * HOUR, scheduledBy: 'c@x' });
  });

  it('refuses a time in the past, under a minute away, or over a year away', () => {
    for (const at of [NOW - 1, NOW + 30_000, NOW + LEARN_SCHEDULE_MAX_LEAD_MS + 1, Number.NaN, '2027-01-01', null]) {
      expect(() => planSchedule(saved(), at, 1, 'b@x', NOW), String(at)).toThrow(LearnOpRejected);
    }
  });

  it('refuses a stale revision, so you schedule what you are looking at', () => {
    expect(() => planSchedule(saved(), NOW + HOUR, 0, 'b@x', NOW)).toThrow(LearnConflict);
  });

  it('refuses when nothing has been saved yet', () => {
    expect(() => planSchedule(null, NOW + HOUR, 0, 'b@x', NOW)).toThrow(/Save the draft/);
  });
});

describe('the schedule survives a draft save and is cleared by a publish', () => {
  it('a save keeps the schedule and the preview token', () => {
    const scheduled = { ...planSchedule(saved(), NOW + HOUR, 1, 'b@x', NOW), previewToken: TOKEN };
    const next = planSave(scheduled, page('B'), 1, 'a@x', NOW + 1);
    expect(next).toMatchObject({ scheduledPublishAt: NOW + HOUR, scheduledRevision: 1, previewToken: TOKEN, revision: 2 });
  });

  it('a revert or restore keeps them too', () => {
    const scheduled = { ...planSchedule(saved(), NOW + HOUR, 1, 'b@x', NOW), previewToken: TOKEN };
    expect(planReplaceDraft(scheduled, page('C'), 'a@x', NOW)).toMatchObject({ scheduledPublishAt: NOW + HOUR, previewToken: TOKEN });
  });

  it('publishing by hand clears the schedule but keeps the preview link', () => {
    const scheduled = { ...planSchedule(saved(), NOW + HOUR, 1, 'b@x', NOW), previewToken: TOKEN };
    const { doc } = planPublish(scheduled, 'a@x', NOW);
    expect(doc).not.toHaveProperty('scheduledPublishAt');
    expect(doc).not.toHaveProperty('scheduledBy');
    expect(doc).not.toHaveProperty('scheduledRevision');
    expect(doc.previewToken).toBe(TOKEN);
  });
});

describe('planCancelSchedule', () => {
  it('removes all three schedule fields', () => {
    const doc = planCancelSchedule(planSchedule(saved(), NOW + HOUR, 1, 'b@x', NOW));
    expect(doc).not.toBeNull();
    expect(Object.keys(doc!).filter((k) => k.startsWith('scheduled'))).toEqual([]);
  });

  it('returns null when nothing is scheduled', () => {
    expect(planCancelSchedule(saved())).toBeNull();
    expect(planCancelSchedule(null)).toBeNull();
  });
});

/** A due run that publishes; fails the test when it does not. */
function due(stored: LearnPageDoc, now: number, library: ReadonlyMap<string, LearnSection> = new Map()) {
  const plan = planScheduledPublish(stored, now, library);
  if (!plan || !plan.ok) throw new Error(`expected a publish, got ${plan ? plan.message : 'nothing due'}`);
  return plan;
}

/** A due run that refuses; fails the test when it publishes. */
function refused(stored: LearnPageDoc, now: number, library: ReadonlyMap<string, LearnSection> = new Map()) {
  const plan = planScheduledPublish(stored, now, library);
  if (!plan || plan.ok) throw new Error(plan ? 'expected a refusal, got a publish' : 'expected a refusal, got nothing due');
  return plan;
}

function section(id: string, blocks: LearnBlock[]): LearnSection {
  return { id, label: id, background: 'plain', width: 'normal', paddingTop: 'medium', paddingBottom: 'medium', blocks };
}

/** Draft "A" with one more section holding `blocks`, saved and scheduled for NOW + HOUR. */
function scheduledWith(...blocks: LearnBlock[]): LearnPageDoc {
  const p = page('A');
  p.sections.push(section('extra', blocks));
  return planSchedule(planSave(null, p, 0, 'a@x', NOW - HOUR), NOW + HOUR, 1, 'b@x', NOW);
}

const EMPTY_IMAGE: LearnBlock = {
  id: 'img1',
  kind: 'image',
  image: { src: '', alt: '', width: 0, height: 0 },
  width: 'medium',
  shape: 'original',
};

describe('planScheduledPublish', () => {
  const scheduled = () => planSchedule(saved(), NOW + HOUR, 1, 'b@x', NOW);

  it('does nothing before the time, or with no schedule', () => {
    expect(planScheduledPublish(scheduled(), NOW + HOUR - 1)).toBeNull();
    expect(planScheduledPublish(saved(), NOW + 10 * HOUR)).toBeNull();
    expect(planScheduledPublish(null, NOW)).toBeNull();
  });

  it('publishes the draft at the time, notes "Scheduled", and clears the schedule', () => {
    const plan = due(scheduled(), NOW + HOUR);
    expect(plan.draftChanged).toBe(false);
    expect(plan.version).toMatchObject({ note: SCHEDULED_NOTE, publishedBy: 'b@x', publishedAt: NOW + HOUR });
    expect(plan.doc.published?.seoTitle).toBe('A');
    expect(plan.doc).toMatchObject({ publishedAt: NOW + HOUR, publishedBy: 'b@x' });
    expect(plan.doc).not.toHaveProperty('scheduledPublishAt');
  });

  it('is idempotent: running again on its own result does nothing', () => {
    const plan = due(scheduled(), NOW + HOUR);
    expect(planScheduledPublish(plan.doc, NOW + 2 * HOUR)).toBeNull();
  });

  it('publishes the latest draft when it changed after scheduling, and says so', () => {
    const edited = planSave(scheduled(), page('B'), 1, 'c@x', NOW + 1);
    const plan = due(edited, NOW + 2 * HOUR);
    expect(plan.draftChanged).toBe(true);
    expect(plan.doc.published?.seoTitle).toBe('B');
    expect(plan.version.note).toBe(SCHEDULED_CHANGED_NOTE);
  });

  it('a late run (the timer was down) still publishes', () => {
    expect(due(scheduled(), NOW + 48 * HOUR).ok).toBe(true);
  });
});

describe('planScheduledPublish makes the checks a press of Publish makes', () => {
  it('refuses a draft with an empty Image block: clears the schedule, keeps the draft, records why', () => {
    const stored = scheduledWith(EMPTY_IMAGE);
    const plan = refused(stored, NOW + HOUR);
    expect(plan.problems).toEqual(['The Image block in "extra" has no image yet. Choose one or remove the block.']);
    expect(plan.message).toBe('Some blocks are not filled in yet. The Image block in "extra" has no image yet. Choose one or remove the block.');
    expect(plan.doc).not.toHaveProperty('scheduledPublishAt');
    expect(plan.doc).not.toHaveProperty('scheduledBy');
    expect(plan.doc).not.toHaveProperty('scheduledRevision');
    expect(plan.doc.scheduleFailure).toEqual({ at: NOW + HOUR, message: plan.message });
    // Nothing was published and nothing else moved.
    expect(plan.doc.published).toBeNull();
    expect(plan.doc).not.toHaveProperty('publishedAt');
    expect(plan.doc.draft).toEqual(stored.draft);
    expect(plan.doc.revision).toBe(stored.revision);
    // The next tick finds nothing due, so the timer stops retrying.
    expect(planScheduledPublish(plan.doc, NOW + 2 * HOUR)).toBeNull();
  });

  it('refuses a stored draft that no longer passes the validator', () => {
    const stored = { ...scheduledWith(), draft: { ...page('A'), sections: 'not a list' } as unknown as LearnPageContent };
    const plan = refused(stored, NOW + HOUR);
    expect(plan.message).toMatch(/The saved draft has problems:/);
    expect(plan.problems.length).toBeGreaterThan(0);
    expect(plan.doc.scheduleFailure?.at).toBe(NOW + HOUR);
  });

  it('expands a saved section into the live copy and the version', () => {
    const stored = scheduledWith({ id: 'r1', kind: 'reusable', libraryId: 'cta' });
    const library = new Map([['cta', section('saved', [{ id: 't1', kind: 'text', text: 'Apply now' }])]]);
    const plan = due(stored, NOW + HOUR, library);
    const kinds = (c: LearnPageContent | null) => (c?.sections ?? []).flatMap((s) => s.blocks.map((b) => b.kind));
    expect(kinds(plan.doc.published)).not.toContain('reusable');
    expect(kinds(plan.doc.published)).toContain('text');
    expect(JSON.stringify(plan.doc.published)).toContain('Apply now');
    expect(plan.version.content).toEqual(plan.doc.published);
    // The draft keeps the link, so a later edit to the saved section still reaches it.
    expect(kinds(plan.doc.draft)).toContain('reusable');
  });

  it('refuses when a saved section makes the expanded page fail the checks', () => {
    const stored = scheduledWith({ id: 'r1', kind: 'reusable', libraryId: 'cta' });
    const broken = section('saved', [{ id: 't1', kind: 'text', text: 42 } as unknown as LearnBlock]);
    const plan = refused(stored, NOW + HOUR, new Map([['cta', broken]]));
    expect(plan.message).toMatch(/With its saved sections filled in, the page does not pass the checks:/);
    expect(plan.doc).not.toHaveProperty('scheduledPublishAt');
  });

  it('refuses an empty Image block that sits inside a saved section', () => {
    const stored = scheduledWith({ id: 'r1', kind: 'reusable', libraryId: 'cta' });
    const plan = refused(stored, NOW + HOUR, new Map([['cta', section('saved', [EMPTY_IMAGE])]]));
    expect(plan.message).toMatch(/not filled in yet/);
    expect(plan.doc.published).toEqual(stored.published);
  });

  it('an empty Saved section block clears the schedule with a failure, never throws (T324 X1)', () => {
    const stored = scheduledWith({ id: 'r1', kind: 'reusable', libraryId: '' });
    let plan: ReturnType<typeof planScheduledPublish> = null;
    expect(() => (plan = planScheduledPublish(stored, NOW + HOUR, new Map()))).not.toThrow();
    const failed = refused(stored, NOW + HOUR);
    expect(plan).not.toBeNull();
    expect(failed.problems).toEqual([
      'The Saved section block in "extra" has no saved section chosen yet. Choose one or remove the block.',
    ]);
    expect(failed.message).toMatch(/^Some blocks are not filled in yet\. The Saved section block in "extra"/);
    expect(failed.doc).not.toHaveProperty('scheduledPublishAt');
    expect(failed.doc.scheduleFailure).toEqual({ at: NOW + HOUR, message: failed.message });
    expect(planScheduledPublish(failed.doc, NOW + 2 * HOUR)).toBeNull();
  });

  it('a Saved section block whose section was deleted from the library fails the same way (T324 E F7)', () => {
    const stored = scheduledWith({ id: 'r1', kind: 'reusable', libraryId: 'gone' });
    const plan = refused(stored, NOW + HOUR, new Map([['other', section('saved', [])]]));
    expect(plan.problems).toEqual([
      'The Saved section block in "extra" shows a saved section that was deleted. Remove the block or choose another saved section.',
    ]);
  });

  it('anything that throws during the run takes the failure path with a plain message (T324 X1)', () => {
    class Boom extends Map<string, LearnSection> {
      override get(): LearnSection | undefined {
        throw new Error('library read went wrong');
      }
    }
    const stored = scheduledWith({ id: 'r1', kind: 'reusable', libraryId: 'cta' });
    const plan = refused(stored, NOW + HOUR, new Boom([['cta', section('saved', [])]]));
    expect(plan.message).toBe('Something went wrong while publishing. Open the editor and press Publish, or schedule it again.');
    expect(plan.problems).toEqual([]);
    expect((plan.error as Error).message).toBe('library read went wrong');
    expect(plan.doc).not.toHaveProperty('scheduledPublishAt');
    expect(plan.doc.scheduleFailure).toEqual({ at: NOW + HOUR, message: plan.message });
    expect(plan.doc.published).toEqual(stored.published);
  });

  it('names at most five problems in the message', () => {
    const blocks = Array.from({ length: 7 }, (_, i) => ({ ...EMPTY_IMAGE, id: `img${i}` }));
    const plan = refused(scheduledWith(...blocks), NOW + HOUR);
    expect(plan.problems).toHaveLength(7);
    expect(plan.message).toMatch(/And 2 more\.$/);
  });

  it('a new schedule or a publish clears the recorded failure, a draft save keeps it', () => {
    const failed = refused(scheduledWith(EMPTY_IMAGE), NOW + HOUR).doc;
    const fixed = planSave(failed, page('Fixed'), failed.revision, 'a@x', NOW + 2 * HOUR);
    expect(fixed.scheduleFailure).toEqual(failed.scheduleFailure);
    expect(planSchedule(fixed, NOW + 3 * HOUR, fixed.revision, 'b@x', NOW + 2 * HOUR)).not.toHaveProperty('scheduleFailure');
    expect(planPublish(fixed, 'a@x', NOW + 2 * HOUR).doc).not.toHaveProperty('scheduleFailure');
  });
});

describe('a scheduled publish during Edit saved section publishes the link, not the copy (T326 R1)', () => {
  const SAVED: LearnSection = { ...section('lib', [{ id: 'h', kind: 'heading', text: 'Team', level: 2 }]), label: 'Team band' };
  const LIB = new Map([['L1', SAVED]]);
  const linked = (): LearnPageContent => {
    const p = page('A');
    p.sections.push(section('bandx', [{ id: 'r1', kind: 'reusable', libraryId: 'L1' }]));
    return p;
  };
  const typed = (c: LearnPageContent, id: string): LearnPageContent => ({
    ...c,
    sections: c.sections.map((s) =>
      s.id === id ? { ...s, blocks: s.blocks.map((b) => (b.kind === 'heading' ? { ...b, text: 'UNSAVED' } : b)) } : s,
    ),
  });
  const scheduledDraft = (draft: LearnPageContent) =>
    planSchedule(planSave(null, draft, 0, 'a@x', NOW - HOUR), NOW + HOUR, 1, 'b@x', NOW);
  const liveOf = (draft: LearnPageContent) => due(scheduledDraft(draft), NOW + HOUR, LIB).doc.published;

  it('started from the block', () => {
    const started = startEditFromBlock(linked(), 'bandx', 'r1', LIB, 'Team band')!;
    const draft = typed(started.content, 'bandx');
    const plan = due(scheduledDraft(draft), NOW + HOUR, LIB);
    expect(plan.doc.published).toEqual(liveOf(linked()));
    expect(JSON.stringify(plan.doc.published)).not.toContain('UNSAVED');
    expect(JSON.stringify(plan.version.content)).not.toContain('libraryEdit');
    // The draft keeps the copy, so the edit goes on after the publish.
    expect(plan.doc.draft).toEqual(draft);
  });

  it('started from the library list: the section is on the page once', () => {
    const started = startEditFromLibrary(linked(), 1, 'L1', SAVED, 'Team band');
    const plan = due(scheduledDraft(typed(started.content, started.edit.sectionId)), NOW + HOUR, LIB);
    expect(plan.doc.published).toEqual(liveOf(linked()));
    expect(plan.doc.published!.sections.filter((s) => s.blocks.some((b) => b.kind === 'heading' && b.text === 'Team'))).toHaveLength(1);
  });

  it("the website's reader never sees the marker", () => {
    const started = startEditFromBlock(linked(), 'bandx', 'r1', LIB, 'Team band')!;
    expect(JSON.stringify(readLearnPage(started.content))).not.toContain('libraryEdit');
  });
});

describe('readStoredDoc carries the schedule, the preview link and a failure to the editor', () => {
  it('keeps them when they are well formed', () => {
    const failed = refused(scheduledWith(EMPTY_IMAGE), NOW + HOUR).doc;
    const raw = { ...planSchedule(saved(), NOW + HOUR, 1, 'b@x', NOW), previewToken: TOKEN, scheduleFailure: failed.scheduleFailure };
    const read = readStoredDoc(raw);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.doc).toMatchObject({
      scheduledPublishAt: NOW + HOUR,
      scheduledBy: 'b@x',
      scheduledRevision: 1,
      previewToken: TOKEN,
      scheduleFailure: failed.scheduleFailure,
    });
  });

  it('drops them when they are the wrong type', () => {
    const raw = { ...saved(), scheduledPublishAt: 'soon', previewToken: 7, scheduleFailure: { at: 'x', message: 1 } };
    const read = readStoredDoc(raw);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.doc).not.toHaveProperty('scheduledPublishAt');
    expect(read.doc).not.toHaveProperty('previewToken');
    expect(read.doc).not.toHaveProperty('scheduleFailure');
  });
});

describe('preview token', () => {
  it('sets, rotates and revokes the token without touching anything else', () => {
    const base = planSchedule(saved(), NOW + HOUR, 1, 'b@x', NOW);
    const withToken = planPreviewToken(base, TOKEN);
    expect(withToken).toMatchObject({ previewToken: TOKEN, scheduledPublishAt: NOW + HOUR, revision: 1 });
    const rotated = planPreviewToken(withToken, 'b'.repeat(43));
    expect(rotated.previewToken).toBe('b'.repeat(43));
    const revoked = planRevokePreview(rotated)!;
    expect(revoked).not.toHaveProperty('previewToken');
    expect(revoked.scheduledPublishAt).toBe(NOW + HOUR);
  });

  it('needs a saved draft, and revoking nothing returns null', () => {
    expect(() => planPreviewToken(null, TOKEN)).toThrow(LearnOpRejected);
    expect(planRevokePreview(saved())).toBeNull();
    expect(planRevokePreview(null)).toBeNull();
  });

  it('builds the link on the website', () => {
    expect(learnPreviewUrl('https://www.knowledgegraph.tech/', TOKEN)).toBe(
      `https://www.knowledgegraph.tech/learn/preview/${TOKEN}`,
    );
  });
});
