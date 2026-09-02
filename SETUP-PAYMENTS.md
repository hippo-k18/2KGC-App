# Turning the money path on

Everything in this document is a thing **you** have to do — an account to open, a
key to paste, a DNS record to add. The code is written and verified; none of it
can be finished from inside the repo.

Work through it in order. Steps 1–4 get you a working test-mode purchase on your
laptop, which is the point at which the money path stops being theoretical.
Steps 5–8 are needed before real money moves.

**Time:** about 90 minutes, most of it waiting for DNS.

---

## Before you start

```bash
cd ~/Documents/Claude/Projects/KGC/2KGC-App
cp apps/web/.env.example apps/web/.env.local
```

Everything below goes into `apps/web/.env.local`, except where it says
otherwise. That file is gitignored and must stay that way.

You will also need two terminal windows for step 4, plus the emulator running in
a third:

```bash
npm run dev:emulators          # terminal 1 — Firestore + Auth, no credentials needed
npm run seed                   # once, to populate ticket types
```

⚠️ **The website now refuses to sell anything if `ticketTypes` is empty.** That
is deliberate — a stale hard-coded price is worse than an outage — but it means
`npm run seed` is no longer optional for local work.

---

## 1 · Stripe account and test keys

**Sign up:** <https://dashboard.stripe.com/register>

You do not need to complete business verification to use test mode. Do it now
anyway if you can — activation can take a day or two and it blocks step 6.

**Get your test keys:** <https://dashboard.stripe.com/test/apikeys>

Copy the **secret key** (starts `sk_test_`). The publishable key is not used —
this integration uses hosted Checkout, so no Stripe code runs in the browser.

```bash
# apps/web/.env.local
STRIPE_SECRET_KEY=sk_test_...
```

Also generate the token that signs confirmation links:

```bash
openssl rand -base64 32
```

```bash
WEB_ORDER_SECRET=<paste the output>
```

★ **Keep the test/live distinction visible.** The dashboard reads the key prefix
and prints "Stripe test mode" or "Stripe live" on the orders screens, and the
refund dialog shouts louder when it is live. That only works if you never put an
`sk_live_` key in a file called test-anything.

---

## 2 · The Stripe CLI, for webhooks

The webhook is where fulfilment actually happens, and it has never received a
live event. This is the step that fixes that.

**Install:** <https://docs.stripe.com/stripe-cli>

```bash
brew install stripe/stripe-cli/stripe
stripe login
```

Then, in its own terminal, leave this running:

```bash
stripe listen --forward-to localhost:3200/api/stripe/webhook
```

It prints a signing secret (starts `whsec_`) **once, on startup**. Paste it in:

```bash
STRIPE_WEBHOOK_SECRET=whsec_...
```

⚠️ **That secret changes every time you restart `stripe listen`.** A webhook
that returns 400 with "signature verification failed" is almost always this and
not a bug.

---

## 3 · Resend, for receipts

**Sign up:** <https://resend.com/signup>

**Create an API key:** <https://resend.com/api-keys> (starts `re_`)

```bash
RESEND_API_KEY=re_...
EMAIL_FROM=KGC 2027 <tickets@knowledgegraph.tech>
EMAIL_REPLY_TO=hello@knowledgegraph.tech
```

**Verify your domain:** <https://resend.com/domains>

Add `knowledgegraph.tech`, and Resend gives you three DNS records to add at
whoever hosts your DNS:

| Type | Purpose | Notes |
|---|---|---|
| `MX` | receiving for the sending subdomain | Resend gives the exact host |
| `TXT` (SPF) | says Resend may send as you | |
| `TXT` (DKIM) | signs your mail | the long one |

Add all three, then press Verify. Propagation is usually minutes and
occasionally hours.

★ **Until the domain verifies, every send returns 403 and nothing is emailed.**
That is a survivable state, not a broken one: the code logs each attempt to the
`emailLog` collection and the dashboard's Transaction History shows them as
failed. Nothing else breaks, and no ticket is lost.

**You can skip this entirely for now.** Leave `RESEND_API_KEY` unset and every
send is recorded as `skipped` with the reason. Stripe still emails its own
payment receipt, so buyers are not left with nothing — they just don't get the
KGC-branded confirmation carrying their claim code.

