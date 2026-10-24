import { describe, expect, it } from 'vitest';
import type { LearnPageContent } from '@kgc/shared';
import {
  collectOffer,
  isRecoveryKeyOf,
  mergeOffer,
  mergeRecovery,
  parseRecovery,
  sameValue,
  tabRecoveryKey,
  recoveryKey,
  recoveryStep,
  recoveryTimeLabel,
  recoveryToOffer,
  revisionForRestore,
  savedCovers,
  serializeRecovery,
} from './learn-recovery-core';

const page = (title: string): LearnPageContent => ({
  seoTitle: title,
  seoDescription: '',
  sections: [{ id: 's1', label: 'Top', background: 'plain', width: 'normal', paddingTop: 'none', paddingBottom: 'none', blocks: [] }],
});

describe('recovery copy (T343, N5)', () => {
  it('is keyed by person and page, whatever the address case', () => {
    expect(recoveryKey(' Owner@Example.com ')).toBe(recoveryKey('owner@example.com'));
    expect(recoveryKey('a@x.test')).not.toBe(recoveryKey('b@x.test'));
    expect(recoveryKey('a@x.test', 'learn')).not.toBe(recoveryKey('a@x.test', 'other'));
  });

  it('round-trips the doc, the base revision and the time', () => {
    const copy = parseRecovery(serializeRecovery(page('mine'), 7, 1234));
    expect(copy).toEqual({ v: 1, doc: page('mine'), baseRevision: 7, at: 1234 });
    expect(parseRecovery(serializeRecovery(page('mine'), 7, 1234, page('server')))?.base).toEqual(page('server'));
    // A damaged base is dropped, the words are kept.
    expect(parseRecovery(JSON.stringify({ v: 1, doc: page('mine'), baseRevision: 7, at: 1, base: { sections: 'x' } }))).toEqual({
      v: 1,
      doc: page('mine'),
      baseRevision: 7,
      at: 1,
    });
  });

  it('reads nothing from missing, damaged or foreign values', () => {
    expect(parseRecovery(null)).toBeNull();
    expect(parseRecovery('')).toBeNull();
    expect(parseRecovery('{not json')).toBeNull();
    expect(parseRecovery('"text"')).toBeNull();
    expect(parseRecovery(JSON.stringify({ v: 2, doc: page('x'), baseRevision: 1, at: 1 }))).toBeNull();
    expect(parseRecovery(JSON.stringify({ v: 1, doc: { sections: 'no' }, baseRevision: 1, at: 1 }))).toBeNull();
    expect(parseRecovery(JSON.stringify({ v: 1, doc: { sections: [{}] }, baseRevision: 1, at: 1 }))).toBeNull();
    expect(parseRecovery(JSON.stringify({ v: 1, doc: page('x'), at: 1 }))).toBeNull();
    expect(parseRecovery(JSON.stringify({ v: 1, doc: page('x'), baseRevision: 1 }))).toBeNull();
  });

  it('keeps a copy while the screen differs from the server, and removes it once they match', () => {
    expect(recoveryStep({ content: page('typed'), lastSaved: page('server') })).toBe('write');
    expect(recoveryStep({ content: page('same'), lastSaved: page('same') })).toBe('clear');
  });

  it('offers a copy only when it holds words the server does not', () => {
    expect(recoveryToOffer(null, page('server'))).toBeNull();
    const same = parseRecovery(serializeRecovery(page('server'), 3, 1))!;
    expect(recoveryToOffer(same, page('server'))).toBeNull();
    const other = parseRecovery(serializeRecovery(page('lost words'), 3, 1))!;
    expect(recoveryToOffer(other, page('server'))).toBe(other);
  });

  it('a save of the same words makes the copy redundant, other words do not', () => {
    const copy = parseRecovery(serializeRecovery(page('W'), 3, 1));
    expect(savedCovers(copy, page('W'))).toBe(true);
    expect(savedCovers(copy, page('older'))).toBe(false);
    expect(savedCovers(null, page('W'))).toBe(false);
  });

  it('a copy typed before someone else saved goes back on its old revision, so the conflict asks', () => {
    const copy = parseRecovery(serializeRecovery(page('W'), 4, 1))!;
    // The server was at 9 when the editor opened: somebody saved after the words.
    expect(revisionForRestore(copy, 9, 9)).toBe(4);
    expect(revisionForRestore(copy, 9, 11)).toBe(4);
    // Nobody saved since: an ordinary edit on whatever this editor holds now.
    expect(revisionForRestore(copy, 4, 4)).toBe(4);
    expect(revisionForRestore(copy, 4, 6)).toBe(6);
    // The merge kept every newer saved word (T348): no question needed.
    expect(revisionForRestore(copy, 9, 11, false)).toBe(11);
  });

  it('names the time, and the day when it was not today', () => {
    const at = new Date(2026, 9, 22, 15, 41).getTime();
    expect(recoveryTimeLabel(at, new Date(2026, 9, 22, 18, 0).getTime())).toBe('3:41 PM');
    expect(recoveryTimeLabel(at, new Date(2026, 9, 23, 9, 0).getTime())).toBe('Oct 22, 3:41 PM');
  });
});

