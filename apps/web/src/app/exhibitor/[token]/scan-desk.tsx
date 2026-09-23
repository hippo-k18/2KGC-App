'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { agreeAction, scanAction } from './actions';
import type { ScanOutcome } from '@/lib/exhibitor-leads';

/**
 * The stand's scanner.
 *
 * Built from the check-in desk's scanner, and the two differences are the
 * interesting part.
 *
 * ── The typed box is not a fallback ─────────────────────────────────────────
 *
 * `BarcodeDetector` does not exist in Safari or Firefox, so on an iPhone — the
 * device most likely to be on a stand — the camera path is simply unavailable.
 * The six characters printed under the badge QR are the path that never fails,
 * so the box is always there, and the camera is the accelerator. Same reasoning
 * as the door.
 *
 * ── Nothing is stored until the attendee agrees ─────────────────────────────
 *
 * The door writes on the scan, because attendance is a fact about somebody
 * being there. This does not: the scan resolves who it is and what would be
 * shared, the screen turns to the attendee, and the record is written when they
 * tap. The wording they read is the wording stored on their record.
 *
 * ⚠️ The camera stops the moment a badge resolves. The person is now reading
 * the panel and deciding; a scanner still firing four times a second would pick
 * up the next badge in the queue and replace what is in front of them.
 */

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function barcodeDetector(): BarcodeDetectorCtor | null {
  const w = globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof w.BarcodeDetector === 'function' ? w.BarcodeDetector : null;
}

/** The camera fires ~4x a second at a badge that is still being held up. */
const SAME_CODE_COOLDOWN_MS = 4000;

