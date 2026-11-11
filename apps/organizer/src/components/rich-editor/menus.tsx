'use client';

import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { LEARN_COLORS, type ColorValue } from '@kgc/shared';
import { BRAND_COLORS, EMOJI, SPECIAL_CHARS, colorHex, colorLabel, contrastWarning, parseHex } from '../../lib/rich-editor/tools';
import { isColorValue } from '../../lib/rich-editor/convert';
import { Icon } from './icons';
import { Popover, ToolButton } from './controls';

/* ── Colour ────────────────────────────────────────────────────────────── */

/** Body text colour on the website, for judging a highlight. */
const INK: ColorValue = LEARN_COLORS.dark;

export function ColorMenu({ editor, kind, current }: { editor: Editor; kind: 'text' | 'highlight'; current: ColorValue | null }) {
  const label = kind === 'text' ? 'Text colour' : 'Highlight colour';
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  const parsed = parseHex(custom);
  const preview: ColorValue | null = parsed ?? current;
  const warning = preview ? (kind === 'text' ? contrastWarning(preview, 'white') : contrastWarning(INK, preview)) : null;

  const apply = (c: ColorValue | null, close: () => void) => {
    const chain = editor.chain().focus();
    if (kind === 'text') (c ? chain.setTextColor(c) : chain.unsetTextColor()).run();
    else (c ? chain.setHighlight(c) : chain.unsetHighlight()).run();
    close();
  };

  const face =
    kind === 'text' ? (
      <span className="rt-color-face">
        <span className="rt-color-letter">A</span>
        <span className="rt-color-bar" style={{ background: current ? colorHex(current) : INK }} />
      </span>
    ) : (
      <span className="rt-color-face">
        <Icon name="highlight" size={14} />
        <span className="rt-color-bar" style={{ background: current ? colorHex(current) : 'transparent' }} />
      </span>
    );

  return (
    <Popover
      label={label}
      face={face}
      caret
      pressed={current ? true : undefined}
      onOpen={() => {
        setCustom(current && current.startsWith('#') ? current : '');
        setError('');
      }}
    >
      {(close) => (
        <div className="rt-color-panel">
          <div className="rt-swatches" role="group" aria-label="Brand colours">
            {BRAND_COLORS.map((b) => (
              <button
                key={b.value}
                type="button"
                className="rt-swatch"
                style={{ background: b.hex }}
                aria-label={b.label}
                aria-pressed={current === b.value}
                data-tip={b.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(b.value, close)}
              />
            ))}
          </div>
          <button type="button" className="rt-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => apply(null, close)}>
            {kind === 'text' ? 'Default colour' : 'No highlight'}
          </button>
          <div className="rt-custom">
            <label className="rt-custom-label" htmlFor={`rt-custom-${kind}`}>
              Custom
            </label>
            <input
              type="color"
              className="rt-color-input"
              aria-label={`${label}: pick`}
              value={parsed ?? (current ? colorHex(current) : '#263759')}
              onChange={(e) => {
                setCustom(e.target.value);
                setError('');
              }}
            />
            <input
              id={`rt-custom-${kind}`}
              className="rt-input rt-hex"
              placeholder="#263759"
              value={custom}
              spellCheck={false}
              onChange={(e) => {
                setCustom(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (parsed) apply(parsed, close);
                  else setError('Use six hex digits, like #263759.');
                }
              }}
              aria-invalid={error ? true : undefined}
            />
            <button
              type="button"
              className="rt-small-btn"
              onClick={() => (parsed && isColorValue(parsed) ? apply(parsed, close) : setError('Use six hex digits, like #263759.'))}
            >
              Apply
            </button>
          </div>
          {error && (
            <p className="rt-error" role="alert">
              {error}
            </p>
          )}
          {warning && preview && (
            <p className="rt-warn" role="status">
              <span className="rt-warn-chip" style={kind === 'text' ? { color: colorHex(preview) } : { background: colorHex(preview) }}>
                Aa
              </span>
              {colorLabel(preview)}: {warning}
            </p>
          )}
        </div>
      )}
    </Popover>
  );
}

/* ── Table ─────────────────────────────────────────────────────────────── */

const GRID = 8;

