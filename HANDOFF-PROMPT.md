# Handoff prompt — wiring Stripe and Resend

**Still current as of 2026-08-31, and more urgent than it was.** Neither account
has been opened, so no live Stripe transaction has ever run and no email has ever
been delivered. Everything downstream of them is built, tested and deployed.
⚠️ **What changed on 2026-08-31: demo mode was removed, and with it the branch
that approved a payment without Stripe.** The deployed website now declines to
sell until `STRIPE_SECRET_KEY` is set, and `RESEND_API_KEY` now governs the OTP
sign-in code as well as receipts — so a buyer without it has no way into the app.
§1 is no longer a nice-to-have.

Two things are left that **cannot be done from inside the repo**, because they
need accounts that only you can open. Everything else is built and verified —
see `ROADMAP.md` for what "everything else" now covers.

The fastest route is: do §1 yourself (about 20 minutes, mostly clicking), then
paste §2 into Claude Code and let it do the wiring and testing.

---

## §1 · What only you can do

Four values. Nothing else is needed.

### Stripe — 10 minutes

1. Sign up at <https://dashboard.stripe.com/register>. You do **not** need to
   finish business verification to use test mode.
2. Copy your test secret key from <https://dashboard.stripe.com/test/apikeys>.
   It starts `sk_test_`. (Ignore the publishable key — this integration uses
   hosted Checkout, so no Stripe code runs in the browser.)
3. Install the CLI and log in:
   ```bash
   brew install stripe/stripe-cli/stripe
   stripe login
   ```

### Resend — 10 minutes, plus DNS propagation

4. Sign up at <https://resend.com/signup>.
5. Create an API key at <https://resend.com/api-keys>. It starts `re_`.
6. Add `knowledgegraph.tech` at <https://resend.com/domains> and put the three
   DNS records it gives you (one MX, two TXT) wherever your DNS is hosted.

⚠️ **Until the domain verifies, every send returns 403.** That is survivable —
each attempt is logged to `emailLog` with the failure, and no ticket is lost —
but no email arrives.

### Then hand over

Paste the four values into the chat when Claude Code asks:

```
sk_test_...          Stripe test secret key
re_...               Resend API key
whsec_...            printed by `stripe listen` on startup (step 2 below)
tickets@knowledgegraph.tech    or whatever sender you verified
```

---

## §2 · Paste this into Claude Code

