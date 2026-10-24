import type { LearnPageContent } from '@kgc/shared';
import { contentEqual, startHistory, type History } from './learn-editor-core';

/**
 * The Learn editor's autosave decisions (T320), with no React in them, so
 * `learn-autosave-core.test.ts` can pin the two bugs the T314 gate found:
 * a refused save that stopped every later save, and an undo that reached back
 * past a draft loaded from the server and saved over a colleague's work.
 */

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

/** How long typing has to pause before the draft is saved. */
export const AUTOSAVE_MS = 1500;

export type AutosaveStep =
  /** Nothing to do. */
  | { kind: 'idle' }
  /** The content is what the server holds: show "Saved" and drop any error. */
  | { kind: 'clean' }
  /** Send the draft after `delay` ms. */
  | { kind: 'save'; delay: number };

/**
 * What autosave does when the content or the save state changes.
 *
 * `refused` is the content of the last save the server refused (a validation
 * error), or null after a network failure or a success. Sending the same
 * refused content again would be refused again, so it waits for a change; a
 * change is sent at the usual pace, and a network failure retries slowly.
 */
export function autosaveStep(input: {
  content: LearnPageContent;
  lastSaved: LearnPageContent;
  state: SaveState;
  refused: LearnPageContent | null;
}): AutosaveStep {
  const { content, lastSaved, state, refused } = input;
  if (state === 'conflict' || state === 'saving') return { kind: 'idle' };
  if (contentEqual(content, lastSaved)) {
    return state === 'unsaved' || state === 'error' ? { kind: 'clean' } : { kind: 'idle' };
  }
  if (state === 'error' && refused && contentEqual(content, refused)) return { kind: 'idle' };
  const slow = state === 'error' && !refused;
  return { kind: 'save', delay: slow ? AUTOSAVE_MS * 4 : AUTOSAVE_MS };
}

/**
 * The undo history after the draft is replaced from the server ("Load their
 * version", a discard, a restore). It starts again from the new draft: an undo
 * that stepped back past it would bring back content the server no longer
 * holds and autosave it, at the new revision, over whatever replaced it.
 */
export function historyAfterServerReplace(draft: LearnPageContent): History {
  return startHistory(draft);
}
