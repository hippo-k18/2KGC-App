/**
 * Which URLs a Learn page `embed` block may frame, and the exact iframe `src`
 * for each (T315). The server validator and the website renderer both call
 * `learnEmbedSrc`, so a URL is framed only in the form checked here.
 *
 * ── Why an allowlist of exact forms ─────────────────────────────────────────
 *
 * An embed is an iframe on www, shown to people who are not signed in. A
 * "contains youtube.com" check lets through `youtube.com.evil.example`,
 * `evil.example/youtube.com/...` and `https://youtube.com@evil.example/`. So the
 * URL is parsed, must be https with no user, password or port, its host must be
 * one of the provider's own hosts exactly, and its path must match one of the
 * forms below. The iframe `src` is then rebuilt from the pieces that were
 * checked (an id, a hash), never copied from the input, and always points at
 * the provider's embed endpoint. Query parameters not listed are dropped.
 *
 * ── Accepted inputs and the src they give ───────────────────────────────────
 *
 * youtube (ID is 11 of [A-Za-z0-9_-])
 *   youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID,
 *   youtube.com/shorts/ID, youtube.com/live/ID, youtube-nocookie.com/embed/ID
 *   (www. and m. hosts too)
 *   -> https://www.youtube-nocookie.com/embed/ID
 *   A start time from `start=90`, `t=90` or `t=90s` becomes `?start=90`;
 *   other `t` forms (1m30s) are ignored, not refused.
 * vimeo (NUM is digits, HASH is hex, for unlisted videos)
 *   vimeo.com/NUM, vimeo.com/NUM/HASH, player.vimeo.com/video/NUM[?h=HASH]
 *   -> https://player.vimeo.com/video/NUM[?h=HASH]
 * google-maps
 *   www.google.com/maps/embed?pb=... only (Share > Embed a map). Ordinary
 *   maps links and maps.app.goo.gl short links refuse to be framed by Google,
 *   so they are refused here rather than shown as a broken box.
 *   -> https://www.google.com/maps/embed?pb=...
 * google-forms (ID is the form id)
 *   docs.google.com/forms/d/e/ID/viewform[?...], docs.google.com/forms/d/ID/viewform[?...]
 *   -> the same path with ?embedded=true. forms.gle short links are refused
 *   (a redirect, cannot be framed); /edit links are refused (editor only).
 * google-docs
 *   docs.google.com/document/d/e/ID/pub[?embedded=true] (File > Share >
 *   Publish to web) -> https://docs.google.com/document/d/e/ID/pub?embedded=true
 *   /edit and /preview links are refused: they show a sign-in wall to anyone
 *   the document is not shared with, which on a public page is most visitors.
 * google-slides
 *   docs.google.com/presentation/d/e/ID/embed or /pub
 *   -> https://docs.google.com/presentation/d/e/ID/embed
 * calendly (USER and EVENT are [A-Za-z0-9_-])
 *   calendly.com/USER, calendly.com/USER/EVENT -> the same URL
 * typeform (FORM is the account subdomain, ID the form id)
 *   FORM.typeform.com/to/ID -> https://FORM.typeform.com/to/ID
 * loom (ID is 32 hex characters; a title slug before it is allowed)
 *   loom.com/share/ID, loom.com/embed/ID (www. too) -> https://www.loom.com/embed/ID
 * spotify (TYPE is track, album, playlist, episode or show; ID is 22 characters)
 *   open.spotify.com/TYPE/ID, open.spotify.com/embed/TYPE/ID, and either
 *   with an /intl-xx/ prefix -> https://open.spotify.com/embed/TYPE/ID
 */

export const LEARN_EMBED_PROVIDERS = [
  "youtube",
  "vimeo",
  "google-maps",
  "google-forms",
  "google-docs",
  "google-slides",
  "calendly",
  "typeform",
  "loom",
  "spotify",
] as const;

export type LearnEmbedProvider = (typeof LEARN_EMBED_PROVIDERS)[number];

/** Longest URL accepted, the same as other links on the page. */
const MAX_URL = 2_000;

const HOSTS: Record<LearnEmbedProvider, readonly string[]> = {
  youtube: [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
  ],
  vimeo: ["vimeo.com", "www.vimeo.com", "player.vimeo.com"],
  "google-maps": ["www.google.com", "google.com"],
  "google-forms": ["docs.google.com"],
  "google-docs": ["docs.google.com"],
  "google-slides": ["docs.google.com"],
  calendly: ["calendly.com", "www.calendly.com"],
  typeform: [],
  loom: ["loom.com", "www.loom.com"],
  spotify: ["open.spotify.com"],
};

const TYPEFORM_HOST = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.typeform\.com$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const GOOGLE_ID = /^[A-Za-z0-9_-]{10,200}$/;

export function isLearnEmbedProvider(v: unknown): v is LearnEmbedProvider {
  return (LEARN_EMBED_PROVIDERS as readonly unknown[]).includes(v);
}

/** Parse `raw` as a plain https URL on a public host, or null. */
function parseHttps(raw: string): URL | null {
  const s = raw.trim();
  if (s === "" || s.length > MAX_URL) return null;
  // Whitespace, control characters and backslashes have no place in a pasted
  // embed link, and backslashes are how parsers get tricked into another host.
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f\\]/.test(s)) return null;
  if (!/^https:\/\/[^/]/i.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || u.port !== "") return null;
  return u;
}

