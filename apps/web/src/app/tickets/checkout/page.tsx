import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';
import { tiersOrNull } from '@/lib/catalogue';
import { demoCheckoutAllowed } from '@/lib/demo-checkout';
import { activeForm } from '@/lib/question-forms';
import { stripeEnabled } from '@/lib/stripe';
import type { TicketId } from '@/lib/tickets';
import { CheckoutForm } from '../checkout-form';

export const metadata: Metadata = {
  title: 'Checkout',
  description: 'Register for the Knowledge Graph Conference 2027.',
};

/**
 * Buying — the page `Choose` lands on.
 *
 * ── Why this is its own route ──────────────────────────────────────────────
 *
 * The form lived at the bottom of `/tickets` behind a `#buy` anchor. Two things
 * were wrong with that and both are fixed by moving rather than by styling.
 * A visitor comparing prices was scrolled past a form asking for a colleague's
 * accessibility requirements, which is a lot of page in front of the one thing
 * most people came for. And `Choose` was a jump to an anchor on the page you
 * were already on: no address change, no title change, nothing for a screen
 * reader to announce, and on a tall viewport sometimes no visible movement at
 * all.
 *
 * ── The tier arrives in the URL, and is checked here ───────────────────────
 *
 * `?tier=` is a query string, so it is whatever somebody typed. It selects a
 * radio button and nothing else — every price is looked up server-side from the
 * tier **id** in `actions.ts`, which is the only thing that turns an id into
 * money. An unknown or missing value falls back to the first tier rather than
 * erroring: this page's job is to let somebody buy, and a 404 over a mistyped
 * query string would deny that over a value the form can correct.
 *
 * ⚠️ Stripe's `cancel_url` points here, with the tier preserved
 * (`actions.ts`). A cancelled payment that returned to `/tickets` would land on
 * a page with no form on it, having thrown away everything that was typed.
 *
 * `stripeEnabled()` reads an environment variable, so this page cannot be
 * statically prerendered — a build-time snapshot would bake in whichever mode
 * the build machine happened to be in.
 */
export const dynamic = 'force-dynamic';

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; cancelled?: string }>;
}) {
  const params = await searchParams;

  const [catalogue, form] = await Promise.all([tiersOrNull(), activeForm('attendee')]);
  const tiers = catalogue ?? [];
  const byId = new Map(tiers.map((t) => [t.id, t]));
  const initialTier = (byId.has(params.tier ?? '') ? params.tier! : tiers[0]?.id) as TicketId;

  return (
    <section className="band">
      <div className="wrap">
        <p style={{ margin: '0 0 1rem' }}>
          <Link href="/tickets">← All tickets</Link>
        </p>

        {params.cancelled && (
          <p className="notice warn">Checkout was cancelled. Nothing was charged.</p>
        )}

        {tiers.length > 0 ? (
          <CheckoutForm
            tiers={tiers}
            initialTier={initialTier}
            stripeReady={stripeEnabled()}
            demoReady={await demoCheckoutAllowed()}
            questions={form.fields}
          />
        ) : (
          <div className="checkout checkout-closed">
            <h2 style={{ fontSize: '1.4rem' }}>Registration is not open yet</h2>
            <p className="notice warn">
              Ticket sales for {SITE.name} have not opened. Everything else on this site is
              current.
            </p>
            <p>
              Write to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and we will
              tell you the moment they do.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
