import { describe, expect, it } from 'vitest';
import {
  addChildAfter,
  addItemAfter,
  capInserted,
  canIndentItem,
  indentItem,
  insertAt,
  isOffsite,
  normalizeLinkInput,
  outdentChild,
  removeAt,
  removeChild,
  removeItem,
  replaceAt,
  setChild,
  tableOnlyDoc,
  type ListItem,
} from './learn-inline-core';

const items = (): ListItem[] => [
  { id: 'a', title: 'Explorer', text: 'fully online' },
  { id: 'b', text: 'Builder', children: ['MC-1', 'MC-2'] },
  { id: 'c', text: 'Team', link: { label: 'Brochure', href: 'mailto:x@y.z', style: 'text' } },
];

describe('list items in place', () => {
  it('adds an empty item after the one Enter was pressed in', () => {
    const r = addItemAfter(items(), 0);
    expect(r.items.map((i) => i.id).slice(0, 1)).toEqual(['a']);
    expect(r.items[1]).toMatchObject({ text: '' });
    expect(r.items[2].id).toBe('b');
    expect(r.focus).toEqual({ itemId: r.items[1].id });
  });

  it('removes an item and focuses the end of the one above', () => {
    const r = removeItem(items(), 2)!;
    expect(r.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(r.focus).toEqual({ itemId: 'b', child: 1 });
    expect(removeItem(items(), 1)!.focus).toEqual({ itemId: 'a' });
    expect(removeItem(items(), 0)!.focus).toEqual({ itemId: 'b' });
  });

  it('never removes the last item', () => {
    expect(removeItem([{ id: 'a', text: '' }], 0)).toBeNull();
  });

  it('indents a plain item into the one above as a sub-item', () => {
    const list: ListItem[] = [...items(), { id: 'd', text: 'Plain words' }];
    const r = indentItem(list, 3)!;
    expect(r.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(r.items[2].children).toEqual(['Plain words']);
    expect(r.focus).toEqual({ itemId: 'c', child: 0 });
    expect(indentItem(items(), 0)).toBeNull();
  });

  it('leaves an item with a title, a link or formatting where it is, so Tab cannot lose them (T332)', () => {
    expect(canIndentItem(items(), 2)).toBe(false);
    expect(indentItem(items(), 2)).toBeNull();
    const titled: ListItem[] = [{ id: 'x', text: 'one' }, { id: 'y', title: 'Bold', text: 'two' }];
    expect(indentItem(titled, 1)).toBeNull();
    const bold: ListItem[] = [
      { id: 'x', text: 'one' },
      { id: 'y', text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two', marks: [{ type: 'bold' }] }] }] } },
    ];
    expect(indentItem(bold, 1)).toBeNull();
    const markdown: ListItem[] = [{ id: 'x', text: 'one' }, { id: 'y', text: 'see [here](https://a.b)' }];
    expect(indentItem(markdown, 1)).toBeNull();
    const plainDoc: ListItem[] = [
      { id: 'x', text: 'one' },
      { id: 'y', text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] } },
    ];
    expect(indentItem(plainDoc, 1)!.items[0].children).toEqual(['two']);
  });

  it('carries sub-items along when indenting', () => {
    const r = indentItem(items(), 1)!;
    expect(r.items[0].children).toEqual(['Builder', 'MC-1', 'MC-2']);
  });

  it('outdents a sub-item to an item after its parent, with the sub-items below it', () => {
    const r = outdentChild(items(), 1, 0)!;
    expect(r.items.map((i) => i.text)).toEqual(['fully online', 'Builder', 'MC-1', 'Team']);
    expect(r.items[1].children).toBeUndefined();
    expect(r.items[2].children).toEqual(['MC-2']);
    expect(r.focus.itemId).toBe(r.items[2].id);
  });

  it('adds, edits and removes sub-items', () => {
    let r = addChildAfter(items(), 1, 0);
    expect(r.items[1].children).toEqual(['MC-1', '', 'MC-2']);
    expect(r.focus).toEqual({ itemId: 'b', child: 1 });
    const edited = setChild(r.items, 1, 1, 'new');
    expect(edited[1].children).toEqual(['MC-1', 'new', 'MC-2']);
    r = removeChild(edited, 1, 0)!;
    expect(r.items[1].children).toEqual(['new', 'MC-2']);
    expect(r.focus).toEqual({ itemId: 'b' });
    const last = removeChild([{ id: 'x', text: 't', children: ['only'] }], 0, 0)!;
    expect(last.items[0].children).toBeUndefined();
  });

  it('does not change the input arrays', () => {
    const before = items();
    const copy = JSON.stringify(before);
    addItemAfter(before, 1);
    removeItem(before, 1);
    indentItem(before, 1);
    outdentChild(before, 1, 1);
    addChildAfter(before, 1, 1);
    removeChild(before, 1, 1);
    expect(JSON.stringify(before)).toBe(copy);
  });
});

describe('arrays', () => {
  it('inserts, replaces and removes', () => {
    expect(insertAt([1, 2], 1, 9)).toEqual([1, 9, 2]);
    expect(insertAt([1, 2], 9, 9)).toEqual([1, 2, 9]);
    expect(replaceAt([1, 2], 0, 5)).toEqual([5, 2]);
    expect(removeAt([1, 2, 3], 1)).toEqual([1, 3]);
  });
});

describe('links typed on the page', () => {
  it('normalises what people paste', () => {
    expect(normalizeLinkInput('example.com/a b')).toEqual({ href: 'https://example.com/a%20b' });
    expect(normalizeLinkInput('ann@example.com')).toEqual({ href: 'mailto:ann@example.com' });
    expect(normalizeLinkInput('#team')).toEqual({ href: '#team' });
    expect(normalizeLinkInput('/tickets')).toEqual({ href: '/tickets' });
    expect(normalizeLinkInput('https://kgc.org')).toEqual({ href: 'https://kgc.org' });
    expect(normalizeLinkInput('javascript:alert(1)')).toHaveProperty('error');
    expect(normalizeLinkInput('not a link')).toHaveProperty('error');
    expect(normalizeLinkInput('  ')).toHaveProperty('error');
  });

  it('knows an off-site link', () => {
    expect(isOffsite('https://x.org')).toBe(true);
    expect(isOffsite('/learn')).toBe(false);
    expect(isOffsite('mailto:a@b.c')).toBe(false);
  });
});

describe('a table block\'s document', () => {
  const table = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] }] }] } as const;
  const fallback = () => ({ type: 'doc' as const, content: [{ type: 'paragraph' as const }] });

  it('keeps only the first table, as the website draws it (T332)', () => {
    const doc = { type: 'doc' as const, content: [table, { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'under' }] }] };
    expect(tableOnlyDoc(doc as never, fallback)).toEqual({ type: 'doc', content: [table] });
    const alone = { type: 'doc' as const, content: [table] };
    expect(tableOnlyDoc(alone as never, fallback)).toBe(alone);
  });

  it('gives a table back when there is none', () => {
    expect(tableOnlyDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Price' }] }] }, fallback)).toEqual(fallback());
    expect(tableOnlyDoc('plain words', fallback)).toEqual(fallback());
  });
});