function timeOf(ms: number | undefined): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ScanDesk({ token, exhibitorName }: { token: string; exhibitorName: string }) {
  const router = useRouter();

  const [code, setCode] = useState('');
  const [scan, setScan] = useState<(ScanOutcome & { code: string }) | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ ok: boolean; message: string } | null>(null);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on'>('off');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [detectorAvailable, setDetectorAvailable] = useState<boolean | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    setDetectorAvailable(barcodeDetector() !== null);
    inputRef.current?.focus();
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera('off');
  }, []);

  const lookUp = useCallback(
    async (raw: string, source: 'camera' | 'typed') => {
      const value = raw.trim();
      if (!value || busyRef.current) return;

      const last = lastRef.current;
      if (source === 'camera' && last && last.code === value) {
        if (Date.now() - last.at < SAME_CODE_COOLDOWN_MS) return;
      }
      lastRef.current = { code: value, at: Date.now() };

      busyRef.current = true;
      setPending(true);
      setDone(null);
      try {
        const result = await scanAction(token, value);
        setScan({ ...result, code: value });
        setNote('');
        // The attendee is now reading the panel. Stop looking at badges.
        if (result.outcome === 'found' || result.outcome === 'already') stopCamera();
      } finally {
        busyRef.current = false;
        setPending(false);
      }
    },
    [stopCamera, token],
  );

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCamera('on');
    } catch (err) {
      setCamera('off');
      setCameraError(
        err instanceof Error ? err.message : 'The browser refused access to the camera.',
      );
    }
  }, []);

  // Tear the stream down on unmount — a camera LED left on after somebody
  // navigates away is the kind of thing that gets a tool banned from a venue.
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  useEffect(() => {
    if (camera !== 'on') return;
    const Ctor = barcodeDetector();
    if (!Ctor) return;

    const detector = new Ctor({ formats: ['qr_code'] });
    let cancelled = false;

    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (cancelled || !video || video.readyState < 2 || busyRef.current) return;
      try {
        const codes = await detector.detect(video);
        const found = codes[0]?.rawValue;
        if (found) void lookUp(found, 'camera');
      } catch {
        // A single failed frame is normal — motion blur, a hand over the lens.
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [camera, lookUp]);

  const agree = useCallback(async () => {
    if (!scan) return;
    setPending(true);
    try {
      const result = await agreeAction(token, scan.code, note);
      setDone(result);
      setScan(null);
      setCode('');
      setNote('');
      router.refresh();
      inputRef.current?.focus();
    } finally {
      setPending(false);
    }
  }, [note, router, scan, token]);

  const dismiss = useCallback(() => {
    setScan(null);
    setCode('');
    setNote('');
    inputRef.current?.focus();
  }, []);

  return (
    <div className="lead-desk">
      <form
        className="lead-scan-form"
        onSubmit={(e) => {
          e.preventDefault();
          void lookUp(code, 'typed');
        }}
      >
        <label htmlFor="lead-code">Badge code, scanned or the six characters under the QR</label>
        <div className="lead-scan-row">
          <input
            id="lead-code"
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="JE5NTH"
          />
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Checking…' : 'Look up'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={camera === 'on' ? stopCamera : () => void startCamera()}
            disabled={detectorAvailable === false || camera === 'starting'}
          >
            {camera === 'on' ? 'Stop camera' : 'Use the camera'}
          </button>
        </div>
      </form>

      {detectorAvailable === false ? (
        <p className="lead-muted">
          This browser cannot read a QR code with the camera. Use Chrome, or type the six characters
          printed under it.
        </p>
      ) : null}
      {cameraError ? <p className="lead-error">Camera: {cameraError}</p> : null}

      <video ref={videoRef} className="lead-video" muted playsInline hidden={camera !== 'on'} />

      {done ? (
        <p className={done.ok ? 'lead-done' : 'lead-error'}>{done.message}</p>
      ) : null}

      {scan?.outcome === 'found' ? (
        /*
          The half of this screen that faces the attendee rather than the stand.
          Their name is the largest thing on it, then exactly what would be
          shared and with whom, then the two buttons. "No thanks" is a real
          button and not a small link, because a consent screen where declining
          is harder than agreeing is not one.
        */
        <section className="lead-consent" aria-live="polite">
          <p className="lead-consent-kicker">For {scan.attendee.name} to read</p>
          <p className="lead-consent-name">{scan.attendee.name}</p>
          {(scan.attendee.title || scan.attendee.company) && (
            <p className="lead-consent-org">
              {[scan.attendee.title, scan.attendee.company].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="lead-consent-wording">{scan.wording}</p>
          <label htmlFor="lead-note">A note for your own list, if you want one</label>
          <textarea
            id="lead-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Wants the healthcare demo"
          />
          <div className="lead-consent-actions">
            <button type="button" className="btn btn-primary" onClick={() => void agree()} disabled={pending}>
              {pending ? 'Saving…' : 'Share my details'}
            </button>
            <button type="button" className="btn btn-outline" onClick={dismiss} disabled={pending}>
              No thanks
            </button>
          </div>
          <p className="lead-muted">
            Nothing is stored unless you tap Share. {exhibitorName} sees only the people who have.
          </p>
        </section>
      ) : null}

      {scan?.outcome === 'already' ? (
        <section className="lead-consent is-already" aria-live="polite">
          <p className="lead-consent-name">{scan.attendee.name}</p>
          <p className="lead-consent-wording">
            Already on your list
            {scan.scannedAtMs ? `, scanned at ${timeOf(scan.scannedAtMs)}` : ''}.
            {scan.note ? ` Your note: ${scan.note}` : ''}
          </p>
          <div className="lead-consent-actions">
            <button type="button" className="btn btn-outline" onClick={dismiss}>
              Next person
            </button>
          </div>
        </section>
      ) : null}

      {scan && scan.outcome !== 'found' && scan.outcome !== 'already' ? (
        <section className="lead-consent is-problem" aria-live="polite">
          <p className="lead-consent-wording">
            {scan.outcome === 'unknown'
              ? 'No badge matches that code.'
              : scan.outcome === 'not-active'
                ? 'That ticket is not active. Send them to the registration desk.'
                : scan.outcome === 'unreadable'
                  ? 'That is not a badge. Try the six characters printed under the code.'
                  : scan.outcome === 'closed'
                    ? 'This link has stopped working. Ask the organizers for a new one.'
                    : 'Something went wrong. Nothing was saved.'}
          </p>
          <div className="lead-consent-actions">
            <button type="button" className="btn btn-outline" onClick={dismiss}>
              Try again
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
