'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { submitScanAction, type ScanResult } from './actions';

/**
 * The scan desk.
 *
 * Two input paths, and the typed one is not a fallback in the apologetic sense
 * — it is always on screen and always focused. `BarcodeDetector` does not exist
 * in Safari or in Firefox, so on a MacBook running Safari the camera path is
 * simply not available; and even where it works, the attendee in front of you
 * may have a cracked screen, a flat battery, or a badge printed on paper. A
 * six-character `claimCode` typed by a human is the path that never fails, so
 * it is the one that gets the keyboard focus and the camera is the accelerator.
 *
 * The verdict is rendered at 40px. That is not decoration: it is read across a
 * desk, at arm's length, by someone who is also talking to the next person in
 * the queue, and the difference between "checked in" and "already checked in"
 * has to be legible without stepping closer.
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

const DEVICE_KEY = 'kgc.console.checkin.deviceId';
const STATION_KEY = 'kgc.console.checkin.stationLabel';

/** The camera fires ~4× a second at a badge that is still being held up. */
const SAME_CODE_COOLDOWN_MS = 4000;

const VERDICT: Record<ScanResult['outcome'], string> = {
  ok: 'OK — CHECKED IN',
  duplicate: 'ALREADY CHECKED IN',
  unknown: 'NOT FOUND',
  cancelled: 'CANCELLED',
};

