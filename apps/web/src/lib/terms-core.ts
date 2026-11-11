/**
 * The conference terms at `/terms`: the switch and the old addresses. No
 * imports, because the middleware reads both on the Edge runtime. The content
 * file's format is `terms-parse.ts`; `terms.ts` reads the file.
 *
 * ── One switch ──────────────────────────────────────────────────────────────
 *
 * `TERMS_PUBLISHED=true` publishes the page and every link to it: the footer's
 * legal row, the /tickets FAQ, the checkout and invoice consent lines, the
 * sitemap, and the old WordPress terms addresses. Off (the default), `/terms`
 * is a 404, nothing links to it, and the old addresses keep going to /tickets.
 * The wording is legal text awaiting approval, so nothing may point a buyer at
 * it, or say they agreed to it, before then.
 *
 * Read from the environment like `SITE_INDEXABLE`: on the droplet that is
 * `/opt/kgc/shared/web.env`, which the deploy links in before `next build`, so
 * flipping it takes a deploy.
 */
export function termsPublished(env: Record<string, string | undefined> = process.env): boolean {
  return env.TERMS_PUBLISHED === 'true';
}

/**
 * The old site's terms pages, 2022 to 2025. Ted's redirect map sends them to
 * /tickets (`old-site-map.ts`), and that stays the answer while the switch is
 * off; `oldSiteTarget` asks this first when it is on.
 */
export const OLD_TERMS_PATHS: ReadonlySet<string> = new Set([
  '/conference-terms-and-conditions',
  '/kgc-2023-conference-policy-terms-and-conditions',
  '/kgc-2024-conference-policy-terms-and-conditions',
  '/kgc-2025-conference-policy-terms-and-conditions',
]);

/** The anchors checkout and the FAQ link to. The content file must keep them. */
export const TERMS_ANCHORS = { refunds: 'refunds', transfers: 'transfers', cancellations: 'cancellations' } as const;
