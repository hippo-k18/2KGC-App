# Audit B — Ticketing: can an organizer edit it, and does the edit propagate?

**Scope:** ticket authoring in `apps/organizer`, the purchase path in `apps/web`,
and what reaches the attendee app. Read-only audit, 2026-08-30. Every claim below
is cited to a file and line that was opened, not inferred.

---

## Summary

**The price chain is genuinely end-to-end and there is no cache and no hard-coded
fallback anywhere on it.** An organizer edits a price at
`apps/organizer/src/app/(dash)/tickets/ticket-setup/1-1-create-tickets`, the
server action writes `ticketTypes/{slug}` with the Admin SDK
(`actions.ts:194-212`), the public site re-reads that document on every request
(`apps/web/src/lib/catalogue.ts:76`, every ticket route is `force-dynamic`), and
Stripe Checkout is handed `unit_amount: tier.priceCents` looked up server-side
from a tier **id** posted by the form, never from a form field
(`apps/web/src/app/tickets/actions.ts:49`, `:224`). The classic "$1 for a $1,199
ticket" bug is closed by construction. Orders denormalise what was actually
charged (`registrations.ts:227-243`), so a price edit cannot rewrite history, and
the dashboard's revenue screens read order totals rather than multiplying a tier
price by a count. That whole spine is correct.

**What is not fully editable is everything around the price.** Of the eighteen
fields `TicketTypeDoc` declares, fifteen have a control on the one ticket editor
in the product; `groups`, `quantitySold` and `taxCode` have none, and `groups` is
the one that bites — it is the field the public `/tickets` page
actually renders for the two headline tiers, which means **editing "What's
included" for All Access or Main Conference changes nothing a buyer sees**
(`apps/web/src/app/tickets/page.tsx:31`). Three more fields are editable but
inert downstream: `inPerson` is read into the display shape and never rendered,
`featured` is ignored by `/tickets` (which hard-codes its two panels by slug at
`page.tsx:93-94`), and `includesWorkshops` / `includesVideoLibrary` are
entitlements that nothing enforces — `users/{uid}/entitlements` is modelled and
has no writer (stated on screen at
`attendees/ticket-session-mapping/page.tsx:299`).

**Inventory is a counter, not a lock, and it is one-way.** `quantityTotal` is
editable and enforced at read time and again at checkout
(`catalogue.ts:50`, `apps/web/src/app/tickets/actions.ts:59`), which is
honest. But `quantitySold` is incremented at fulfilment and **never decremented
on refund** (only writers: `catalogue.ts:188`, `manual-orders.ts:204`), and there
is no control anywhere to correct it — so ten refunds permanently consume ten
seats of a capped tier and the only remedy is to raise the cap. When a tier does
hit zero the `/tickets` page still renders a "Choose" button for it
(`page.tsx:51-56`, `:192`); only the radio inside the checkout form disables it
(`checkout-form.tsx:146`). The `/tickets/exhibitor` and `/tickets/sponsor` pages
do this correctly (`audience-page.tsx:125-139`), so the attendee page is the
outlier.

**Missing outright:** ticket add-ons (no product model at all — the Checkout
session builds exactly one line item with `quantity: 1`), group/bundle tickets as
a purchasable product, multi-seat card checkout, dashboard-initiated invoicing,
partial refunds, invoice refunds (credit notes), per-order min/max, fees, and a
refund policy field. Invoicing itself **is** built and prices every seat live off
the catalogue (`invoice/actions.ts:119-136`); refunds are built, audited and
passphrase-confirmed, but full-only and card-only
(`attendee-orders/actions.ts:12-49`).

**One deployment-shaped hazard worth naming first.** If the dashboard runs
without `FIRESTORE_EMULATOR_HOST` and without a service-account credential, it
silently serves and *writes to* an in-memory fixture
(`apps/organizer/src/lib/demo/store.ts:282-285`, `src/lib/firestore.ts:32`). In
that mode a price edit returns "Saved. The website shows the new details
immediately" and nothing reaches Firestore. `apps/web` has no equivalent
fallback — it throws or renders a closed state — so the two halves fail
asymmetrically and the failure is invisible from the editor.

---

## Per-field table — `TicketTypeDoc` (`packages/shared/src/models.ts:765-819`)

