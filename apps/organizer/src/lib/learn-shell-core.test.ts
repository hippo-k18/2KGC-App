import { describe, expect, it } from 'vitest';
import type { LearnPageContent } from '@kgc/shared';
import { pushEdit, startHistory, undo } from './learn-editor-core';
import {
  SCHEDULE_GRACE_MS,
  SCHEDULE_RETRY_MS,
  SCHEDULE_TRIES,
  fitZoom,
  historyAfterRestore,
  scheduleCheckDelay,
  scrollTopFor,
} from './learn-shell-core';

const page = (title: string): LearnPageContent => ({ seoTitle: title, seoDescription: '', sections: [] });

describe('restore is one undo step (E F5)', () => {
  it('Undo brings the unpublished draft back', () => {
    let h = startHistory(page('published'));
    h = pushEdit(h, { type: 'setPage', patch: { seoTitle: 'CMPW unpublished work' } }, 1);
    const restored = historyAfterRestore(h, page('old version'));
    expect(restored.present.seoTitle).toBe('old version');
    expect(restored.past.length).toBeGreaterThan(0);
    expect(undo(restored).present.seoTitle).toBe('CMPW unpublished work');
  });
});

describe('looking for a scheduled publish that has run (E F8)', () => {
  const at = 1_000_000;
  it('waits until a little after the time', () => {
    expect(scheduleCheckDelay(at, at - 60_000, 0)).toBe(60_000 + SCHEDULE_GRACE_MS);
  });
  it('asks at once when the time has passed, then every minute, then stops', () => {
    expect(scheduleCheckDelay(at, at + SCHEDULE_GRACE_MS, 0)).toBe(0);
    expect(scheduleCheckDelay(at, at + 120_000, 1)).toBe(SCHEDULE_RETRY_MS);
    expect(scheduleCheckDelay(at, at + 600_000, SCHEDULE_TRIES)).toBeNull();
  });
  it('never asks setTimeout for more than it can wait', () => {
    expect(scheduleCheckDelay(at + 90 * 86_400_000, at, 0)).toBeLessThanOrEqual(6 * 3_600_000);
  });
});

describe('Show me scrolls the block well into view (E F9)', () => {
  it('puts a short block a third of the way down, not at the bottom edge', () => {
    // An H4 at 860 in a pane 860 high.
    const top = scrollTopFor({ scrollTop: 1000, paneHeight: 860, top: 860, height: 40 });
    const shownAt = 860 - (top - 1000);
    expect(shownAt).toBeGreaterThan(100);
    expect(shownAt).toBeLessThan(860 - 40);
  });
  it('starts a tall block near the top', () => {
    expect(scrollTopFor({ scrollTop: 0, paneHeight: 500, top: 900, height: 1200 })).toBe(876);
  });
  it('never scrolls above the top', () => {
    expect(scrollTopFor({ scrollTop: 0, paneHeight: 800, top: 10, height: 40 })).toBe(0);
  });
});

describe('History preview fits its box (E F14)', () => {
  it('scales a 1280 page into a 320 box', () => {
    expect(fitZoom(320, 1280, 0.42)).toBe(0.25);
    expect(fitZoom(1000, 1280, 0.42)).toBe(0.42);
    expect(fitZoom(0, 1280, 0.42)).toBe(0.42);
  });
});
