'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import type { PageImage } from '@kgc/shared';
import {
  ASPECT_PRESETS,
  FULL_CROP,
  NO_EDIT,
  cropToPixels,
  fitCropToAspect,
  focalFromCrop,
  fromCopyToOriginal,
  fromOriginalToCopy,
  imageEditOps,
  isAtStart,
  moveCrop,
  pointInCrop,
  resizeCrop,
  rotateBy,
  rotateSize,
  toDisplayPoint,
  toDisplayRect,
  toOriginalPoint,
  toOriginalRect,
  type Corner,
  type CropRect,
  type EditStart,
  type Transform,
} from '@/lib/learn-media-ui-core';
import type { LearnImageEditState } from '@/lib/learn-image-edit-core';
import { editLearnImageAction, learnImageEditStartAction } from './api';
import { Modal } from './dialogs';
import { resolveSrc } from './editor-types';
import './media.css';

/**
 * Crop, turn, flip and set the focal point of one image (T318). The preview
 * is the real <img> under CSS transforms rather than a canvas: the server
 * makes the new file, so the browser only has to show what it will look like,
 * and a Storage URL drawn into a canvas would taint it anyway.
 *
 * Crop and focal point are held in the original picture's coordinates and
 * converted to what is on screen only for drawing (see learn-media-ui-core), so
 * turning or flipping never moves the part of the picture that was chosen.
 *
 * Editing an edited copy opens the original it was cut from, with the copy's
 * crop and turn already set (T325, D8), so changing your mind never crops the
 * copy again and loses pixels. Reset goes back to the whole original.
 */

const STEP = 0.02;
const FOCUS_STEP = 0.05;
const NO_TURN: Transform = { rotate: 0, flipX: false, flipY: false };
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

type Drag = { kind: 'move' | Corner; x: number; y: number; start: CropRect; id: number };

const round2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

export interface ImageEditorProps {
  image: PageImage;
  siteOrigin: string;
  onDone: (image: PageImage) => void;
  onClose: () => void;
}

type Origin = { image: PageImage; state: LearnImageEditState };

/** Asks the server whether `image` is an edited copy with its original still stored, then opens the editor. */
export function ImageEditor(props: ImageEditorProps) {
  const [origin, setOrigin] = useState<Origin | null | undefined>(undefined);
  const src = props.image.src;

  useEffect(() => {
    let alive = true;
    learnImageEditStartAction(src)
      .then((res) => alive && setOrigin(res.ok ? res.start : null))
      // Without the answer the copy itself is edited, as before.
      .catch(() => alive && setOrigin(null));
    return () => {
      alive = false;
    };
  }, [src]);

  if (origin === undefined) {
    return (
      <Modal
        title="Edit image"
        onClose={props.onClose}
        wide
        footer={
          <button type="button" className="btn btn-default" onClick={props.onClose}>
            Cancel
          </button>
        }
      >
        <p className="le-imged-size" role="status">
          Loading the image...
        </p>
      </Modal>
    );
  }
  return <ImageEditorBody {...props} origin={origin} />;
}