Editor referenced throughout is
`apps/organizer/src/app/(dash)/tickets/ticket-setup/1-1-create-tickets/`
(`ticket-form.tsx` = the UI, `actions.ts` = the write). It is the **only** ticket
editor in the dashboard; the exhibitor and sponsor catalogue screens link into it
(`audience-catalogue.tsx:18-31`).

| Field | Editable from dashboard? | Where | Reaches public site? | Notes |
|---|---|---|---|---|
| `name` | **Yes** | `ticket-form.tsx:46-53` → `actions.ts:84`, `:154` | Yes — `/tickets` panels, smaller cards, checkout radio, order rail | Denormalised onto `OrderLine.ticketTypeName` and `RegistrationDoc.ticketType` at sale time; a rename does **not** backfill issued badges (`app/src/lib/data/badge.ts:283`) |
| `priceCents` | **Yes** | `ticket-form.tsx:70-79` → `actions.ts:85`, `parseMoney():63-68` | Yes — read live at purchase (`apps/web/src/app/tickets/actions.ts:49`) and passed to Stripe (`:224`) | Typed in whole units, stored in minor units. `0` + `visible` is refused (`actions.ts:111-118`). Every save audited with before/after (`actions.ts:223-237`) |
| `currency` | **Yes** | `ticket-form.tsx:80-84` (usd/eur/gbp) → `actions.ts:88`, `:119` | **Partially** — Checkout and `/tickets/{exhibitor,sponsor}` honour it; `/tickets` headline panels and smaller cards hard-code USD formatting (`page.tsx:36`, `:186` call `formatPrice` with no currency arg) | The editor's own preview also hard-codes `currency: 'USD'` (`ticket-form.tsx:92`) |
| `tagline` | **Yes** | `ticket-form.tsx:107-113` → `actions.ts:86`, `:157` | **Partially** — rendered on the order rail (`checkout-form.tsx:295`), on `/tickets/{exhibitor,sponsor}` (`audience-page.tsx:119`) and in the Stripe product description (`apps/web/src/app/tickets/actions.ts:229`); **not** rendered by the `/tickets` panels or smaller cards | |
| `includes` | **Yes** | `ticket-form.tsx:120-126` (one bullet per line) → `actions.ts:135-138` | **Only where `groups` is absent** — `page.tsx:31` prefers `groups`, and the seeded `all-access` and `main-conference` both have `groups` (`scripts/src/lib/ticket-types.ts:70-86`, `:108-123`). Editing this for the two headline tiers changes nothing on the panels. Does show in the order rail and smaller cards | The single most misleading control on the screen |
| `groups` | **No** | Not on `TicketTypeRow` (`commerce.ts:290-319`), not in the form, not in the written `fields` (`actions.ts:153-191`) | Yes — it is what `/tickets` actually renders for the headline tiers | Preserved by the `merge: true` write, so it survives edits — it just cannot be changed except by re-seeding or the Firebase console |
| `inPerson` | **Yes** | `ticket-form.tsx:225` → `actions.ts:92`, `:159` | **No** — read into `Tier` (`catalogue.ts:66`) and never rendered by any public component | Consumed only by dashboard screens: `virtual-and-hybrid-setup/page.tsx:36`, `attendee-customization/ticket-tiering/page.tsx:68` |
| `featured` | **Yes** | `ticket-form.tsx:229` → `actions.ts:93`, `:160` | **Partially** — drives dark/light styling on `/tickets/{exhibitor,sponsor}` (`audience-page.tsx:116`, `:128`); **ignored** by `/tickets`, which selects its two panels by hard-coded slug (`page.tsx:93-94`) | |
| `visible` | **Yes**, two ways | `ticket-form.tsx:221`; plus a one-click Hide/Show on the list, as a POST not a link (`page.tsx:195-210` → `toggleTicketVisibilityAction`, `actions.ts:267-296`) | Yes — filtered in `listTiers` (`catalogue.ts:147`) | Hidden tiers remain purchasable by direct id via `tierById` (`catalogue.ts:162-169`) — deliberate, that is the comp/speaker-rate mechanism |
| `sortOrder` | **Yes** | `ticket-form.tsx:206-212` → `actions.ts:90`, `:162` | **Partially** — sorts the catalogue (`catalogue.ts:148-151`), which orders the "smaller tickets" band and the checkout radio, but the two headline panels are slug-addressed and unmoved | |
| `audience` | **Yes** | `ticket-form.tsx:185-189` → `actions.ts:94-99`, `:172` | Yes — chooses which of the three public pages sells the tier (`catalogue.ts:133-153`, `audience-catalogue.tsx:35-39`) | Previously written as the literal `'attendee'`, which silently reclassified exhibitor/sponsor tiers on save; fixed and documented in place (`actions.ts:163-171`) |
| `quantityTotal` | **Yes** | `ticket-form.tsx:136-144` (blank = unlimited) → `actions.ts:89`, `:121-124`, `:188` | Yes — `availability()` closes the tier at capacity (`catalogue.ts:50`) and `startCheckout` re-checks (`apps/web/src/app/tickets/actions.ts:59`) | Validated as a whole number ≥ 1 or blank |
| `quantitySold` | **No** | Deliberately never written on update (`actions.ts:200-207`); displayed only (`ticket-form.tsx:152`, `page.tsx:164-173`) | Yes — it is half of the sold-out test | Incremented at fulfilment (`catalogue.ts:188`) and by manual orders (`manual-orders.ts:204`); **never decremented**, including on refund. No correction control exists anywhere |
| `salesOpenAt` | **Yes** | `ticket-form.tsx:163-168` (`datetime-local`) → `actions.ts:102`, `parseDate():71-75`, `:189` | Yes — "Not on sale yet" (`catalogue.ts:44-46`) | Ordering validated against close (`actions.ts:131-133`). Parsed with bare `new Date()` in the server's timezone — no event-timezone handling, unlike sessions |
| `salesCloseAt` | **Yes** | `ticket-form.tsx:171-174` → `actions.ts:103`, `:190` | Yes — "Sales closed" (`catalogue.ts:47-49`) | as above |
| `includesWorkshops` | **Yes** | `ticket-form.tsx:239-246` → `actions.ts:100`, `:186` | **No** — no public or app consumer | Read only by `attendees/ticket-session-mapping/page.tsx:77`. `users/{uid}/entitlements` has no writer (`:299`), so this grants nothing at a door or in the app |
| `includesVideoLibrary` | **Yes** | `ticket-form.tsx:247-255` → `actions.ts:101`, `:187` | **No** | The UI itself says "sold, but nothing serves it yet" (`ticket-form.tsx:254`) |
| `taxCode` | **No** | No control; carried forward or defaulted to `txcd_20030000` (`actions.ts:173`) | Yes — sent as `product_data.tax_code` (`apps/web/src/app/tickets/actions.ts:243`) | Arguably correct to withhold from an organizer, but it is a per-tier field the model justifies making per-tier (`models.ts:812-818`) and nothing can set it |
| `eventId` | No (fixed) | `actions.ts:199` | n/a | Leads every composite index; correctly not editable |