function timeOf(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function Scanner({ listId, listName }: { listId: string; listName: string }) {
  const router = useRouter();

  const [deviceId, setDeviceId] = useState('');
  const [stationLabel, setStationLabel] = useState('');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [pending, setPending] = useState(false);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on'>('off');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [detectorAvailable, setDetectorAvailable] = useState<boolean | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const busyRef = useRef(false);

  /**
   * The device identity, minted once and kept in `localStorage`.
   *
   * It is half of `scanEvents/{deviceId}_{clientScanId}`, and it is also the
   * `checkInStations` document id — so a station that reloads the page is the
   * same station, and a duplicate scan can still name where the first one
   * happened. Regenerating it on every load would make the composite scan id
   * unique-by-accident and destroy the replay safety it exists for.
   */
  useEffect(() => {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `dev_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    setDeviceId(id);
    setStationLabel(window.localStorage.getItem(STATION_KEY) ?? 'Console desk 1');
    setDetectorAvailable(barcodeDetector() !== null);
    inputRef.current?.focus();
  }, []);

  const saveStation = useCallback((label: string) => {
    setStationLabel(label);
    window.localStorage.setItem(STATION_KEY, label);
  }, []);

  const submit = useCallback(
    async (raw: string, source: 'camera' | 'typed') => {
      const value = raw.trim();
      if (!value || !deviceId || busyRef.current) return;

      const last = lastRef.current;
      if (source === 'camera' && last && last.code === value) {
        if (Date.now() - last.at < SAME_CODE_COOLDOWN_MS) return;
      }
      lastRef.current = { code: value, at: Date.now() };

      busyRef.current = true;
      setPending(true);
      try {
        const scan = await submitScanAction({
          listId,
          code: value,
          deviceId,
          // One scan, one id. The server turns it into
          // `scanEvents/{deviceId}_{clientScanId}`, so re-sending this exact
          // object lands on the same document instead of double-counting.
          clientScanId: crypto.randomUUID(),
          stationLabel,
          source,
        });
        setResult(scan);
        setCode('');
        router.refresh();
      } finally {
        busyRef.current = false;
        setPending(false);
        inputRef.current?.focus();
      }
    },
    [deviceId, listId, router, stationLabel],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamera('off');
  }, []);

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

  // Tear the stream down on unmount — a camera LED left on after the operator
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
        if (found) void submit(found, 'camera');
      } catch {
        // A single failed frame is normal — motion blur, a hand over the lens.
        // Retrying 250ms later is the whole recovery strategy.
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [camera, submit]);

  return (
    <div className="scan-desk">
      <div className="scan-left">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(code, 'typed');
          }}
        >
          <label htmlFor="code">Badge code — QR secret or six-character claim code</label>
          <input
            id="code"
            name="code"
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="JE5NTH"
            disabled={!deviceId}
          />
          <button id="check-in-submit" type="submit" disabled={pending || !deviceId}>
            {pending ? 'Checking in…' : 'Check in'}
          </button>{' '}
          <button
            type="button"
            onClick={camera === 'on' ? stopCamera : () => void startCamera()}
            disabled={detectorAvailable === false || camera === 'starting'}
          >
            {camera === 'on' ? 'Stop camera' : 'Start camera'}
          </button>
        </form>

        {detectorAvailable === false ? (
          <p className="muted">
            This browser has no <code>BarcodeDetector</code>, so the camera cannot decode a QR
            here. Safari and Firefox both lack it; Chrome and Edge on desktop and Android have it.
            Type the code instead — it is the same write either way, and it is why the box above is
            focused on load.
          </p>
        ) : null}
        {cameraError ? <p className="error">Camera: {cameraError}</p> : null}

        <video
          ref={videoRef}
          className="scan-video"
          muted
          playsInline
          hidden={camera !== 'on'}
        />

        <label htmlFor="station">This station&apos;s name</label>
        <input
          id="station"
          value={stationLabel}
          onChange={(e) => saveStation(e.target.value)}
          autoComplete="off"
        />
        <p className="muted">
          Device <code>{deviceId || '…'}</code>, kept in this browser&apos;s{' '}
          <code>localStorage</code>. It is the <code>checkInStations</code> document id and the
          first half of every <code>scanEvents</code> id, so it must survive a reload. Scanning{' '}
          <strong>{listName}</strong>.
        </p>
      </div>

      <div className="scan-right">
        {result ? <ScanVerdict result={result} /> : <IdleVerdict />}
      </div>
    </div>
  );
}

function IdleVerdict() {
  return (
    <div className="scan-result scan-idle">
      <div className="scan-verdict">READY</div>
      <p className="muted">Scan a badge or type a code. The result appears here.</p>
    </div>
  );
}

function ScanVerdict({ result }: { result: ScanResult }) {
  if (result.error) {
    return (
      <div className="scan-result scan-unknown">
        <div className="scan-verdict">ERROR</div>
        <div className="scan-name">{result.error}</div>
        <div className="scan-meta">Nothing was written. Try again.</div>
      </div>
    );
  }

  return (
    <div className={`scan-result scan-${result.outcome}`}>
      <div className="scan-verdict">{VERDICT[result.outcome]}</div>

      {result.outcome === 'unknown' ? (
        <>
          <div className="scan-name">No registration matches that code</div>
          <div className="scan-meta">
            Checked against every <code>qrSecret</code> and every <code>claimCode</code> for this
            event. Nothing was written to <code>checkIns</code>. Logged as{' '}
            <code>{result.scanEventId}</code>.
          </div>
        </>
      ) : (
        <>
          <div className="scan-name">{result.name}</div>
          <div className="scan-sub">
            {result.ticketType ?? 'no ticket type'} · {result.email}
          </div>
        </>
      )}

      {result.outcome === 'ok' ? (
        <div className="scan-meta">
          Checked in at {timeOf(result.checkedInAt)}. Wrote{' '}
          <code>{result.checkInPath}</code>.
        </div>
      ) : null}

      {result.outcome === 'duplicate' ? (
        <div className="scan-meta">
          Already checked in at <strong>{timeOf(result.checkedInAt)}</strong> at{' '}
          <strong>{result.stationLabel}</strong>. Nothing was written this time — the second{' '}
          <code>create</code> failed with <code>already-exists</code>, which is the duplicate
          check. Wave them through.
        </div>
      ) : null}

      {result.outcome === 'cancelled' ? (
        <div className="scan-meta">
          This registration is <strong>{result.registrationStatus}</strong>, not active. Not
          checked in. Send them to the registration desk.
        </div>
      ) : null}

      <div className="scan-foot muted">
        {result.matchedOn ? `matched on ${result.matchedOn} · ` : null}
        {result.source} · <code>scanEvents/{result.scanEventId}</code>
        {result.scanEventReplayed ? ' · replay, original entry kept' : null}
      </div>
    </div>
  );
}
