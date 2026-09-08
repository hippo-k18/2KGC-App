import 'server-only';

/**
 * CORS for the two sign-in endpoints, and nothing else on this site.
 *
 * ── Why these two routes need it when nothing else here does ───────────────
 *
 * Every other route on this site is called by its own pages, same origin. These
 * two are called by the **attendee app**, which is a different origin in all
 * three of the places it runs: `kgc-2027-app.netlify.app` on the web,
 * `http://localhost:8081` under Expo's web target, and — on a phone — no origin
 * at all, because React Native's fetch is not a browser and sends no `Origin`
 * header. A missing `Origin` is therefore the *normal* case for the app this
 * exists to serve, and must not be treated as an attack.
 *
 * ── What CORS is actually protecting here, which is less than it looks ─────
 *
 * These endpoints take no cookie and no credential. A cross-origin caller
 * learns nothing it could not learn by calling from a server, so the allowlist
 * is not the security boundary — the rate limits and the code itself are. What
 * it does buy is that a random page cannot quietly use an attendee's browser to
 * burn their per-address code allowance, which turns "I never got a code" into
 * a support conversation.
 *
 * So: an allowlisted `Origin` is echoed, anything else gets no CORS header and
 * the browser refuses the response, and a request with no `Origin` is answered
 * normally because that is the phone.
 *
 * ⚠️ `Access-Control-Allow-Origin: *` would be wrong even here — it is the
 * value that stops working the moment either endpoint ever needs a credential,
 * and the failure at that point is silent in production and invisible locally.
 */
const ALLOWED_ORIGINS = [
  'https://kgc-2027-app.netlify.app',
  // Expo's web target, and the Metro dev server it is served from.
  'http://localhost:8081',
  'http://localhost:19006',
];

export function corsHeaders(origin: string | null): Record<string, string> {
  const base = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    // The response varies by Origin, so a cache that ignored this would serve
    // one app's CORS header to another origin.
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return { ...base, 'Access-Control-Allow-Origin': origin };
  }
  return base;
}
