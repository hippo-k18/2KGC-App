# The live demo — strategy and state

> ## ⚠️ Superseded on 2026-08-31 — demo mode has been removed
>
> **This file is now a historical record, not instructions.** BUILD-PLAN 1.4–1.8
> deleted every mechanism described below: `DEMO_MODE`, `EXPO_PUBLIC_DEMO_MODE`,
> the printed-credential panels, the `demo`/`123` sign-in mapping, `OPEN_SIGNIN`
> and the payment bypass. Steps 7, 8 and 9 have been *undone*.
>
> What is true instead:
>
> - **The purchase path fails closed.** No Stripe key means `/tickets` says so,
>   the pay button is disabled, and `startCheckout` refuses. Nothing can be
>   bought until `STRIPE_SECRET_KEY` is set (`OWNER-ACTIONS.md` §2).
> - **Sign-in is a six-digit code** (`requestOtp` / `verifyOtp`), with email +
>   password kept beside it at the owner's request. No password is printed
>   anywhere, and no account this project provisions has one.
> - **Two things survive by explicit request**: the two boxes on each login
>   screen, and the three card boxes on `/tickets`.
>
> ⚠️ **§4 below is still live and still needs action** — the fifty Auth accounts
> it records were created on the real project with a shared password, and that
> password has been removed from the repo but *not* rotated on the accounts. See
> `OWNER-ACTIONS.md` §4.

Written 2026-08-27. This file is the plan *and* the record of what is actually
done, so it must be edited as each step lands rather than at the end.

## What changed, in one sentence

Everything used to run against the Firebase emulator on one laptop. This moves
the demo onto the real `kgc-conference-app-and-website` project so the two
Netlify sites and a phone can all reach the same data at the same time.

## The three surfaces

| Surface | Where it runs | Sign-in |
| --- | --- | --- |
| Public website | `kgc-2027-website.netlify.app` | none — anyone can buy |
| Organizer dashboard | `kgc-2027-dashboard.netlify.app` | email allowlist + passphrase |
| Attendee app | `kgc-2027-app.netlify.app`, or Expo Go on a phone | Firebase Auth, email + password |

## Decisions taken for the demo

**~~Payment is approved on the button.~~ Removed 2026-08-31.** Stripe is not configured.
The existing no-Stripe path already writes a byte-identical registration; the
only change is that the order is now marked `paid` rather than `pending`, so
every downstream screen — revenue, orders, attendee list — shows the sale the
way a real one would. `channel: 'demo'` still marks it, so nothing in an export
can mistake it for money that arrived.

**Email receipts are off.** `RESEND_API_KEY` is unset, and `emailEnabled()`
already makes every send a no-op in that state. Nothing is queued and nothing
fails; the confirmation page carries the claim code, which is the part the demo
actually shows.

**~~Credentials are printed on screen.~~ Removed 2026-08-31.** Every sign-in and the checkout card box
show the values to type, in a dark panel rendered in the page next to the fields
it fills — inside the dashboard's login card, under the website's card box. It
used to be fixed to the bottom of the viewport and covered whatever was beneath
it, including the pay button and the confirmation page's claim code. This is a
demo affordance and it is gated on `DEMO_MODE` / `EXPO_PUBLIC_DEMO_MODE` so it
cannot survive into a real deployment by accident.

## Steps

- [x] 1. Create the `(default)` Firestore database — `nam5`, Native, Standard.
- [x] 2. Publish `firestore.rules` to the live project.
- [x] 3. Apply all 16 composite indexes and 6 field overrides.
- [x] 4. Provision Firebase Auth and enable Email/Password. **Console only** —
      the API refuses on Spark with `BILLING_NOT_ENABLED`, and the Admin SDK
      answers `auth/configuration-not-found` until somebody clicks Get started.
      Done 2026-08-27; `signIn.email` is `{enabled: true, passwordRequired: true}`.
- [x] 5. Seed the live project — 483 documents: 72 sessions, 45 speakers, 18
      sponsors, 11 ticket types, 50 synthetic attendees.
- [x] 6. Create the Auth accounts and stamp the `registered` claim — 50 created,
      50 sets of claims. Verified by an actual REST sign-in with the app's own
      web API key: `amara.okonkwo@example.test` returns a token carrying
      `registered: true`, `roles: [attendee, organizer]`, `eventId: kgc-2027`.
      Those claims are what `firestore.rules` gates on, so the app's
      authorization path is now real rather than emulated.
- [x] ~~7. Demo mode in `apps/web`~~ — **reverted 2026-08-31**; — approves on click, cosmetic card box,
      credential panel with one-click fill.
- [x] ~~8. Demo mode in `apps/organizer`~~ — **reverted 2026-08-31**; — credential panel, and a passphrase long
      enough that the live-project guard accepts it.
