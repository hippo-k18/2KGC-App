import { describe, expect, it } from 'vitest';
import {
  addChildAfter,
  addItemAfter,
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

  it('indents an item into the one above as one line of words', () => {
    const r = indentItem(items(), 2)!;
    expect(r.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(r.items[1].children).toEqual(['MC-1', 'MC-2', 'Team Brochure']);
    expect(r.focus).toEqual({ itemId: 'b', child: 2 });
    expect(indentItem(items(), 0)).toBeNull();
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