**Fields Whova has that this model does not have at all** — verified absent by
grep across `packages/`, `apps/web/src`, `apps/organizer/src`, `scripts/src`:
`minPerOrder` / `maxPerOrder`, any fee/absorb-fee field, `refundPolicy`, a
per-ticket-type question-form binding (questions bind the other way — each
question carries `ticketTypeIds`, `question-form-actions.ts:73`), waitlist,
transfer policy, and any add-on/bundle product.

---

## Broken / missing hops

Numbered, with citations. Hops 1–6 are on the price-and-specs chain; 7–12 are the
missing capabilities.

1. **`includes` is edited but `groups` is rendered.**
   `apps/web/src/app/tickets/page.tsx:31` —
   `const groups = tier.groups ?? [{ heading: 'Includes', items: [...tier.includes] }]`.
   The seeded `all-access` and `main-conference` both carry `groups`
   (`scripts/src/lib/ticket-types.ts:70`, `:108`), and `groups` has no editor:
   it is not on `TicketTypeRow` (`apps/organizer/src/lib/commerce.ts:290-319`),
   not in `ticket-form.tsx`, and not in the written field set
   (`.../1-1-create-tickets/actions.ts:153-191`). An organizer changing what the
   flagship tickets include sees the change on the dashboard and on the checkout
   order rail, and **no change at all on the public ticket panels**. Silent, and
   the only ticket-copy edit anyone is likely to make.

