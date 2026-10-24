import type { LearnPageContent } from '@kgc/shared';
import {
  isRecoveryKeyOf,
  parseRecovery,
  savedCovers,
  serializeRecovery,
  type RecoveryCopy,
  type StoredCopy,
} from '@/lib/learn-recovery-core';

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
export function writeRecovery(key: string, doc: LearnPageContent, baseRevision: number, base?: LearnPageContent): boolean {
  try {
    window.localStorage.setItem(key, serializeRecovery(doc, baseRevision, Date.now(), base));
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

// ── One copy per open editor (T348, E R2) ──────────────────────────────

/**
 * An id for this editor, new on every open. Not kept in sessionStorage:
 * a duplicated tab copies sessionStorage, and two tabs on one id would share
 * a copy again. A reload leaves the old id's copy behind, which the new
 * editor finds and offers like any other.
 */
export function newTabId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Every copy this person has for this page in this browser, the T343 one included. */
export function listRecovery(personKey: string): StoredCopy[] {
  const out: StoredCopy[] = [];
  try {
    const store = window.localStorage;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !isRecoveryKeyOf(personKey, key)) continue;
      const copy = parseRecovery(store.getItem(key));
      if (copy) out.push({ key, copy });
    }
  } catch {
    // Storage refused: nothing can have been kept.
  }
  return out;
}

type Locks = {
  request: (name: string, opts: { mode: 'exclusive' }, cb: () => Promise<void>) => Promise<unknown>;
  query: () => Promise<{ held?: { name?: string }[] }>;
};
const locks = (): Locks | null => (navigator as unknown as { locks?: Locks }).locks ?? null;

/**
 * Marks this editor's copy as in use while the editor is open, with a Web
 * Lock the browser lets go of when the tab closes or crashes. Returns the
 * release.
 */
export function holdRecoveryKey(key: string): () => void {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    void locks()?.request(key, { mode: 'exclusive' }, () => held).catch(() => {});
  } catch {
    // No Web Locks: other tabs cannot tell this copy is in use (see below).
  }
  return release;
}

/**
 * The copies whose editors are still open in another tab, so they are not
 * offered or removed. Without Web Locks this is empty, and a tab whose copy
 * another tab removed writes it again at once (the storage event).
 */
export async function liveRecoveryKeys(): Promise<Set<string>> {
  try {
    const l = locks();
    if (!l) return new Set();
    const snap = await l.query();
    return new Set((snap.held ?? []).map((h) => h.name ?? '').filter(Boolean));
  } catch {
    return new Set();
  }
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
