# Payments for KGC

**Recommendation: stay on Stripe.** Not because it is the obvious default, but
because the two things that decide this for a B2B conference — fees on
high-value tickets, and the ability to invoice a company — both point the same
way, and Stripe is already integrated.

---

## Why not a ticketing platform

The comparison people expect is Stripe vs Eventbrite. On a conference like this
it is not close.

| | Per $800 ticket | 1,000 tickets |
|---|---|---|
| **Stripe** (2.9% + $0.30) | ~$23.50 | **~$23,500** |
| **Eventbrite** (3.7% + $1.79, plus 2.9% order fee) | ~$54 | **~$54,000** |

Roughly **$30,000 of difference** on one event, and the gap widens with ticket
price because the platform fee is a percentage. On a $50 gig ticket Eventbrite
is defensible; on an $800 conference registration it is a tax on being
expensive.

Two things matter more than the headline rate:

- **Cash flow.** Eventbrite holds ticket money and pays out *after the event*.
  Sell out in January and the cash arrives in March — after you have paid the
  venue, the AV company and the caterer. Stripe pays out on a rolling basis as
  tickets sell, which is the difference between funding the event from ticket
  revenue and funding it from your own balance sheet.
- **Shape.** Eventbrite is a consumer marketplace. A B2B conference with
  multi-track programming, group registrations, sponsor allocations and
  corporate invoicing spends its time bending a tool built for gig-goers.

The counter-argument for a marketplace is *discovery* — Eventbrite shows your
event to people who were not looking for it. For KGC that is worth close to
nothing: attendees arrive through the mailing list, speakers' networks and
sponsors, not through browsing.

