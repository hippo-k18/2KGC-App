'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { scrollToClear, type Span } from '@/lib/learn-tour-core';
import './extras.css';

/**
 * A five-step tour of the editor for someone opening it for the first time.
 *
 * Each step points at an element the shell marks with `data-tour="..."`. The
 * tour looks them up rather than taking refs, so the shell only adds an
 * attribute; a step whose element is not on screen (a pane hidden on a phone)
 * shows its card in the middle instead of pointing at nothing.
 */

// v3 (T329): the tour now starts with editing on the page, so everyone sees it once more.
const STORAGE_KEY = 'kgc-learn-tour-v3';

export type TourAnchor = 'outline' | 'preview' | 'settings' | 'add' | 'publish' | 'help';

/**
 * On a phone the outline and settings panes sit behind tabs and Help sits in More, so a step whose own
 * target is hidden points at the control that leads there instead, and says so.
 */
type Step = { anchor: TourAnchor; title: string; body: string; phone?: { selector: string; body: string } };

const MORE_BUTTON = '.le-menu-wrap > button[aria-haspopup="menu"]';

const STEPS: Step[] = [
  {
    anchor: 'preview',
    title: 'Change the words right on the page',
    body: 'Click any words on the page to change them, right where they are. Click a photo to replace it.',
    phone: {
      selector: '#le-tab-preview',
      body: 'In the Preview tab, tap any words on the page to change them, right where they are.',
    },
  },
  {
    anchor: 'add',
    title: 'Add something new',
    body: 'Use + to add a block, such as text or a photo, or a ready-made section, such as a team or a list of questions.',
    phone: {
      selector: '#le-tab-outline',
      body: 'Add a section at the bottom of the Outline tab: a ready-made one, such as a team or a list of questions, or a blank one.',
    },
  },
  {
    anchor: 'settings',
    title: 'Layout and colours',
    body: 'Layout and colours live here. You rarely need it.',
    phone: {
      selector: '#le-tab-settings',
      body: 'Layout and colours live in the Settings tab. You rarely need it.',
    },
  },
  {
    anchor: 'publish',
    title: 'Nothing goes live until you publish',
    body: 'Your changes save as a draft on their own. When you are happy with them, Publish puts them on the website.',
  },
  {
    anchor: 'help',
    title: 'Help is here',
    body: 'Short answers to common questions, and this tour again whenever you want it.',
    phone: { selector: MORE_BUTTON, body: 'Help is in the More menu: short answers to common questions, and this tour again.' },
  },
];

const GAP = 12;
const MARGIN = 16;
const RING_PAD = 6;

type Box = { top: number; left: number; width: number; height: number };

function visible(el: HTMLElement | null): HTMLElement | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // display:none or zero-size (a collapsed pane) counts as missing.
  return r.width > 0 && r.height > 0 ? el : null;
}