2. **Currency is editable and the attendee tickets page ignores it.**
   `apps/web/src/app/tickets/page.tsx:36` and `:186` call
   `formatPrice(tier.priceCents)` with no second argument;
   `apps/web/src/lib/tickets.ts:74` defaults it to `'usd'`. Set a tier to EUR in
   the dashboard (`ticket-form.tsx:80-84`) and `/tickets` prints a dollar sign
   over a euro amount, while Stripe charges euros
   (`apps/web/src/app/tickets/actions.ts:223`) and `/tickets/exhibitor` prints it
   correctly (`audience-page.tsx:118`). The dashboard's own preview shares the
   bug (`ticket-form.tsx:92`).

3. **A sold-out or closed tier still shows a live "Choose" button on `/tickets`.**
   `apps/web/src/app/tickets/page.tsx:51-56` (panels) and `:192` (smaller cards)
   render the link unconditionally; neither reads `tier.onSale` or
   `tier.unavailableReason`, both of which are already on the shape
   (`apps/web/src/lib/tickets.ts:61-63`) and are used correctly on the
   exhibitor/sponsor page (`audience-page.tsx:125-139`). The buyer follows the
   link to `#buy` and finds a disabled radio (`checkout-form.tsx:146`) with no
   explanation above it. So "what happens on the website when quantity hits
   zero" is: the tier keeps advertising itself, and the purchase is refused two
   scroll-lengths later.

4. **`quantitySold` is a ratchet with no reset.** Written only by
   `apps/web/src/lib/catalogue.ts:188` and
   `apps/organizer/src/lib/manual-orders.ts:204`, both `FieldValue.increment(+n)`.
   The refund path (`apps/web/src/lib/registrations.ts:297+`, webhook
   `charge.refunded`) does not touch it, and the create-tickets action refuses to
   write it on update by design (`.../1-1-create-tickets/actions.ts:200-207`).
   Consequence: a capped tier's usable inventory shrinks permanently with every
   refund, and the only lever an organizer has is to inflate `quantityTotal` —
   which then lies on every "12/16 sold" readout
   (`page.tsx:164-173`, `1-7-registration-settings/page.tsx:71`).

5. **Capacity is checked when an invoice is *raised*, not when it is *paid*.**
   `apps/web/src/app/tickets/invoice/actions.ts:121` rejects a seat on a tier
   that is not `onSale`; the `invoice.paid` branch of the webhook
   (`apps/web/src/app/api/stripe/webhook/route.ts:226-237`) registers every seat
   and increments the counter with no re-check. On net-30 terms that is a
   thirty-day window in which a capped tier can be sold out from under an
   invoice, and the oversell arrives as a fait accompli.

6. **Both counter increments are best-effort, so `quantitySold` can silently drift
   low too.** `catalogue.ts:182-194` swallows the failure and logs; the manual
   path does the same (`manual-orders.ts:206-209`). Correct for fulfilment (the
   ticket must not be lost), but it means the number the sold-out test depends on
   has no reconciliation job anywhere. Nothing recomputes it from `orders`.

7. **Editing a tier in the dashboard's demo mode writes to memory and reports
   success.** `apps/organizer/src/lib/demo/store.ts:282-285` — no emulator host
   and no credential means `isDemoMode()`, and `src/lib/firestore.ts:32` returns
   the in-memory fixture, which the save action then writes through
   (`.../1-1-create-tickets/actions.ts:196`) and which returns "Saved. The
   website shows the new details immediately… including the new price"
   (`:242-251`). The message is false in that configuration and there is nothing
   on the ticket editor that says so.

8. **No add-on product exists.** The screen says so accurately
   (`.../ticket-setup/ticket-add-ons/page.tsx:90-108`): nothing in the model is
   purchasable except a ticket type, and the Checkout session builds exactly one
   line item with `quantity: 1`
   (`apps/web/src/app/tickets/actions.ts:220-247`). Workshops are sold as a
   *tier* with an `includesWorkshops` boolean, which stops working the moment two
   extras are independent.

9. **No group/bundle product and no multi-seat card checkout.** Group buying
   exists only as the invoice flow, capped at ten seats
   (`apps/web/src/app/tickets/invoice/actions.ts:38`, `:78`), and there is no
   dashboard action to raise an invoice even though `raiseInvoice()` exists —
   named as a gap on `.../ticket-setup/create-group-tickets/page.tsx:141-145`.
   "Team of 5 for the price of 4" cannot be modelled; the only discount mechanism
   is a Stripe promotion code (`apps/web/src/app/tickets/actions.ts:266`), an
   object no dashboard screen can show against a specific order.

