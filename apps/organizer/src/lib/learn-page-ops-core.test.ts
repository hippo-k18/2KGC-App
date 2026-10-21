import { describe, expect, it } from 'vitest';
import type { LearnPageContent, LearnPageDoc } from '@kgc/shared';

import { LEARN_PAGE_DEFAULT, LearnConflict, planPublish, planReplaceDraft, planSave } from './learn-page-core';
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

describe('planScheduledPublish', () => {
  const scheduled = () => planSchedule(saved(), NOW + HOUR, 1, 'b@x', NOW);

  it('does nothing before the time, or with no schedule', () => {
    expect(planScheduledPublish(scheduled(), NOW + HOUR - 1)).toBeNull();
    expect(planScheduledPublish(saved(), NOW + 10 * HOUR)).toBeNull();
    expect(planScheduledPublish(null, NOW)).toBeNull();
  });

  it('publishes the draft at the time, notes "Scheduled", and clears the schedule', () => {
    const plan = planScheduledPublish(scheduled(), NOW + HOUR)!;
    expect(plan.draftChanged).toBe(false);
    expect(plan.version).toMatchObject({ note: SCHEDULED_NOTE, publishedBy: 'b@x', publishedAt: NOW + HOUR });
    expect(plan.doc.published?.seoTitle).toBe('A');
    expect(plan.doc).toMatchObject({ publishedAt: NOW + HOUR, publishedBy: 'b@x' });
    expect(plan.doc).not.toHaveProperty('scheduledPublishAt');
  });

  it('is idempotent: running again on its own result does nothing', () => {
    const plan = planScheduledPublish(scheduled(), NOW + HOUR)!;
    expect(planScheduledPublish(plan.doc, NOW + 2 * HOUR)).toBeNull();
  });

  it('publishes the latest draft when it changed after scheduling, and says so', () => {
    const edited = planSave(scheduled(), page('B'), 1, 'c@x', NOW + 1);
    const plan = planScheduledPublish(edited, NOW + 2 * HOUR)!;
    expect(plan.draftChanged).toBe(true);
    expect(plan.doc.published?.seoTitle).toBe('B');
    expect(plan.version.note).toBe(SCHEDULED_CHANGED_NOTE);
  });

  it('a late run (the timer was down) still publishes', () => {
    expect(planScheduledPublish(scheduled(), NOW + 48 * HOUR)).not.toBeNull();
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