---

## 4 · Run a real test-mode purchase

This is the step that matters. Three terminals:

```bash
# 1
npm run dev:emulators

# 2
stripe listen --forward-to localhost:3200/api/stripe/webhook

# 3
cd apps/web && npm run dev
```

Open <http://localhost:3200/tickets>, buy a Main Conference ticket, and pay with
Stripe's test card:

```
4242 4242 4242 4242    any future expiry    any CVC    any postcode
```

**What should happen:**

- ✅ terminal 2 prints `checkout.session.completed` → `[200]`
- ✅ you land on `/order/<token>` with a claim code
- ✅ a confirmation email arrives (if you did step 3)
- ✅ the order appears at <http://localhost:3100/tickets/orders-and-transactions/attendee-orders>

Then test the refund, from the dashboard rather than from Stripe:

```bash
cd apps/organizer && npm run dev      # port 3100
```

Sign in, find the order, click **Refund**, type the exact amount. Terminal 2
should print `charge.refunded` → `[200]`, the registration should flip to
cancelled, and a refund email should go out.

★ **Also test the invoice flow** at <http://localhost:3200/tickets/invoice> —
add two attendees, request the invoice, then pay it from the hosted Stripe page.
`invoice.paid` should register both seats.

Other cards worth trying — <https://docs.stripe.com/testing>:

| Card | Behaviour |
|---|---|
| `4000 0000 0000 9995` | declined, insufficient funds |
| `4000 0000 0000 3220` | 3D Secure challenge |
| `4000 0000 0000 0341` | attaches, then fails on charge |

---

## 5 · Tax — the part that is easy to get backwards

⚠️ **An event ticket is taxed where the event happens, not where the buyer
lives.** This is unlike almost everything else Stripe Tax handles, and getting it
wrong still produces a plausible number on the invoice.

KGC is at Cornell Tech, Roosevelt Island, so the jurisdiction is **New York** — a
buyer in Berlin owes New York's treatment, not German VAT.

The code already sends Stripe's ticketing tax code (`txcd_20030000`) on every
line and has `automatic_tax` enabled. Both are inert until you do this:

1. **Set the event location:** <https://dashboard.stripe.com/settings/tax>
   Without it Stripe taxes by billing address, which is the wrong answer.
   Stripe's guide: <https://docs.stripe.com/tax/tax-for-tickets/integration-guide>
2. **Decide whether to register in New York:**
   <https://dashboard.stripe.com/tax/registrations>
   Stripe monitors economic nexus and warns when sales cross a threshold, but
   registering is a filing decision, not a toggle.

→ This is the one item on this list I'd take to an accountant rather than
decide from documentation.

---

## 6 · Discount codes

Already wired — `allow_promotion_codes: true` is on the Checkout session, so
Stripe owns the codes and there is no coupon table in this repo to keep in step.

**Create them:** <https://dashboard.stripe.com/coupons> → create a coupon, then
add a promotion code to it (the coupon is the discount, the code is the string
people type).

Worth creating before launch: speaker comps, sponsor allocations, early-bird,
academic rate.

---

## 7 · Payouts

**Set the bank account:** <https://dashboard.stripe.com/settings/payouts>

Stripe pays out on a rolling basis as tickets sell, which is the main reason
`PAYMENTS.md` argues against Eventbrite — they hold ticket money until after the
event, which is after you have paid the venue.

---

## 8 · Going live

Do these together, in one sitting, and re-run step 4 afterwards against the live
keys with a real card you then refund.

1. **Live keys:** <https://dashboard.stripe.com/apikeys> — `sk_live_...`
2. **A real webhook endpoint**, not the CLI:
   <https://dashboard.stripe.com/webhooks> → Add endpoint →
   `https://www.knowledgegraph.tech/api/stripe/webhook`

   Subscribe to exactly these eight events. Anything else is acknowledged and
   ignored:

   ```
   checkout.session.completed
   checkout.session.async_payment_succeeded
   checkout.session.async_payment_failed
   checkout.session.expired
   charge.refunded
   charge.dispute.created
   invoice.paid
   invoice.payment_failed
   ```

   Copy that endpoint's signing secret into production as
   `STRIPE_WEBHOOK_SECRET`.

