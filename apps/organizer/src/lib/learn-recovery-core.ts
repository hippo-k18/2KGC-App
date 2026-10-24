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
  /**
   * The page as the server held it when the words were typed (T348), so a
   * restore applies only what was really typed. Copies from before T348 have none.
   */
  base?: LearnPageContent;
}

/** The person's key for a page in this browser; each tab's copy adds its own id to it (T348). */
export function recoveryKey(email: string, page = 'learn'): string {
  return `kgc-learn-recovery:v1:${page}:${email.trim().toLowerCase()}`;
}

export function serializeRecovery(doc: LearnPageContent, baseRevision: number, at: number, base?: LearnPageContent): string {
  const copy: RecoveryCopy = { v: 1, doc, baseRevision, at, ...(base ? { base } : {}) };
  return JSON.stringify(copy);
}

const isPageShape = (doc: unknown): doc is LearnPageContent => {
  const d = doc as Partial<LearnPageContent> | undefined;
  if (!d || typeof d !== 'object' || !Array.isArray(d.sections)) return false;
  return d.sections.every((s) => s && typeof s === 'object' && Array.isArray((s as { blocks?: unknown }).blocks));
};

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
  if (!isPageShape(r.doc)) return null;
  const copy: RecoveryCopy = { v: 1, doc: r.doc, baseRevision: r.baseRevision as number, at: r.at as number };
  // A damaged base only loses the finer merge, not the words.
  if (isPageShape(r.base)) copy.base = r.base;
  return copy;
}

/**
 * What to do with this tab's own copy after the editor's content changed:
 * keep the on-screen words when they differ from what the server holds,
 * remove the copy once they match. A copy on offer is under other keys, so
 * typing meanwhile is kept too and never overwrites it (T348).
 */
