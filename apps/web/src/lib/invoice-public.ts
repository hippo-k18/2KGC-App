/**
 * Whether the website links to `/tickets/invoice`.
 *
 * Off since 2026-10-04, when the owner asked to hide paying by invoice "for
 * now" (T155). Every entry point reads this one constant: the row under the
 * ticket cards, the checkout rail row, the footer link and the two FAQ answers,
 * which ask people to email instead while it is off. Set it to `true` to bring
 * them all back.
 *
 * The page itself still answers at its URL, and `actions.ts` and the webhook's
 * invoice path are untouched, so invoices already raised still fulfil. The
 * page is noindex and disallowed in `robots.ts` either way, and was never in
 * the sitemap.
 *
 * A constant rather than an environment variable because the footer and the
 * checkout form are client components, where only `NEXT_PUBLIC_*` variables
 * exist, and those are baked in at build time anyway.
 */
export const INVOICE_PUBLIC = false;
