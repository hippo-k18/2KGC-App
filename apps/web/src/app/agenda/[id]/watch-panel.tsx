import Link from 'next/link';
import {
  formatDuration,
  recordingView,
  streamView,
  ticketList,
  type WatchView,
} from '@kgc/shared';
import type { SessionWatchData } from '@/lib/watch';
import type { TicketPass } from '@/lib/ticket-pass';

/**
 * Where the video goes, and what stands there when it cannot.
 *
 * ── The one rule this component exists to keep ──────────────────────────────
 *
 * A reader who may not watch is shown a sentence, never a player. The failure
 * this replaces is the one `stream-core.ts` and `AGENTS.md` both name: a page
 * that renders a frame first and finds out afterwards, leaving an empty grey
 * rectangle that says nothing about why. So the decision is made before any
 * markup — `streamView` / `recordingView` in `@kgc/shared` — and the blocked
 * shape they return carries no URL for this file to render even by accident.
 *
 * ── Why a signed-out visitor is told about tickets and not about signing in ─
 *
 * This site has no accounts (see `ticket-pass.ts`). Telling somebody to sign in
 * would be telling them to do something that does not exist. What is true is
 * that watching is part of a ticket, so the panel says which ticket, links to
 * the page where it is sold, and adds one line for the person who already
 * bought one and has their confirmation email.
 *
 * A server component. Everything it is handed is already decided; nothing about
 * the gate runs in the browser.
 */

function Frame({ src, title }: { src: string; title: string }) {
  return (
    <div className="watch-frame">
      <iframe
        src={src}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        /*
         * `referrerPolicy` and a sandbox are deliberately not set beyond what
         * the providers need. YouTube and Vimeo both refuse to play inside a
         * sandbox without `allow-same-origin` and `allow-scripts`, which
         * together are no sandbox at all — so the protection here is that the
         * URL was built by `parseStreamSource`, is `https`, and came from a
         * provider an organizer chose from a fixed list.
         */
        loading="lazy"
      />
    </div>
  );
}

/**
 * The sentence for a reader who is not being shown the video.
 *
 * Every branch says what is true and what to do about it. None of them says
 * "unavailable", which is the word that makes a visitor reload the page.
 */
function Blocked({
  view,
  kind,
  pass,
  startsAtLocal,
  availableFrom,
  availableUntil,
}: {
  view: Extract<WatchView, { kind: 'blocked' }>;
  kind: 'stream' | 'recording';
  pass: TicketPass | null;
  startsAtLocal?: string;
  availableFrom?: string;
  availableUntil?: string;
}) {
  const thing = kind === 'stream' ? 'Watching this live' : 'The recording';
  const needed = ticketList(view.allowedTicketTypes);

  if (view.block === 'no-ticket' || view.block === 'wrong-ticket') {
    return (
      <div className="watch-blocked">
        <p className="watch-need">
          {needed
            ? `${thing} is included with the ${needed} ticket.`
            : `${thing} is included with every ticket.`}
        </p>
        {view.block === 'wrong-ticket' && pass ? (
          <p className="watch-sub">
            Your ticket on this device is {pass.ticketType}, which does not include it.
          </p>
        ) : null}
        <p className="watch-actions">
          <Link className="btn btn-primary" href="/tickets">
            See tickets
          </Link>
        </p>
        {view.block === 'no-ticket' ? (
          <p className="watch-sub">
            Already have a ticket? Open the link in your confirmation email and choose Watch on this
            device.
          </p>
        ) : null}
      </div>
    );
  }

  if (view.block === 'not-started') {
    return (
      <div className="watch-blocked">
        <p className="watch-need">
          The stream has not started yet
          {startsAtLocal ? `. It begins at ${startsAtLocal.slice(11, 16)}` : ''}.
        </p>
        <p className="watch-sub">Your ticket covers it. Come back at the start time.</p>
      </div>
    );
  }

  if (view.block === 'ended') {
    return (
      <div className="watch-blocked">
        <p className="watch-need">The live stream has finished.</p>
      </div>
    );
  }

  if (view.block === 'not-yet') {
    return (
      <div className="watch-blocked">
        <p className="watch-need">
          The recording is not up yet{availableFrom ? `. It goes up on ${availableFrom}` : ''}.
        </p>
        <p className="watch-sub">Your ticket covers it.</p>
      </div>
    );
  }

  return (
    <div className="watch-blocked">
      <p className="watch-need">
        The recording is no longer available
        {availableUntil ? `. It was up until ${availableUntil}` : ''}.
      </p>
    </div>
  );
}

