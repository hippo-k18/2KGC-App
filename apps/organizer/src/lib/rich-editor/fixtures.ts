import type { RichDoc } from '@kgc/shared';

/** One of every node, mark and attribute the contract names. */
export const EVERYTHING: RichDoc = {
  type: 'doc',
  content: [
    { type: 'heading', level: 1, content: [{ type: 'text', text: 'Title' }] },
    { type: 'heading', level: 2, align: 'center', content: [{ type: 'text', text: 'Two' }] },
    { type: 'heading', level: 3, align: 'right', content: [{ type: 'text', text: 'Three' }] },
    { type: 'heading', level: 4, align: 'justify', content: [{ type: 'text', text: 'Four' }] },
    {
      type: 'paragraph',
      align: 'left',
      content: [
        { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'i', marks: [{ type: 'italic' }] },
        { type: 'text', text: 'u', marks: [{ type: 'underline' }] },
        { type: 'text', text: 's', marks: [{ type: 'strike' }] },
        { type: 'text', text: 'c', marks: [{ type: 'code' }] },
        { type: 'text', text: 'sup', marks: [{ type: 'superscript' }] },
        { type: 'text', text: 'sub', marks: [{ type: 'subscript' }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'link', marks: [{ type: 'link', href: 'https://example.com' }] },
        { type: 'text', text: 'tab', marks: [{ type: 'link', href: '#team', newTab: true }] },
        { type: 'text', text: 'navy', marks: [{ type: 'color', color: 'navy' }] },
        { type: 'text', text: 'hex', marks: [{ type: 'color', color: '#ab12cd' }] },
        { type: 'text', text: 'hl', marks: [{ type: 'highlight', color: 'orange' }] },
        { type: 'text', text: 'big', marks: [{ type: 'fontSize', size: 'x-large' }] },
        {
          type: 'text',
          text: 'all',
          marks: [
            { type: 'link', href: 'mailto:a@b.co' },
            { type: 'bold' },
            { type: 'italic' },
            { type: 'underline' },
            { type: 'color', color: 'teal' },
            { type: 'highlight', color: '#ffee00' },
            { type: 'fontSize', size: 'small' },
          ],
        },
      ],
    },
    { type: 'paragraph' },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
            {
              type: 'orderedList',
              start: 3,
              content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }] }],
            },
          ],
        },
      ],
    },
    {
      type: 'orderedList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] }],
    },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] },
    { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;\nx++' }] },
    { type: 'codeBlock' },
    { type: 'horizontalRule' },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H1' }] }] },
            { type: 'tableHeader', colspan: 2, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H2' }] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', rowspan: 2, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph' }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'c', marks: [{ type: 'bold' }] }] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'd' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'e' }] }] },
          ],
        },
      ],
    },
  ],
};
