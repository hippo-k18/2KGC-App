'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import type { LearnPageContent } from '@kgc/shared';
import { summarizeChanges, type EditAction, type Selection } from '@/lib/learn-editor-core';
import { canonicalContent } from '@/lib/learn-library-edit-core';
import { loadLearnVersionAction, type LearnVersionSummary } from './api';
import { Modal } from './dialogs';
import { DEVICE_WIDTH, type Device } from './editor-types';
import { LearnPreview } from './preview';
import './tools.css';

/**
 * Compare a published version with the draft (T318): the change list on top,
 * then both pages side by side, read only, scrolled together. On a phone the
 * two previews would be too small to read, so one shows at a time.
 */

const PAGE_SELECTION: Selection = { kind: 'page' };
const noSelect: (sel: Selection) => void = () => {};
const noEdit: (action: EditAction) => void = () => {};

/** Below this width the previews stack and a toggle picks one. */
const STACK = 640;

function useStacked(): boolean {
  const [stacked, setStacked] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${STACK - 1}px)`);
    const update = () => setStacked(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return stacked;
}

/** Scales a fixed-width page down to fit its pane, the way the editor's stage does. */
function useFitScale(width: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const avail = entry.contentRect.width - 16;
      setScale(Math.min(1, Math.max(0.15, avail / width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return { ref, scale };
}

function versionLabel(v: LearnVersionSummary): string {
  const d = new Date(v.publishedAt);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}${sameYear ? '' : ` ${d.getFullYear()}`}`;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Published ${day}, ${time} by ${v.publishedBy}${v.note ? `, ${v.note}` : ''}`;
}

/** A local copy of the publish dialog's change group, so dialogs.tsx stays as it is. */
function ChangeGroup({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="le-change-group">
      <h3>
        {title} <span className="le-count">{items.length}</span>
      </h3>
      <ul>
        {items.slice(0, 12).map((t, i) => (
          <li key={`${t}-${i}`}>{t}</li>
        ))}
        {items.length > 12 && <li className="le-muted">and {items.length - 12} more</li>}
      </ul>
    </div>
  );
}

function ComparePane({
  label,
  content,
  device,
  siteOrigin,
  scrollRef,
  onScroll,
  emptyText = 'Loading...',
}: {
  label: string;
  content: LearnPageContent | null;
  emptyText?: string;
  device: Device;
  siteOrigin: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  const width = DEVICE_WIDTH[device];
  const { ref: fitRef, scale } = useFitScale(width);
  const headId = useId();
  return (
    <section className="le-tools-cmp-pane" aria-labelledby={headId} ref={fitRef}>
      <h3 id={headId} className="le-tools-cmp-label">
        {label}
      </h3>
      <div className="le-tools-cmp-scroll" ref={scrollRef} onScroll={onScroll} tabIndex={0} aria-label={`${label}, scrollable preview`}>
        {content ? (
          // inert: a preview to look at, so nothing in it can be selected or edited.
          <div className="le-tools-cmp-frame" inert>
            <div style={{ width, zoom: scale }}>
              <LearnPreview
                content={content}
                selection={PAGE_SELECTION}
                onSelect={noSelect}
                onEdit={noEdit}
                warnings={[]}
                siteOrigin={siteOrigin}
                device={device}
              />
            </div>
          </div>
        ) : (
          <p className="le-muted le-tools-cmp-empty">{emptyText}</p>
        )}
      </div>
    </section>
  );
}

export function CompareDialog({
  versions,
  draft,
  siteOrigin,
  onClose,
}: {
  versions: LearnVersionSummary[];
  draft: LearnPageContent;
  siteOrigin: string;
  onClose: () => void;
}) {
  const sorted = useMemo(() => [...versions].sort((a, b) => b.publishedAt - a.publishedAt), [versions]);
  const [picked, setPicked] = useState<string | null>(sorted[0]?.id ?? null);
  const [loaded, setLoaded] = useState<{ id: string; content: LearnPageContent } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [synced, setSynced] = useState(true);
  const [showing, setShowing] = useState<'version' | 'draft'>('version');
  const stacked = useStacked();
  const ids = useId();

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  /** The pane being moved by code, so its own scroll event does not bounce back. */
  const driven = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!picked) return;
    let live = true;
    setError(null);
    loadLearnVersionAction(picked)
      .then((res) => {
        if (!live) return;
        if (res.ok) setLoaded({ id: picked, content: res.content });
        else setError(res.error);
      })
      .catch(() => live && setError('Could not load that version.'));
    return () => {
      live = false;
    };
  }, [picked]);

  // Only the picked version counts, so an old load never shows under a new label.
  const version = loaded && loaded.id === picked ? loaded.content : null;
  // The draft comes expanded and in one key order (`canonicalContent`), like the
  // version, so a linked section is not listed as a change (T325, E F2).
  const changes = useMemo(() => (version ? summarizeChanges(canonicalContent(version), draft) : null), [version, draft]);

  // The two pages differ in length, so scroll by proportion rather than by pixels.
  const follow = useCallback(
    (from: RefObject<HTMLDivElement | null>, to: RefObject<HTMLDivElement | null>) => {
      const a = from.current;
      const b = to.current;
      if (!synced || stacked || !a || !b) return;
      if (driven.current === a) {
        driven.current = null;
        return;
      }
      const range = a.scrollHeight - a.clientHeight;
      const ratio = range > 0 ? a.scrollTop / range : 0;
      const target = Math.round(ratio * (b.scrollHeight - b.clientHeight));
      if (Math.abs(b.scrollTop - target) < 1) return;
      driven.current = b;
      b.scrollTop = target;
    },
    [synced, stacked],
  );

  if (sorted.length === 0)
    return (
      <Modal
        title="Compare with the draft"
        onClose={onClose}
        footer={
          <button type="button" className="btn btn-default" onClick={onClose} data-autofocus>
            Close
          </button>
        }
      >
        <p>Nothing has been published from here yet, so there is no version to compare with.</p>
      </Modal>
    );

  const showLeft = !stacked || showing === 'version';
  const showRight = !stacked || showing === 'draft';

  return (
    <Modal
      title="Compare with the draft"
      onClose={onClose}
      wide
      footer={
        <button type="button" className="btn btn-default" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="le-tools-cmp">
        <div className="le-tools-cmp-controls">
          <div className="le-tools-field le-tools-cmp-pick">
            <label className="le-tools-label" htmlFor={`${ids}-version`}>
              Published version
            </label>
            <select
              id={`${ids}-version`}
              className="whova-text-input"
              value={picked ?? ''}
              onChange={(e) => setPicked(e.target.value)}
              data-autofocus
            >
              {sorted.map((v) => (
                <option key={v.id} value={v.id}>
                  {versionLabel(v)}
                </option>
              ))}
            </select>
          </div>

          <div className="le-tools-seg" role="group" aria-label="Preview width">
            {(['desktop', 'phone'] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={device === d ? 'is-on' : ''}
                aria-pressed={device === d}
                onClick={() => setDevice(d)}
              >
                {d === 'desktop' ? 'Desktop' : 'Phone'}
              </button>
            ))}
          </div>

          {stacked ? (
            <div className="le-tools-seg" role="group" aria-label="Show">
              <span className="le-tools-seg-label" aria-hidden="true">
                Show:
              </span>
              {(['version', 'draft'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={showing === p ? 'is-on' : ''}
                  aria-pressed={showing === p}
                  onClick={() => setShowing(p)}
                >
                  {p === 'version' ? 'Version' : 'Draft'}
                </button>
              ))}
            </div>
          ) : (
            <label className="le-tools-check">
              <input type="checkbox" checked={synced} onChange={(e) => setSynced(e.target.checked)} />
              Scroll together
            </label>
          )}
        </div>

        {error && (
          <div className="whova-banner danger" role="alert">
            {error}
          </div>
        )}

        <div className="le-tools-cmp-changes" aria-live="polite">
          {changes &&
            (changes.total === 0 ? (
              <p className="le-muted">The draft is the same as this version.</p>
            ) : (
              <details className="le-tools-cmp-details" open={!stacked}>
                <summary>
                  {changes.total === 1 ? '1 change' : `${changes.total} changes`} since this version
                </summary>
                <div className="le-changes" aria-label="What changed">
                  {changes.pageEdited && <ChangeGroup title="Page title or description" items={['Edited']} />}
                  <ChangeGroup title="Sections added" items={changes.sectionsAdded} />
                  <ChangeGroup title="Sections removed" items={changes.sectionsRemoved} />
                  <ChangeGroup title="Sections changed" items={changes.sectionsEdited} />
                  <ChangeGroup title="Sections moved" items={changes.sectionsMoved} />
                  <ChangeGroup title="Blocks added" items={changes.blocksAdded} />
                  <ChangeGroup title="Blocks removed" items={changes.blocksRemoved} />
                  <ChangeGroup title="Blocks changed" items={changes.blocksEdited} />
                  <ChangeGroup title="Blocks moved" items={changes.blocksMoved} />
                </div>
              </details>
            ))}
        </div>

        <div className={`le-tools-cmp-panes${stacked ? ' is-stacked' : ''}`}>
          {showLeft && (
            <ComparePane
              label="Published version"
              content={error ? null : version}
              emptyText={error ? 'This version could not be loaded.' : 'Loading...'}
              device={device}
              siteOrigin={siteOrigin}
              scrollRef={leftRef}
              onScroll={() => follow(leftRef, rightRef)}
            />
          )}
          {showRight && (
            <ComparePane
              label="Draft"
              content={draft}
              device={device}
              siteOrigin={siteOrigin}
              scrollRef={rightRef}
              onScroll={() => follow(rightRef, leftRef)}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
