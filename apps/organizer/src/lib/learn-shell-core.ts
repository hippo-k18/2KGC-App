import type { LearnPageContent } from '@kgc/shared';
import { replaceInHistory, type History } from './learn-editor-core';

/**
 * Small decisions of the Learn editor shell (T325), with no React in them so
 * `learn-shell-core.test.ts` can pin them.
 */

/**
 * The undo history after a version is restored into the draft (E F5). The
 * draft that was there goes onto the undo stack, so Undo brings unpublished
 * work back (and autosave stores it again). Unlike a discard or "Load their
 * version", a restore is the person's own choice about their own draft, so
 * there is no colleague's work for an undo to overwrite.
 */
export function historyAfterRestore(h: History, restored: LearnPageContent): History {
  return replaceInHistory(h, restored);
}

/** The cron runs every minute; give it this long after the time before asking. */
export const SCHEDULE_GRACE_MS = 20_000;
/** Then ask again this often, a few times, in case it ran late. */
export const SCHEDULE_RETRY_MS = 60_000;
export const SCHEDULE_TRIES = 5;
/** setTimeout cannot wait longer than about 24 days; wake up and look again well before that. */
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;

/**
 * How long to wait before asking the server whether a scheduled publish has
 * run (E F8), or null to stop asking. `tries` counts the questions asked
 * since the time passed.
 */
export function scheduleCheckDelay(at: number, now: number, tries: number): number | null {
  if (tries >= SCHEDULE_TRIES) return null;
  const due = at + SCHEDULE_GRACE_MS;
  if (now < due) return Math.min(due - now, MAX_WAIT_MS);
  return tries === 0 ? 0 : SCHEDULE_RETRY_MS;
}

/**
 * Where to scroll a pane so a block shows well (E F9): a block that fits
 * goes a third of the way down, a taller one starts near the top. `top` is
 * the block's top relative to the pane's visible top.
 */
export function scrollTopFor(input: { scrollTop: number; paneHeight: number; top: number; height: number }): number {
  const { scrollTop, paneHeight, top, height } = input;
  const margin = 24;
  const offset = height < paneHeight - 2 * margin ? Math.max(margin, (paneHeight - height) / 3) : margin;
  return Math.max(0, scrollTop + top - offset);
}

/** The zoom that fits a page `pageWidth` wide into a box `boxWidth` wide (E F14). */
export function fitZoom(boxWidth: number, pageWidth: number, max = 1): number {
  if (!(boxWidth > 0) || !(pageWidth > 0)) return max;
  return Math.min(max, boxWidth / pageWidth);
}