/** `2027-06-03`, written the way the rest of the site writes a date. */
function dateLabel(ms: number | null | undefined): string | undefined {
  if (typeof ms !== 'number') return undefined;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(ms));
}

export function WatchPanel({
  watch,
  pass,
  sessionTitle,
  startsAtLocal,
  nowMs,
}: {
  watch: SessionWatchData;
  pass: TicketPass | null;
  sessionTitle: string;
  startsAtLocal: string;
  nowMs: number;
}) {
  const viewer = { ticketType: pass?.ticketType ?? null };
  const live = streamView(watch.stream, viewer);
  const recorded = recordingView(watch.recording, viewer, nowMs);

  // Nothing set up for this session. No panel at all, rather than a box
  // announcing the absence of a video for a talk that was never streamed.
  if (live.kind === 'none' && recorded.kind === 'none') return null;

  const availableFrom = dateLabel(watch.recording?.availableFromMs);
  const availableUntil = dateLabel(watch.recording?.availableUntilMs);
  const duration = watch.recording?.durationSeconds
    ? formatDuration(watch.recording.durationSeconds)
    : '';

  return (
    <div className="watch-panels">
      {live.kind !== 'none' && (
        <section className="watch-panel" aria-labelledby="watch-live">
          <h2 id="watch-live">
            Watch live
            {watch.stream?.state === 'live' ? <span className="watch-live-dot">Live now</span> : null}
          </h2>

          {live.kind === 'play' ? (
            <Frame src={live.embedUrl} title={`${sessionTitle}, live stream`} />
          ) : live.kind === 'open' ? (
            <div className="watch-blocked">
              {/*
                Zoom sends `X-Frame-Options` and cannot be embedded, which is a
                stored fact rather than a guess — see `SessionStreamDoc`. A
                frame here would be a grey box, so it is a button instead and
                the page says where it goes.
              */}
              <p className="watch-need">This session is on Zoom, so it opens outside this page.</p>
              <p className="watch-actions">
                <a className="btn btn-primary" href={live.watchUrl} target="_blank" rel="noreferrer">
                  Join the session
                </a>
              </p>
            </div>
          ) : (
            <Blocked view={live} kind="stream" pass={pass} startsAtLocal={startsAtLocal} />
          )}
        </section>
      )}

      {recorded.kind !== 'none' && (
        <section className="watch-panel" aria-labelledby="watch-recording">
          <h2 id="watch-recording">
            Recording
            {duration ? <span className="watch-meta">{duration}</span> : null}
          </h2>

          {recorded.kind === 'play' ? (
            <>
              <Frame src={recorded.embedUrl} title={`${sessionTitle}, recording`} />
              {availableUntil ? (
                /*
                 * Stated on the panel the recording is playing in, not only
                 * once it has gone. A video library sold with an expiry is one
                 * an attendee plans around.
                 */
                <p className="watch-sub">Available until {availableUntil}.</p>
              ) : null}
            </>
          ) : recorded.kind === 'open' ? (
            <div className="watch-blocked">
              <p className="watch-need">The recording opens outside this page.</p>
              <p className="watch-actions">
                <a className="btn btn-primary" href={recorded.watchUrl} target="_blank" rel="noreferrer">
                  Watch the recording
                </a>
              </p>
              {availableUntil ? <p className="watch-sub">Available until {availableUntil}.</p> : null}
            </div>
          ) : (
            <Blocked
              view={recorded}
              kind="recording"
              pass={pass}
              availableFrom={availableFrom}
              availableUntil={availableUntil}
            />
          )}
        </section>
      )}
    </div>
  );
}