function youtubeStart(u: URL): string {
  const raw = u.searchParams.get("start") ?? u.searchParams.get("t");
  const m = raw ? /^(\d{1,6})s?$/.exec(raw) : null;
  return m && Number(m[1]) > 0 ? `?start=${Number(m[1])}` : "";
}

function youtube(u: URL): string | null {
  const parts = u.pathname.split("/").slice(1);
  let id: string | null = null;
  if (u.hostname === "youtu.be") {
    if (parts.length === 1) id = parts[0];
  } else if (u.hostname.includes("youtube-nocookie")) {
    if (parts.length === 2 && parts[0] === "embed") id = parts[1];
  } else if (u.pathname === "/watch") {
    id = u.searchParams.get("v");
  } else if (parts.length === 2 && ["embed", "shorts", "live"].includes(parts[0])) {
    id = parts[1];
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return `https://www.youtube-nocookie.com/embed/${id}${youtubeStart(u)}`;
}

function vimeo(u: URL): string | null {
  let m: RegExpExecArray | null;
  let num: string;
  let hash: string | null;
  if (u.hostname === "player.vimeo.com") {
    m = /^\/video\/(\d{1,12})$/.exec(u.pathname);
    if (!m) return null;
    num = m[1];
    hash = u.searchParams.get("h");
  } else {
    m = /^\/(\d{1,12})(?:\/([0-9a-f]{6,20}))?$/.exec(u.pathname);
    if (!m) return null;
    num = m[1];
    hash = m[2] ?? u.searchParams.get("h");
  }
  if (hash !== null && !/^[0-9a-f]{6,20}$/.test(hash)) return null;
  return `https://player.vimeo.com/video/${num}${hash ? `?h=${hash}` : ""}`;
}

function googleMaps(u: URL): string | null {
  if (u.pathname !== "/maps/embed") return null;
  const pb = u.searchParams.get("pb");
  // The pb blob is `!`-separated fields: digits, letters, dots, colons, and
  // place names (any letters, spaces and a little punctuation).
  if (!pb || pb.length > 4_000 || !/^![\p{L}\p{N}!._:,+'() -]+$/u.test(pb)) return null;
  return `https://www.google.com/maps/embed?pb=${encodeURIComponent(pb)}`;
}

function googleForms(u: URL): string | null {
  const m = /^\/forms\/d\/(e\/)?([^/]+)\/viewform$/.exec(u.pathname);
  if (!m || !GOOGLE_ID.test(m[2])) return null;
  return `https://docs.google.com/forms/d/${m[1] ?? ""}${m[2]}/viewform?embedded=true`;
}

function googleDocs(u: URL): string | null {
  const m = /^\/document\/d\/e\/([^/]+)\/pub$/.exec(u.pathname);
  if (!m || !GOOGLE_ID.test(m[1])) return null;
  return `https://docs.google.com/document/d/e/${m[1]}/pub?embedded=true`;
}

function googleSlides(u: URL): string | null {
  const m = /^\/presentation\/d\/e\/([^/]+)\/(?:embed|pub)$/.exec(u.pathname);
  if (!m || !GOOGLE_ID.test(m[1])) return null;
  return `https://docs.google.com/presentation/d/e/${m[1]}/embed`;
}

function calendly(u: URL): string | null {
  const m = /^\/([A-Za-z0-9_-]{1,100})(?:\/([A-Za-z0-9_-]{1,100}))?\/?$/.exec(u.pathname);
  if (!m) return null;
  return `https://calendly.com/${m[1]}${m[2] ? `/${m[2]}` : ""}`;
}

function typeform(u: URL): string | null {
  const host = TYPEFORM_HOST.exec(u.hostname);
  const m = /^\/to\/([A-Za-z0-9]{4,32})$/.exec(u.pathname);
  if (!host || !m) return null;
  return `https://${host[1]}.typeform.com/to/${m[1]}`;
}

function loom(u: URL): string | null {
  const m = /^\/(?:share|embed)\/(?:[A-Za-z0-9-]{1,200}-)?([0-9a-f]{32})$/.exec(u.pathname);
  if (!m) return null;
  return `https://www.loom.com/embed/${m[1]}`;
}

function spotify(u: URL): string | null {
  const m = /^(?:\/intl-[a-z]{2}(?:-[A-Za-z]{2})?)?(?:\/embed)?\/(track|album|playlist|episode|show)\/([A-Za-z0-9]{22})$/.exec(
    u.pathname,
  );
  if (!m) return null;
  return `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
}

const BUILD: Record<LearnEmbedProvider, (u: URL) => string | null> = {
  youtube,
  vimeo,
  "google-maps": googleMaps,
  "google-forms": googleForms,
  "google-docs": googleDocs,
  "google-slides": googleSlides,
  calendly,
  typeform,
  loom,
  spotify,
};

/**
 * The iframe `src` for `url` as an embed from `provider`, or null when `url`
 * is not one of that provider's accepted forms (see the header).
 */
export function learnEmbedSrc(provider: string, url: string): string | null {
  if (!isLearnEmbedProvider(provider) || typeof url !== "string") return null;
  const u = parseHttps(url);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const hostOk = provider === "typeform" ? TYPEFORM_HOST.test(host) : HOSTS[provider].includes(host);
  if (!hostOk) return null;
  return BUILD[provider](u);
}
