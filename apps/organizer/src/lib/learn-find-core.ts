import type { LearnPageContent, LearnSection, RichNode } from '@kgc/shared';
import { findInPage, findRegex, mapPageText, type FindMatch, type FindOptions } from './learn-tools-core';

/**
 * Find over what the page shows, not only what Replace can change
 * (T324 E F12). `findInPage` walks the draft's own text, so it skipped two
 * things a course lead can see on the page:
 *
 * - a linked (Saved section) block, whose text lives in the library. Its
 *   matches are listed under the block, and Replace leaves them alone: the
 *   saved section is changed in one place, for every page that links it.
 * - a word split by formatting ("**Giz**mo"), which is two text runs, so a
 *   search inside each run never sees "Gizmo". Those are found on the plain
 *   text of the paragraph. Replace stays per run, so it leaves them alone too.
 *
 * Replace still goes through `replaceInPage`, which changes exactly the
 * matches here that have no `locked` reason.
 */

export interface FindHit extends FindMatch {
  /** Why Replace does not change this match. Replaceable when absent. */
  locked?: string;
  /** For a match inside a linked section: the saved section's name. */
  savedSection?: string;
}

export const LOCKED_LINKED = 'Edit the saved section to change this.';
export const LOCKED_SPLIT = 'Part of this word has other formatting. Change it in the block.';

const CONTEXT = 30;

type Library = ReadonlyMap<string, LearnSection>;

/** Runs of text that sit next to each other in one paragraph, numbered as `richTextRuns` numbers them. */
function textGroups(nodes: RichNode[]): { first: number; runs: string[] }[] {
  const groups: { first: number; runs: string[] }[] = [];
  let run = 0;
  const walk = (list: RichNode[] | undefined) => {
    let cur: { first: number; runs: string[] } | null = null;
    for (const n of list ?? []) {
      if (n.type === 'text') {
        if (!cur) groups.push((cur = { first: run, runs: [] }));
        cur.runs.push(n.text);
        run++;
      } else {
        // A line break or a nested block ends the paragraph's plain text.
        cur = null;
        if ('content' in n) walk(n.content);
      }
    }
  };
  walk(nodes);
  return groups;
}

/** Sort key for a match id `field:run:offset`. */
function keyOf(id: string): number[] {
  return id.split(':').slice(-3).map(Number);
}

function byKey(a: FindHit, b: FindHit): number {
  const x = keyOf(a.id);
  const y = keyOf(b.id);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Matches in rich text that run across two or more differently formatted runs. */
function splitMatches(content: LearnPageContent, query: string, opts: FindOptions): FindHit[] {
  const re = findRegex(query, opts);
  if (!re) return [];
  const out: FindHit[] = [];
  let field = 0;
  mapPageText(content, (where, v) => {
    const f = field++;
    if (!v.rich || typeof v.value === 'string') return v.value;
    for (const g of textGroups(v.value.content ?? [])) {
      if (g.runs.length < 2) continue;
      const text = g.runs.join('');
      const starts: number[] = [];
      let at = 0;
      for (const r of g.runs) {
        starts.push(at);
        at += r.length;
      }
      const runAt = (i: number) => {
        let r = 0;
        while (r + 1 < starts.length && starts[r + 1] <= i) r++;
        return r;
      };
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (m[0] === '') {
          re.lastIndex++;
          continue;
        }
        const end = m.index + m[0].length;
        const r = runAt(m.index);
        // Inside one run: `findInPage` already has it.
        if (runAt(end - 1) === r) continue;
        out.push({
          id: `split:${f}:${g.first + r}:${m.index - starts[r]}`,
          where,
          before: text.slice(Math.max(0, m.index - CONTEXT), m.index),
          match: m[0],
          after: text.slice(end, end + CONTEXT),
          locked: LOCKED_SPLIT,
        });
      }
    }
    return v.value;
  });
  return out;
}

/** Every match in `content`'s own text, in page order. */
function ownMatches(content: LearnPageContent, query: string, opts: FindOptions): FindHit[] {
  const plain: FindHit[] = findInPage(content, query, opts);
  const split = splitMatches(content, query, opts);
  return split.length === 0 ? plain : [...plain, ...split].sort(byKey);
}

/**
 * Every match on the page as it shows, in page order: the draft's own text,
 * and the text of each linked section from `library` (none while it loads).
 * `names` gives a saved section's name; its label stands in without one.
 */
export function findOnPage(
  content: LearnPageContent,
  query: string,
  opts: FindOptions = {},
  library?: Library | null,
  names?: ReadonlyMap<string, string>,
): FindHit[] {
  const own = ownMatches(content, query, opts);
  const hasLinked = !!library && content.sections.some((s) => s.blocks.some((b) => b.kind === 'reusable'));
  if (!hasLinked || !query) return own;

  const byBlock = new Map<string, FindHit[]>();
  const out: FindHit[] = [];
  for (const h of own) {
    if (!h.where.blockId) {
      out.push(h);
      continue;
    }
    const list = byBlock.get(h.where.blockId) ?? [];
    list.push(h);
    byBlock.set(h.where.blockId, list);
  }
  for (const s of content.sections) {
    for (const b of s.blocks) {
      if (b.kind !== 'reusable') {
        out.push(...(byBlock.get(b.id) ?? []));
        continue;
      }
      const saved = library!.get(b.libraryId);
      if (!saved) continue;
      const name = names?.get(b.libraryId) || saved.label || 'Saved section';
      const inner = ownMatches({ seoTitle: '', seoDescription: '', sections: [saved] }, query, opts);
      for (const h of inner) {
        out.push({
          ...h,
          id: `linked:${b.id}:${h.id}`,
          where: { sectionId: s.id, blockId: b.id, field: h.where.field },
          locked: LOCKED_LINKED,
          savedSection: name,
        });
      }
    }
  }
  return out;
}

/** What Replace all leaves alone, in words; null when it changes every match. */
export function lockedSummary(hits: readonly FindHit[]): string | null {
  const linked = hits.filter((h) => h.locked === LOCKED_LINKED).length;
  const split = hits.filter((h) => h.locked === LOCKED_SPLIT).length;
  const parts: string[] = [];
  if (linked) parts.push(linked === 1 ? '1 in a saved section' : `${linked} in saved sections`);
  if (split) parts.push(`${split} with mixed formatting`);
  if (parts.length === 0) return null;
  const n = linked + split;
  return `${parts.join(' and ')} ${n === 1 ? 'stays as it is' : 'stay as they are'}.`;
}