export function recoveryStep(input: { content: LearnPageContent; lastSaved: LearnPageContent }): 'write' | 'clear' {
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
export function revisionForRestore(
  copy: Pick<RecoveryCopy, 'baseRevision'>,
  revisionAtOpen: number,
  currentRevision: number,
  /** False when the merge replaced none of the newer saved words (T348): nothing to ask. */
  replacesNewer = true,
): number {
  return copy.baseRevision !== revisionAtOpen && replacesNewer ? copy.baseRevision : currentRevision;
}

/** "3:41 PM" today, "Oct 22, 3:41 PM" on another day. */
export function recoveryTimeLabel(at: number, now: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${day}, ${time}`;
}

// ── Several tabs, several copies (T348, E R2) ─────────────────────────────

/**
 * Each open editor keeps its own copy under the person's key plus an id of
 * its own, so a save in one tab never removes another tab's words. A copy
 * written the T343 way, under the plain key, is still read.
 */
export function tabRecoveryKey(personKey: string, tabId: string): string {
  return `${personKey}:tab:${tabId}`;
}

/** Whether a stored key holds one of this person's copies for this page. */
export function isRecoveryKeyOf(personKey: string, key: string): boolean {
  return key === personKey || key.startsWith(`${personKey}:tab:`);
}

export interface StoredCopy {
  key: string;
  copy: RecoveryCopy;
}

/** What the editor offers on open: every copy left by a tab that is gone, newest first. */
export interface RecoveryOffer {
  copies: StoredCopy[];
  /** When the newest of them was written. */
  at: number;
  /** The oldest revision any of them was typed on. */
  baseRevision: number;
}

/**
 * Sorts the stored copies on open. `live` are the keys of editors still open
 * in other tabs: theirs are left alone. A copy holding nothing the server
 * lacks is `redundant`, to remove.
 */
export function collectOffer(
  stored: StoredCopy[],
  serverDraft: LearnPageContent,
  live: ReadonlySet<string>,
): { offer: RecoveryOffer | null; redundant: string[] } {
  const redundant: string[] = [];
  const copies: StoredCopy[] = [];
  for (const s of stored) {
    if (live.has(s.key)) continue;
    if (recoveryToOffer(s.copy, serverDraft)) copies.push(s);
    else redundant.push(s.key);
  }
  if (copies.length === 0) return { offer: null, redundant };
  copies.sort((a, b) => b.copy.at - a.copy.at);
  return {
    offer: {
      copies,
      at: copies[0].copy.at,
      baseRevision: Math.min(...copies.map((c) => c.copy.baseRevision)),
    },
    redundant,
  };
}

// ── Restore merges (T348, K2) ────────────────────────────────────────────

/*
 * "Restore them" must not undo anything saved or typed since the copy's
 * words were typed. So the copy goes in as a merge, value by value, with two
 * bases: the page the copy was typed on (`copyBase`, stored with it) tells
 * what the copy really changed, and the page the editor opened with
 * (`openBase`) tells what the person changed since opening.
 * - A value the copy changed, and the person has not changed since opening,
 *   takes the copy's value. If someone saved that value after the copy's words
 *   were typed, that is counted in `overrode`, and the restore goes through
 *   the conflict question.
 * - A value the person changed since opening keeps the person's value. When
 *   the copy changed it too, that is counted in `kept` so the editor says so.
 * - Every other value stays as it is on screen, so a save made after the
 *   copy (by someone else, or by this person in another tab) is not undone.
 * - A field is any value that is not a plain object: a text, a number, a rich
 *   text document (one value) or a list without ids. Objects with an id
 *   (sections, blocks, items) are matched by id anywhere in the page.
 * - Structure follows the person: blocks they removed stay removed and blocks
 *   stay where they put them. A block only the copy added comes back after the
 *   block it followed there. A block the copy removed goes too, unless it was
 *   changed since. A list the person did not reorder takes the copy's order
 *   when the copy reordered it.
 * A copy from before T348 has no base of its own; the page the editor opened
 * with stands in, as T343 did.
 */
type J = unknown;
type Rec = Record<string, unknown>;

const isObj = (v: J): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const idOf = (v: J): string | null => (isObj(v) && typeof v.id === 'string' && v.id ? v.id : null);
const isIdList = (v: J): v is Rec[] => Array.isArray(v) && v.length > 0 && v.every((x) => idOf(x) !== null);
/** A rich text document is one value, never merged inside. */
const isLeafObj = (v: Rec) => v.type === 'doc';
const asList = (v: J): J[] => (Array.isArray(v) ? v : []);
const idsOf = (list: J[]) => list.map(idOf);
const sameIds = (a: (string | null)[], b: (string | null)[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** Deep equality that ignores key order and keys holding undefined. */
export function sameValue(a: J, b: J): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameValue(x, b[i]));
  }
  if (!isObj(a) || !isObj(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameValue(a[k], b[k]));
}

function indexIds(v: J, into: Map<string, Rec>) {
  if (Array.isArray(v)) v.forEach((x) => indexIds(x, into));
  else if (isObj(v) && !isLeafObj(v)) {
    const id = idOf(v);
    if (id && !into.has(id)) into.set(id, v);
    for (const k of Object.keys(v)) indexIds(v[k], into);
  }
}

interface MergeCtx {
  open: Map<string, Rec>;
  copyBase: Map<string, Rec>;
  copy: Map<string, Rec>;
  cur: Map<string, Rec>;
  kept: number;
  overrode: number;
}

/** `ob` the page at open, `cb` the copy's own base, then the copy and the screen. */
function mergeValue(ob: J, cb: J, copy: J, cur: J, ctx: MergeCtx): J {
  // Lists of things with ids are always walked, so a block is never in two places.
  if (isIdList(cur) || isIdList(copy)) return mergeIdList(asList(ob), asList(cb), asList(copy), asList(cur), ctx);
  if (sameValue(copy, cb) || sameValue(copy, cur)) return cur;
  // Objects are walked even when the person left them alone, for the lists inside.
  if (isObj(copy) && isObj(cur) && !isLeafObj(copy) && !isLeafObj(cur)) {
    const o = isObj(ob) ? ob : {};
    const c = isObj(cb) ? cb : {};
    const out: Rec = {};
    for (const k of new Set([...Object.keys(cur), ...Object.keys(copy), ...Object.keys(c)])) {
      const v = mergeValue(o[k], c[k], copy[k], cur[k], ctx);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (sameValue(cur, ob)) {
    if (!sameValue(ob, cb)) ctx.overrode += 1;
    return copy;
  }
  ctx.kept += 1;
  return cur;
}

function mergeItem(id: string, curItem: Rec, ctx: MergeCtx): Rec {
  const copyItem = ctx.copy.get(id);
  if (!copyItem) return curItem;
  return mergeValue(ctx.open.get(id), ctx.copyBase.get(id), copyItem, curItem, ctx) as Rec;
}

/** A copy-only item, less anything inside it the page already holds elsewhere. */
function withoutKnown(v: J, ctx: MergeCtx): J {
  if (Array.isArray(v)) return v.filter((x) => !(idOf(x) && ctx.cur.has(idOf(x)!))).map((x) => withoutKnown(x, ctx));
  if (!isObj(v) || isLeafObj(v)) return v;
  const out: Rec = {};
  for (const k of Object.keys(v)) out[k] = withoutKnown(v[k], ctx);
  return out;
}

function mergeIdList(ob: J[], cb: J[], copy: J[], cur: J[], ctx: MergeCtx): J[] {
  // The person's list, less what only the copy removed, if nobody changed it since.
  let out: J[] = [];
  for (const item of cur) {
    const id = idOf(item);
    if (!id) {
      out.push(item);
      continue;
    }
    const removedByCopy = ctx.copyBase.has(id) && !ctx.copy.has(id);
    if (removedByCopy && sameValue(item, ctx.copyBase.get(id))) continue;
    out.push(mergeItem(id, item as Rec, ctx));
  }
  // Reordered in the copy and not by the person: the copy's order, for what both lists hold.
  if (sameIds(idsOf(cur), idsOf(ob)) && !sameIds(idsOf(copy), idsOf(cb))) {
    const copyOrder = new Map(copy.map((x, i) => [idOf(x), i] as const));
    const inCopy = out.filter((x) => copyOrder.has(idOf(x)));
    inCopy.sort((a, b) => copyOrder.get(idOf(a))! - copyOrder.get(idOf(b))!);
    let n = 0;
    out = out.map((x) => (copyOrder.has(idOf(x)) ? inCopy[n++] : x));
  }
  // Added in the copy only: back after the block it followed there.
  copy.forEach((item, i) => {
    const id = idOf(item);
    if (!id || ctx.copyBase.has(id) || ctx.open.has(id) || ctx.cur.has(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const prev = idOf(copy[j]);
      const k = out.findIndex((x) => idOf(x) === prev);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    const added = withoutKnown(item, ctx);
    out.splice(at, 0, added);
    indexIds(added, ctx.cur);
  });
  return out;
}

export interface MergeResult {
  doc: LearnPageContent;
  /** Values that kept the person's newer words where the copy had others. */
  kept: number;
  /** Values where the copy replaced words someone saved after it. */
  overrode: number;
}

/** The page on screen with the copy merged in. */
export function mergeRecovery(openBase: LearnPageContent, copy: RecoveryCopy, current: LearnPageContent): MergeResult {
  const ctx: MergeCtx = { open: new Map(), copyBase: new Map(), cur: new Map(), copy: new Map(), kept: 0, overrode: 0 };
  const copyBase = copy.base ?? openBase;
  indexIds(openBase, ctx.open);
  indexIds(copyBase, ctx.copyBase);
  indexIds(copy.doc, ctx.copy);
  indexIds(current, ctx.cur);
  const doc = mergeValue(openBase, copyBase, copy.doc, current, ctx) as LearnPageContent;
  return { doc, kept: ctx.kept, overrode: ctx.overrode };
}

/** Every offered copy merged in, newest first, so the newest words win between copies. */
export function mergeOffer(openBase: LearnPageContent, offer: RecoveryOffer, current: LearnPageContent): MergeResult {
  let doc = current;
  let kept = 0;
  let overrode = 0;
  for (const { copy } of offer.copies) {
    const r = mergeRecovery(openBase, copy, doc);
    doc = r.doc;
    kept += r.kept;
    overrode += r.overrode;
  }
  return { doc, kept, overrode };
}