> Wire up Stripe and Resend for the KGC ticketing system and prove the money
> path works end to end. The code is already written — this is configuration
> plus a real test transaction.
>
> **Read `SETUP-PAYMENTS.md` first**; it has the full context. `PAYMENTS.md`
> explains why Stripe rather than Eventbrite. Do not change payment logic
> without saying why.
>
> **What to do:**
>
> 1. Ask me for my Stripe test secret key (`sk_test_…`), my Resend API key
>    (`re_…`), and my verified sender address. Add them to
>    `apps/web/.env.local` as `STRIPE_SECRET_KEY`, `RESEND_API_KEY` and
>    `EMAIL_FROM`. Add the same Stripe and Resend keys to
>    `apps/organizer/.env.local` — the dashboard needs Stripe for refunds and
>    discount codes, and Resend for Message Speakers.
>
> 2. Start the emulator (`npm run dev:emulators`), seed it (`npm run seed`),
>    and start the website (`cd apps/web && npm run dev`, port 3200) and the
>    dashboard (`cd apps/organizer && npm run dev`, port 3100).
>
> 3. Run `stripe listen --forward-to localhost:3200/api/stripe/webhook` in its
>    own terminal. It prints a `whsec_…` secret **once, on startup** — put that
>    in `apps/web/.env.local` as `STRIPE_WEBHOOK_SECRET` and restart the web
>    server. A "signature verification failed" 400 is almost always this.
>
> 4. **Drive a real test-mode purchase in a browser**, not with curl. Use
>    `cmux browser` — I want browsing inside cmux, not a standalone Chrome.
>    Note that `cmux browser fill` does not dispatch the events React listens
>    for, so use `eval` with the native value setter plus an `input` event.
>    Buy a Main Conference ticket with card `4242 4242 4242 4242`, any future
>    expiry, any CVC.
>
> 5. **Verify each of these and tell me which failed**, quoting the actual
>    output rather than asserting success:
>    - `stripe listen` prints `checkout.session.completed` → `[200]`
>    - the browser lands on `/order/{token}` showing a claim code
>    - a confirmation email actually arrives (check the inbox, and check the
>      `emailLog` collection says `sent` rather than `failed`)
>    - the order appears at
>      `localhost:3100/tickets/orders-and-transactions/attendee-orders`
>    - `ticketTypes/main-conference.quantitySold` incremented by exactly 1
>    - the buyer appears on `attendees/manage-attendees/attendees` with the
>      right ticket and "App: not yet"
>
> 6. **Then refund it from the dashboard**, not from Stripe. Click Refund, type
>    the exact amount, use the passphrase in `apps/organizer/.env.local`.
>    Verify: `stripe listen` prints `charge.refunded` → `[200]`, the
>    registration flips to `cancelled`, a refund email sends, and the order
>    shows `refunded`.
>
> 7. **Then test the invoice flow** at `localhost:3200/tickets/invoice` with two
>    attendees. Pay it from Stripe's hosted invoice page. Verify `invoice.paid`
>    registers **both** seats, each gets its own claim code email, and the
>    dashboard shows **one** order with two line items — not two orders.
>
> 8. **Record the Stripe event payloads as fixtures** under `tests/` and add
>    tests that replay them against the webhook, so the branches stay covered
>    without needing Stripe again. Follow the style of
>    `tests/commerce/fulfilment.test.ts` — each test named after the guarantee
>    it protects.
>
> **Constraints:**
>
> - `AGENTS.md` is the project brief. Read it. Match the surrounding code
>   style: comments explain reasoning, not mechanics.
> - Never add Claude attribution to commits or PRs. No `Co-Authored-By`, no
>   "Generated with" footer.
> - Money is always integer minor units. Never a float.
> - The webhook must return 2xx for events it does not handle — a 4xx makes
>   Stripe retry forever and eventually disable the endpoint.
> - Emails and the sold counter must never throw upward from the webhook.
> - **`server-only` and Vitest do not mix.** Logic worth testing goes in a
>   plain module beside the fetch, not inside it.
> - ⚠️ **Never build a Firestore sentinel (`FieldValue.serverTimestamp()`,
>   `Timestamp.now()`) inside `@kgc/scripts`.** `apps/web`, `apps/organizer`
>   and `scripts` each resolve their own copy of `firebase-admin`, and
>   Firestore checks sentinels with `instanceof` — a sentinel made in one and
>   used with another's store fails the whole write with
>   `Couldn't serialize object of type "l"`. Use a native `Date`. This took the
>   entire purchase flow down once already and the tests did not catch it.
> - When you are done, run all of it and report failures honestly:
>   ```bash
>   npm test && npm run test:rules && npm run test:commerce && npm run typecheck
>   cd apps/web && npm run typecheck && npm run build
>   cd apps/organizer && npx tsc --noEmit && npm run build
>   ```
>   `test:rules` and `test:commerce` need Java on PATH, which a non-interactive
>   shell does not inherit:
>   `export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"`
>
> **Do not go live.** Test keys only. Going live needs the tax setup in
> `SETUP-PAYMENTS.md` §5 and a real webhook endpoint, and that is a separate
> decision.

---

## §3 · What is already done, so nobody redoes it

- ✅ `apps/organizer/.env.local` exists with generated secrets and is gitignored
- ✅ The Attendees screen shows ticket holders, not just app sign-ups
- ✅ Demo purchases increment `quantitySold` and send a `[TEST]`-prefixed receipt
- ✅ The two-copies-of-`firebase-admin` bug is fixed
- ✅ 205 tests pass; both sites build; both Expo platforms export