10. **Refunds are full-only and card-only.** `.../attendee-orders/actions.ts:33-41`
    excludes partial refunds and invoice credit notes by design and
    `OrderRow.refundable` gates the button. Everything else about the refund is
    sound — reauthentication, typed amount confirmation, audit written before the
    call, and the registration withdrawn by the `charge.refunded` webhook rather
    than by this action, so a Stripe-dashboard refund behaves identically.

11. **Entitlements do not leave the dashboard.** `includesWorkshops` /
    `includesVideoLibrary` are editable (`ticket-form.tsx:239-255`) and are read
    by exactly one screen (`attendees/ticket-session-mapping/page.tsx:77`).
    `users/{uid}/entitlements` is modelled and unwritten (`:299`), and nothing in
    `app/src` reads either flag — grep for `includesWorkshops` under `app/` finds
    nothing. So the workshop-access checkbox changes a dashboard table and
    nothing else.

12. **The attendee app never sees the catalogue at all, and holds a frozen copy of
    one field.** `ticketTypes` has no `match` block in `firestore.rules` and is
    asserted closed to every client including organizers
    (`tests/rules/firestore.test.ts:1595-1615`). The app's only ticket datum is
    `RegistrationDoc.ticketType`, a name string snapshotted at fulfilment
    (`apps/web/src/lib/registrations.ts:161`) and rendered on the badge
    (`app/src/lib/data/badge.ts:283`, `app/src/app/(tabs)/me/badge.tsx:101`). A
    rename in the dashboard therefore never reaches a badge already issued, and
    there is no backfill. Defensible for orders; for a badge it means the
    organizer has no way to correct a ticket label in an attendee's hand.

**Hops that are correct and should not be "fixed":** the form posts a tier id and
never a price (`apps/web/src/app/tickets/actions.ts:42-50`); `listTiers` throws on
an empty collection rather than falling back (`catalogue.ts:136-143`);
`tiersOrNull` distinguishes "unreachable" from "no tickets" and renders a closed
state (`catalogue.ts:103-110`, `page.tsx:262-282`); orders record their own
amounts so an edit cannot rewrite history (`registrations.ts:227-243`); the
webhook's `result.created` guard stops a replay double-counting a seat
(`webhook/route.ts:406`); terminal order statuses survive a replay
(`registrations.ts:206-219`); and every ticket route on both apps is
`force-dynamic` with no `revalidate` and no CDN caching of the price
(`apps/web/netlify.toml`, and all 53 dashboard ticket pages carry
`export const dynamic = 'force-dynamic'` — verified by grep, zero exceptions).

---

## The full chain for one price change

| # | Hop | State |
|---|---|---|
| 1 | Organizer opens `/tickets/ticket-setup/1-1-create-tickets?edit={id}` → `TicketForm` prefilled from `listTicketTypes()` | ✅ works |
| 2 | `saveTicketTypeAction` parses dollars → cents, validates, writes `ticketTypes/{id}` merge + audit entry (`actions.ts:107`, `:194-237`) | ✅ works — ⚠️ writes to memory, not Firestore, in credential-less demo mode (hop 7 above) |
| 3 | `revalidatePath` on two dashboard routes (`actions.ts:239-240`) | ✅ redundant but harmless — every dashboard ticket page is `force-dynamic` |
| 4 | `apps/web` `/tickets` renders: `tiersOrNull()` → `listTiers()` → one `where(eventId)` query, sorted in memory (`catalogue.ts:76`, `:145-152`) | ✅ live, uncached, no fallback |
| 5 | Price shown on the panels / cards | ✅ new price — ⚠️ formatted as USD regardless of the tier's currency (hop 2) |
| 6 | Other spec edits shown on the panels | ❌ `includes` masked by `groups` (hop 1); `tagline`, `featured`, `inPerson` not rendered there at all |
| 7 | Buyer selects tier in `CheckoutForm`, posts `name=tier` only (`checkout-form.tsx:142-149`) | ✅ no price crosses the wire |
| 8 | `startCheckout` re-reads the tier by id and re-checks `onSale` (`actions.ts:49`, `:59`) | ✅ the authoritative check |
| 9 | Stripe Checkout session: `unit_amount: tier.priceCents`, `currency: tier.currency`, `tax_code: tier.taxCode`, `quantity: 1` (`actions.ts:218-247`) | ✅ live price — ❌ hard-coded single quantity (hop 9) |
| 10 | Webhook `checkout.session.completed` → `fulfilPurchase` with `session.amount_total` (`webhook/route.ts:356`) | ✅ Stripe's own arithmetic, not a recomputation |
| 11 | `orders/{ord_sha256(session)}` written with `items[0].unitPriceCents` and denormalised tier name (`registrations.ts:227-243`) | ✅ idempotent, replay-safe, price frozen at sale |
| 12 | `incrementSold(tierId)` guarded by `result.created` (`webhook/route.ts:406`) | ✅ — ⚠️ best-effort, never decremented (hops 4, 6) |
| 13 | Dashboard Tickets tab (Summary / Attendee Orders / Transaction History) reads `orders` | ✅ reads what was charged; `commerce.ts:24` documents explicitly that it never multiplies a tier price by a count |
| 14 | Attendee app | ❌ never reads `ticketTypes` (rules-closed, `tests/rules/firestore.test.ts:1598`); sees only the frozen `RegistrationDoc.ticketType` string on the badge, never a price (hop 12) |