3. **Netlify environment variables**, for both sites:

   | Variable | Website | Dashboard |
   |---|---|---|
   | `STRIPE_SECRET_KEY` | ✅ | ✅ (refunds) |
   | `STRIPE_WEBHOOK_SECRET` | ✅ | — |
   | `WEB_ORDER_SECRET` | ✅ | ✅ (invoice emails) |
   | `RESEND_API_KEY` | ✅ | ✅ |
   | `EMAIL_FROM` | ✅ | ✅ |
   | `FIREBASE_SERVICE_ACCOUNT` | ✅ | ✅ |
   | `WEB_PUBLIC_ORIGIN` | ✅ | ✅ |
   | `CONSOLE_SESSION_SECRET` | — | ✅ |
   | `CONSOLE_ALLOWLIST` | — | ✅ |
   | `CONSOLE_PASSPHRASE` | — | ✅ |

   `WEB_ORDER_SECRET` must be **the same string** on both, or confirmation links
   minted by the dashboard will not verify on the website.

   Service account JSON: <https://console.firebase.google.com/project/kgc-conference-app-and-website/settings/serviceaccounts/adminsdk>
   Paste the whole file as one line; the code repairs Netlify's escaped newlines.

4. **Seed ticket types into production**, once:

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json npm run seed -- --confirm-live
   ```

   ★ `quantitySold` is carried forward on every re-seed, so this is safe to run
   again later. It will not zero your sales counters.

---

## The security thing I want to flag

❌ **`CONSOLE_PASSPHRASE` is a shared secret, and it now guards a refund
button.**

`apps/organizer/src/lib/auth.ts` sets out what a shared passphrase costs: no
MFA, and no audit identity beyond the email typed beside it. It does revoke —
the allowlist is re-checked on every request — but only once a redeploy picks up
the change. That is the accepted design, not a step on the way to one.

What I added on top:

- the refund dialog asks for the passphrase **again**, so an eight-hour session
  on an unattended registration-desk laptop is not one click from a refund;
- you must type the exact order total to confirm — a checkbox becomes muscle
  memory by the third refund, typing `1199.00` does not;
- every refund and every out-of-band invoice approval is written to `auditLog`
  with the actor's name, **before** Stripe is called;
- the code already refuses a passphrase under 7 characters whenever live
  Firebase credentials are present. ⚠️ That floor was 12 until 2026-08-31, when
  it was lowered at the owner's request so `kgc2027` would be accepted; it is
  no longer a meaningful stand-in for MFA in front of a refund button.

That is enough to make a refund a deliberate act rather than an accident. It is
not enough to make it attributable to a person. Before this dashboard is used by
more than you, SSO should land.

---

## What is still not built

Honest list, so nothing here reads as more finished than it is.

| | Status |
|---|---|
| Hosted Checkout, PCI SAQ A | ✅ built |
| Idempotent fulfilment, badge secrets preserved | ✅ built, 13 tests |
| Refunds, disputes, async payments, expired sessions | ✅ built |
| Partial refunds leave the ticket valid | ✅ built + tested |
| Ticket types editable in the dashboard | ✅ built |
| Orders, summary and transaction screens | ✅ built |
| Refund from the dashboard | ✅ built |
| Corporate invoicing, PO numbers, net terms | ✅ built, buyer form live |
| Mark an invoice paid out of band | ✅ built |
| Receipts, invoice and refund emails | ✅ built |
| Stripe Tax | ⚠️ in code, **needs step 5** |
| A live test-mode transaction | ❌ **needs you — step 4** |
| Group/team self-service checkout beyond 10 seats | ❌ email us instead |
| Exhibitor and sponsor ticket catalogues | ❌ modelled, no screens |
| Refunding an invoice (credit notes) | ❌ Stripe dashboard only |
| Ticket add-ons, question forms, invite-only tickets | ❌ gap notes in nav |

**Bottom line:** everything in this repo is verified by typecheck, build, 35 unit
tests, 143 rules tests, 13 new commerce tests, and a rendered check of every new
screen against seeded data. **Nothing has been verified against Stripe itself.**
Step 4 is the one that closes that, and it should happen before any real money
does.
