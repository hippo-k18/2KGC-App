/**
 * Scheduled publish and the draft preview link for the Learn page (T316),
 * against the Firestore emulator: the timer's step publishes once at the
 * scheduled time (even when two runs overlap), says so when the draft changed
 * after scheduling, audits the run, and a draft save never drops a schedule or
 * a preview token.
 *
 * Run with: npm run test:learn-ops
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { COLLECTIONS, LEARN_PAGE_DEFAULT, type LearnPageContent, type LearnPageDoc, isPreviewTokenShape } from '@kgc/shared';
import { db } from '@/lib/firestore';
import { publishLearnPage, saveLearnDraft } from '@/lib/learn-page';
import { LearnConflict } from '@/lib/learn-page-core';
import {
  cancelLearnSchedule,
  revokeLearnPreviewToken,
  rotateLearnPreviewToken,
  runLearnPageCronStep,
  runScheduledLearnPublish,
  scheduleLearnPublish,
} from '@/lib/learn-page-ops';
import { LearnOpRejected, SCHEDULED_CHANGED_NOTE, SCHEDULED_NOTE } from '@/lib/learn-page-ops-core';

const ACTOR = 'editor@kgc.test';
const HOUR = 3_600_000;

const docRef = () => db().collection(COLLECTIONS.pageLayouts).doc('learn');
const versionsRef = () => docRef().collection('versions');
const audit = () => db().collection(COLLECTIONS.auditLog);

function page(title: string): LearnPageContent {
  return { ...structuredClone(LEARN_PAGE_DEFAULT), seoTitle: title };
}

async function stored(): Promise<LearnPageDoc> {
  return (await docRef().get()).data() as LearnPageDoc;
}

async function versions() {
  const snap = await versionsRef().orderBy('publishedAt', 'desc').get();
  return snap.docs.map((d) => d.data());
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run with: npm run test:learn-ops');
});

beforeEach(async () => {
  await db().recursiveDelete(docRef());
  await db().recursiveDelete(audit());
});

describe('scheduled publish', () => {
  it('publishes the draft once at its time, notes "Scheduled", and audits the run', async () => {
    await saveLearnDraft(page('Spring'), 0, ACTOR);
    const at = Date.now() + HOUR;
    await scheduleLearnPublish(at, 1, ACTOR);
    expect(await stored()).toMatchObject({ scheduledPublishAt: at, scheduledBy: ACTOR, scheduledRevision: 1 });

    expect((await runLearnPageCronStep(at - 1)).published).toBe(false);
    expect((await stored()).published).toBeNull();

    const run = await runLearnPageCronStep(at);
    expect(run).toMatchObject({ published: true, draftChanged: false, scheduledBy: ACTOR });
    const doc = await stored();
    expect(doc.published?.seoTitle).toBe('Spring');
    expect(doc).toMatchObject({ publishedAt: at, publishedBy: ACTOR });
    expect(doc.scheduledPublishAt).toBeUndefined();
    expect(await versions()).toEqual([expect.objectContaining({ note: SCHEDULED_NOTE, publishedBy: ACTOR })]);

    const rows = (await audit().where('action', '==', 'learnPage.scheduledPublish').get()).docs.map((d) => d.data());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'system:schedule', after: { scheduledBy: ACTOR, draftChanged: false } });

    expect((await runLearnPageCronStep(at + HOUR)).published).toBe(false);
    expect(await versions()).toHaveLength(1);
  });

  it('two overlapping runs publish once', async () => {
    await saveLearnDraft(page('Race'), 0, ACTOR);
    const at = Date.now() + HOUR;
    await scheduleLearnPublish(at, 1, ACTOR);
    const runs = await Promise.all([runScheduledLearnPublish(at), runScheduledLearnPublish(at), runScheduledLearnPublish(at)]);
    expect(runs.filter((r) => r.published)).toHaveLength(1);
    expect(await versions()).toHaveLength(1);
  });

  it('publishes the latest draft when it was edited after scheduling, and says so', async () => {
    await saveLearnDraft(page('Monday'), 0, ACTOR);
    const at = Date.now() + HOUR;
    await scheduleLearnPublish(at, 1, ACTOR);
    await saveLearnDraft(page('Tuesday'), 1, 'other@kgc.test');
    expect((await stored()).scheduledPublishAt).toBe(at);

    const run = await runScheduledLearnPublish(at + 5);
    expect(run.draftChanged).toBe(true);
    expect((await stored()).published?.seoTitle).toBe('Tuesday');
    expect((await versions())[0].note).toBe(SCHEDULED_CHANGED_NOTE);
  });

  it('cancel stops it, and publishing by hand settles it', async () => {
    await saveLearnDraft(page('A'), 0, ACTOR);
    const at = Date.now() + HOUR;
    await scheduleLearnPublish(at, 1, ACTOR);
    expect(await cancelLearnSchedule()).toBe(at);
    expect(await cancelLearnSchedule()).toBeNull();
    expect((await runScheduledLearnPublish(at)).published).toBe(false);

    await scheduleLearnPublish(at, 1, ACTOR);
    await publishLearnPage({ baseRevision: 1, actor: ACTOR });
    expect((await stored()).scheduledPublishAt).toBeUndefined();
    expect((await runScheduledLearnPublish(at)).published).toBe(false);
    expect(await versions()).toHaveLength(1);
  });

  it('refuses a stale revision, a past time, and an unsaved page', async () => {
    await expect(scheduleLearnPublish(Date.now() + HOUR, 0, ACTOR)).rejects.toThrow(LearnOpRejected);
    await saveLearnDraft(page('A'), 0, ACTOR);
    await expect(scheduleLearnPublish(Date.now() + HOUR, 0, ACTOR)).rejects.toThrow(LearnConflict);
    await expect(scheduleLearnPublish(Date.now() - 1, 1, ACTOR)).rejects.toThrow(LearnOpRejected);
    expect((await stored()).scheduledPublishAt).toBeUndefined();
  });
});

describe('preview token', () => {
  it('is created, survives a save, rotates and revokes', async () => {
    await expect(rotateLearnPreviewToken()).rejects.toThrow(LearnOpRejected);
    await saveLearnDraft(page('A'), 0, ACTOR);

    const first = await rotateLearnPreviewToken();
    expect(isPreviewTokenShape(first)).toBe(true);
    expect((await stored()).previewToken).toBe(first);
    expect((await stored()).revision).toBe(1);

    await saveLearnDraft(page('B'), 1, ACTOR);
    expect((await stored()).previewToken).toBe(first);

    const second = await rotateLearnPreviewToken();
    expect(second).not.toBe(first);
    expect((await stored()).previewToken).toBe(second);

    expect(await revokeLearnPreviewToken()).toBe(true);
    expect((await stored()).previewToken).toBeUndefined();
    expect(await revokeLearnPreviewToken()).toBe(false);
  });
});
