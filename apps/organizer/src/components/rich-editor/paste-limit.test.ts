import { describe, expect, it } from 'vitest';
import { Schema, Slice, Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Plugin } from '@tiptap/pm/state';
import { PasteLimit, cutSlice, docChars, fragmentChars, pasteLimitKey, pasteRoom } from './paste-limit';

/** T343: a rich field's paste is cut to its limit, typing stops there, and nothing already there is trimmed. */

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    bulletList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph+' },
    text: { group: 'inline' },
    hardBreak: { group: 'inline', inline: true },
  },
  marks: { bold: {} },
});

const p = (text: string) => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const doc = (...paras: PMNode[]) => schema.node('doc', null, paras);

function plugin(max: number | undefined): Plugin {
  const ext = PasteLimit.configure({ max: () => max });
  const make = ext.config.addProseMirrorPlugins as (this: unknown) => Plugin[];
  return make.call({ options: ext.options })[0];
}

function stateWith(d: PMNode, max: number | undefined, at = d.content.size - 1) {
  return EditorState.create({ doc: d, plugins: [plugin(max)], selection: TextSelection.create(d, at) });
}

describe('cutSlice', () => {
  it('keeps a slice that fits, and cuts one that does not to exactly the room', () => {
    const slice = new Slice(Fragment.from(schema.text('abcdef')), 0, 0);
    expect(cutSlice(slice, 10)).toBe(slice);
    expect(fragmentChars(cutSlice(slice, 4).content)).toBe(4);
    expect(cutSlice(slice, 4).content.textBetween(0, 4)).toBe('abcd');
    expect(cutSlice(slice, 0)).toBe(Slice.empty);
    expect(cutSlice(slice, -3)).toBe(Slice.empty);
  });

  it('cuts across paragraphs and lists, keeping marks and dropping what comes after the cut', () => {
    const bold = schema.marks.bold.create();
    const frag = Fragment.fromArray([
      schema.node('paragraph', null, [schema.text('one ', [bold]), schema.text('two')]),
      schema.node('bulletList', null, [schema.node('listItem', null, [p('three')])]),
      p('four'),
    ]);
    const cut = cutSlice(new Slice(frag, 1, 1), 9);
    expect(fragmentChars(cut.content)).toBe(9);
    expect(cut.content.childCount).toBe(2);
    expect(cut.content.firstChild!.firstChild!.marks.map((m) => m.type.name)).toEqual(['bold']);
    expect(cut.content.lastChild!.textContent).toBe('th');
    // Still a slice the document can take.
    expect(() => cut.content.forEach((n) => n.check())).not.toThrow();
  });
});

describe('pasteRoom', () => {
  it('is the limit less what the field holds, plus what the paste replaces', () => {
    const d = doc(p('hello world'));
    expect(pasteRoom(stateWith(d, 20), 20)).toBe(9);
    const sel = EditorState.create({ doc: d, selection: TextSelection.create(d, 1, 6) });
    expect(pasteRoom(sel, 20)).toBe(14);
    // Already over: no room, and nothing is taken away.
    expect(pasteRoom(stateWith(d, 5), 5)).toBe(0);
    // Already over, with a selection: as much as the selection, never less (T348, D-S1).
    const overSel = EditorState.create({ doc: d, selection: TextSelection.create(d, 1, 6) });
    expect(pasteRoom(overSel, 5)).toBe(5);
  });
});