describe('cutting an addition to a plain field (T343)', () => {
  it('cuts only the added characters, wherever they went', () => {
    expect(capInserted('abcd', 'abXYZcd', 6)).toEqual({ text: 'abXYcd', caret: 4 });
    expect(capInserted('abcd', 'XYZabcd', 5)).toEqual({ text: 'Xabcd', caret: 1 });
    expect(capInserted('Begin yy IMETAIL', 'Begin かなyy IMETAIL', 17)).toEqual({ text: 'Begin かyy IMETAIL', caret: 7 });
  });

  it('never cuts a field that shrank or kept its length, even over the limit', () => {
    const long = 'x'.repeat(52);
    expect(capInserted(long, long.slice(0, 51), 40)).toBeNull();
    expect(capInserted('abcdef', 'abfcde', 3)).toBeNull();
  });

  it('drops an addition to a field already over the limit, keeping its words', () => {
    expect(capInserted('x'.repeat(45), 'x'.repeat(20) + 'Q' + 'x'.repeat(25), 40)).toEqual({ text: 'x'.repeat(45), caret: 20 });
  });

  it('keeps what fits of a replacement', () => {
    expect(capInserted('hello world', 'hello there friend', 14)).toEqual({ text: 'hello there fd', caret: 13 });
    expect(capInserted('ab', 'abc', 5)).toBeNull();
  });

  it('in a field already over, a replacement keeps as much as it replaced (T348, D-S1/D-N4)', () => {
    // Select "PASTE" (5) in a 45-character field with a limit of 40, paste "ABCDEFGH".
    const over = 'PASTE' + 'x'.repeat(40);
    expect(capInserted(over, 'ABCDEFGH' + 'x'.repeat(40), 40)).toEqual({ text: 'ABCDE' + 'x'.repeat(40), caret: 5 });
    // A shorter replacement shrinks the field and is left alone.
    expect(capInserted(over, 'NEW' + 'x'.repeat(40), 40)).toBeNull();
  });
});