function ImageEditorBody({ image, siteOrigin, onDone, onClose, origin }: ImageEditorProps & { origin: Origin | null }) {
  const uid = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  // What is on screen: the original when `image` is an edited copy of it.
  const work: PageImage = origin ? { ...origin.image, alt: image.alt } : image;
  const start: EditStart = origin
    ? { crop: origin.state.crop, t: { rotate: origin.state.rotate, flipX: origin.state.flipX, flipY: origin.state.flipY } }
    : NO_EDIT;
  const imageFocus =
    image.focusX !== undefined || image.focusY !== undefined
      ? { x: image.focusX ?? 0.5, y: image.focusY ?? 0.5 }
      : null;
  // Held in the coordinates of the picture on screen, like the crop.
  const initialFocus = imageFocus && origin ? fromCopyToOriginal(imageFocus, start) : imageFocus;

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [t, setT] = useState<Transform>(start.t);
  const [crop, setCrop] = useState<CropRect>(start.crop);
  const [aspectId, setAspectId] = useState('free');
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(initialFocus);
  const [mode, setMode] = useState<'crop' | 'focus'>('crop');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const w = natural?.w || work.width || 1;
  const h = natural?.h || work.height || 1;
  const disp = rotateSize(w, h, t.rotate);
  const dispCrop = toDisplayRect(crop, t);
  const dispFocus = focus ? toDisplayPoint(focus, t) : null;
  const ratio = ASPECT_PRESETS.find((p) => p.id === aspectId)?.ratio ?? null;
  const ready = !!natural && !loadFailed;
  const geometryChanged = !isAtStart(crop, t, start);
  const focusChanged = focus?.x !== initialFocus?.x || focus?.y !== initialFocus?.y;
  const px = cropToPixels(toDisplayRect(crop, t), disp.width, disp.height);

  function setDispCrop(r: CropRect, tr: Transform = t) {
    setCrop(toOriginalRect(r, tr));
    setError(null);
  }

  function chooseAspect(id: string) {
    setAspectId(id);
    const r = ASPECT_PRESETS.find((p) => p.id === id)?.ratio ?? null;
    if (r) setDispCrop(fitCropToAspect(dispCrop, r, disp.width, disp.height));
  }

  function turn(deg: 90 | -90) {
    const next = { ...t, rotate: rotateBy(t.rotate, deg) };
    setT(next);
    setError(null);
    // A 16:9 box turned on its side is 9:16; refit so the chosen shape holds.
    if (ratio) {
      const nd = rotateSize(w, h, next.rotate);
      setDispCrop(fitCropToAspect(toDisplayRect(crop, next), ratio, nd.width, nd.height), next);
    }
  }

  function flip(axis: 'flipX' | 'flipY') {
    setT({ ...t, [axis]: !t[axis] });
    setError(null);
  }

  /** Back to the whole picture: for an edited copy, the whole original. */
  function reset() {
    setT(NO_TURN);
    setCrop(FULL_CROP);
    setAspectId('free');
    setFocus(initialFocus);
    setError(null);
  }

  function stageFraction(clientX: number, clientY: number) {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height, r };
  }

  function onCropPointerDown(e: PointerEvent<HTMLElement>, kind: Drag['kind']) {
    if (mode !== 'crop' || !ready || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, x: e.clientX, y: e.clientY, start: dispCrop, id: e.pointerId };
  }

  function onCropPointerMove(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const r = stageRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    const dx = (e.clientX - d.x) / r.width;
    const dy = (e.clientY - d.y) / r.height;
    setDispCrop(
      d.kind === 'move'
        ? moveCrop(d.start, dx, dy)
        : resizeCrop(d.start, d.kind, dx, dy, ratio, disp.width, disp.height),
    );
  }

  function onCropPointerUp(e: PointerEvent<HTMLElement>) {
    if (drag.current?.id === e.pointerId) drag.current = null;
  }

  function onCropKey(e: KeyboardEvent<HTMLDivElement>) {
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-STEP, 0],
      ArrowRight: [STEP, 0],
      ArrowUp: [0, -STEP],
      ArrowDown: [0, STEP],
    };
    const step = d[e.key];
    if (!step) return;
    e.preventDefault();
    setDispCrop(
      e.shiftKey
        ? resizeCrop(dispCrop, 'se', step[0], step[1], ratio, disp.width, disp.height)
        : moveCrop(dispCrop, step[0], step[1]),
    );
  }

  function setFocusFromDisplay(x: number, y: number) {
    const o = toOriginalPoint({ x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }, t);
    setFocus({ x: round2(o.x), y: round2(o.y) });
    setError(null);
  }

  function onStageClick(e: MouseEvent<HTMLDivElement>) {
    if (mode !== 'focus') return;
    const p = stageFraction(e.clientX, e.clientY);
    if (p) setFocusFromDisplay(p.x, p.y);
  }

  function onFocusKey(e: KeyboardEvent<HTMLDivElement>) {
    if (mode !== 'focus') return;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-FOCUS_STEP, 0],
      ArrowRight: [FOCUS_STEP, 0],
      ArrowUp: [0, -FOCUS_STEP],
      ArrowDown: [0, FOCUS_STEP],
    };
    const step = d[e.key];
    if (!step) return;
    e.preventDefault();
    const cur = dispFocus ?? { x: 0.5, y: 0.5 };
    setFocusFromDisplay(cur.x + step[0], cur.y + step[1]);
  }

  /** The image as it is, with only the focal point changed. */
  function focalOnly(): PageImage {
    // With a crop that could not be saved, its middle is the best guess at what matters.
    const f = focus ?? (!geometryChanged ? null : { x: focalFromCrop(crop).focusX, y: focalFromCrop(crop).focusY });
    if (!f) return image;
    const c = fromOriginalToCopy(f, start);
    return { ...image, focusX: c.x, focusY: c.y };
  }

  async function save() {
    const ops = geometryChanged ? imageEditOps(crop, t, w, h) : [];
    if (ops.length === 0) {
      // Back to the whole original: use it as it is, no new file.
      if (origin && geometryChanged) {
        const out: PageImage = { ...work };
        if (focus) {
          out.focusX = round2(focus.x);
          out.focusY = round2(focus.y);
        }
        onDone(out);
        return;
      }
      // Turns and flips that cancel out leave the picture as it was: no new file.
      onDone(focalOnly());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The server makes a new file and its library row and keeps the original,
      // so the pages and versions that use the original are unaffected. It
      // refuses the website's own /kgc/ images; that message is shown as sent.
      // `state` is kept on the copy's library row, so editing the copy again
      // opens `work` with this crop and turn (the server checks it gives `ops`).
      const state: LearnImageEditState = { crop, rotate: t.rotate, flipX: t.flipX, flipY: t.flipY };
      const res = await editLearnImageAction({ src: work.src, edit: { ops, format: 'keep', state }, alt: image.alt });
      if (!res.ok) {
        setError(res.error || 'The edited image could not be saved.');
        return;
      }
      // The new file is the on-screen crop, so a focal point the person chose
      // moves into its frame. Without one, the new image has none either.
      const out: PageImage = { ...res.image, alt: image.alt };
      if (dispFocus) {
        const f = pointInCrop(dispFocus, dispCrop);
        out.focusX = f.x;
        out.focusY = f.y;
      }
      onDone(out);
    } catch {
      setError('The edited image could not be saved. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const ar = disp.width / disp.height;
  const quarter = t.rotate === 90 || t.rotate === 270;
  const imgStyle: CSSProperties = {
    width: `${quarter ? (100 * disp.height) / disp.width : 100}%`,
    height: `${quarter ? (100 * disp.width) / disp.height : 100}%`,
    transform: `translate(-50%, -50%) scale(${t.flipX ? -1 : 1}, ${t.flipY ? -1 : 1}) rotate(${t.rotate}deg)`,
  };
  const pct = (n: number) => `${n * 100}%`;
  const helpId = `${uid}-help`;
  const sizeId = `${uid}-size`;

  return (
    <Modal
      title="Edit image"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-default le-imged-reset" onClick={reset} disabled={busy}>
            Reset
          </button>
          <button type="button" className="btn btn-default" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="whova-btn-main small"
            onClick={() => void save()}
            disabled={busy || loadFailed || (!ready && geometryChanged) || (!geometryChanged && !focusChanged)}
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <div className="le-imged">
        <div className="le-imged-view">
          {origin && (
            <p className="le-imged-hint le-imged-origin">
              This image is an edited copy. You are working on the original it came from, so Reset shows the
              whole picture.
            </p>
          )}
          {/* The frame does not clip, so the crop handles show whole at the picture's edge. */}
          <div className="le-imged-frame" style={{ '--le-imged-ar': ar } as CSSProperties}>
            <div
              ref={stageRef}
              className={`le-imged-stage${mode === 'focus' ? ' is-focus' : ''}`}
              onClick={onStageClick}
              onKeyDown={onFocusKey}
              {...(mode === 'focus'
                ? {
                    role: 'slider',
                    tabIndex: 0,
                    'aria-label': 'Focal point. Use the arrow keys to move it.',
                    'aria-valuemin': 0,
                    'aria-valuemax': 100,
                    'aria-valuenow': Math.round((dispFocus?.x ?? 0.5) * 100),
                    'aria-valuetext': dispFocus
                      ? `${Math.round(dispFocus.x * 100)}% from the left, ${Math.round(dispFocus.y * 100)}% from the top`
                      : 'Not set, the middle is used',
                  }
                : {})}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a Storage or site URL, sized by CSS */}
              <img
                className="le-imged-img"
                src={resolveSrc(work.src, siteOrigin)}
                alt=""
                draggable={false}
                style={imgStyle}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  if (el.naturalWidth && el.naturalHeight) setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                }}
                onError={() => setLoadFailed(true)}
              />
              {ready && (
                <div
                  className={`le-imged-crop${mode === 'focus' ? ' is-passive' : ''}`}
                  style={{
                    left: pct(dispCrop.x),
                    top: pct(dispCrop.y),
                    width: pct(dispCrop.width),
                    height: pct(dispCrop.height),
                  }}
                  role={mode === 'crop' ? 'group' : undefined}
                  tabIndex={mode === 'crop' ? 0 : -1}
                  aria-label={mode === 'crop' ? 'Crop box' : undefined}
                  aria-describedby={mode === 'crop' ? `${helpId} ${sizeId}` : undefined}
                  onPointerDown={(e) => onCropPointerDown(e, 'move')}
                  onPointerMove={onCropPointerMove}
                  onPointerUp={onCropPointerUp}
                  onPointerCancel={onCropPointerUp}
                  onKeyDown={mode === 'crop' ? onCropKey : undefined}
                >
                  <span className="le-imged-thirds" aria-hidden="true" />
                </div>
              )}
              {ready && (mode === 'focus' || dispFocus) && (
                <span
                  className={`le-imged-dot${dispFocus ? '' : ' unset'}`}
                  style={{ left: pct(dispFocus?.x ?? 0.5), top: pct(dispFocus?.y ?? 0.5) }}
                  aria-hidden="true"
                />
              )}
            </div>
            {ready && mode === 'crop' && (
              <div
                className="le-imged-handles"
                aria-hidden="true"
                style={{ left: pct(dispCrop.x), top: pct(dispCrop.y), width: pct(dispCrop.width), height: pct(dispCrop.height) }}
              >
                {CORNERS.map((c) => (
                  <span
                    key={c}
                    className={`le-imged-handle ${c}`}
                    onPointerDown={(e) => onCropPointerDown(e, c)}
                    onPointerMove={onCropPointerMove}
                    onPointerUp={onCropPointerUp}
                    onPointerCancel={onCropPointerUp}
                  />
                ))}
              </div>
            )}
          </div>
          {loadFailed ? (
            <p className="le-imged-error" role="alert">
              This image could not be loaded, so it cannot be edited here.
            </p>
          ) : (
            <p id={sizeId} className="le-imged-size" aria-live="polite">
              {ready ? `Keeps ${px.width} × ${px.height} px of ${disp.width} × ${disp.height} px` : 'Loading the image...'}
            </p>
          )}
        </div>

        <div className="le-imged-controls">
          <div className="le-imged-modes" role="group" aria-label="What to change">
            <button
              type="button"
              className="le-imged-chip"
              aria-pressed={mode === 'crop'}
              onClick={() => setMode('crop')}
            >
              Crop
            </button>
            <button
              type="button"
              className="le-imged-chip"
              aria-pressed={mode === 'focus'}
              onClick={() => setMode('focus')}
            >
              Focal point
            </button>
          </div>

          {mode === 'crop' ? (
            <>
              <section className="le-imged-group" aria-labelledby={`${uid}-crop`}>
                <h3 id={`${uid}-crop`}>Crop</h3>
                <p id={helpId} className="le-imged-hint">
                  Drag the box to choose the part to keep, and drag a corner to change its size. On the
                  keyboard, select the box, then use the arrow keys to move it and Shift with the arrow keys to
                  change its size.
                </p>
              </section>
              <section className="le-imged-group" aria-labelledby={`${uid}-shape`}>
                <h3 id={`${uid}-shape`}>Shape</h3>
                <p className="le-imged-hint">Pick a shape to keep the box in proportion. Free allows any shape.</p>
                <div className="le-imged-chips" role="group" aria-labelledby={`${uid}-shape`}>
                  {ASPECT_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="le-imged-chip"
                      aria-pressed={aspectId === p.id}
                      disabled={!ready}
                      onClick={() => chooseAspect(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <section className="le-imged-group" aria-labelledby={`${uid}-focus`}>
              <h3 id={`${uid}-focus`}>Focal point</h3>
              <p className="le-imged-hint">
                Click the most important part of the picture, or select the picture and use the arrow keys. When
                the page trims the image to fit a space, this part stays in view.
              </p>
              {focus && (
                <button type="button" className="le-imged-link" onClick={() => setFocus(null)}>
                  Clear the focal point
                </button>
              )}
            </section>
          )}

          <section className="le-imged-group" aria-labelledby={`${uid}-turn`}>
            <h3 id={`${uid}-turn`}>Turn and flip</h3>
            <p className="le-imged-hint">Turn the picture a quarter turn, or mirror it.</p>
            <div className="le-imged-chips">
              <button type="button" className="btn btn-default btn-sm" disabled={!ready} onClick={() => turn(-90)}>
                Rotate left
              </button>
              <button type="button" className="btn btn-default btn-sm" disabled={!ready} onClick={() => turn(90)}>
                Rotate right
              </button>
              <button
                type="button"
                className="le-imged-chip"
                aria-pressed={t.flipX}
                disabled={!ready}
                onClick={() => flip('flipX')}
              >
                Flip horizontal
              </button>
              <button
                type="button"
                className="le-imged-chip"
                aria-pressed={t.flipY}
                disabled={!ready}
                onClick={() => flip('flipY')}
              >
                Flip vertical
              </button>
            </div>
          </section>

          {error && (
            <div className="le-imged-failed" role="alert">
              <p className="le-imged-error">{error}</p>
              <button type="button" className="btn btn-default btn-sm" onClick={() => onDone(focalOnly())}>
                Keep only the focal point
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