/** The step's own target, else its phone stand-in; `phone` says which one was found. */
function findAnchor(step: Step): { el: HTMLElement; phone: boolean } | null {
  const own = visible(document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`));
  if (own) return { el: own, phone: false };
  const alt = step.phone ? visible(document.querySelector<HTMLElement>(step.phone.selector)) : null;
  return alt ? { el: alt, phone: true } : null;
}

/** The nearest ancestor that scrolls vertically. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** The sticky or fixed box `hit` belongs to, below the first ancestor it shares with `target`. */
function stickyBox(hit: Element, target: HTMLElement): Element {
  for (let p: Element | null = hit; p && !p.contains(target); p = p.parentElement) {
    const { position } = getComputedStyle(p);
    if (position === 'sticky' || position === 'fixed') return p;
  }
  return hit;
}

/**
 * What is drawn over `el` at its top, middle and bottom: a sticky bar, say.
 * The tour's own shade and ring do not count.
 */
function coversOf(el: HTMLElement): Span[] {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const out: Span[] = [];
  for (const y of [r.top + 1, r.top + r.height / 2, r.bottom - 1]) {
    for (const hit of document.elementsFromPoint(x, y)) {
      // Painted top first, so everything before the target (or its container) is on top of it.
      if (hit === el || hit.contains(el)) break;
      if (el.contains(hit) || hit.closest('.le-x-tour')) continue;
      const b = stickyBox(hit, el).getBoundingClientRect();
      out.push({ top: b.top, bottom: b.bottom });
    }
  }
  return out;
}

/**
 * Brings `el` into view, then clear of anything sticky drawn over it (T326 D5b:
 * "Add a section" ended up under the outline's Copy and Paste bar).
 */
function revealTarget(el: HTMLElement): void {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const pane = scrollParent(el);
  if (!pane) return;
  const r = el.getBoundingClientRect();
  const p = pane.getBoundingClientRect();
  const delta = scrollToClear({ top: r.top, bottom: r.bottom }, coversOf(el), { top: p.top, bottom: p.bottom });
  if (delta !== 0) pane.scrollBy({ top: delta });
}

/** Where the card goes: below the target, else above, else beside, else centred; always inside the window. */
function placeCard(target: Box | null, card: { width: number; height: number }): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(MARGIN, Math.min(vw - card.width - MARGIN, x));
  const clampY = (y: number) => Math.max(MARGIN, Math.min(vh - card.height - MARGIN, y));
  if (!target) return { top: clampY((vh - card.height) / 2), left: clampX((vw - card.width) / 2) };
  const below = target.top + target.height + GAP;
  const above = target.top - GAP - card.height;
  const centreX = target.left + target.width / 2 - card.width / 2;
  if (below + card.height <= vh - MARGIN) return { top: below, left: clampX(centreX) };
  if (above >= MARGIN) return { top: above, left: clampX(centreX) };
  const right = target.left + target.width + GAP;
  const left = target.left - GAP - card.width;
  const centreY = clampY(target.top + target.height / 2 - card.height / 2);
  if (right + card.width <= vw - MARGIN) return { top: centreY, left: right };
  if (left >= MARGIN) return { top: centreY, left };
  // A target as big as the window (the preview pane): sit inside it, near the bottom.
  return { top: clampY(vh - card.height - MARGIN * 2), left: clampX(centreX) };
}

export function FirstRunTour({ onDone }: { onDone: () => void }) {
  const titleId = useId();
  const bodyId = useId();
  const [step, setStep] = useState(0);
  const [ring, setRing] = useState<Box | null>(null);
  const [onPhone, setOnPhone] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  const next = useCallback(() => {
    if (step >= STEPS.length - 1) doneRef.current();
    else setStep(step + 1);
  }, [step]);
  const back = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  const measure = useCallback(() => {
    const found = findAnchor(STEPS[step]);
    setOnPhone(found?.phone ?? false);
    const r = found?.el.getBoundingClientRect();
    const box = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
    setRing(box);
    const card = cardRef.current;
    if (card) setPos(placeCard(box, { width: card.offsetWidth, height: card.offsetHeight }));
  }, [step]);

  // Bring the target into view first, then measure, so the ring lands on it.
  useLayoutEffect(() => {
    const found = findAnchor(STEPS[step]);
    if (found) revealTarget(found.el);
    measure();
  }, [step, measure]);

  // The phone text can be a different length, so place the card again once it shows.
  useLayoutEffect(() => {
    measure();
  }, [onPhone, measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    // Capture, so scrolling inside a pane moves the ring too.
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  useEffect(() => {
    nextRef.current?.focus();
  }, [step]);

  // Focus goes back where it was when the tour ends.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        doneRef.current();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      } else if (e.key === 'Tab') {
        // Keep Tab inside the card while the rest of the page is covered.
        const list = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
        if (list.length === 0) return;
        const first = list[0];
        const lastEl = list[list.length - 1];
        if (!cardRef.current?.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [next, back]);

  const ringStyle: CSSProperties | undefined = ring
    ? {
        top: ring.top - RING_PAD,
        left: ring.left - RING_PAD,
        width: ring.width + RING_PAD * 2,
        height: ring.height + RING_PAD * 2,
      }
    : undefined;

  return (
    <div className="le-x-tour">
      {/* Covers the editor so a stray click does not edit the page mid-tour. */}
      <div className={`le-x-tour-shade${ring ? '' : ' is-dim'}`} aria-hidden="true" />
      {ringStyle && <div className="le-x-tour-ring" style={ringStyle} aria-hidden="true" />}
      <div
        ref={cardRef}
        className={`le-x-tour-card${ring ? '' : ' is-centred'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
      >
        <p className="le-x-tour-count">
          {step + 1} of {STEPS.length}
        </p>
        <h2 id={titleId} className="le-x-tour-title">
          {current.title}
        </h2>
        <p id={bodyId} className="le-x-tour-body">
          {onPhone && current.phone ? current.phone.body : current.body}
        </p>
        <div className="le-x-tour-actions">
          <button type="button" className="linkish le-x-tour-skip" onClick={() => doneRef.current()}>
            Skip tour
          </button>
          <span className="le-x-tour-nav">
            {step > 0 && (
              <button type="button" className="btn btn-default btn-sm" onClick={back}>
                Back
              </button>
            )}
            <button type="button" className="whova-btn-main small" ref={nextRef} onClick={next}>
              {last ? 'Done' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    // Storage blocked (private window, a browser setting): treat as seen, so
    // nobody gets the tour on every visit.
    return true;
  }
}

function writeSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    // Nothing to do; the tour simply shows again next time storage works.
  }
}

/**
 * Whether to show the tour. Starts false and reads storage after mount, so the
 * server render and the first client render agree.
 */
export function useFirstRunTour(): { show: boolean; start: () => void; finish: () => void } {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!readSeen()) setShow(true);
  }, []);
  const start = useCallback(() => setShow(true), []);
  const finish = useCallback(() => {
    writeSeen();
    setShow(false);
  }, []);
  return { show, start, finish };
}
