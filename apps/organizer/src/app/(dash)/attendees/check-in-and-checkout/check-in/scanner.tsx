'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TIME_ZONE } from '@kgc/shared';
import {
  enqueue,
  flushQueue,
  loadQueue,
  saveQueue,
  whenCheckedIn,
  withTimeout,
  type QueuedScan,
} from '@/lib/scan-queue-core';
import { submitScanAction, type ScanInput, type ScanResult } from './actions';

/**
 * The scan desk.
 *
 * Three input paths. The code field is always on screen and always focused, so
 * a USB or Bluetooth handheld scanner, which types the code and presses Enter,
 * works with nothing to set up. The camera reads QR codes with
 * `BarcodeDetector` where the browser has it (Chrome, Edge, Android) and with
 * jsQR where it does not (Safari, so every iPhone and iPad). Somebody with no
 * badge at all is found by name in the desk list below.
 *
 * ── A scan that does not reach the server ───────────────────────────────────
 *
 * It says so, in red, and clears whatever verdict was on screen before: a
 * stale green "checked in" is how an unrecorded person gets waved through
 * (T259 #1). The scan is kept on this device and sent again, with the same
 * `clientScanId`, until it lands. See `lib/scan-queue-core.ts`.
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

/** Whether this page can open a camera at all (needs HTTPS or localhost). */
function cameraPossible(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
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

/** A scan with no answer after this long is treated as not sent, and queued. */
const SCAN_TIMEOUT_MS = 10_000;

/** How often queued scans are tried again while the device thinks it is online. */
const RETRY_EVERY_MS = 15_000;

/**
 * The page's counts and lists are refreshed at most this often. Refreshing on
 * every scan downloaded the whole page each time (T259 #5).
 */
const REFRESH_EVERY_MS = 60_000;

const VERDICT: Record<ScanResult['outcome'], string> = {
  ok: 'OK: CHECKED IN',
  duplicate: 'ALREADY CHECKED IN',
  unknown: 'NOT FOUND',
  cancelled: 'CANCELLED',
};

type Shown =
  | { kind: 'result'; result: ScanResult }
  | { kind: 'checking' }
  | { kind: 'failed' };

/** Whether a result means "the scan did not land, keep it". */
const keep = (r: ScanResult) => Boolean(r.error && r.retryable);

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
  const [shown, setShown] = useState<Shown | null>(null);
  const [pending, setPending] = useState(false);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on'>('off');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(null);
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const [lastSent, setLastSent] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const busyRef = useRef(false);
  const flushingRef = useRef(false);
  const typedRef = useRef<string[]>([]);
  const refreshedRef = useRef(0);
  const queueRef = useRef<QueuedScan[]>([]);

  const writeQueue = useCallback((next: QueuedScan[]) => {
    queueRef.current = next;
    setQueue(next);
    saveQueue(storage(), next);
  }, []);

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
    const store = storage();
    let id = store?.getItem(DEVICE_KEY) ?? null;
    if (!id) {
      id = `dev_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      try {
        store?.setItem(DEVICE_KEY, id);
      } catch {
        // Private mode: this tab keeps the id for as long as it is open.
      }
    }
    setDeviceId(id);
    // A page-supplied name wins and is not written back to `localStorage`: a
    // kiosk opened for one afternoon must not rename the desk station this
    // browser uses the rest of the time.
    setStationLabel(stationOverride || store?.getItem(STATION_KEY) || 'Console desk 1');
    setCameraAvailable(cameraPossible());
    const saved = loadQueue(store);
    queueRef.current = saved;
    setQueue(saved);
    inputRef.current?.focus();
  }, [stationOverride]);

  const saveStation = useCallback((label: string) => {
    setStationLabel(label);
    try {
      window.localStorage.setItem(STATION_KEY, label);
    } catch {
      // Not remembered in private mode. The name still applies to this tab.
    }
  }, []);

  /** Refresh the page's counts now and then, never on every scan. */
  const maybeRefresh = useCallback(() => {
    if (kiosk) return;
    if (Date.now() - refreshedRef.current < REFRESH_EVERY_MS) return;
    refreshedRef.current = Date.now();
    router.refresh();
  }, [kiosk, router]);

  /** Send whatever is queued, oldest first. Safe to call at any time. */
  const flush = useCallback(async () => {
    if (flushingRef.current || queueRef.current.length === 0) return;
    flushingRef.current = true;
    try {
      const { sent } = await flushQueue(
        queueRef.current,
        (q) => withTimeout(submitScanAction(q), SCAN_TIMEOUT_MS),
        (r) => ({ retry: keep(r) }),
      );
      // Scans queued while this ran are kept too.
      const sentIds = new Set(sent.map((s) => s.scan.clientScanId));
      writeQueue(queueRef.current.filter((q) => !sentIds.has(q.clientScanId)));
      const last = sent[sent.length - 1];
      if (last) {
        const r = last.result;
        setLastSent(
          `Sent ${sent.length} saved ${sent.length === 1 ? 'scan' : 'scans'}. Last: ${
            r.error ? `error, ${r.error}` : `${kiosk ? '' : `${r.name ?? 'unknown code'}, `}${VERDICT[r.outcome].toLowerCase()}`
          }.`,
        );
        maybeRefresh();
      }
    } finally {
      flushingRef.current = false;
    }
  }, [kiosk, maybeRefresh, writeQueue]);

  useEffect(() => {
    const t = window.setInterval(() => {
      if (navigator.onLine !== false) void flush();
    }, RETRY_EVERY_MS);
    const online = () => void flush();
    window.addEventListener('online', online);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('online', online);
    };
  }, [flush]);

  const submit = useCallback(
    async (raw: string, source: 'camera' | 'typed') => {
      const value = raw.trim();
      if (!value || !deviceId) return;
      if (busyRef.current) {
        // A handheld scanner can send the next badge before the last answer
        // is back. Keep it rather than let it run into the next code.
        if (source === 'typed') {
          typedRef.current.push(value);
          setCode('');
        }
        return;
      }

      const last = lastRef.current;
      if (source === 'camera' && last && last.code === value) {
        if (Date.now() - last.at < SAME_CODE_COOLDOWN_MS) return;
      }
      lastRef.current = { code: value, at: Date.now() };

      // One scan, one id. The server turns it into
      // `scanEvents/{deviceId}_{clientScanId}`, so re-sending this exact
      // object lands on the same document instead of double-counting.
      const input: ScanInput = {
        listId,
        code: value,
        deviceId,
        clientScanId: crypto.randomUUID(),
        stationLabel,
        source,
      };

      busyRef.current = true;
      setPending(true);
      setCode('');
      // The last person's verdict goes the moment the next scan starts.
      setShown({ kind: 'checking' });
      try {
        const scan = await withTimeout(submitScanAction(input), SCAN_TIMEOUT_MS);
        if (keep(scan)) throw new Error(scan.error);
        setShown({ kind: 'result', result: scan });
        maybeRefresh();
        // The connection works again, so anything saved can go now.
        void flush();
      } catch {
        writeQueue(enqueue(queueRef.current, { ...input, queuedAt: Date.now() }));
        setShown({ kind: 'failed' });
      } finally {
        busyRef.current = false;
        setPending(false);
        inputRef.current?.focus();
        const next = typedRef.current.shift();
        if (next) window.setTimeout(() => void submitRef.current?.(next, 'typed'), 0);
      }
    },
    [deviceId, flush, listId, maybeRefresh, stationLabel, writeQueue],
  );
  const submitRef = useRef<typeof submit | null>(null);
  submitRef.current = submit;

  /*
    Keystrokes from a handheld scanner go to the code field even when nothing
    has focus, for instance after somebody tapped the page background. Typing
    into another field (the station name, the desk search) is left alone.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.isContentEditable)) return;
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

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
    if (!kiosk || !shown || shown.kind === 'checking') return;
    const t = window.setTimeout(() => setShown(null), KIOSK_RESET_MS);
    return () => window.clearTimeout(t);
  }, [kiosk, shown]);

  useEffect(() => {
    if (camera !== 'on') return;
    let cancelled = false;
    let read: ((video: HTMLVideoElement) => Promise<string | undefined>) | null = null;

    const Ctor = barcodeDetector();
    if (Ctor) {
      const detector = new Ctor({ formats: ['qr_code'] });
      read = async (video) => (await detector.detect(video))[0]?.rawValue;
    } else {
      // Safari has no BarcodeDetector. jsQR reads a frame drawn to a canvas,
      // scaled down because a badge fills most of the frame anyway and a
      // smaller image decodes several times faster on a phone.
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      void import('jsqr').then(({ default: jsQR }) => {
        if (cancelled || !ctx) return;
        read = async (video) => {
          const scale = Math.min(1, 640 / Math.max(video.videoWidth, 1));
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data;
        };
      });
    }

    const timer = window.setInterval(async () => {
      const video = videoRef.current;
      if (cancelled || !read || !video || video.readyState < 2 || busyRef.current) return;
      try {
        const found = await read(video);
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
          <label htmlFor="code">
            {kiosk ? 'Badge code' : 'Badge code, from the camera or a handheld scanner'}
          </label>
          <input
            id="code"
            name="code"
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            disabled={!deviceId}
          />
          <button id="check-in-submit" type="submit" disabled={pending || !deviceId}>
            {pending ? 'Checking in…' : 'Check in'}
          </button>{' '}
          <button
            type="button"
            onClick={camera === 'on' ? stopCamera : () => void startCamera()}
            disabled={cameraAvailable === false || camera === 'starting'}
          >
            {camera === 'on' ? 'Stop camera' : 'Start camera'}
          </button>
        </form>

        {cameraAvailable === false ? (
          <p className="muted">
            This page cannot open the camera. Use a handheld scanner, or find the person by name.
          </p>
        ) : null}
        {cameraError ? <p className="error">Camera: {cameraError}</p> : null}

        {queue.length > 0 ? (
          <div className="error" role="status" style={{ fontWeight: 600, margin: '12px 0' }}>
            <p style={{ margin: '0 0 8px' }}>
              {queue.length} {queue.length === 1 ? 'scan' : 'scans'} not sent yet. Saved on this
              device and sent again when the connection is back.
            </p>
            <button type="button" onClick={() => void flush()}>
              Send now
            </button>
          </div>
        ) : null}
        {lastSent && !kiosk ? (
          <p className="muted" role="status">
            {lastSent}
          </p>
        ) : null}

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

      <div className="scan-right" aria-live="polite">
        {shown?.kind === 'result' ? (
          <ScanVerdict result={shown.result} kiosk={kiosk} />
        ) : shown?.kind === 'failed' ? (
          <FailedVerdict kiosk={kiosk} queued={queue.length} />
        ) : shown?.kind === 'checking' ? (
          <div className="scan-result scan-idle">
            <div className="scan-verdict">CHECKING…</div>
          </div>
        ) : (
          <IdleVerdict kiosk={kiosk} />
        )}
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
          ? 'Hold the QR code on your badge up to the camera. No badge? Please see the registration desk.'
          : 'Scan a badge. The result appears here. No badge? Find the person by name below.'}
      </p>
    </div>
  );
}

/** The scan never reached the server. Red, because nobody was checked in. */
function FailedVerdict({ kiosk, queued }: { kiosk?: boolean; queued: number }) {
  return (
    <div className="scan-result scan-unknown" role="alert">
      <div className="scan-verdict">NOT RECORDED</div>
      <div className="scan-name">Check the connection</div>
      <div className="scan-meta">
        {kiosk ? (
          'This scan did not go through. Please see a member of staff at the registration desk.'
        ) : (
          <>
            This scan did not reach the server. It is saved on this device and will be sent again
            automatically ({queued} waiting). Until then, this person is not checked in.
          </>
        )}
      </div>
    </div>
  );
}

function ScanVerdict({ result, kiosk }: { result: ScanResult; kiosk?: boolean }) {
  const when = (iso: string | undefined) => whenCheckedIn(iso, new Date(), TIME_ZONE);

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
            <>Checked in at {when(result.checkedInAt)}. Enjoy the conference.</>
          ) : (
            <>
              Checked in at {when(result.checkedInAt)}.
            </>
          )}
        </div>
      ) : null}

      {result.outcome === 'duplicate' ? (
        <div className="scan-meta">
          {kiosk ? (
            <>
              Already checked in at <strong>{when(result.checkedInAt)}</strong>. Nothing more to
              do. You are on the list. If that was not you, please tell a member of staff.
            </>
          ) : (
            <>
              Already checked in at <strong>{when(result.checkedInAt)}</strong> at{' '}
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
      {result.onlyExtra ? (
        <div className="scan-meta" style={{ color: 'var(--kgc-orange)', fontWeight: 600 }}>
          {kiosk ? (
            <>{result.onlyExtra} only. Your badge is for the {result.onlyExtra.toLowerCase()}, not the main conference.</>
          ) : (
            <>
              {result.onlyExtra} only: not a Main Conference ticket. Send them to the {result.onlyExtra.toLowerCase()}.
            </>
          )}
        </div>
      ) : null}

      {result.noWorkshops ? (
        <div className="scan-meta" style={{ color: 'var(--kgc-orange)', fontWeight: 600 }}>
          {kiosk ? (
            <>This badge does not include Workshops. Please see the registration desk.</>
          ) : (
            <>No Workshops on this badge. Check their ticket before they go in.</>
          )}
        </div>
      ) : null}

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