describe('the paste limit plugin', () => {
  it('cuts a paste of 2,470 characters into a heading of limit 500 to exactly 500 in all', () => {
    const state = stateWith(doc(p('Find the program')), 500);
    const transform = plugin(500).props.transformPasted!.bind(plugin(500));
    const view = { state } as unknown as Parameters<typeof transform>[1];
    const cut = transform(new Slice(Fragment.from(p('y'.repeat(2470))), 1, 1), view, false);
    const next = state.apply(state.tr.replaceSelection(cut));
    expect(docChars(next.doc)).toBe(500);
    expect(next.doc.textContent.startsWith('Find the program')).toBe(true);
  });

  it('leaves the paste alone when the field has no limit', () => {
    const state = stateWith(doc(p('a')), undefined);
    const transform = plugin(undefined).props.transformPasted!.bind(plugin(undefined));
    const slice = new Slice(Fragment.from(schema.text('x'.repeat(50))), 0, 0);
    expect(transform(slice, { state } as never, false)).toBe(slice);
  });

  it('stops typing at the limit but lets deletes, undo and loads from outside through', () => {
    const state = stateWith(doc(p('abcd')), 5);
    const typed = state.apply(state.tr.insertText('e'));
    expect(typed.doc.textContent).toBe('abcde');
    // At the limit, one more character is refused.
    expect(typed.apply(typed.tr.insertText('f')).doc.textContent).toBe('abcde');
    // A delete goes through.
    expect(typed.apply(typed.tr.delete(1, 2)).doc.textContent).toBe('bcde');
    // Undo, redo and a load from outside go through, even past the limit.
    expect(typed.apply(typed.tr.insertText('fg').setMeta('history$', { redo: false })).doc.textContent).toBe('abcdefg');
    expect(typed.apply(typed.tr.insertText('fg').setMeta('preventUpdate', true)).doc.textContent).toBe('abcdefg');
    expect(typed.apply(typed.tr.insertText('fg').setMeta('composition', 1)).doc.textContent).toBe('abcdefg');
  });

  it('never trims a field already over its limit, and lets it shrink', () => {
    const state = stateWith(doc(p('x'.repeat(30))), 10);
    expect(state.apply(state.tr.insertText('y')).doc.textContent).toHaveLength(30);
    // Replacing a selection with fewer characters is a shrink, so it goes through.
    const shrink = state.apply(state.tr.insertText('y', 1, 6));
    expect(shrink.doc.textContent).toHaveLength(26);
    // A formatting change adds nothing and goes through.
    const bolded = state.apply(state.tr.addMark(1, 5, schema.marks.bold.create()));
    expect(bolded.doc.firstChild!.firstChild!.marks).toHaveLength(1);
  });

  it('in a field already over, a short paste over a selection goes in instead of only deleting it (T348, D-S1)', () => {
    const d = doc(p('PASTE' + 'w'.repeat(30)));
    const state = EditorState.create({ doc: d, plugins: [plugin(10)], selection: TextSelection.create(d, 1, 6) });
    const transform = plugin(10).props.transformPasted!.bind(plugin(10));
    const view = { state } as unknown as Parameters<typeof transform>[1];
    const pasted = transform(new Slice(Fragment.from(schema.text('NEW')), 0, 0), view, false);
    const next = state.apply(state.tr.replaceSelection(pasted));
    expect(next.doc.textContent).toBe('NEW' + 'w'.repeat(30));
    // A longer paste keeps what fits: as many characters as the selection held.
    const long = transform(new Slice(Fragment.from(schema.text('ABCDEFGH')), 0, 0), view, false);
    expect(state.apply(state.tr.replaceSelection(long)).doc.textContent).toBe('ABCDE' + 'w'.repeat(30));
  });

  it('says the count and limit while over, and nothing while under (T348)', () => {
    const pl = plugin(10);
    const attrs = pl.props.attributes as (s: EditorState) => Record<string, string>;
    const over = EditorState.create({ doc: doc(p('x'.repeat(12))), plugins: [pl] });
    expect(attrs(over)).toEqual({ 'data-limit-note': '12 characters; the limit is 10. Shorten it to publish.', 'data-limit-over': '' });
    const under = EditorState.create({ doc: doc(p('x'.repeat(9))), plugins: [pl] });
    expect(attrs(under)).toEqual({});
    // A short note set by a cut paste shows while under.
    const noted = under.apply(under.tr.setMeta(pasteLimitKey, 'Pasted text was cut to fit the limit of 10 characters.'));
    expect(attrs(noted)).toEqual({ 'data-limit-note': 'Pasted text was cut to fit the limit of 10 characters.' });
  });

  it('keeps what fits of several characters typed at once (T348, D-N3)', () => {
    const pl = plugin(10);
    let state = EditorState.create({ doc: doc(p('abcdefghi')), plugins: [pl], selection: TextSelection.create(doc(p('abcdefghi')), 10) });
    const view = {
      get state() {
        return state;
      },
      composing: false,
      dispatch: (tr: Parameters<EditorState['apply']>[0]) => {
        state = state.apply(tr);
      },
    };
    const input = pl.props.handleTextInput as unknown as (v: unknown, from: number, to: number, text: string) => boolean;
    expect(input(view, 10, 10, 'hello')).toBe(true);
    expect(state.doc.textContent).toBe('abcdefghih');
    // Something that fits is left to the editor.
    expect(input(view, 1, 3, 'xy')).toBe(false);
  });
});
