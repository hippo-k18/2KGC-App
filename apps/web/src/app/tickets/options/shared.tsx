import Link from 'next/link';
import type { ReactNode } from 'react';
import chrome from './options.module.css';
import { SITE } from '@/lib/site';
import { tiersOrNull } from '@/lib/catalogue';
import type { Tier, TicketId } from '@/lib/tickets';
import { demoCheckoutAllowed } from '@/lib/demo-checkout';
import { stripeEnabled } from '@/lib/stripe';
import { activeForm } from '@/lib/question-forms';
import { CheckoutForm } from '../checkout-form';

/**
 * The parts every ticketing option shares, so that ten designs differ where
 * they are meant to differ.
 *
 * ── What is being compared ──────────────────────────────────────────────────
 *
 * Only the *choosing*: how the tiers are laid out, how a buyer reads what is
 * included, and how All Access is made to look like the ticket worth having.
 * Everything after the decision — the checkout form, the four-step strip, the
 * FAQ — is identical in all ten, because a comparison in which two things vary
 * at once tells you nothing about either.
 *
 * It also means every option is a *working* page: each one reaches the same
 * `CheckoutForm` with the same `?tier=` contract the live page uses, so they
 * can be clicked through rather than only looked at.
 */
export interface OptionData {
  tiers: Tier[];
  /** The tier `?tier=` asked for, or the first one. */
  preselected: TicketId;
  questions: Awaited<ReturnType<typeof activeForm>>['fields'];
  stripeReady: boolean;
  demoReady: boolean;
  cancelled: boolean;
}

export async function loadOptionData(params: {
  tier?: string;
  cancelled?: string;
}): Promise<OptionData> {
  const [catalogue, form] = await Promise.all([tiersOrNull(), activeForm('attendee')]);
  const tiers = catalogue ?? [];
  const byId = new Map(tiers.map((t) => [t.id, t]));
  return {
    tiers,
    preselected: (byId.has(params.tier ?? '') ? params.tier! : tiers[0]?.id) as TicketId,
    questions: form.fields,
    stripeReady: stripeEnabled(),
    demoReady: await demoCheckoutAllowed(),
    cancelled: Boolean(params.cancelled),
  };
}

/**
 * The purchase itself, unchanged from the live page.
 *
 * Kept in one place rather than pasted into ten files: a bug fixed in the
 * checkout has to be fixed once, and an option that quietly diverged here would
 * be comparing a different product.
 */
export function BuyBand({ data }: { data: OptionData }) {
  return (
    <section className="band buy-band" id="buy">
      <div className="wrap">
        {data.tiers.length > 0 ? (
          <CheckoutForm
            tiers={data.tiers}
            initialTier={data.preselected}
            stripeReady={data.stripeReady}
            demoReady={data.demoReady}
            questions={data.questions}
          />
        ) : (
          <div className="checkout checkout-closed">
            <h2 style={{ fontSize: '1.4rem' }}>Registration is not open yet</h2>
            <p className="notice warn">
              Ticket sales for {SITE.name} have not opened. Everything else on this page is
              current.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** The four-step strip and the FAQ, identical across every option. */
export function AfterBands() {
  return (
    <>
      <section className="band band-wash flow-band">
        <div className="wrap">
          <h2 className="flow-title">From paying to standing in the room</h2>
          <ol className="flow-strip">
            <li>
              <strong>Register</strong>
              Pick a ticket, and give us the attendee’s name and email address.
            </li>
            <li>
              <strong>Keep the claim code</strong>
              Six characters, shown the moment you pay. It is the fallback door into your ticket.
            </li>
            <li>
              <strong>Open the KGC app</strong>
              Sign in with the same address. The schedule, messages and contacts are already
              there.
            </li>
            <li>
              <strong>Scan in at the door</strong>
              Your badge QR carries a random secret, not your name.
            </li>
          </ol>
        </div>
      </section>

      <section className="band-wash">
        <div className="kgc-faq">
          <h2>Questions people actually ask</h2>
          <details>
            <summary>Can I transfer my ticket to someone else?</summary>
            <div className="answer">
              <p>
                Yes, up to a week before the conference. Mail{' '}
                <a className={chrome.wrapAnywhere} href={`mailto:${SITE.contactEmail}`}>
                  {SITE.contactEmail}
                </a> with the new
                attendee’s details and we will move the registration rather than issue a second
                one.
              </p>
            </div>
          </details>
          <details>
            <summary>Is there a student rate?</summary>
            <div className="answer">
              <p>Yes. Write to us from your institutional address before you buy.</p>
            </div>
          </details>
          <details>
            <summary>Do virtual tickets include the recordings?</summary>
            <div className="answer">
              <p>
                Yes. Every session, on demand, for at least a month after the conference closes.
              </p>
            </div>
          </details>
        </div>
      </section>
    </>
  );
}

/**
 * The bar that says which option you are looking at and gets you to the next
 * one. Only ever rendered under `/tickets/options`, never on the live page.
 */
export function OptionChrome({
  n,
  name,
  note,
  children,
}: {
  n: number;
  name: string;
  note: string;
  children: ReactNode;
}) {
  const prev = n === 1 ? 10 : n - 1;
  const next = n === 10 ? 1 : n + 1;
  return (
    <>
      <div className={chrome.bar}>
        <span className={chrome.n}>Option {n} of 10</span>
        <strong className={chrome.name}>{name}</strong>
        <span className={chrome.note}>{note}</span>
        <span className={chrome.nav}>
          <Link href={`/tickets/options/v${prev}`}>← {prev}</Link>
          <Link href="/tickets/options">All</Link>
          <Link href={`/tickets/options/v${next}`}>{next} →</Link>
        </span>
      </div>
      {children}
    </>
  );
}
