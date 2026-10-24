import type { LearnPageContent } from '@kgc/shared';
import { contentEqual } from './learn-editor-core';
import { toRichDoc } from './rich-editor/convert';

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
  /** Items someone removed that held the copy's words, put back (T351, R1). */
  restored: number;
  /** Values where two copies' words were put together (T351, E2). */
  combined: number;
  /** Values an earlier copy of the same offer put in, by place: not the person's. */
  fromCopy: Map<string, J>;
}

/** Where a value sits: the nearest id around it, then the keys down to it. */
const placeOf = (key: string, k: string, v: Rec | undefined) => (v && idOf(v) ? `${idOf(v)}.${k}` : `${key}.${k}`);

/** `ob` the page at open, `cb` the copy's own base, then the copy and the screen. */
function mergeValue(ob: J, cb: J, copy: J, cur: J, ctx: MergeCtx, key = ''): J {
  // Lists of things with ids are always walked, so a block is never in two places.
  if (isIdList(cur) || isIdList(copy)) return mergeIdList(asList(ob), asList(cb), asList(copy), asList(cur), ctx);
  if (sameValue(copy, cur)) return cur;
  // Objects are walked even when the person left them alone, and even when the
  // copy did, for the lists inside: a block the copy changed may sit there now (T351).
  if (isObj(copy) && isObj(cur) && !isLeafObj(copy) && !isLeafObj(cur)) {
    const o = isObj(ob) ? ob : {};
    const c = isObj(cb) ? cb : {};
    const out: Rec = {};
    for (const k of new Set([...Object.keys(cur), ...Object.keys(copy), ...Object.keys(c)])) {
      const v = mergeValue(o[k], c[k], copy[k], cur[k], ctx, placeOf(key, k, cur));
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (sameValue(copy, cb)) return cur;
  if (sameValue(cur, ob)) {
    if (!sameValue(ob, cb)) ctx.overrode += 1;
    ctx.fromCopy.set(key, copy);
    return copy;
  }
  // Put there by a newer copy of the same offer, not by the person: both copies' words stay.
  if (ctx.fromCopy.has(key) && sameValue(ctx.fromCopy.get(key), cur)) {
    const both = combineValues(cb, cur, copy);
    ctx.combined += 1;
    ctx.fromCopy.set(key, both);
    return both;
  }
  ctx.kept += 1;
  return cur;
}

/** One stretch of `base` that `x` replaced: base[from, to) became `text`. */
function changeOf(base: string, x: string) {
  let p = 0;
  while (p < base.length && p < x.length && base[p] === x[p]) p++;
  let s = 0;
  while (s < base.length - p && s < x.length - p && base[base.length - 1 - s] === x[x.length - 1 - s]) s++;
  return { from: p, to: base.length - s, text: x.slice(p, x.length - s) };
}

/**
 * Two texts both typed on `base`: each one's change applied, when they touch
 * different places. Words added at the same place go older first. Null when
 * the changes overlap.
 */
export function mergeTexts(base: string, newer: string, older: string): string | null {
  const n = changeOf(base, newer);
  const o = changeOf(base, older);
  const at = (first: typeof n, second: typeof n) =>
    base.slice(0, first.from) + first.text + base.slice(first.to, second.from) + second.text + base.slice(second.to);
  if (o.to <= n.from) return at(o, n);
  if (n.to <= o.from) return at(n, o);
  return null;
}

/** A newer and an older copy's values for one place, put together so neither one's words are lost. */
function combineValues(base: J, newer: J, older: J): J {
  if (typeof newer === 'string' && typeof older === 'string') {
    return (typeof base === 'string' ? mergeTexts(base, newer, older) : null) ?? `${newer} ${older}`;
  }
  if (isObj(newer) && isObj(older) && isLeafObj(newer) && isLeafObj(older)) {
    // A rich text: the two changes applied to its stored form, when that still reads as a document.
    // A text still stored the old way (Markdown) is read as the editor reads it.
    const from = typeof base === 'string' ? toRichDoc(base) : base;
    if (isObj(from) && isLeafObj(from)) {
      const joined = mergeTexts(JSON.stringify(from), JSON.stringify(newer), JSON.stringify(older));
      try {
        const v: unknown = joined && JSON.parse(joined);
        if (isObj(v) && isLeafObj(v) && Array.isArray(v.content)) return v;
      } catch {
        // Fall through to both versions.
      }
    }
    return { ...newer, content: [...asList(newer.content), ...asList(older.content)] };
  }
  if (Array.isArray(newer) && Array.isArray(older)) return [...newer, ...older.filter((x) => !newer.some((y) => sameValue(x, y)))];
  return newer;
}

function mergeItem(id: string, curItem: Rec, ctx: MergeCtx): Rec {
  const copyItem = ctx.copy.get(id);
  if (!copyItem) return curItem;
  return mergeValue(ctx.open.get(id), ctx.copyBase.get(id), copyItem, curItem, ctx, id) as Rec;
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
  // Added in the copy, or changed there and removed since by anyone (T351, R1):
  // back after the block it followed there, so the copy's words are never dropped.
  copy.forEach((item, i) => {
    const id = idOf(item);
    if (!id || ctx.cur.has(id)) return;
    const was = ctx.copyBase.get(id) ?? ctx.open.get(id);
    const added = withoutKnown(item, ctx);
    if (was && sameValue(added, withoutKnown(was, ctx))) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const prev = idOf(copy[j]);
      const k = out.findIndex((x) => idOf(x) === prev);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, added);
    indexIds(added, ctx.cur);
    if (was) ctx.restored += 1;
  });
  return out;
}

/** Every value the copy holds, by place (see `placeOf`); lists of things with ids are walked. */
function placesOf(v: J, key: string, into: Map<string, J>) {
  if (isIdList(v)) {
    for (const x of v) placesOf(x, idOf(x)!, into);
    return;
  }
  if (isObj(v) && !isLeafObj(v)) {
    for (const k of Object.keys(v)) placesOf(v[k], placeOf(key, k, v), into);
    return;
  }
  if (!into.has(key)) into.set(key, v);
}

/**
 * The copy's changed values that are neither in the merged page nor reported
 * as kept or put together (T351): the editor keeps the copy while any are left.
 */
export function unplacedWords(copyBase: LearnPageContent, copy: LearnPageContent, current: LearnPageContent, merged: LearnPageContent, openBase = copyBase): string[] {
  const [b, c, cur, out, open] = [copyBase, copy, current, merged, openBase].map((d) => {
    const m = new Map<string, J>();
    placesOf(d, '', m);
    return m;
  });
  const missing: string[] = [];
  for (const [k, v] of c) {
    if (v === undefined || (b.has(k) && sameValue(b.get(k), v)) || sameValue(out.get(k), v)) continue;
    // The person's newer words there: kept, and said so.
    if (cur.has(k) && sameValue(out.get(k), cur.get(k)) && !sameValue(cur.get(k), open.get(k))) continue;
    missing.push(k);
  }
  return missing;
}

export interface MergeResult {
  doc: LearnPageContent;
  /** Values that kept the person's newer words where the copy had others. */
  kept: number;
  /** Values where the copy replaced words someone saved after it. */
  overrode: number;
  /** Removed items brought back because the copy changed them (T351, R1). */
  restored: number;
  /** Values where two copies' words were put together (T351, E2). */
  combined: number;
  /** Changed values of the copies that went nowhere: keep the copies (T351). */
  unplaced: string[];
}

const newCtx = (): MergeCtx => ({
  open: new Map(),
  copyBase: new Map(),
  cur: new Map(),
  copy: new Map(),
  kept: 0,
  overrode: 0,
  restored: 0,
  combined: 0,
  fromCopy: new Map(),
});

function mergeInto(openBase: LearnPageContent, copy: RecoveryCopy, current: LearnPageContent, ctx: MergeCtx): LearnPageContent {
  const copyBase = copy.base ?? openBase;
  for (const m of [ctx.open, ctx.copyBase, ctx.copy, ctx.cur]) m.clear();
  indexIds(openBase, ctx.open);
  indexIds(copyBase, ctx.copyBase);
  indexIds(copy.doc, ctx.copy);
  indexIds(current, ctx.cur);
  return mergeValue(openBase, copyBase, copy.doc, current, ctx) as LearnPageContent;
}

const resultOf = (doc: LearnPageContent, ctx: MergeCtx, unplaced: string[]): MergeResult => ({
  doc,
  kept: ctx.kept,
  overrode: ctx.overrode,
  restored: ctx.restored,
  combined: ctx.combined,
  unplaced,
});

/** The page on screen with the copy merged in. */
export function mergeRecovery(openBase: LearnPageContent, copy: RecoveryCopy, current: LearnPageContent): MergeResult {
  const ctx = newCtx();
  const doc = mergeInto(openBase, copy, current, ctx);
  return resultOf(doc, ctx, unplacedWords(copy.base ?? openBase, copy.doc, current, doc, openBase));
}

/**
 * Every offered copy merged in, newest first. Where an older copy changed a
 * value a newer one already put in, both copies' words are put together
 * (T351, E2): an older copy's words are never taken for the person's.
 */
export function mergeOffer(openBase: LearnPageContent, offer: RecoveryOffer, current: LearnPageContent): MergeResult {
  const ctx = newCtx();
  let doc = current;
  for (const { copy } of offer.copies) doc = mergeInto(openBase, copy, doc, ctx);
  // Each copy checked against the page as the person had it, so another copy's words do not count as theirs.
  const placed = new Map<string, J>();
  placesOf(doc, '', placed);
  const unplaced = offer.copies.flatMap(({ copy }) =>
    // A value put together from two copies holds this copy's change too.
    unplacedWords(copy.base ?? openBase, copy.doc, current, doc, openBase).filter(
      (k) => !ctx.fromCopy.has(k) || !sameValue(ctx.fromCopy.get(k), placed.get(k)),
    ),
  );
  return resultOf(doc, ctx, unplaced);
}
