import { describe, expect, it } from 'vitest';
import type { LearnPageContent } from '@kgc/shared';
import { AUTOSAVE_MS, autosaveStep, historyAfterServerReplace } from './learn-autosave-core';
import { pushEdit, redo, undo } from './learn-editor-core';

function page(text: string): LearnPageContent {
  return {
    seoTitle: 'Learn',
    seoDescription: 'About',
    sections: [
      {
        id: 's1',
        label: 'Hero',
        background: 'plain',
        width: 'normal',
        paddingTop: 'none',
        paddingBottom: 'none',
        blocks: [{ id: 't1', kind: 'text', text }],
      },
    ],
  } as LearnPageContent;
}

describe('autosaveStep', () => {
  const saved = page('saved');
  const bad = page('bad');
  const fixed = page('fixed');

  it('saves a change at the usual pace', () => {
    expect(autosaveStep({ content: fixed, lastSaved: saved, state: 'unsaved', refused: null })).toEqual({
      kind: 'save',
      delay: AUTOSAVE_MS,
    });
  });

  it('does not resend content the server refused', () => {
    expect(autosaveStep({ content: bad, lastSaved: saved, state: 'error', refused: bad })).toEqual({ kind: 'idle' });
  });

  it('retries at once when the refused content is fixed', () => {
    expect(autosaveStep({ content: fixed, lastSaved: saved, state: 'error', refused: bad })).toEqual({
      kind: 'save',
      delay: AUTOSAVE_MS,
    });
  });

  it('clears the error when the edit is taken back to what is saved', () => {
    expect(autosaveStep({ content: saved, lastSaved: saved, state: 'error', refused: bad })).toEqual({ kind: 'clean' });
    expect(autosaveStep({ content: saved, lastSaved: saved, state: 'unsaved', refused: null })).toEqual({ kind: 'clean' });
  });

  it('retries slowly after a network failure', () => {
    expect(autosaveStep({ content: fixed, lastSaved: saved, state: 'error', refused: null })).toEqual({
      kind: 'save',
      delay: AUTOSAVE_MS * 4,
    });
  });

  it('never saves during a conflict or while a save is on its way', () => {
    expect(autosaveStep({ content: fixed, lastSaved: saved, state: 'conflict', refused: null })).toEqual({ kind: 'idle' });
    expect(autosaveStep({ content: fixed, lastSaved: saved, state: 'saving', refused: null })).toEqual({ kind: 'idle' });
  });
});

describe('historyAfterServerReplace', () => {
  it('leaves nothing to undo or redo past a loaded draft', () => {
    let h = historyAfterServerReplace(page('mine 1'));
    h = pushEdit(h, { type: 'replace', content: page('mine 2') }, 0);
    h = pushEdit(h, { type: 'replace', content: page('mine 3') }, 10_000);
    h = undo(h);
    expect(h.past.length).toBeGreaterThan(0);
    expect(h.future.length).toBeGreaterThan(0);

    const theirs = page('theirs');
    const loaded = historyAfterServerReplace(theirs);
    expect(loaded.past).toEqual([]);
    expect(loaded.future).toEqual([]);
    expect(undo(loaded).present).toBe(theirs);
    expect(redo(loaded).present).toBe(theirs);
  });
});
