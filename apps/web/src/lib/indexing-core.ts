/**
 * Whether search engines may index the main site, as one environment switch.
 *
 * `SITE_INDEXABLE=true` is the cutover flip: it is unset on staging, so every
 * main-site response carries `X-Robots-Tag: noindex, nofollow`, robots.txt
 * disallows everything and the sitemap is empty. Set it (together with
 * `WEB_PUBLIC_ORIGIN=https://www.knowledgegraph.tech`) on the day the site moves
 * to www, and those three signals open together. See
 * orchestrator/reports/T044-cutover-runbook.md.
 *
 * It never touches the blog host, which is live and indexable already, and it
 * never opens a host other than the one `WEB_PUBLIC_ORIGIN` names: a leftover
 * staging address or the droplet's IP stays closed with the flag on.
 *
 * No server-only imports, so the middleware can read it.
 */
export function siteIndexingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SITE_INDEXABLE === 'true';
}

/** True when this main-site host may be indexed: the configured origin, with the flag on. */
export function mainHostIndexable(host: string, origin: string | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!siteIndexingEnabled(env) || !origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The header value every non-indexable main-site response carries. */
export const NOINDEX_HEADER = 'noindex, nofollow';
