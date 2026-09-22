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
 *
 * ── Kiosk mode is subtraction, and that is the whole of it ──────────────────
 *
 * `kiosk` renders the same component with the operator's half removed: no
 * device explanation, no station box, no document paths, no email address, and
 * a verdict that clears itself after a few seconds. Nothing about the *write*
 * changes — it is the same idempotent `create()` through the same server
 * action, still made by an organizer's authenticated session.
 *
 * ⚠️ That last point is the one worth being precise about, because the screen
 * looks like self-service and is not. `firestore.rules` denies every client
 * write under `checkInLists`, `scanEvents` and `checkInStations`, deliberately,
 * so that attendance cannot be self-asserted. A kiosk here is a *station the
 * organizer operates and walks away from*, not an attendee-authenticated write:
 * the credential in front of it is the dashboard session, and leaving the tab
 * open is the organizer vouching for whatever it records. What kiosk mode
 * removes is the attendee list, the addresses and the identifiers — the things
 * that must never face a queue — and nothing else.
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

/**
 * How long a kiosk holds a verdict before returning to READY.
 *
 * Long enough to read at walking pace, short enough that the next person does
 * not walk up to somebody else's name still on the screen. It is the only
 * privacy control an unattended screen has, so it is deliberately short.
 */
const KIOSK_RESET_MS = 7000;

const VERDICT: Record<ScanResult['outcome'], string> = {
  ok: 'OK: CHECKED IN',
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

export function Scanner({
  listId,
  listName,
  kiosk,
  stationOverride,
}: {
  listId: string;
  listName: string;
  /** Unattended layout: no operator controls, no identifiers, self-clearing. */
  kiosk?: boolean;
  /**
   * The station name to scan under, when the page decides it rather than the
   * browser. A kiosk is named by whoever set it up and then left alone, so it
   * cannot be a box on the screen the queue is looking at.
   */
  stationOverride?: string;
}) {
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
    // A page-supplied name wins and is not written back to `localStorage`: a
    // kiosk opened for one afternoon must not rename the desk station this
    // browser uses the rest of the time.
    setStationLabel(stationOverride || window.localStorage.getItem(STATION_KEY) || 'Console desk 1');
    setDetectorAvailable(barcodeDetector() !== null);
    inputRef.current?.focus();
  }, [stationOverride]);

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

  /*
    A kiosk forgets. The verdict names a person, and an unattended screen that
    keeps the last one showing is a screen the next person in the queue reads —
    so it clears itself rather than waiting for another scan. The staffed desk
    does the opposite on purpose: the operator needs the last result to stay
    while they talk to whoever it was about.
  */
  useEffect(() => {
    if (!kiosk || !result) return;
    const t = window.setTimeout(() => setResult(null), KIOSK_RESET_MS);
    return () => window.clearTimeout(t);
  }, [kiosk, result]);

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
          <label htmlFor="code">Badge code, scanned or the six characters under the QR</label>
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
            This browser cannot read QR codes with the camera. Use Chrome or Edge, or type the code.
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

        {kiosk ? (
          /*
            A kiosk states what it is counting and nothing else. The device id
            and the station box are operator controls: one is an identifier and
            the other is an editable field, and neither belongs on a screen
            facing a queue.
          */
          <p className="muted">
            Checking in to <strong>{listName}</strong> at {stationLabel}.
          </p>
        ) : (
          <>
            <label htmlFor="station">This station&apos;s name</label>
            <input
              id="station"
              value={stationLabel}
              onChange={(e) => saveStation(e.target.value)}
              autoComplete="off"
            />
            <p className="muted">
              Scanning <strong>{listName}</strong>.
            </p>
          </>
        )}
      </div>

      <div className="scan-right">
        {result ? <ScanVerdict result={result} kiosk={kiosk} /> : <IdleVerdict kiosk={kiosk} />}
      </div>
    </div>
  );
}

