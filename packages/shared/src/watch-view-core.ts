/**
 * What a viewer is shown where a video would be.
 *
 * `stream-core.ts` answers "may this ticket watch" and "is the recording inside
 * its window". Neither of those is a screen. This file turns them into the one
 * decision a page actually makes — player, outside link, or a sentence saying
 * what is needed — because the website and the app both have to make it and a
 * screen that gets it wrong shows an empty grey box.
 *
 * ── Why a blocked viewer is a first-class outcome ───────────────────────────
 *
 * The failure this exists to prevent is the one `stream-core.ts` describes from
 * the other end: a reader that assumes it may watch renders a player, the
 * gated read comes back `permission-denied` or simply absent, and the page
 * shows a black rectangle with nothing to say about it. So there is no "no
 * value" branch here that a caller can fall through. Every input produces a
 * `WatchView`, and three of the four kinds carry a reason in words.
 *
 * ⚠️ **This is presentation, not a boundary.** `firestore.rules` gates the
 * documents, and the website reads them with the Admin SDK, which bypasses
 * rules entirely — so on the website this decision is the *only* thing standing
 * between a visitor and a URL that was sold. The caller must not fetch the
 * document, decide `blocked`, and then render `embedUrl` anyway. `blockedView`
 * exists so the shape it hands to the page cannot contain one.
 *
 * Plain TypeScript: no Firestore import, no React. Tested in
 * `watch-view-core.test.ts`.
 */

import type { RecordingWindow, StreamState } from "./stream-core.js";
import { mayWatch, recordingWindow } from "./stream-core.js";

/** Why somebody is not being shown the video. */
export type WatchBlock =
  /** Nobody has said which ticket this visitor holds. */
  | "no-ticket"
  /** They hold a ticket, and it is not one of the ones this was sold with. */
  | "wrong-ticket"
  /** The recording is not up yet. */
  | "not-yet"
  /** The recording's availability window has closed. */
  | "expired"
  /** The stream has not started. Nothing to play, whatever the ticket says. */
  | "not-started"
  /** The stream is over and no recording has been published. */
  | "ended";

export type WatchView =
  /** Put `embedUrl` in a frame. */
  | { kind: "play"; embedUrl: string; watchUrl: string }
  /** The provider refuses to be framed. One button that leaves the page. */
  | { kind: "open"; watchUrl: string }
  /** Say what is needed. No URL reaches the caller in this shape, ever. */
  | { kind: "blocked"; block: WatchBlock; allowedTicketTypes: string[] }
  /** Nothing has been set up. The caller renders no panel at all. */
  | { kind: "none" };

/** Who is watching, as far as anything can tell. */
export interface Viewer {
  /**
   * `RegistrationDoc.ticketType` — the name, not an id, because that is what
   * `allowedTicketTypes` holds and what the rules compare against.
   *
   * Null means no ticket has been established: signed out on the website, or a
   * phone that has never loaded its badge. It is not the same as a ticket type
   * that is not on the list, and the two get different sentences.
   */
  ticketType: string | null;
}

/** The fields of a stream this decision needs. Deliberately not the document. */
export interface StreamLike {
  embedUrl: string;
  watchUrl: string;
  embeddable: boolean;
  state: StreamState;
  allowedTicketTypes?: string[];
}

/** The fields of a recording this decision needs. */
export interface RecordingLike {
  embedUrl: string;
  watchUrl: string;
  embeddable: boolean;
  allowedTicketTypes?: string[];
  availableFromMs?: number | null;
  availableUntilMs?: number | null;
}

const blocked = (block: WatchBlock, allowedTicketTypes: string[] = []): WatchView => ({
  kind: "blocked",
  block,
  allowedTicketTypes,
});

const playable = (v: { embedUrl: string; watchUrl: string; embeddable: boolean }): WatchView =>
  v.embeddable ? { kind: "play", embedUrl: v.embedUrl, watchUrl: v.watchUrl } : { kind: "open", watchUrl: v.watchUrl };

/**
 * The live stream.
 *
 * ── Order of the checks, which is the whole of the design ───────────────────
 *
 * The ticket is checked **before** the state. A viewer with the wrong ticket
 * who is told "not started yet" comes back at 11:00 and is refused then, having
 * been given no reason to buy anything in the meantime. Telling them which
 * ticket includes it is both the true answer and the useful one, and it
 * discloses nothing: the ticket list is on the tickets page.
 *
 * `scheduled` and `ended` are separate blocks rather than one "unavailable",
 * because they are opposite instructions: come back, and do not.
 */
export function streamView(
  stream: StreamLike | null | undefined,
  viewer: Viewer,
): WatchView {
  if (!stream) return { kind: "none" };

  const allowed = stream.allowedTicketTypes ?? [];
  if (!viewer.ticketType) return blocked("no-ticket", allowed);
  if (!mayWatch(stream, viewer.ticketType)) return blocked("wrong-ticket", allowed);

  if (stream.state === "scheduled") return blocked("not-started", allowed);
  if (stream.state === "ended") return blocked("ended", allowed);

  return playable(stream);
}

/**
 * The recording.
 *
 * Same ordering argument, with the window last: an expiry is worth stating
 * exactly ("this was available until 3 June") and that sentence is only true
 * for somebody who could have watched it.
 */
export function recordingView(
  recording: RecordingLike | null | undefined,
  viewer: Viewer,
  nowMs: number,
): WatchView {
  if (!recording) return { kind: "none" };

  const allowed = recording.allowedTicketTypes ?? [];
  if (!viewer.ticketType) return blocked("no-ticket", allowed);
  if (!mayWatch(recording, viewer.ticketType)) return blocked("wrong-ticket", allowed);

  const window: RecordingWindow = recordingWindow(recording, nowMs);
  if (window === "not-yet") return blocked("not-yet", allowed);
  if (window === "expired") return blocked("expired", allowed);

  return playable(recording);
}

/**
 * "Main Conference", "Main Conference or Gold", "Main Conference, Gold or
 * Platinum".
 *
 * Its own function because the sentence is assembled in three places and a
 * comma-joined list reads as one long ticket name. Empty returns empty, and the
 * caller says "any ticket" in its own words — this file does not know whether
 * it is writing about a stream or a recording.
 */
export function ticketList(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0]!;
  return `${clean.slice(0, -1).join(", ")} or ${clean[clean.length - 1]!}`;
}