type Block = Record<string, unknown>;
const doc = (...sections: { id: string; blocks: Block[] }[]): LearnPageContent =>
  ({
    seoTitle: 'T',
    seoDescription: '',
    sections: sections.map((s) => ({ label: s.id, background: 'plain', width: 'normal', paddingTop: 'none', paddingBottom: 'none', ...s })),
  }) as unknown as LearnPageContent;
const text = (id: string, t: string): Block => ({ id, kind: 'text', text: t });
/** A copy as T343 wrote it (no base: the page at open stands in), or with the page it was typed on. */
const asCopy = (d: LearnPageContent, base?: LearnPageContent, baseRevision = 1) =>
  parseRecovery(serializeRecovery(d, baseRevision, 1, base))!;
const texts = (d: LearnPageContent) => d.sections.flatMap((s) => s.blocks.map((b) => `${b.id}:${(b as unknown as Block).text ?? ''}`));

describe('restore merges into the page (T348, K2)', () => {
  const base = doc({ id: 's1', blocks: [text('a', 'A'), text('b', 'B')] });

  it('keeps words typed since opening and adds the copy\'s words elsewhere (the R1 repro)', () => {
    const copy = doc({ id: 's1', blocks: [text('a', 'A old'), text('b', 'B')] });
    const current = doc({ id: 's1', blocks: [text('a', 'A'), text('b', 'B new')] });
    const r = mergeRecovery(base, asCopy(copy), current);
    expect(texts(r.doc)).toEqual(['a:A old', 'b:B new']);
    expect(r.kept).toBe(0);
  });

  it('a field changed both in the copy and since opening keeps the newer words, and says so', () => {
    const copy = doc({ id: 's1', blocks: [text('a', 'A old'), text('b', 'B')] });
    const current = doc({ id: 's1', blocks: [text('a', 'A new'), text('b', 'B')] });
    const r = mergeRecovery(base, asCopy(copy), current);
    expect(texts(r.doc)).toEqual(['a:A new', 'b:B']);
    expect(r.kept).toBe(1);
  });

  it('works per field inside a block and per item', () => {
    const b0 = doc({ id: 's1', blocks: [{ id: 'q', kind: 'faq', items: [{ id: 'i1', q: 'Q1', a: 'A1' }, { id: 'i2', q: 'Q2', a: 'A2' }] }] });
    const copy = doc({ id: 's1', blocks: [{ id: 'q', kind: 'faq', items: [{ id: 'i1', q: 'Q1 old', a: 'A1' }, { id: 'i2', q: 'Q2', a: 'A2 old' }] }] });
    const cur = doc({ id: 's1', blocks: [{ id: 'q', kind: 'faq', items: [{ id: 'i1', q: 'Q1', a: 'A1 new' }, { id: 'i2', q: 'Q2', a: 'A2' }] }] });
    const r = mergeRecovery(b0, asCopy(copy), cur);
    expect(r.doc.sections[0].blocks[0]).toEqual({
      id: 'q',
      kind: 'faq',
      items: [{ id: 'i1', q: 'Q1 old', a: 'A1 new' }, { id: 'i2', q: 'Q2', a: 'A2 old' }],
    });
    expect(r.kept).toBe(0);
  });

  it('a rich text document is one value', () => {
    const rich = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
    const b0 = doc({ id: 's1', blocks: [{ id: 'r', kind: 'text', text: rich('one') }] });
    const copy = doc({ id: 's1', blocks: [{ id: 'r', kind: 'text', text: rich('one old') }] });
    const cur = doc({ id: 's1', blocks: [{ id: 'r', kind: 'text', text: rich('one new') }] });
    const r = mergeRecovery(b0, asCopy(copy), cur);
    expect(r.doc.sections[0].blocks[0]).toEqual({ id: 'r', kind: 'text', text: rich('one new') });
    expect(r.kept).toBe(1);
    const untouched = mergeRecovery(b0, asCopy(copy), b0);
    expect(untouched.doc.sections[0].blocks[0]).toEqual({ id: 'r', kind: 'text', text: rich('one old') });
  });

  it('blocks added in the copy come back after the block they followed', () => {
    const copy = doc({ id: 's1', blocks: [text('a', 'A'), text('x', 'X added'), text('b', 'B')] });
    const current = doc({ id: 's1', blocks: [text('n', 'N mine'), text('a', 'A'), text('b', 'B')] });
    expect(texts(mergeRecovery(base, asCopy(copy), current).doc)).toEqual(['n:N mine', 'a:A', 'x:X added', 'b:B']);
  });

  it('a block removed since opening stays removed; one the copy removed goes unless changed since', () => {
    const copy = doc({ id: 's1', blocks: [text('a', 'A old')] });
    const current = doc({ id: 's1', blocks: [text('b', 'B')] });
    expect(texts(mergeRecovery(base, asCopy(copy), current).doc)).toEqual([]);
    const changed = doc({ id: 's1', blocks: [text('a', 'A'), text('b', 'B new')] });
    expect(texts(mergeRecovery(base, asCopy(copy), changed).doc)).toEqual(['a:A old', 'b:B new']);
  });

  it('takes the copy\'s order only where the person did not reorder', () => {
    const copy = doc({ id: 's1', blocks: [text('b', 'B'), text('a', 'A')] });
    expect(texts(mergeRecovery(base, asCopy(copy), base).doc)).toEqual(['b:B', 'a:A']);
    const moved = doc({ id: 's1', blocks: [text('b', 'B'), text('a', 'A new')] });
    expect(texts(mergeRecovery(base, asCopy(doc({ id: 's1', blocks: [text('a', 'A'), text('b', 'B old')] })), moved).doc)).toEqual([
      'b:B old',
      'a:A new',
    ]);
  });

  it('never puts one block in two places', () => {
    const b0 = doc({ id: 's1', blocks: [text('a', 'A')] }, { id: 's2', blocks: [text('b', 'B')] });
    // The copy moved a into s2; since opening the person edited b.
    const copy = doc({ id: 's1', blocks: [] }, { id: 's2', blocks: [text('b', 'B'), text('a', 'A old')] });
    const cur = doc({ id: 's1', blocks: [text('a', 'A')] }, { id: 's2', blocks: [text('b', 'B new')] });
    const out = texts(mergeRecovery(b0, asCopy(copy), cur).doc);
    expect(out.filter((t) => t.startsWith('a:'))).toHaveLength(1);
    expect(out).toContain('a:A old');
    expect(out).toContain('b:B new');
    // A section only the copy has keeps none of the page's own blocks.
    const copy2 = doc({ id: 's1', blocks: [] }, { id: 's2', blocks: [text('b', 'B')] }, { id: 's3', blocks: [text('a', 'A'), text('z', 'Z')] });
    const out2 = texts(mergeRecovery(b0, asCopy(copy2), cur).doc);
    expect(out2.filter((t) => t.startsWith('a:'))).toHaveLength(1);
    expect(out2).toContain('z:Z');
  });

  it('with its own base, a copy never undoes a save made after it (E R2b: another tab saved)', () => {
    const typedOn = doc({ id: 's1', blocks: [text('a', 'A'), text('b', 'B')] });
    const copy = asCopy(doc({ id: 's1', blocks: [text('a', 'A keepA'), text('b', 'B')] }), typedOn);
    // The other tab saved b, then the editor opened on that.
    const atOpen = doc({ id: 's1', blocks: [text('a', 'A'), text('b', 'B savedB')] });
    const r = mergeRecovery(atOpen, copy, atOpen);
    expect(texts(r.doc)).toEqual(['a:A keepA', 'b:B savedB']);
    expect([r.kept, r.overrode]).toEqual([0, 0]);
    // A T343 copy cannot tell, and puts its own b back: the editor then asks.
    expect(texts(mergeRecovery(atOpen, asCopy(copy.doc), atOpen).doc)).toEqual(['a:A keepA', 'b:B']);
  });

  it('counts a value the copy takes over from a later save, so the conflict asks', () => {
    const typedOn = doc({ id: 's1', blocks: [text('a', 'A')] });
    const copy = asCopy(doc({ id: 's1', blocks: [text('a', 'A mine')] }), typedOn);
    const atOpen = doc({ id: 's1', blocks: [text('a', 'A theirs')] });
    const r = mergeRecovery(atOpen, copy, atOpen);
    expect(texts(r.doc)).toEqual(['a:A mine']);
    expect(r.overrode).toBe(1);
    // Changed again since opening: the newest words stay.
    const typed = doc({ id: 's1', blocks: [text('a', 'A theirs and new')] });
    expect(texts(mergeRecovery(atOpen, copy, typed).doc)).toEqual(['a:A theirs and new']);
  });

  it('page settings merge too', () => {
    const copy = { ...base, seoTitle: 'T old' };
    const cur = { ...base, seoDescription: 'new' };
    const r = mergeRecovery(base, asCopy(copy), cur);
    expect([r.doc.seoTitle, r.doc.seoDescription]).toEqual(['T old', 'new']);
  });

  it('equality ignores key order', () => {
    expect(sameValue({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(sameValue({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
  });
});

describe('one copy per tab (T348, E R2)', () => {
  const person = recoveryKey('a@x.test');

  it('tab keys belong to the person, the T343 key too, and nobody else\'s', () => {
    expect(isRecoveryKeyOf(person, person)).toBe(true);
    expect(isRecoveryKeyOf(person, tabRecoveryKey(person, 't1'))).toBe(true);
    expect(isRecoveryKeyOf(person, recoveryKey('a@x.test.other'))).toBe(false);
    expect(isRecoveryKeyOf(person, tabRecoveryKey(recoveryKey('b@x.test'), 't1'))).toBe(false);
    expect(tabRecoveryKey(person, 't1')).not.toBe(tabRecoveryKey(person, 't2'));
  });

  it('offers every gone tab\'s copy, newest first, skips live tabs and drops redundant ones', () => {
    const server = doc({ id: 's1', blocks: [text('a', 'A'), text('b', 'B')] });
    const c = (t: LearnPageContent, rev: number, at: number) => parseRecovery(serializeRecovery(t, rev, at))!;
    const stored = [
      { key: person, copy: c(doc({ id: 's1', blocks: [text('a', 'A legacy'), text('b', 'B')] }), 3, 10) },
      { key: tabRecoveryKey(person, 'A'), copy: c(doc({ id: 's1', blocks: [text('a', 'A'), text('b', 'B tabA')] }), 4, 30) },
      { key: tabRecoveryKey(person, 'B'), copy: c(server, 4, 40) },
      { key: tabRecoveryKey(person, 'L'), copy: c(doc({ id: 's1', blocks: [text('a', 'live')] }), 4, 50) },
    ];
    const { offer, redundant } = collectOffer(stored, server, new Set([tabRecoveryKey(person, 'L')]));
    expect(redundant).toEqual([tabRecoveryKey(person, 'B')]);
    expect(offer!.copies.map((x) => x.key)).toEqual([tabRecoveryKey(person, 'A'), person]);
    expect(offer!.at).toBe(30);
    expect(offer!.baseRevision).toBe(3);
    // Both tabs' words come back, with what was typed since opening.
    const current = doc({ id: 's1', blocks: [text('a', 'A'), text('b', 'B'), text('n', 'N new')] });
    expect(texts(mergeOffer(server, offer!, current).doc)).toEqual(['a:A legacy', 'b:B tabA', 'n:N new']);
    expect(collectOffer([], server, new Set()).offer).toBeNull();
  });
});