**Verdict on a pure price change: hops 1–5 and 7–13 all work; a price edited in
the dashboard is the price charged on the next request with no deploy** — which
is exactly what `demo/act3-dashboard.mjs:110-145` records on video. The failures
are on the *spec* edits (hop 6), the currency formatting (hop 5), and the two
ends of the chain: a credential-less dashboard (hop 2) and the app (hop 14).

---

## Every screen under `apps/organizer/src/app/(dash)/tickets/`

**CRUD** = the screen writes durable state. **Read-only** = it reads real data and
renders it honestly but writes nothing. **Inert** = static prose or a gap note
with no data behind it.

### Ticket Setup

| Screen | Class | Notes |
|---|---|---|
| `ticket-setup/1-1-create-tickets` | **CRUD** | The one ticket editor. Create + edit + visibility toggle; no delete, deliberately (`actions.ts:258-266`). Writes `ticketTypes`, audits every save |
| `ticket-setup/1-2-question-forms` | **CRUD** | Delegates to `question-form-screen.tsx` + `question-form-actions.ts`; add/edit/reorder/delete questions, toggle the form live. Writes `questionForms/{audience}` |
| `ticket-setup/1-3-confirmation-emails` | Read-only | Renders `emailLog` rows; no template editor |
| `ticket-setup/1-4-registration-pages` | Read-only | Shows what the buyer currently sees; says plainly the page copy is JSX and needs a deploy (`page.tsx:47-52`) |
| `ticket-setup/1-5-registration-widgets` | Read-only + gap | No embeddable widget exists |
| `ticket-setup/1-6-abandoned-registration` | Read-only | Cancelled orders as a proxy; no cart-recovery mail |
| `ticket-setup/1-7-registration-settings` | Read-only | Deliberately no form — the settings it would host live per-tier on 1.1 (`page.tsx:9-23`) |
| `ticket-setup/ticket-add-ons` | Read-only + gap | No add-on model at all |
| `ticket-setup/create-group-tickets` | Read-only | Lists invoice-channel orders; the buyer-facing form is on `apps/web` |
| `ticket-setup/discount-codes` | **CRUD** | Creates and deactivates **Stripe** promotion codes (`actions.ts:26-110`), not Firestore documents. Degrades to an EmptyState with no Stripe key |
| `ticket-setup/session-rsvp` | Read-only + gap | |
| `ticket-setup/member-and-invite-only-ticketing` | Read-only + gap | Reports hidden tiers as the nearest available mechanism |
| `ticket-setup/{imis,memberclicks,neon-crm,yourmembership}-connection-guide` | **Inert** (×4) | Static prose |

### Exhibitor Ticket Setup

