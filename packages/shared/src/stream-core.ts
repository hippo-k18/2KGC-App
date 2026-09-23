/**
 * Streams and recordings: parsing, validation and the watch decision.
 *
 * Three surfaces need the same answers — the dashboard validates what an
 * organizer pastes, the app decides whether to open a player, and the website's
 * agenda decides whether to show a "watch" affordance — so the parsing lives
 * here rather than three times. `firestore.rules` restates the *access* half in
 * its own language, for the reason it restates the seat arithmetic: rules are
 * the only boundary a client cannot skip, and a helper it cannot call.
 *
 * ── Why a normalised form is stored rather than the pasted string ───────────
 *
 * An organizer pastes whatever the provider's Share button gave them, and for
 * one video that is at least five different strings: a watch page, a short
 * link, a live permalink, an embed URL with a tracking query, or the bare id.
 * If each reader parsed the raw string, every reader would have its own set of
 * shapes it happens to handle, and the failure is a blank player rather than an
 * error — nothing on any screen would say which of the five it choked on. So
 * the id is extracted once, on the way in, and both a watch URL and an embed
 * URL are stored beside it.
 *
 * ── Why `embeddable` is a stored fact and not a guess ───────────────────────
 *
 * Zoom refuses to be framed (`X-Frame-Options`), so a Zoom link is a button
 * that leaves the app, not a player inside it. A reader that assumes every
 * provider embeds renders an empty grey box and no error, which is the failure
 * mode this project already has too many of.
 *
 * Plain TypeScript: no Firestore import, no React. Tested in
 * `stream-core.test.ts`.
 */

export const STREAM_PROVIDERS = ["youtube", "vimeo", "zoom", "embed"] as const;
export type StreamProvider = (typeof STREAM_PROVIDERS)[number];

export const STREAM_STATES = ["scheduled", "live", "ended"] as const;
export type StreamState = (typeof STREAM_STATES)[number];

/** How a recording's availability window reads right now. */
export type RecordingWindow = "available" | "not-yet" | "expired";

export interface ParsedStream {
  provider: StreamProvider;
  /** The provider's own id, where the provider has one. */
  videoId?: string;
  /** Where a person watches it. Always safe to open in a browser. */
  watchUrl: string;
  /** What a player may load. Equal to `watchUrl` when nothing can be framed. */
  embedUrl: string;
  /** False when the provider refuses to be put in a frame. */
  embeddable: boolean;
}

export type ParseResult =
  | { ok: true; value: ParsedStream }
  | { ok: false; error: string };

export function isStreamProvider(value: string): value is StreamProvider {
  return (STREAM_PROVIDERS as readonly string[]).includes(value);
}

export function isStreamState(value: string): value is StreamState {
  return (STREAM_STATES as readonly string[]).includes(value);
}

/** The label an organizer reads. Kept here so three screens cannot disagree. */
export function providerLabel(provider: StreamProvider): string {
  switch (provider) {
    case "youtube":
      return "YouTube";
    case "vimeo":
      return "Vimeo";
    case "zoom":
      return "Zoom";
    default:
      return "Embed link";
  }
}

/**
 * `https` only, everywhere.
 *
 * Not pedantry twice over: an `http` frame inside an `https` page is blocked by
 * the browser with nothing on the page to say so, and a `javascript:` string
 * typed into a dashboard box is a script injection on a page a thousand people
 * open. `DocumentDoc.url` makes the same check for the same second reason.
 */
function httpsUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** YouTube ids are 11 characters of the URL-safe alphabet. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^[0-9]{6,12}$/;

function youtubeId(raw: string): string | null {
  const trimmed = raw.trim();
  if (YOUTUBE_ID.test(trimmed)) return trimmed;

  const u = httpsUrl(trimmed);
  if (!u) return null;

  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0] ?? "";
    return YOUTUBE_ID.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtube-nocookie.com") {
    return null;
  }

  const v = u.searchParams.get("v");
  if (v && YOUTUBE_ID.test(v)) return v;

  // `/live/ID`, `/embed/ID` and `/shorts/ID` all put the id in the last segment.
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length >= 2 && ["live", "embed", "shorts", "v"].includes(parts[0]!)) {
    const id = parts[1]!;
    return YOUTUBE_ID.test(id) ? id : null;
  }
  return null;
}

function vimeoId(raw: string): string | null {
  const trimmed = raw.trim();
  if (VIMEO_ID.test(trimmed)) return trimmed;

  const u = httpsUrl(trimmed);
  if (!u) return null;

  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;

  // `vimeo.com/123`, `vimeo.com/123/abcdef` (an unlisted hash),
  // `player.vimeo.com/video/123`, `vimeo.com/event/123`.
  const parts = u.pathname.split("/").filter(Boolean);
  const first = parts.find((p) => VIMEO_ID.test(p));
  return first ?? null;
}

