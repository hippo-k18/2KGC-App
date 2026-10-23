import type { LearnPageContent } from '@kgc/shared';
import { parseRecovery, savedCovers, serializeRecovery, type RecoveryCopy } from '@/lib/learn-recovery-core';

/**
 * The browser side of the recovery copy (T343, N5): localStorage, every call
 * wrapped, because a private window, a full disk or blocked site data throws.
 * The decisions are in `lib/learn-recovery-core.ts`.
 */

export function readRecovery(key: string): RecoveryCopy | null {
  try {
    return parseRecovery(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

/** True when the copy is stored. */
export function writeRecovery(key: string, doc: LearnPageContent, baseRevision: number): boolean {
  try {
    window.localStorage.setItem(key, serializeRecovery(doc, baseRevision, Date.now()));
    return true;
  } catch {
    return false;
  }
}

export function clearRecovery(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing stored, or storage refused: either way there is no copy to offer.
  }
}

/** After a save: removes the copy if it holds exactly what was saved. Runs after the editor closed too. */
export function clearRecoveryIfSaved(key: string, saved: LearnPageContent) {
  if (savedCovers(readRecovery(key), saved)) clearRecovery(key);
}

/*
 * The guard history entry. Next replaces history.state on every server
 * action (each autosave), so a marker in the state does not survive; the
 * Navigation API's entry keys do, where the browser has it. They are kept in
 * sessionStorage so an editor opened again on a guard entry knows it.
 */
const GUARD_KEYS = 'kgc-learn-back-guards';

type Nav = { currentEntry?: { key?: string } | null };
function navKey(): string | null {
  const nav = (window as unknown as { navigation?: Nav }).navigation;
  return nav?.currentEntry?.key ?? null;
}

function guardKeys(): string[] {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(GUARD_KEYS) ?? '[]');
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** Whether this browser can tell a guard entry from the entry under it. */
export function canTellGuards(): boolean {
  return navKey() !== null;
}

/** True, false, or null when the browser cannot tell. */
export function onGuardEntry(): boolean | null {
  const key = navKey();
  if (key === null) return null;
  return guardKeys().includes(key);
}

/** Adds a history entry for the same address, so the next Back stays in the editor and can ask. */
export function pushGuardEntry() {
  window.history.pushState(null, '', window.location.href);
  const key = navKey();
  if (key === null) return;
  try {
    window.sessionStorage.setItem(GUARD_KEYS, JSON.stringify([...guardKeys().slice(-19), key]));
  } catch {
    // Without it, a reopened editor falls back to counting Backs.
  }
}