Sources: [eventcloud fee table](https://www.eventcloud.io/blog/ticketing-platform-fees-compared-2026),
[Eventbrite fees 2026](https://www.eventcloud.io/blog/eventbrite-fees-explained-2026),
[Zeffy comparison](https://www.zeffy.com/compare/eventbrite-vs-stripe).

---

## The thing almost everyone gets wrong: tax

**An event ticket is taxed where the event happens, not where the buyer lives.**
This is unlike nearly everything else Stripe Tax handles, and it is easy to
implement backwards without noticing, because the wrong answer still produces a
number on the invoice.

KGC is at Cornell Tech, Roosevelt Island — so the jurisdiction is **New York**,
and a buyer in Berlin owes New York's treatment rather than German VAT.

What is now in the code:

- Every ticket line carries Stripe's ticketing tax code **`txcd_20030000`**
  ("General – Services"), which is what their own ticketing guide specifies.
- `automatic_tax: { enabled: true }` on both Checkout and invoices. This is
  inert until tax is registered and enabled in the Stripe dashboard, so it is
  safe to ship before that and removes a code change from the day it happens.
- `billing_address_collection: 'required'`, which `automatic_tax` needs and
  which a company needs on an invoice anyway.

What is **not** done and needs a human:

- **Set the event location in the Stripe dashboard.** Without it, Stripe taxes
  by billing address, which is the wrong answer described above.
- **Decide whether to register in New York.** Stripe Tax monitors economic
  nexus and warns when sales cross a threshold, but registering is a filing
  decision, not a toggle.
- **VAT for EU attendees.** Stripe can collect and validate VAT IDs and apply
  reverse charge for B2B. Whether an in-person US event needs this at all
  depends on advice we do not have.

Sources: [Stripe: tax ticket sales by event location](https://docs.stripe.com/tax/tax-for-tickets/integration-guide),
[Stripe: ticketing and events taxability](https://stripe.com/guides/introduction-to-ticketing-and-events-taxability),
[Stripe: nexus](https://stripe.com/resources/more/nexus-tax-101).

---

## Corporate invoicing — the largest gap, now built

A researcher expensing $800 pays by card. A bank sending four people does not:
procurement issues a purchase order, finance pays an invoice on net-30, and
frequently no corporate card in the building will authorise a conference
registration.

**An event that cannot invoice loses exactly the delegates it most wants, and
loses them silently** — nobody emails to say "your checkout had no invoice
option".

`apps/web/src/lib/invoicing.ts` now does this through Stripe Invoicing: same
account, same payouts, same webhook stream, no second processor. It raises one
line item per seat, prints a **purchase order number** on the PDF (the single
most common reason finance rejects an invoice), defaults to **net-30**, and
sends a hosted invoice page finance can pay by card or bank transfer.

⚠️ **An invoice is a promise to pay, and a promise is not a ticket.** Fulfilment
happens on `invoice.paid`, never when the invoice is raised. Issuing badges
against unpaid invoices is how conferences end up chasing money from people who
have already attended and gone home. If KGC decides a PO is sufficient, that is
a policy decision and belongs in an organizer action that marks an invoice paid
out-of-band — not in the code quietly treating unpaid as paid.

**Built since:** the buyer-facing form is live at `/tickets/invoice`, linked
from the tickets page beside the card checkout. It prices every seat on the
server from a tier id, rejects duplicate addresses (two seats on one email is
one badge), records the invoice as a `pending` order so the dashboard can chase
it, and redirects to Stripe's hosted invoice page rather than printing a total
of its own that could disagree with it.

The out-of-band escape hatch this section argues for also exists now: **Mark
paid** on the orders screen registers every attendee and records `markedPaidBy`
on the order, leaving the Stripe invoice open because the money genuinely has
not arrived.

---

## Two real bugs this work found

Both were in the webhook, which handled `checkout.session.completed` and
returned `ignored` for everything else.

1. **A refunded ticket still opened the door.** Nothing listened for
   `charge.refunded`, so the registration stayed `active` — and `active` is
   precisely what the check-in desk scans for. Someone could buy, refund, keep
   the confirmation email and walk in. Now `charge.refunded` and
   `charge.dispute.created` cancel the registration.
2. **Delayed payment methods took money and produced no ticket.** A comment
   said the registration would be written "when
   `checkout.session.async_payment_succeeded` follows" — but that event was
   ignored along with everything else, so it never was. Now handled.

The refund path is careful about one case: somebody who bought twice (a
workshop upgrade on top of a main-conference ticket) has one registration
backed by two orders, so refunding the first must not revoke a ticket the
second still pays for. The registration is cancelled only when no other **paid**
order shares its email.

---

## What is done, and what is left

| | Status |
|---|---|
| Hosted Checkout, PCI SAQ A | ✅ built |
| Idempotent fulfilment, badge secrets preserved across repeat purchase | ✅ built, 13 tests |
| Refunds, disputes, async payments, expired sessions | ✅ built |
| Partial refunds leave the ticket valid | ✅ built + tested |
| Stripe Tax with the ticketing tax code | ✅ in code, **needs dashboard setup** |
| Discount codes (`allow_promotion_codes`) | ✅ built — codes live in Stripe |
| Corporate invoicing, PO numbers, net terms | ✅ built, buyer form at `/tickets/invoice` |
| Ticket types editable by an organizer | ✅ built — `ticketTypes` is now the source of truth |
| Organizer-facing orders screens | ✅ built — Summary, Attendee Orders, Transaction History |
| Refund initiated from the dashboard | ✅ built, audited, passphrase-confirmed |
| Mark an invoice paid out of band | ✅ built |
| Receipts, invoice and refund emails | ✅ built on Resend, every attempt logged |
| Group / team self-service checkout beyond 10 seats | ❌ |
| Exhibitor and sponsor ticket catalogues | ❌ modelled, no screens |
| Refunding an invoice (credit notes) | ❌ Stripe dashboard only |

**The headline has moved.** Selling a ticket, taking payment, handling a refund,
issuing a badge, telling an organizer what has sold, refunding without opening
Stripe, invoicing a company and emailing everybody involved are all real now.

What is left is breadth rather than depth: the exhibitor and sponsor catalogues,
groups larger than ten, and credit notes. See `SETUP-PAYMENTS.md` for the
accounts and keys that turn all of it on.

---

## What nobody has tested

**The Stripe webhook has still never received a live event.** That is the one
claim on this page that no amount of code changes.

Everything above is verified by typecheck, production build, 35 unit tests, 143
`firestore.rules` tests, 13 new commerce tests against the emulator, and a
rendered check of every new screen against seeded orders. None of that involves
Stripe. The fulfilment logic is exercised directly; the *event delivery* that
triggers it is not.

`stripe listen --forward-to localhost:3200/api/stripe/webhook` against a test
key closes it in about ten minutes, and it should happen before any real money
does. Step 4 of `SETUP-PAYMENTS.md` is the script for it.
