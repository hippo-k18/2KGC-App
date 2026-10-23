import type { LearnPageContent } from '@kgc/shared';
import { contentEqual } from './learn-editor-core';

/**
 * The Learn editor's local recovery copy (T343, N5), with no React and no
 * storage in it so `learn-recovery-core.test.ts` can pin it.
 *
 * Browser Back cannot be held, and with a conflict or a refused save the
 * words cannot be sent on the way out either. So while the editor holds words
 * the server does not, it keeps a copy in this browser: the draft as it is on
 * screen, the revision it was based on and when it was written. The next time
 * the same person opens the editor here it offers the copy back, as a normal
 * unsaved edit, so the usual conflict flow decides what happens to it.
 */

export interface RecoveryCopy {
  v: 1;
  doc: LearnPageContent;
  /** The server revision the words were typed on. */
  baseRevision: number;
  /** When the copy was written (ms). */
  at: number;
}

/** One copy per signed-in person and page, in this browser. */
export function recoveryKey(email: string, page = 'learn'): string {
  return `kgc-learn-recovery:v1:${page}:${email.trim().toLowerCase()}`;
}

export function serializeRecovery(doc: LearnPageContent, baseRevision: number, at: number): string {
  const copy: RecoveryCopy = { v: 1, doc, baseRevision, at };
  return JSON.stringify(copy);
}

/** A stored copy, or null for anything missing, damaged or of another shape. */
export function parseRecovery(text: string | null | undefined): RecoveryCopy | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<RecoveryCopy>;
  if (r.v !== 1 || !Number.isFinite(r.baseRevision) || !Number.isFinite(r.at)) return null;
  const doc = r.doc as Partial<LearnPageContent> | undefined;
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.sections)) return null;
  if (!doc.sections.every((s) => s && typeof s === 'object' && Array.isArray((s as { blocks?: unknown }).blocks))) return null;
  return { v: 1, doc: doc as LearnPageContent, baseRevision: r.baseRevision as number, at: r.at as number };
}

/**
 * What to do with the stored copy after the editor's content changed:
 * keep the on-screen words when they differ from what the server holds,
 * remove the copy once they match. Nothing while an older copy is still
 * being offered, so typing meanwhile cannot overwrite the words on offer.
 */
export function recoveryStep(input: {
  content: LearnPageContent;
  lastSaved: LearnPageContent;
  offerPending: boolean;
}): 'write' | 'clear' | 'skip' {
  if (input.offerPending) return 'skip';
  return contentEqual(input.content, input.lastSaved) ? 'clear' : 'write';
}

/** The copy to offer when the editor opens, or null when it holds nothing the server lacks. */
export function recoveryToOffer(copy: RecoveryCopy | null, serverDraft: LearnPageContent): RecoveryCopy | null {
  if (!copy) return null;
  return contentEqual(copy.doc, serverDraft) ? null : copy;
}

/** True when a save of `saved` makes the stored copy redundant. */
export function savedCovers(copy: RecoveryCopy | null, saved: LearnPageContent): boolean {
  return !!copy && contentEqual(copy.doc, saved);
}

/**
 * The revision a restored copy is saved against. When someone saved after
 * the copy's words were typed (the server was past its base when the editor
 * opened), the save goes on the old base, so the server answers with a
 * conflict and the person chooses, rather than the copy silently replacing
 * the newer work. Otherwise it is an ordinary edit on the current revision.
 */
export function revisionForRestore(copy: RecoveryCopy, revisionAtOpen: number, currentRevision: number): number {
  return copy.baseRevision !== revisionAtOpen ? copy.baseRevision : currentRevision;
}

/** "3:41 PM" today, "Oct 22, 3:41 PM" on another day. */
export function recoveryTimeLabel(at: number, now: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${day}, ${time}`;
}
