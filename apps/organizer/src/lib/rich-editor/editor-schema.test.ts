// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { richExtensions, transformPastedHTML } from '../../components/rich-editor/extensions';
import { richToTiptap, tiptapToRich, toRichDoc } from './convert';
import { validateRichDoc } from '@kgc/shared';
import { EVERYTHING } from './fixtures';

/**
 * The same round trip as `convert.test.ts`, but through a real TipTap editor
 * with the extensions the component uses, so a node or attribute the schema
 * silently rejects (and ProseMirror would drop on load) fails here.
 */

const handlers = () => ({
  singleLine: false,
  onExit: () => false,
  onLink: () => {},
  onFind: () => {},
  onHelp: () => {},
  onFocusMode: () => {},
});

let editor: Editor | null = null;
const make = (content: JSONContent) => {
  editor = new Editor({ extensions: richExtensions({ handlers }), content });
  return editor;
};
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('the editor schema', () => {
  it('loads and gives back every node and mark unchanged', () => {
    const e = make(richToTiptap(EVERYTHING) as JSONContent);
    expect(tiptapToRich(e.getJSON())).toEqual(EVERYTHING);
  });

  it('loads a v1 Markdown string', () => {
    const md = 'Meet the **KGC | Learn**\nTeam\n\n*Where peer-learning drives practice.* [Brochure](mailto:contact@knowledgegraph.tech)';
    const e = make(richToTiptap(md) as JSONContent);
    expect(tiptapToRich(e.getJSON())).toEqual(toRichDoc(md));
  });

  it('applies the toolbar commands as contract marks', () => {
    const e = make(richToTiptap('hello world') as JSONContent);
    e.chain().setTextSelection({ from: 1, to: 6 }).setTextColor('teal').setHighlight('#ffee00').setFontSize('large').toggleUnderline().run();
    e.chain().setTextAlign('center').run();
    expect(tiptapToRich(e.getJSON())).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          align: 'center',
          content: [
            {
              type: 'text',
              text: 'hello',
              marks: [{ type: 'underline' }, { type: 'color', color: 'teal' }, { type: 'highlight', color: '#ffee00' }, { type: 'fontSize', size: 'large' }],
            },
            { type: 'text', text: ' world' },
          ],
        },
      ],
    });
    e.chain().setTextSelection({ from: 1, to: 6 }).setFontSize('normal').run();
    expect(JSON.stringify(tiptapToRich(e.getJSON()))).not.toContain('fontSize');
  });

  it('inserts and edits tables', () => {
    const e = make(richToTiptap('x') as JSONContent);
    e.chain().insertTable({ rows: 2, cols: 3, withHeaderRow: true }).run();
    let doc = tiptapToRich(e.getJSON());
    const table = doc.content.find((n) => n.type === 'table');
    expect(table && 'content' in table ? table.content.length : 0).toBe(2);
    e.commands.addRowAfter();
    e.commands.addColumnAfter();
    doc = tiptapToRich(e.getJSON());
    const t2 = doc.content.find((n) => n.type === 'table') as { content: { content: unknown[] }[] };
    expect(t2.content.length).toBe(3);
    expect(t2.content[0].content.length).toBe(4);
    e.chain().deleteTable().run();
    expect(tiptapToRich(e.getJSON()).content.some((n) => n.type === 'table')).toBe(false);
  });

  it('keeps an ordered list start number', () => {
    const e = make(richToTiptap('one') as JSONContent);
    e.chain().toggleOrderedList().updateAttributes('orderedList', { start: 5 }).run();
    expect(tiptapToRich(e.getJSON()).content[0]).toMatchObject({ type: 'orderedList', start: 5 });
  });

  it('drops pasted styles but keeps structure', () => {
    const e = make(richToTiptap('') as JSONContent);
    const html = transformPastedHTML(
      '<b style="font-weight:normal" id="docs-internal-guid-1"><h2 style="font-family:Arial">Agenda</h2>' +
        '<p><span style="font-weight:700;color:#ff0000;font-size:20pt">Bold</span> and <span style="font-style:italic">italic</span></p>' +
        '<ul><li><p>one</p></li></ul></b>',
    );
    e.commands.setContent(html);
    expect(tiptapToRich(e.getJSON())).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', level: 2, content: [{ type: 'text', text: 'Agenda' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          ],
        },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }] },
      ],
    });
  });

  it('keeps its own colours through copy and paste', () => {
    const e = make(richToTiptap(EVERYTHING) as JSONContent);
    const html = e.getHTML();
    const e2 = new Editor({ extensions: richExtensions({ handlers }), content: transformPastedHTML(html) });
    try {
      const doc = JSON.stringify(tiptapToRich(e2.getJSON()));
      expect(doc).toContain('"color":"#ab12cd"');
      expect(doc).toContain('"highlight","color":"orange"');
      expect(doc).toContain('"size":"x-large"');
    } finally {
      e2.destroy();
    }
  });

  it('cannot make a document the server refuses: no table or divider where the contract has none (T323)', () => {
    const quote = { type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] }] }] };
    const list = {
      type: 'doc',
      content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }] }] }],
    };
    for (const start of [quote, list]) {
      const e = make(start as JSONContent);
      e.commands.focus('end');
      e.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false });
      e.commands.focus('end');
      e.commands.setHorizontalRule();
      const doc = tiptapToRich(e.getJSON());
      expect(validateRichDoc(doc)).toMatchObject({ ok: true });
      expect(JSON.stringify(doc)).toContain('"table"');
      e.destroy();
      editor = null;
    }
    // A table inside a table cell is not allowed either.
    const e = make({ type: 'doc', content: [] });
    e.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    e.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false });
    expect(validateRichDoc(tiptapToRich(e.getJSON()))).toMatchObject({ ok: true });
  });

  it('selects one cell with the first Cmd+A in a table, and everything with the second', () => {
    const e = make(richToTiptap('x') as JSONContent);
    e.chain().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).insertContent('abc').run();
    // A real keydown, as the browser sends it (jsdom is not a Mac, so Mod is Ctrl).
    const selectAll = () => e.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    selectAll();
    expect(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to)).toBe('abc');
    selectAll();
    expect(e.state.selection.to - e.state.selection.from).toBeGreaterThan(3);
  });
});