| Screen | Class | Notes |
|---|---|---|
| `exhibitor-ticket-setup/2-1-exhibitor-tickets` | Read-only | Wraps `AudienceCatalogue`; Edit links land on 1.1 |
| `exhibitor-ticket-setup/2-2-question-forms` | **CRUD** | Same editor as 1.2, `audience="exhibitor"` |
| `exhibitor-ticket-setup/2-3-booth-selection` | **CRUD** | Writes `booths` (release / block) via `actions.ts`; not `ticketTypes` |
| `exhibitor-ticket-setup/2-4-confirmation-emails` | **Inert** | 22 lines |
| `exhibitor-ticket-setup/2-5-ticket-add-ons` | Read-only + gap | Reports over-allocated booth-staff passes |
| `exhibitor-ticket-setup/2-6-offline-payment` | **CRUD** | `ManualOrderForm` → writes an order + registration + increments `quantitySold` (`manual-orders.ts:150-210`) |
| `exhibitor-ticket-setup/2-7-registration-page` | Read-only | Points at `/tickets/exhibitor` |
| `exhibitor-ticket-setup/2-8-registration-widget` | **Inert** | |
| `exhibitor-ticket-setup/discount-codes` | Read-only + gap | Stripe codes are not audience-scoped |
| `exhibitor-ticket-setup/pre-paid-exhibitors` | **CRUD** | `ManualOrderForm`; reconciles sponsors/exhibitors against orders |
| `exhibitor-ticket-setup/registration-settings` | **Inert** | 45 lines |

### Sponsor Ticket Setup

| Screen | Class | Notes |
|---|---|---|
| `sponsor-ticket-setup/sponsor-tickets` | Read-only | `AudienceCatalogue`, sponsor slice |
| `sponsor-ticket-setup/question-forms` | **CRUD** | Same editor, `audience="sponsor"` |
| `sponsor-ticket-setup/discount-codes` | Read-only + gap | |
| `sponsor-ticket-setup/registration-page` | Read-only | |
| `sponsor-ticket-setup/registration-settings` | **Inert** | |
| `sponsor-ticket-setup/registration-widget` | **Inert** | |
| `sponsor-ticket-setup/confirmation-emails` | **Inert** | |

### Orders and Transactions

| Screen | Class | Notes |
|---|---|---|
| `orders-and-transactions/attendee-orders` | **CRUD** | Refund (full, card-only, reauthenticated, audited) and Mark-paid-out-of-band, via `actions.ts` + `order-actions.tsx` |
| `orders-and-transactions/summary` | Read-only | Revenue from order totals, not tier prices |
| `orders-and-transactions/transaction-history` | Read-only | Plus the `emailLog` diagnostic strip |
| `orders-and-transactions/exhibitor-orders` | Read-only | `audience-orders.tsx`; joins `OrderLine.ticketTypeId` → `audience` at read time |
| `orders-and-transactions/sponsor-orders` | Read-only | as above |

### Marketing, publishing, payout, customization, export

| Screen | Class | Notes |
|---|---|---|
| `publish-tickets` | Read-only | Pre-flight blockers/warnings; correctly has no publish button (`page.tsx:15-22`) |
| `payout` | Read-only + gap | Stripe balance/payout not wired |
| `attendee-customization/ticket-tiering` | Read-only + gap | |
| `attendee-customization/attendee-categories` | Read-only + gap | |
| `ticket-marketing/campaign-contact-list` | **CRUD** | CSV import + per-contact subscribe toggle |
| `ticket-marketing/email-campaign` | **CRUD** | Sends via Resend, one `emailLog` row per recipient |
| `ticket-marketing/campaign-link-tracking` | **CRUD** | `LinkForm` (`page.tsx:109`) → `link-actions.ts` creates tracked `/r/{code}` links |
| `ticket-marketing/referral-contest` | **CRUD** | Same `LinkForm` (`page.tsx:163`), per-referrer codes |
| `ticket-marketing/social-sharing` | **CRUD** | Same `LinkForm` (`page.tsx:118`), per-channel codes |
| `ticket-marketing/event-listing`, `ticket-marketing/event-website` | Read-only + gap (×2) | |
| `export-to-ams-crm` | **Inert** | |
| `hubspot-connection-guide`, `memberclicks-connection-guide` | **Inert** (×2) | |

**Totals: 53 pages — 14 CRUD, 26 read-only, 13 inert; 26 pages carry a
`GapPanel`, 24 of them read-only.** Exactly one of the fourteen CRUD screens
writes `ticketTypes`: `1-1 Create Tickets`.

---

## Prioritized TODO — to make ticketing fully editable end to end

**P0 — silent wrongness on the live money path**

1. **Make `groups` editable, or stop rendering it.** Either add a grouped-bullets
   editor to `ticket-form.tsx` (and `groups` to `TicketTypeRow` and the written
   field set), or delete `groups` from the model and have `page.tsx:31` render
   `includes` for every tier. Until one of these happens, the "What's included"
   textarea is a control that does nothing for the two most important tiers.