- [x] ~~9. Demo mode in `app/`~~ — **reverted 2026-08-31**; — Expo points at the live project, and the
      credential hint is no longer emulator-only.
- [x] 10. Netlify environment for both sites. The dashboard had no
      service-account credential at all and was serving its in-memory fixture;
      it now reads the live project.
- [x] 11. Typecheck (3 apps), the full suite, commit, push. **358 tests as of
      2026-08-28** — 119 unit · 66 programme · 143 rules · 16 commerce · 14
      triggers.
- [x] 12. Both sites deployed and smoke-tested — a purchase driven through the
      deployed website appeared on the deployed dashboard as `paid`.
- [x] 13. `PRESENT.md` — the run sheet for the day.
- [x] 14. `scripts/ops/reset-demo-sales.mjs`, so a rehearsal does not leave the
      counter at 1 before the real run starts.
- [x] 15. Host the attendee app on the web — `kgc-2027-app.netlify.app`. Expo Go
      serves its JavaScript from Metro on the presenter's laptop, so the phone
      had to share its Wi-Fi; that rules out a conference room, cellular, and
      anyone in the audience opening it themselves. `expo export --platform web`
      removes the laptop from the path entirely.
- [x] 16. Get the dashboard's own gap notes off the demo screens — 126 "Not
      built here" panels, 8 gap cards, 8 grey tags and the sign-in security
      banner now render only under `SHOW_GAP_NOTES=1`. They were accurate and
      they were written for whoever is building this; an audience reads them as
      a verdict on the product. Done 2026-08-28; see
      `apps/organizer/src/lib/gap-notes.ts`.
- [x] 17. Get the demo credential panels out of the way — they were fixed to the
      bottom of the viewport and covered the pay button and the confirmation
      page's claim code. Now in the flow, under the card box on the website and
      inside the login card on the dashboard. The demo buyer is **Demo
      Attendee**, not an invented person's name.

## Things that will bite

**The emulator does not enforce indexes.** Every query in this repo has only run
where a missing index is free. Step 3 is what stops a screen being blank on
stage; an index that is still `CREATING` behaves exactly like one that does not
exist.

**`.env.local` must move aside before a Netlify build.** Next.js reads it during
`next build` and the local file points at an emulator that is not there. This
took production down on 2026-08-27. See `DEPLOY-NETLIFY.md`.

**The dashboard refuses a short passphrase against a live project.** That is
deliberate — `MIN_LIVE_PASSPHRASE` is 7, lowered from 12 on 2026-08-31 at the
owner's request — so `123` has to be replaced, and the
replacement has to be printed on the login screen for the demo to be usable.

---

## The free tier ran out, and it will again

On 2026-08-28 the project hit `RESOURCE_EXHAUSTED: Quota exceeded` on Firestore
and stayed there for the rest of the day. While it lasts, the tickets page shows
"not open yet" instead of prices, the dashboard reads nothing, and the app is
empty. **Nothing announces this** — every surface degrades into looking merely
unfinished.

Spark allows 50,000 document reads a day and resets at midnight Pacific.

### What actually burned it

Cloud Monitoring, `firestore.googleapis.com/document/read_count` over 24h:

| | |
| --- | --- |
| Total | **47,130** |
| In one hour (16:52 UTC) | **45,807** — 97% of the day |
| By type | 47,089 `QUERY`, 37 `LOOKUP`, 4 `NOT_FOUND` |

**It is not a leak, and that was worth proving rather than assuming.** The
suspects were checked and cleared: `useCollection` deps on `onAuthStateChanged`
(stable — not `onIdTokenChanged`, which would resubscribe on every hourly token
refresh), and `retry()` has no automatic caller, so a failing listener cannot
spin. The spike lands exactly on the hour of heaviest deploy-and-verify work:
two browsers open on the app and the dashboard, navigating repeatedly, each
navigation re-running whole-collection listeners.

### Why that still matters on the day

The database is only ~530 documents, so 45,807 reads means roughly **eighty full
scans of everything**. A single attendee browsing the app cold costs about 220
reads:

| Screen | Reads |
| --- | --- |
| Agenda | 72 sessions |
| People | 42 directory + 45 speakers + 18 sponsors |
| Home | 19 tracks and rooms, 3 announcements |
| Community | 6 posts, 16 replies when opened |
| Me → Badge | 1 registration |

So **fifty people opening the app is around 11,000 reads** — survivable once,
not twice, and not alongside a rehearsal and a dashboard walkthrough. Putting
the QR on a slide, which is the best thing the demo can do, is also the thing
most likely to exhaust the quota mid-session.

Blaze's free allowance is *identical*; the difference is that Spark stops
serving at the cap and Blaze bills the overage, which at this volume is cents.
That, not the feature list, is the argument for upgrading before the day.