/**
 * Whether a host is Zoom's.
 *
 * Suffix-matched on a dot so that `zoom.us.example.com` is not Zoom. An
 * organization's Zoom lives on a vanity subdomain (`kgc.zoom.us`), so the
 * subdomain cannot simply be forbidden.
 */
function isZoomHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "zoom.us" || h.endsWith(".zoom.us");
}

/**
 * Turn what an organizer pasted into something every reader can use.
 *
 * Returns the error as prose because it is shown on the form: an organizer who
 * pasted a channel page instead of a video needs to be told which of the two
 * they pasted, not that validation failed.
 */
export function parseStreamSource(provider: string, raw: string): ParseResult {
  const source = raw.trim();
  if (!source) return { ok: false, error: "Paste the link to the video or the meeting." };
  if (!isStreamProvider(provider)) {
    return { ok: false, error: "Pick where the video is hosted." };
  }

  if (provider === "youtube") {
    const id = youtubeId(source);
    if (!id) {
      return {
        ok: false,
        error:
          "That is not a YouTube video link. Paste the address of the video itself, the one with the eleven character code in it.",
      };
    }
    return {
      ok: true,
      value: {
        provider,
        videoId: id,
        watchUrl: `https://www.youtube.com/watch?v=${id}`,
        embedUrl: `https://www.youtube.com/embed/${id}`,
        embeddable: true,
      },
    };
  }

  if (provider === "vimeo") {
    const id = vimeoId(source);
    if (!id) {
      return {
        ok: false,
        error:
          "That is not a Vimeo video link. Paste the address of the video itself, the one ending in a number.",
      };
    }
    return {
      ok: true,
      value: {
        provider,
        videoId: id,
        watchUrl: `https://vimeo.com/${id}`,
        embedUrl: `https://player.vimeo.com/video/${id}`,
        embeddable: true,
      },
    };
  }

  if (provider === "zoom") {
    const u = httpsUrl(source);
    if (!u || !isZoomHost(u.hostname)) {
      return {
        ok: false,
        error: "That is not a Zoom link. Paste the join address, which starts with https:// and contains zoom.us.",
      };
    }
    /**
     * The passcode stays in the link.
     *
     * A Zoom join URL carries `?pwd=…`, and stripping it for tidiness leaves a
     * link that prompts every attendee for a passcode nobody gave them. The
     * document is gated instead, which is where the protection belongs.
     */
    const url = u.toString();
    return {
      ok: true,
      value: { provider, watchUrl: url, embedUrl: url, embeddable: false },
    };
  }

  const u = httpsUrl(source);
  if (!u) {
    return {
      ok: false,
      error: "Paste a full address starting with https://. Anything else is refused.",
    };
  }
  const url = u.toString();
  return { ok: true, value: { provider, watchUrl: url, embedUrl: url, embeddable: true } };
}

/**
 * Whether a viewer holding this ticket may watch.
 *
 * `allowedTicketTypes` holds ticket type **names**, the ones
 * `RegistrationDoc.ticketType` carries — the same convention
 * `SessionDoc.eligibleTicketTypes` and `DocumentDoc.visibleToTicketTypes` use,
 * and the same one `firestore.rules` compares against, because the rules
 * language can compare two strings and cannot resolve an id.
 *
 * Empty means every ticket type. Absent must be read as empty here and only
 * here: the writer always stores the array, so an absent field is a document
 * from before this feature, and those were never restricted.
 */
export function mayWatch(
  gated: { allowedTicketTypes?: string[] },
  ticketType: string | null | undefined,
): boolean {
  const allowed = gated.allowedTicketTypes ?? [];
  if (allowed.length === 0) return true;
  if (!ticketType) return false;
  return allowed.includes(ticketType);
}

/**
 * Where a recording sits in its availability window.
 *
 * Both ends are optional and independent: no `availableFrom` means it is up as
 * soon as it is saved, no `availableUntil` means it stays up. Compared in
 * milliseconds so the caller decides where "now" comes from, which is what
 * makes this testable without freezing a clock.
 */
export function recordingWindow(
  recording: { availableFromMs?: number | null; availableUntilMs?: number | null },
  nowMs: number,
): RecordingWindow {
  const from = recording.availableFromMs ?? null;
  const until = recording.availableUntilMs ?? null;
  if (from !== null && nowMs < from) return "not-yet";
  if (until !== null && nowMs >= until) return "expired";
  return "available";
}

/** `1:05:30`, or `4:07`. Hours only when there are hours. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * `1:05:30`, `65:30` or `90` typed into a duration box, as seconds.
 *
 * Organizers copy a duration off the player, and players write it three ways.
 * Returns null for anything else rather than guessing, because a duration that
 * silently reads as zero is a row that says a talk is empty.
 */
export function parseDuration(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d{1,3}(:[0-5]?\d){0,2}$/.test(trimmed)) return null;
  const parts = trimmed.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 1) return parts[0]! * 60; // bare minutes
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
}
