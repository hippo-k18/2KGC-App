'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { LearnSection } from '@kgc/shared';
import { cloneSectionWithNewIds, createSection } from '@/lib/learn-editor-core';
import { SECTION_TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from '@/lib/learn-templates';
import {
  deleteLearnLibraryAction,
  listLearnLibraryAction,
  renameLearnLibraryAction,
  saveLearnLibraryAction,
  type LibraryRow,
} from './api';
import { Modal } from './dialogs';
import './extras.css';

/* The same palette as the block picker's thumbnails, so both pickers read as one family. */
const BLUE = '#2069bc';
const GREY = '#c4ccd6';
const GREY_DARK = '#8a96a6';
const PALE = '#e7f1fb';

const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';

/** Short text lines, the building block of most thumbnails. */
function Lines({ x, y, widths, gap = 6, h = 3, fill = GREY }: { x: number; y: number; widths: number[]; gap?: number; h?: number; fill?: string }) {
  return (
    <>
      {widths.map((w, i) => (
        <rect key={i} x={x} y={y + i * gap} width={w} height={h} rx={h / 2} fill={fill} />
      ))}
    </>
  );
}

/** A miniature of each section, 120 by 72. */
const TEMPLATE_THUMBS: Record<string, ReactNode> = {
  blank: (
    <>
      <rect x="10" y="10" width="100" height="52" rx="4" fill="none" stroke={GREY_DARK} strokeWidth="1.2" strokeDasharray="4 3" />
      <path d="M60 28 V44 M52 36 H68" stroke={BLUE} strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  hero: (
    <>
      <rect x="1" y="1" width="118" height="70" rx="4" fill="#f2f4f7" />
      <rect x="22" y="14" width="76" height="9" rx="2" fill={BLUE} />
      <Lines x={30} y={30} widths={[60, 44]} />
      <rect x="28" y="46" width="30" height="11" rx="5.5" fill={BLUE} />
      <rect x="62" y="46" width="30" height="11" rx="5.5" fill="#fff" stroke={BLUE} strokeWidth="1.3" />
    </>
  ),
  'contents-intro': (
    <>
      <rect x="12" y="10" width="40" height="4" rx="2" fill={GREY_DARK} />
      {[20, 28, 36].map((y) => (
        <g key={y}>
          <circle cx="15" cy={y + 1.5} r="2" fill={BLUE} />
          <rect x="21" y={y} width="34" height="3" rx="1.5" fill={BLUE} opacity="0.6" />
        </g>
      ))}
      <Lines x={12} y={48} widths={[96, 90, 70]} />
    </>
  ),
  'text-image': (
    <>
      <rect x="10" y="16" width="40" height="6" rx="2" fill={BLUE} />
      <Lines x={10} y={28} widths={[44, 40, 44, 30]} />
      <rect x="64" y="12" width="46" height="48" rx="4" fill={PALE} stroke={BLUE} strokeWidth="1.3" />
      <circle cx="98" cy="24" r="4" fill={BLUE} opacity="0.55" />
      <path d="M66 58 L80 40 L90 50 L96 44 L108 58 Z" fill={BLUE} />
    </>
  ),
  team: (
    <>
      <rect x="38" y="8" width="44" height="6" rx="2" fill={BLUE} />
      {[28, 60, 92].map((cx) => (
        <g key={cx}>
          <rect x={cx - 14} y="20" width="28" height="44" rx="3" fill="#fff" stroke="#dde3ea" />
          <circle cx={cx} cy="33" r="7" fill={BLUE} opacity="0.75" />
          <rect x={cx - 9} y="45" width="18" height="3" rx="1.5" fill={GREY_DARK} />
          <rect x={cx - 7} y="51" width="14" height="2.5" rx="1.25" fill={GREY} />
        </g>
      ))}
    </>
  ),
  'course-list': (
    <>
      <rect x="30" y="8" width="60" height="6" rx="2" fill={BLUE} />
      {[10, 44, 78].map((x) => (
        <g key={x}>
          <rect x={x} y="20" width="32" height="44" rx="3" fill="#fff" stroke="#dde3ea" />
          <rect x={x + 4} y="25" width="20" height="4" rx="2" fill={GREY_DARK} />
          <Lines x={x + 4} y={33} widths={[24, 20, 22]} gap={5} h={2.5} />
          <rect x={x + 4} y="55" width="16" height="3" rx="1.5" fill={BLUE} />
        </g>
      ))}
    </>
  ),
  questions: (
    <>
      <rect x="30" y="8" width="60" height="6" rx="2" fill={BLUE} />
      {[20, 32, 44, 56].map((y) => (
        <g key={y}>
          <rect x="14" y={y} width="92" height="9" rx="2" fill="#fff" stroke="#dde3ea" />
          <rect x="18" y={y + 3} width="50" height="3" rx="1.5" fill={GREY_DARK} />
          <path d={`M98 ${y + 3} l3 3 l3 -3`} fill="none" stroke={BLUE} strokeWidth="1.3" strokeLinecap="round" />
        </g>
      ))}
    </>
  ),
  testimonial: (
    <>
      <rect x="18" y="10" width="84" height="52" rx="4" fill={PALE} />
      <path d="M28 20 h6 v6 l-3 6 h-3 l2 -6 h-2 Z M38 20 h6 v6 l-3 6 h-3 l2 -6 h-2 Z" fill={BLUE} />
      <Lines x={28} y={36} widths={[64, 56]} fill={GREY_DARK} />
      <circle cx="33" cy="54" r="4" fill={BLUE} opacity="0.7" />
      <rect x="40" y="52" width="26" height="3" rx="1.5" fill={GREY} />
    </>
  ),
  numbers: (
    <>
      {[26, 60, 94].map((cx) => (
        <g key={cx}>
          <rect x={cx - 12} y="22" width="24" height="12" rx="2" fill={BLUE} />
          <rect x={cx - 10} y="40" width="20" height="3" rx="1.5" fill={GREY} />
        </g>
      ))}
    </>
  ),
  gallery: (
    <>
      <rect x="38" y="6" width="44" height="6" rx="2" fill={BLUE} />
      {[0, 1].map((r) =>
        [0, 1, 2].map((c) => (
          <rect key={`${r}-${c}`} x={14 + c * 32} y={18 + r * 24} width="28" height="20" rx="2" fill={PALE} stroke={BLUE} strokeWidth="1" />
        )),
      )}
    </>
  ),
  'call-to-action': (
    <>
      <rect x="1" y="12" width="118" height="48" rx="4" fill={BLUE} />
      <rect x="34" y="20" width="52" height="6" rx="2" fill="#fff" />
      <rect x="28" y="31" width="64" height="3" rx="1.5" fill="#fff" opacity="0.7" />
      <rect x="44" y="40" width="32" height="11" rx="5.5" fill="#fff" />
    </>
  ),
  'contact-map': (
    <>
      <rect x="38" y="6" width="44" height="6" rx="2" fill={BLUE} />
      <rect x="28" y="16" width="64" height="3" rx="1.5" fill={GREY} />
      <rect x="14" y="24" width="92" height="42" rx="3" fill={PALE} />
      <path d="M14 44 L44 34 L70 52 L106 38" fill="none" stroke="#fff" strokeWidth="3" />
      <path d="M60 30 a6 6 0 0 1 12 0 c0 5 -6 11 -6 11 s-6 -6 -6 -11 Z" fill={BLUE} />
      <circle cx="66" cy="30" r="2" fill="#fff" />
    </>
  ),
};

export function TemplateThumb({ id }: { id: string }) {
  return (
    <svg className="le-x-tpl-thumb" width="120" height="72" viewBox="0 0 120 72" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="119" height="71" rx="4" fill="#fff" stroke="#dde3ea" />
      {TEMPLATE_THUMBS[id]}
    </svg>
  );
}

type Tab = 'ready' | 'saved';
type Filter = 'All' | TemplateCategory;

function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`;
}

/**
 * "Add a section": the ready-made templates and the sections people saved.
 * Both insert into the draft through the shell's callbacks, then close, so the
 * shell owns where the section lands and the undo step.
 */
export function AddSectionDialog({
  onInsert,
  onInsertReusable,
  onClose,
}: {
  onInsert: (section: LearnSection) => void;
  onInsertReusable: (libraryId: string, name: string) => void;
  onClose: () => void;
}) {
  const baseId = useId();
  const [tab, setTab] = useState<Tab>('ready');
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ ready: null, saved: null });

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next: Tab = e.key === 'Home' ? 'ready' : e.key === 'End' ? 'saved' : tab === 'ready' ? 'saved' : 'ready';
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const tabProps = (t: Tab) => ({
    id: `${baseId}-tab-${t}`,
    role: 'tab' as const,
    type: 'button' as const,
    'aria-selected': tab === t,
    'aria-controls': `${baseId}-panel-${t}`,
    tabIndex: tab === t ? 0 : -1,
    className: tab === t ? 'is-on' : undefined,
    onClick: () => setTab(t),
    ref: (el: HTMLButtonElement | null) => {
      tabRefs.current[t] = el;
    },
  });

  const insert = (section: LearnSection) => {
    onInsert(section);
    onClose();
  };

  return (
    <Modal title="Add a section" onClose={onClose} wide>
      <div className="le-x-tabs" role="tablist" aria-label="Kind of section" onKeyDown={onTabKey}>
        <button {...tabProps('ready')} data-autofocus>
          Ready-made
        </button>
        <button {...tabProps('saved')}>Saved sections</button>
      </div>
      <div
        id={`${baseId}-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${tab}`}
        className="le-x-tabpanel"
      >
        {tab === 'ready' ? (
          <ReadyMade onPick={insert} />
        ) : (
          <SavedSections
            onCopy={(row) => insert(cloneSectionWithNewIds(row.section, row.name))}
            onLinked={(row) => {
              onInsertReusable(row.id, row.name);
              onClose();
            }}
          />
        )}
      </div>
    </Modal>
  );
}

function ReadyMade({ onPick }: { onPick: (section: LearnSection) => void }) {
  const [filter, setFilter] = useState<Filter>('All');
  const gridRef = useRef<HTMLDivElement>(null);
  const shown = SECTION_TEMPLATES.filter((t) => filter === 'All' || t.category === filter);

  // Arrow keys move between cards; the column count comes from the live grid,
  // because it changes with the window width.
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const grid = gridRef.current;
    if (!grid) return;
    const items = Array.from(grid.querySelectorAll<HTMLButtonElement>('button.le-x-tpl'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const cols = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    const last = items.length - 1;
    let next = current;
    if (e.key === 'ArrowRight') next = Math.min(last, current + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, current - 1);
    else if (e.key === 'ArrowDown') next = Math.min(last, current + cols);
    else if (e.key === 'ArrowUp') next = Math.max(0, current - cols);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    items[next]?.focus();
  };

  return (
    <>
      <div className="le-x-filter" role="group" aria-label="Show">
        {(['All', ...TEMPLATE_CATEGORIES] as Filter[]).map((c) => (
          <button key={c} type="button" aria-pressed={filter === c} className={filter === c ? 'is-on' : undefined} onClick={() => setFilter(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="le-x-tpl-grid" ref={gridRef} onKeyDown={onGridKey}>
        {filter === 'All' && (
          <button type="button" className="le-x-tpl" onClick={() => onPick(createSection('New section'))}>
            <TemplateThumb id="blank" />
            <span className="le-x-tpl-name">Blank section</span>
            <span className="le-x-tpl-hint">A heading and a line of text to start from</span>
          </button>
        )}
        {shown.map((t) => (
          <button key={t.id} type="button" className="le-x-tpl" onClick={() => onPick(t.build())}>
            <TemplateThumb id={t.id} />
            <span className="le-x-tpl-name">{t.name}</span>
            <span className="le-x-tpl-hint">{t.hint}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function SavedSections({ onCopy, onLinked }: { onCopy: (row: LibraryRow) => void; onLinked: (row: LibraryRow) => void }) {
  const [rows, setRows] = useState<LibraryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listLearnLibraryAction()
      .then((res) => {
        if (!live) return;
        if (res.ok) setRows(res.items);
        else setError(res.error);
      })
      .catch(() => live && setError(NETWORK_ERROR));
    return () => {
      live = false;
    };
  }, []);

  if (error)
    return (
      <div className="whova-banner danger" role="alert">
        {error}
      </div>
    );
  if (!rows) return <p className="le-muted" role="status">Loading saved sections...</p>;
  if (rows.length === 0)
    return (
      <div className="le-x-empty">
        <p>
          <strong>No saved sections yet.</strong>
        </p>
        <p className="le-muted">
          To save one, select a section on the page, then choose Save to library in its settings. It then shows here,
          ready to add to this page again.
        </p>
      </div>
    );

  return (
    <ul className="le-x-lib">
      {rows.map((row) => (
        <LibraryItem
          key={row.id}
          row={row}
          onCopy={() => onCopy(row)}
          onLinked={() => onLinked(row)}
          onRenamed={(name) => setRows((rs) => rs?.map((r) => (r.id === row.id ? { ...r, name } : r)) ?? rs)}
          onDeleted={() => setRows((rs) => rs?.filter((r) => r.id !== row.id) ?? rs)}
        />
      ))}
    </ul>
  );
}

function LibraryItem({
  row,
  onCopy,
  onLinked,
  onRenamed,
  onDeleted,
}: {
  row: LibraryRow;
  onCopy: () => void;
  onLinked: () => void;
  onRenamed: (name: string) => void;
  onDeleted: () => void;
}) {
  const inputId = useId();
  const [mode, setMode] = useState<'view' | 'rename' | 'confirm-delete'>('view');
  const [name, setName] = useState(row.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renameBtn = useRef<HTMLButtonElement>(null);

  const rename = async () => {
    const next = name.trim();
    if (!next) {
      setError('Give the section a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await renameLearnLibraryAction(row.id, next);
      if (res.ok) {
        onRenamed(next);
        setMode('view');
        // Back to the button that opened the field, so keyboard users keep their place.
        requestAnimationFrame(() => renameBtn.current?.focus());
      } else setError(res.error);
    } catch {
      setError(NETWORK_ERROR);
    }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await deleteLearnLibraryAction(row.id);
      if (res.ok) {
        onDeleted();
        return;
      }
      setError(res.error);
    } catch {
      setError(NETWORK_ERROR);
    }
    setBusy(false);
  };

  return (
    <li className="le-x-lib-row">
      <div className="le-x-lib-main">
        {mode === 'rename' ? (
          <div className="le-x-lib-rename">
            <label className="le-x-sr" htmlFor={inputId}>
              New name
            </label>
            <input
              id={inputId}
              className="whova-text-input"
              value={name}
              maxLength={80}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void rename();
                } else if (e.key === 'Escape') {
                  // Closes the field, not the whole dialog.
                  e.preventDefault();
                  setName(row.name);
                  setMode('view');
                }
              }}
            />
            <button type="button" className="whova-btn-main small" disabled={busy} onClick={() => void rename()}>
              {busy ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              className="btn btn-default btn-sm"
              disabled={busy}
              onClick={() => {
                setName(row.name);
                setMode('view');
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <span className="le-x-lib-name">{row.name}</span>
        )}
        <span className="le-x-lib-meta">
          Saved {formatDay(row.createdAt)} · {plural(row.section.blocks.length, 'block')}
        </span>
      </div>

      {mode === 'confirm-delete' ? (
        <div className="le-x-confirm" role="group" aria-label={`Delete ${row.name}`}>
          <span>Delete this saved section? Linked copies on the page stop showing it.</span>
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void remove()} autoFocus>
            {busy ? 'Deleting...' : 'Delete'}
          </button>
          <button type="button" className="btn btn-default btn-sm" disabled={busy} onClick={() => setMode('view')}>
            Keep it
          </button>
        </div>
      ) : (
        <div className="le-x-lib-actions">
          <div className="le-x-lib-insert">
            <button type="button" className="whova-btn-main small" onClick={onCopy}>
              Insert a copy
            </button>
            <span className="le-x-lib-note">A copy you can change here</span>
          </div>
          <div className="le-x-lib-insert">
            <button type="button" className="btn btn-default btn-sm" onClick={onLinked}>
              Insert linked
            </button>
            <span className="le-x-lib-note">Stays in sync with the library</span>
          </div>
          {mode === 'view' && (
            <div className="le-x-lib-manage">
              <button
                type="button"
                className="linkish"
                ref={renameBtn}
                onClick={() => {
                  setError(null);
                  setMode('rename');
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="linkish le-x-danger-link"
                onClick={() => {
                  setError(null);
                  setMode('confirm-delete');
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="whova-banner danger le-x-lib-error" role="alert">
          {error}
        </div>
      )}
    </li>
  );
}

/** Names a section and saves a copy of it to the library, for this page or later ones. */
export function SaveToLibraryDialog({
  section,
  onClose,
  onSaved,
}: {
  section: LearnSection;
  onClose: () => void;
  onSaved: (item: LibraryRow) => void;
}) {
  const inputId = useId();
  const [name, setName] = useState(section.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the section a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await saveLearnLibraryAction(trimmed, section);
      if (res.ok) {
        onSaved(res.item);
        onClose();
        return;
      }
      setError(res.error);
    } catch {
      setError(NETWORK_ERROR);
    }
    setBusy(false);
  };

  return (
    <Modal
      title="Save to library"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-default" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="whova-btn-main small" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <p className="le-muted">
        Saves a copy of this section so you can add it again from Add a section, under Saved sections.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="whova-form-group">
          <label className="whova-form-label" htmlFor={inputId}>
            Name
          </label>
          <input
            id={inputId}
            className="whova-text-input"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error === 'Give the section a name.' || undefined}
            data-autofocus
          />
        </div>
      </form>
      {error && (
        <div className="whova-banner danger" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
