# The live demo — strategy and state

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
| Attendee app | Expo, on the presenter's laptop or phone | Firebase Auth, email + password |

## Decisions taken for the demo

**Payment is approved on the button.** Stripe is not configured and will not be.
The existing no-Stripe path already writes a byte-identical registration; the
only change is that the order is now marked `paid` rather than `pending`, so
every downstream screen — revenue, orders, attendee list — shows the sale the
way a real one would. `channel: 'demo'` still marks it, so nothing in an export
can mistake it for money that arrived.

**Email receipts are off.** `RESEND_API_KEY` is unset, and `emailEnabled()`
already makes every send a no-op in that state. Nothing is queued and nothing
fails; the confirmation page carries the claim code, which is the part the demo
actually shows.

**Credentials are printed on screen.** Every sign-in and the checkout card box
show the values to type, in a fixed panel at the bottom of the viewport. This is
a demo affordance and it is gated on `DEMO_MODE` / `EXPO_PUBLIC_DEMO_MODE` so it
cannot survive into a real deployment by accident.

## Steps

- [x] 1. Create the `(default)` Firestore database — `nam5`, Native, Standard.
- [x] 2. Publish `firestore.rules` to the live project.
- [x] 3. Apply all 16 composite indexes and 6 field overrides.
- [ ] 4. Provision Firebase Auth and enable Email/Password. **Console only** —
      the API refuses on Spark with `BILLING_NOT_ENABLED`, and the Admin SDK
      answers `auth/configuration-not-found` until somebody clicks Get started.
- [ ] 5. Seed the live project: agenda, speakers, sponsors, ticket types,
      50 synthetic attendees.
- [ ] 6. Create the Auth accounts and stamp the `registered` claim.
- [ ] 7. Demo mode in `apps/web`: approve on click, credential panel.
- [ ] 8. Demo mode in `apps/organizer`: credential panel, live-grade passphrase.
- [ ] 9. Demo mode in `app/`: point Expo at the live project, keep the
      credential hint that today is emulator-only.
- [ ] 10. Netlify environment for both sites, dashboard included — it has no
      service-account credential at all today and cannot read Firestore.
- [ ] 11. Build, typecheck, test, commit, push.
- [ ] 12. Deploy both sites and smoke-test the live URLs.
- [ ] 13. Write `PRESENT.md` — the run sheet for the day.

## Things that will bite

**The emulator does not enforce indexes.** Every query in this repo has only run
where a missing index is free. Step 3 is what stops a screen being blank on
stage; an index that is still `CREATING` behaves exactly like one that does not
exist.

**`.env.local` must move aside before a Netlify build.** Next.js reads it during
`next build` and the local file points at an emulator that is not there. This
took production down on 2026-08-27. See `DEPLOY-NETLIFY.md`.

**The dashboard refuses a short passphrase against a live project.** That is
deliberate — `MIN_LIVE_PASSPHRASE` is 12 — so `123` has to be replaced, and the
replacement has to be printed on the login screen for the demo to be usable.