2. **Pass currency through on `/tickets`.** `page.tsx:36` and `:186` →
   `formatPrice(t.priceCents, t.currency)`; `ticket-form.tsx:92` → use the
   selected currency in the preview. One-line fixes; today a non-USD tier
   misprices itself on the public page.
3. **Guard the credential-less dashboard against ticket writes.** Either refuse
   `saveTicketTypeAction` / `toggleTicketVisibilityAction` when `isDemoMode()`,
   or make the success message say the write went to an in-memory fixture. A
   money screen must not report a save that did not happen.

**P1 — inventory correctness**

4. **Render `onSale` on `/tickets`.** Copy the treatment already written for
   `audience-page.tsx:125-139` into `TicketPanel` and the smaller-card block, so
   a sold-out or not-yet-open tier says so instead of offering a button.
5. **Make `quantitySold` correctable.** Minimum: an audited "adjust sold count"
   control on 1.1 for the refund-shrinkage case. Better: decrement on the
   `charge.refunded` path, joined through `OrderLine.ticketTypeId`, plus a
   reconcile-from-orders script under `scripts/ops/`.
6. **Re-check capacity at `invoice.paid`, not only when the invoice is raised.**
   `webhook/route.ts:226` — refuse or flag seats on a tier that has since closed,
   rather than registering them silently.

**P2 — specs that are editable but inert**

7. **Write `users/{uid}/entitlements` at fulfilment** from `includesWorkshops` /
   `includesVideoLibrary`, and read it in the app. Until then both checkboxes are
   decorative outside one dashboard table.
8. **Honour `featured` on `/tickets`** instead of the hard-coded `all-access` /
   `main-conference` slugs at `page.tsx:93-94`, so the highlight checkbox does
   something and a fifth tier can be promoted.
9. **Render `tagline` on the ticket panels**, or remove the field from the editor.
10. **Decide `inPerson`'s job.** It is editable, threaded onto `Tier`, and read by
    nobody on the public site. Either badge virtual tiers on `/tickets` or drop
    it from the form.
11. **Add a `taxCode` control** (a short select of Stripe's ticketing codes) —
    the model argues per-tier tax codes matter and nothing can currently set one.
12. **Timezone the sales window.** `parseDate` (`actions.ts:71-75`) uses the
    server's zone; sessions already solve this with `startsAtLocal` + `timeZone`.
    An early-bird deadline that closes at the wrong hour is a support ticket.

**P3 — capabilities that do not exist**

13. **Add-ons.** An `addOns` collection (price, optional capacity, entitlement),
    multi-select on the public form, extra Checkout line items, and the
    entitlement written at fulfilment — with the same read-time availability
    check the catalogue already has. This is the largest single gap and the
    screen at `ticket-setup/ticket-add-ons/page.tsx:73-88` already specifies it.
14. **Multi-seat card checkout.** Lift `quantity: 1`
    (`apps/web/src/app/tickets/actions.ts:222`) and collect per-seat attendee
    details on our own page before the redirect — the same shape the invoice form
    already uses.
15. **Bundle / group ticket product** ("Team of 5"), so a group discount is a
    tier rather than an invisible Stripe coupon.
16. **Raise an invoice from the dashboard.** `raiseInvoice()` already exists; this
    is a form and an action, and it is named as a gap on
    `create-group-tickets/page.tsx:141-145`.
17. **Partial refunds and invoice credit notes**, both currently excluded by
    design (`attendee-orders/actions.ts:33-41`) and both currently requiring the
    Stripe dashboard.
18. **Min/max per order, and a refund-policy field** surfaced at checkout — three
    fields the model does not have and Whova does.
19. **Ticket-type deletion or archival.** There is deliberately no delete
    (`actions.ts:258-266`); "hide" covers most of it, but an `archived` flag that
    drops a tier from dashboard tables while keeping order references intact
    would stop the catalogue growing forever.
20. **Backfill or version `RegistrationDoc.ticketType`** so a renamed tier can be
    corrected on badges already issued, or accept and document that badge labels
    are frozen at purchase.

**Also worth doing while in here:** nothing recomputes `quantitySold` from
`orders`, and nothing tests the price chain end to end — `PAYMENTS.md` records
that the Stripe webhook has still never received a live event. Item 5's reconcile
script and a `stripe listen` run against a test key would close both.
