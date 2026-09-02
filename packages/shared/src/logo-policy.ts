/**
 * Which stored logo URLs a surface of ours is allowed to render.
 *
 * ── Why this is shared and not a website detail ─────────────────────────────
 *
 * The rule lived only in `apps/web/src/lib/data.ts`, where it read "a URL on
 * this host must never reach a browser from a page we serve". The app serves
 * pages to browsers too — `app/src/components/sponsor-logo.tsx` put `logoURL`
 * straight into an `<Image source>` — so for any sponsor whose document still
 * held a Whova URL the website showed a local copy and the app hotlinked the
 * CDN. One policy, honoured on one of the two surfaces it was written for, is
 * not a policy.
 *
 * Plain TS with no React and no Firestore import, so both installs can have it.
 */

/**
 * Whova's own asset CDN, which is where the seed fixtures took the real 2026
 * logos from.
 *
 * ⚠️ A URL on this host must never reach a browser from anything we serve. Two
 * separate reasons, and either alone would be enough: it is a request to the
 * product this one replaces, made by a visitor to our public site or a holder
 * of our app and visible in their network tab; and it is a hotlink to somebody
 * else's bandwidth for an asset we do not own, which they can break or swap at
 * any time.
 *
 * The seed no longer writes these URLs into `logoURL` at all, so on freshly
 * seeded data this catches nothing. It stays for the two ways one can still
 * arrive: a Whova CSV imported through the dashboard's sponsor importer, and
 * the live project, which was seeded by an older build and still holds eighteen
 * of them.
 */
export const FOREIGN_LOGO_CDN = /^https?:\/\/[^/]*\bd1keuthy5s86c8\.cloudfront\.net\//i;

/**
 * A stored logo URL, or nothing when we may not serve it.
 *
 * Dropping the URL is deliberately all this does. What replaces it is the
 * caller's business and differs by surface — the website falls through to its
 * own committed copy under `public/kgc/`, and the app falls through to the
 * initials plate `SponsorLogo` already renders for a sponsor with no logo. Both
 * are a visibly missing asset rather than a silent third-party request, which
 * is the point.
 */
export function servableLogoURL(stored?: string): string | undefined {
  if (!stored) return undefined;
  return FOREIGN_LOGO_CDN.test(stored) ? undefined : stored;
}