export function TableMenu({ editor, inTable }: { editor: Editor; inTable: boolean }) {
  const [hover, setHover] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const run = (fn: () => boolean, close: () => void) => {
    fn();
    close();
  };
  const c = () => editor.chain().focus();
  return (
    <Popover label="Table" face={<Icon name="table" />} pressed={inTable ? true : undefined} caret onOpen={() => setHover({ r: 0, c: 0 })}>
      {(close) =>
        inTable ? (
          <div className="rt-menu" role="group" aria-label="Table tools">
            {(
              [
                ['Add row above', () => c().addRowBefore().run(), editor.can().addRowBefore()],
                ['Add row below', () => c().addRowAfter().run(), editor.can().addRowAfter()],
                ['Add column left', () => c().addColumnBefore().run(), editor.can().addColumnBefore()],
                ['Add column right', () => c().addColumnAfter().run(), editor.can().addColumnAfter()],
                ['Delete row', () => c().deleteRow().run(), editor.can().deleteRow()],
                ['Delete column', () => c().deleteColumn().run(), editor.can().deleteColumn()],
                ['Header row on or off', () => c().toggleHeaderRow().run(), editor.can().toggleHeaderRow()],
                ['Header column on or off', () => c().toggleHeaderColumn().run(), editor.can().toggleHeaderColumn()],
                ['Merge cells', () => c().mergeCells().run(), editor.can().mergeCells()],
                ['Split cell', () => c().splitCell().run(), editor.can().splitCell()],
              ] as const
            ).map(([label, fn, ok]) => (
              <button key={label} type="button" className="rt-menu-item" disabled={!ok} onMouseDown={(e) => e.preventDefault()} onClick={() => run(fn, close)}>
                {label}
              </button>
            ))}
            <button type="button" className="rt-menu-item rt-danger" onMouseDown={(e) => e.preventDefault()} onClick={() => run(() => c().deleteTable().run(), close)}>
              <Icon name="trash" size={14} /> Delete table
            </button>
          </div>
        ) : (
          <div className="rt-grid-picker">
            <div
              className="rt-grid"
              role="grid"
              aria-label="Table size"
              onMouseLeave={() => setHover({ r: 0, c: 0 })}
            >
              {Array.from({ length: GRID }, (_, r) => (
                <div role="row" key={r} className="rt-grid-row">
                  {Array.from({ length: GRID }, (_, col) => {
                    const on = r < hover.r && col < hover.c;
                    return (
                      <button
                        key={col}
                        type="button"
                        role="gridcell"
                        className={`rt-grid-cell${on ? ' on' : ''}`}
                        aria-label={`${r + 1} by ${col + 1}`}
                        tabIndex={r === 0 && col === 0 ? 0 : -1}
                        onMouseEnter={() => setHover({ r: r + 1, c: col + 1 })}
                        onFocus={() => setHover({ r: r + 1, c: col + 1 })}
                        onKeyDown={(e) => {
                          const d = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
                          if (!d) return;
                          e.preventDefault();
                          const nr = Math.min(GRID - 1, Math.max(0, r + d[0]));
                          const nc = Math.min(GRID - 1, Math.max(0, col + d[1]));
                          (e.currentTarget.closest('.rt-grid')?.children[nr]?.children[nc] as HTMLElement | undefined)?.focus();
                        }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => run(() => c().insertTable({ rows: r + 1, cols: col + 1, withHeaderRow: true }).run(), close)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="rt-grid-label" aria-live="polite">
              {hover.r ? `${hover.r} rows × ${hover.c} columns` : 'Pick a size'}
            </p>
          </div>
        )
      }
    </Popover>
  );
}

/* ── Special characters and emoji ──────────────────────────────────────── */

export function CharMenu({ editor, kind }: { editor: Editor; kind: 'chars' | 'emoji' }) {
  const groups = kind === 'chars' ? SPECIAL_CHARS : EMOJI;
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  return (
    <Popover
      label={kind === 'chars' ? 'Special characters' : 'Emoji'}
      face={kind === 'chars' ? <span className="rt-glyph">Ω</span> : <Icon name="smile" />}
      onOpen={() => setQ('')}
    >
      {(close) => (
        <div className="rt-chars">
          <input className="rt-input" placeholder="Search" aria-label="Search characters" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="rt-chars-scroll">
            {groups.map((g) => {
              const chars = g.chars.filter((c) => !query || c.name.toLowerCase().includes(query) || c.ch === q.trim());
              if (!chars.length) return null;
              return (
                <div key={g.group} role="group" aria-label={g.group}>
                  <p className="rt-chars-group">{g.group}</p>
                  <div className="rt-chars-grid">
                    {chars.map((c) => (
                      <ToolButton
                        key={c.ch}
                        inPanel
                        label={c.name}
                        className={kind === 'emoji' ? 'rt-char rt-emoji' : 'rt-char'}
                        onClick={() => {
                          editor.chain().focus().insertContent(c.ch).run();
                          close();
                        }}
                      >
                        {c.ch === ' ' ? <span className="rt-nbsp">nbsp</span> : c.ch}
                      </ToolButton>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Popover>
  );
}
