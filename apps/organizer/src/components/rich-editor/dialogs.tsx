'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { SHORTCUTS, buildHref, describeHref, findMatches, type LinkKind, type TextMatch } from '../../lib/rich-editor/tools';
import { Dialog, keysFor } from './controls';
import { changeLink, findKey, type FindMeta } from './extensions';
import { Icon } from './icons';

export interface RichAnchor {
  /** The anchor id without `#`, as stored on a section or block. */
  id: string;
  /** What the link dialog shows, e.g. "Team (section)". */
  label: string;
}

/* ── Link ──────────────────────────────────────────────────────────────── */

const KINDS: { kind: LinkKind; label: string; field: string; placeholder: string }[] = [
  { kind: 'url', label: 'Web address', field: 'Address', placeholder: 'https://example.com' },
  { kind: 'anchor', label: 'Section on this page', field: 'Section', placeholder: '' },
  { kind: 'email', label: 'Email', field: 'Email address', placeholder: 'name@example.com' },
  { kind: 'phone', label: 'Phone', field: 'Phone number', placeholder: '+1 212 555 0100' },
];

export function LinkDialog({ editor, anchors, onClose }: { editor: Editor; anchors: RichAnchor[]; onClose: () => void }) {
  const initial = useMemo(() => {
    const attrs = editor.getAttributes('link') as { href?: string; target?: string | null };
    const { from, to, empty } = editor.state.selection;
    return {
      editing: !!attrs.href,
      target: attrs.href ? describeHref(attrs.href) : { kind: 'url' as LinkKind, value: '' },
      newTab: attrs.target === '_blank',
      needsText: empty && !attrs.href,
      selected: editor.state.doc.textBetween(from, to, ' '),
    };
  }, [editor]);

  const [kind, setKind] = useState<LinkKind>(initial.target.kind);
  const [value, setValue] = useState(initial.target.value);
  const [newTab, setNewTab] = useState(initial.newTab);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const result = value.trim() ? buildHref(kind, value) : null;
  const warning = result && 'warning' in result ? result.warning : undefined;
  const meta = KINDS.find((k) => k.kind === kind)!;

  const apply = () => {
    const r = buildHref(kind, value);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    const attrs = { href: r.href, target: newTab ? '_blank' : null };
    if (initial.needsText) {
      const shown = text.trim() || value.trim();
      editor.chain().focus().insertContent({ type: 'text', text: shown, marks: [{ type: 'link', attrs }] }).run();
    } else {
      changeLink(editor, (c) => c.setLink(attrs));
    }
    onClose();
  };

  const remove = () => {
    changeLink(editor, (c) => c.unsetLink());
    onClose();
  };

  return (
    <Dialog
      title={initial.editing ? 'Edit link' : 'Add link'}
      onClose={() => {
        onClose();
        editor.commands.focus();
      }}
      footer={
        <>
          {initial.editing && (
            <button type="button" className="rt-text-btn rt-danger" onClick={remove}>
              Remove link
            </button>
          )}
          <span className="rt-grow" />
          <button type="button" className="rt-secondary" onClick={() => (onClose(), editor.commands.focus())}>
            Cancel
          </button>
          <button type="button" className="rt-primary" onClick={apply}>
            {initial.editing ? 'Save' : 'Add link'}
          </button>
        </>
      }
    >
      <div className="rt-tabs" role="radiogroup" aria-label="Link to">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            role="radio"
            aria-checked={kind === k.kind}
            className="rt-tab"
            onClick={() => {
              setKind(k.kind);
              setValue('');
              setError('');
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
      <form
        className="rt-form"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        {initial.needsText && (
          <label className="rt-field">
            <span>Text to show</span>
            <input className="rt-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Defaults to the address" />
          </label>
        )}
        {!initial.needsText && initial.selected && (
          <p className="rt-hint">
            Linking: <q>{initial.selected.length > 60 ? `${initial.selected.slice(0, 60)}…` : initial.selected}</q>
          </p>
        )}
        <label className="rt-field">
          <span>{meta.field}</span>
          {kind === 'anchor' && anchors.length > 0 ? (
            <select className="rt-input" value={value} onChange={(e) => (setValue(e.target.value), setError(''))} data-autofocus="">
              <option value="">Choose a section</option>
              {anchors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="rt-input"
              data-autofocus=""
              value={value}
              inputMode={kind === 'phone' ? 'tel' : kind === 'email' ? 'email' : 'url'}
              placeholder={kind === 'anchor' ? 'section-name' : meta.placeholder}
              onChange={(e) => {
                setValue(e.target.value);
                setError('');
              }}
              aria-invalid={error ? true : undefined}
              spellCheck={false}
            />
          )}
        </label>
        {kind === 'anchor' && anchors.length === 0 && (
          <p className="rt-hint">No section has an anchor yet. Give one an anchor in its settings, then pick it here.</p>
        )}
        <label className="rt-check">
          <input type="checkbox" checked={newTab} onChange={(e) => setNewTab(e.target.checked)} />
          Open in a new tab
        </label>
        {error && (
          <p className="rt-error" role="alert">
            {error}
          </p>
        )}
        {!error && warning && (
          <p className="rt-warn" role="status">
            {warning}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/* ── Find and replace ──────────────────────────────────────────────────── */

interface Hit extends TextMatch {
  /** Document positions. */
  pf: number;
  pt: number;
}

/** Every match in the document, as ProseMirror positions. Matches never cross a block or a line break. */
function findInDoc(doc: PMNode, query: string, matchCase: boolean, wholeWord: boolean): Hit[] {
  const hits: Hit[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) map.push(start + i);
        text += child.text;
      } else {
        map.push(start);
        text += '\n';
      }
    });
    for (const m of findMatches(text, query, { matchCase, wholeWord })) {
      hits.push({ ...m, pf: map[m.from], pt: map[m.to - 1] + 1 });
    }
    return false;
  });
  return hits;
}

export function FindBar({ editor, onClose, startWithReplace }: { editor: Editor; onClose: () => void; startWithReplace?: boolean }) {
  const [query, setQuery] = useState(() => {
    const { from, to } = editor.state.selection;
    const t = editor.state.doc.textBetween(from, to, ' ');
    return t.length < 80 && !t.includes('\n') ? t : '';
  });
  const [replace, setReplace] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [current, setCurrent] = useState(0);
  const [version, setVersion] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    editor.on('update', bump);
    return () => {
      editor.off('update', bump);
    };
  }, [editor]);

  const hits = useMemo(
    () => (query ? findInDoc(editor.state.doc, query, matchCase, wholeWord) : []),
    // `version` re-runs the search after an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, query, matchCase, wholeWord, version],
  );
  const cur = hits.length ? Math.min(current, hits.length - 1) : 0;

  const paint = useCallback(
    (ranges: Hit[], index: number) => {
      if (editor.isDestroyed) return;
      const meta: FindMeta = { ranges: ranges.map((h) => ({ from: h.pf, to: h.pt })), current: index };
      editor.view.dispatch(editor.state.tr.setMeta(findKey, meta).setMeta('addToHistory', false));
    },
    [editor],
  );

  useEffect(() => {
    paint(hits, cur);
  }, [hits, cur, paint]);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    return () => paint([], 0);
  }, [paint]);

  const reveal = (i: number) => {
    const h = hits[i];
    if (!h) return;
    setCurrent(i);
    editor.commands.setTextSelection({ from: h.pf, to: h.pt });
    editor.commands.scrollIntoView();
  };
  const step = (d: 1 | -1) => hits.length && reveal((cur + d + hits.length) % hits.length);

  const replaceOne = () => {
    const h = hits[cur];
    if (!h) return;
    // insertText keeps the marks of the text it replaces.
    const tr = editor.state.tr;
    if (replace) tr.insertText(replace, h.pf, h.pt);
    else tr.delete(h.pf, h.pt);
    editor.view.dispatch(tr);
  };
  const replaceAll = () => {
    if (!hits.length) return;
    const tr = editor.state.tr;
    [...hits].reverse().forEach((h) => {
      if (replace) tr.insertText(replace, h.pf, h.pt);
      else tr.delete(h.pf, h.pt);
    });
    editor.view.dispatch(tr);
  };

  const close = () => {
    onClose();
    editor.commands.focus();
  };

  return (
    <div
      className="rt-find"
      role="search"
      aria-label="Find and replace"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="rt-find-row">
        <input
          ref={input}
          className="rt-input"
          aria-label="Find"
          placeholder="Find"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCurrent(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            }
          }}
        />
        <span className="rt-find-count" aria-live="polite">
          {query ? (hits.length ? `${cur + 1} of ${hits.length}` : 'No results') : ''}
        </span>
        <button type="button" className="rt-icon-btn" aria-label="Previous match (Shift+Enter)" data-tip="Previous (Shift+Enter)" disabled={!hits.length} onClick={() => step(-1)}>
          <Icon name="up" />
        </button>
        <button type="button" className="rt-icon-btn" aria-label="Next match (Enter)" data-tip="Next (Enter)" disabled={!hits.length} onClick={() => step(1)}>
          <Icon name="down" />
        </button>
        <button type="button" className="rt-icon-btn" aria-label="Close find" data-tip="Close (Esc)" onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      <div className="rt-find-row">
        <input
          className="rt-input"
          aria-label="Replace with"
          placeholder="Replace with"
          value={replace}
          autoFocus={startWithReplace}
          onChange={(e) => setReplace(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              replaceOne();
            }
          }}
        />
        <button type="button" className="rt-small-btn" disabled={!hits.length} onClick={replaceOne}>
          Replace
        </button>
        <button type="button" className="rt-small-btn" disabled={!hits.length} onClick={replaceAll}>
          Replace all
        </button>
      </div>
      <div className="rt-find-row rt-find-opts">
        <label className="rt-check">
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
          Match case
        </label>
        <label className="rt-check">
          <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
          Whole word
        </label>
      </div>
    </div>
  );
}

/* ── Keyboard shortcuts ────────────────────────────────────────────────── */

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} wide>
      <div className="rt-keys">
        {SHORTCUTS.map((g) => (
          <section key={g.group} className="rt-keys-group">
            <h3>{g.group}</h3>
            <dl>
              {g.items.map((it) => (
                <Fragment key={it.label}>
                  <dt>{it.label}</dt>
                  <dd>
                    <kbd>{keysFor(it.keys)}</kbd>
                  </dd>
                </Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
