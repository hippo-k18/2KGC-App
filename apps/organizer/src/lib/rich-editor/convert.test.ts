import { describe, expect, it } from 'vitest';
import type { RichDoc } from '@kgc/shared';
import {
  collapseToSingleParagraph,
  countWords,
  markdownToRich,
  normalizeRichDoc,
  richPlainText,
  richToTiptap,
  tiptapToRich,
  toRichDoc,
} from './convert';
import { EVERYTHING } from './fixtures';

const roundTrip = (d: RichDoc) => tiptapToRich(richToTiptap(d));

describe('RichDoc <-> TipTap JSON', () => {
  it('round trips every node, mark and attribute exactly', () => {
    expect(normalizeRichDoc(EVERYTHING)).toEqual(EVERYTHING);
    expect(roundTrip(EVERYTHING)).toEqual(EVERYTHING);
  });

  it('maps attributes onto the TipTap names', () => {
    const tt = richToTiptap({
      type: 'doc',
      content: [
        { type: 'paragraph', align: 'center', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', href: '/a', newTab: true }, { type: 'color', color: 'navy' }] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
      ],
    });
    expect(tt.content?.[0]).toEqual({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: '/a', target: '_blank' } }, { type: 'textColor', attrs: { color: 'navy' } }] }],
    });
    expect(tt.content?.[1].attrs).toEqual({ start: 1 });
  });

  it('normalises things that render the same', () => {
    const messy = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a', marks: [{ type: 'italic' }, { type: 'bold' }] },
            { type: 'text', text: 'b', marks: [{ type: 'bold' }, { type: 'italic' }] },
            { type: 'text', text: '' },
          ],
        },
        { type: 'orderedList', start: 1, content: [{ type: 'listItem', content: [{ type: 'text', text: 'loose' }] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', colspan: 1, rowspan: 1, content: [] }] }] },
        { type: 'blockquote', content: [] },
      ],
    } as unknown as RichDoc;
    const n = normalizeRichDoc(messy);
    expect(n).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'ab', marks: [{ type: 'bold' }, { type: 'italic' }] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'loose' }] }] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph' }] },
      ],
    });
    expect(normalizeRichDoc(n)).toEqual(n);
    expect(roundTrip(n)).toEqual(n);
  });

  it('drops what the contract does not name', () => {
    const fromEditor = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'x.png' } },
        {
          type: 'paragraph',
          attrs: { textAlign: 'start', class: 'x' },
          content: [
            { type: 'text', text: 'k', marks: [{ type: 'textStyle', attrs: { fontFamily: 'Comic Sans' } }, { type: 'bold' }] },
            { type: 'text', text: 'c', marks: [{ type: 'textColor', attrs: { color: 'red' } }] },
            { type: 'mention', attrs: { id: 'x' } },
          ],
        },
        { type: 'details', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kept' }] }] },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }] },
        { type: 'heading', attrs: { level: 6 }, content: [{ type: 'text', text: 'h' }] },
      ],
    };
    expect(tiptapToRich(fromEditor)).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'k', marks: [{ type: 'bold' }] }, { type: 'text', text: 'c' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'kept' }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'x' }] },
        { type: 'heading', level: 2, content: [{ type: 'text', text: 'h' }] },
      ],
    });
  });

  it('never returns an empty document', () => {
    expect(tiptapToRich({ type: 'doc', content: [] })).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(toRichDoc('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(toRichDoc(null)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});

describe('v1 Markdown', () => {
  it('loads paragraphs, line breaks, bold, italic and links', () => {
    expect(markdownToRich('Meet the **KGC | Learn**\nTeam\n\n*Where* [us](https://kgc.org)')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Meet the ' },
            { type: 'text', text: 'KGC | Learn', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'Team' },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Where', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'us', marks: [{ type: 'link', href: 'https://kgc.org' }] },
          ],
        },
      ],
    });
  });

  it('round trips a Markdown string loaded into the editor', () => {
    const d = toRichDoc('A [link](mailto:x@y.z), **bold** and _more_');
    expect(roundTrip(d)).toEqual(d);
    expect(d.content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'A ' },
        { type: 'text', text: 'link', marks: [{ type: 'link', href: 'mailto:x@y.z' }] },
        { type: 'text', text: ', ' },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'more', marks: [{ type: 'italic' }] },
      ],
    });
  });

  it('loads what the v1 page shows, no more', () => {
    // The v1 page draws a link inside bold as bold text, and `- ` or `# `
    // lines as text, so the first edit must not change how they look.
    expect(markdownToRich('**[x](https://a.b)**\n- item\n# not a heading')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '[x](https://a.b)', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: '- item' },
            { type: 'hardBreak' },
            { type: 'text', text: '# not a heading' },
          ],
        },
      ],
    });
  });
});

describe('text and counts', () => {
  it('gives plain text with block breaks', () => {
    expect(richPlainText(EVERYTHING).split('\n').slice(0, 5)).toEqual(['Title', 'Two', 'Three', 'Four', 'biuscsupsub']);
  });

  it('counts words, not punctuation', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  Hello,   world! - it’s KGC-2027 ')).toBe(4);
    expect(countWords('café 東京')).toBe(2);
  });
});

describe('single line', () => {
  it('folds every block into one paragraph with line breaks', () => {
    expect(
      collapseToSingleParagraph({
        type: 'doc',
        content: [
          { type: 'paragraph', align: 'center', content: [{ type: 'text', text: 'Meet the ' }, { type: 'text', text: 'team', marks: [{ type: 'bold' }] }] },
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'and more' }] }] }] },
          { type: 'paragraph' },
        ],
      }),
    ).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          align: 'center',
          content: [
            { type: 'text', text: 'Meet the ' },
            { type: 'text', text: 'team', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'and more' },
          ],
        },
      ],
    });
  });

  it('leaves a single paragraph alone', () => {
    const d = toRichDoc('One **line**\nand a break');
    expect(collapseToSingleParagraph(d)).toEqual(d);
  });
});