function IdleVerdict({ kiosk }: { kiosk?: boolean }) {
  return (
    <div className="scan-result scan-idle">
      <div className="scan-verdict">READY</div>
      <p className="muted">
        {kiosk
          ? 'Hold your badge up to the camera, or type the six-character code under it.'
          : 'Scan a badge or type a code. The result appears here.'}
      </p>
    </div>
  );
}

function ScanVerdict({ result, kiosk }: { result: ScanResult; kiosk?: boolean }) {
  if (result.error) {
    return (
      <div className="scan-result scan-unknown">
        <div className="scan-verdict">ERROR</div>
        <div className="scan-name">{result.error}</div>
        <div className="scan-meta">Nothing was recorded. Try again.</div>
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
            {kiosk ? (
              'Nothing was recorded. Please see a member of staff at the registration desk.'
            ) : (
              <>
                Nothing was recorded. Check the code and try again.
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="scan-name">{result.name}</div>
          <div className="scan-sub">
            {result.ticketType ?? 'no ticket type'}
            {/*
              The address is for the operator, not for the room. On a kiosk it
              is the one field on this panel that turns a check-in screen into a
              harvestable directory, so it is not rendered at all rather than
              hidden with CSS.
            */}
            {kiosk ? null : <> · {result.email}</>}
          </div>
        </>
      )}

      {result.outcome === 'ok' ? (
        <div className="scan-meta">
          {kiosk ? (
            <>Checked in at {timeOf(result.checkedInAt)}. You are all set. Enjoy the conference.</>
          ) : (
            <>
              Checked in at {timeOf(result.checkedInAt)}.
            </>
          )}
        </div>
      ) : null}

      {result.outcome === 'duplicate' ? (
        <div className="scan-meta">
          {kiosk ? (
            <>
              Already checked in at <strong>{timeOf(result.checkedInAt)}</strong>. Nothing more to
              do. You are on the list. If that was not you, please tell a member of staff.
            </>
          ) : (
            <>
              Already checked in at <strong>{timeOf(result.checkedInAt)}</strong> at{' '}
              <strong>{result.stationLabel}</strong>. Nothing more to do.
            </>
          )}
        </div>
      ) : null}

      {result.outcome === 'cancelled' ? (
        <div className="scan-meta">
          {kiosk ? (
            <>
              This ticket is not active. Nothing was recorded. Please see the registration desk.
            </>
          ) : (
            <>
              This registration is <strong>{result.registrationStatus}</strong>, not active. Not
              checked in. Send them to the registration desk.
            </>
          )}
        </div>
      ) : null}

      {/*
        A required release this person has not signed.

        It sits under the verdict as something for the desk to raise, not as a
        refusal. On a kiosk it names no document and asks the person to come to
        the desk: an unattended screen telling somebody which release they have
        not signed is a screen telling the queue behind them too.

        ⚠️ "They are checked in" only where they are. A cancelled or transferred
        ticket is not checked in, and this line used to say it was — directly
        under a verdict saying the opposite, which is the one moment a desk
        volunteer is reading fast and deciding whether to let somebody past.
      */}
      {result.consentOutstanding?.length ? (
        <div className="scan-meta" style={{ color: 'var(--kgc-orange)', fontWeight: 600 }}>
          {kiosk ? (
            <>Form not signed. Please see the registration desk before you go in.</>
          ) : (
            <>
              Form not signed: <strong>{result.consentOutstanding.join(', ')}</strong>.{' '}
              {result.outcome === 'ok' || result.outcome === 'duplicate'
                ? 'They are checked in. Ask them to sign.'
                : 'Ask them to sign.'}
            </>
          )}
        </div>
      ) : null}

      {/*
        The provenance line is diagnostics for whoever is running the desk — a
        scan id is pasteable into the Firebase console, which is exactly why it
        does not belong on an unattended screen.
      */}
      {kiosk ? null : (
        <div className="scan-foot muted">
          {result.matchedOn === 'claimCode' ? 'typed code · ' : result.matchedOn ? 'badge · ' : null}
          {result.source}
          {result.scanEventReplayed ? ' · repeat scan' : null}
        </div>
      )}
    </div>
  );
}
