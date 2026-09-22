import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

/**
 * `/tickets/options` and its ten variants are an internal design review, not a
 * page for buyers.
 *
 * The index reads "Ten ticketing pages ... the only thing that differs is the
 * part being judged", which is a note to whoever is choosing between them. It
 * was reachable on the deployed site, one link away from the page that takes
 * money, and `robots: noindex` on the index only asked search engines not to
 * list it — it did not stop anybody opening it, and it never covered the ten
 * `v1`–`v10` routes underneath at all.
 *
 * So the gate is here rather than on the index: a layout wraps every route in
 * this segment, and `notFound()` makes the whole subtree a 404 in a production
 * build while leaving it fully usable under `next dev`, which is the only place
 * it was ever meant to be read.
 *
 * `NODE_ENV` rather than an environment variable, for the reason
 * `lib/demo-checkout.ts` gives at length: `next build` fixes it to
 * `production`, so this is a compile-time constant on Netlify and there is no
 * setting anybody can get wrong on a deploy.
 */
export default function OptionsLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return <>{children}</>;
}
