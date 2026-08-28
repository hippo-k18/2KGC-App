# KGC 2027 — demo run sheet

Everything below runs against the **live** Firebase project
`kgc-conference-app-and-website`. The website, the dashboard and the phone all
read the same database, which is the point: what you do on one appears on the
others while the room watches.

---

## Before you stand up

### 1. Firebase Auth — already done, nothing to do

Email/Password is enabled on the project and all fifty demo accounts exist with
their claims stamped. Verified by signing in for real:
`amara.okonkwo@example.test` returns a token carrying `registered: true`, which
is the claim `firestore.rules` gates on.

Only re-run this if the accounts are ever wiped:

```bash
cd ~/Documents/Claude/Projects/KGC/2KGC-App
export GOOGLE_APPLICATION_CREDENTIALS="$PWD/.secrets/service-account.json"
npm run claims -- --confirm-live
```

**Do not enable Google sign-in.** The app only calls
`signInWithEmailAndPassword`, and a Google account would arrive with a uid that
matches no seeded attendee — so it would sign in to an empty profile with no
`registered` claim and every rule-protected screen would come back blank.

### 2. Reset the sales, if you have rehearsed

Buying twice with the same email updates the same order rather than creating a
second one, so the counter will not move on the second run and the orders screen
will already say "Paid 1" before you buy anything.

```bash
export GOOGLE_APPLICATION_CREDENTIALS="$PWD/.secrets/service-account.json"
node scripts/ops/reset-demo-sales.mjs
```

It only touches orders marked `channel: 'demo'` — and the app accounts those
purchases created, whose uid *is* the registration id, so a seeded attendee
cannot be reached from it. Add `--dry-run` to see what it would remove first.

### 3. Open the tabs, in this order

| Tab | URL |
| --- | --- |
| 1 — Website | <https://kgc-2027-website.netlify.app> |
| 2 — Tickets | <https://kgc-2027-website.netlify.app/tickets#buy> |
| 3 — Dashboard | <https://kgc-2027-dashboard.netlify.app/login> |
| 4 — Attendee app | <https://kgc-2027-app.netlify.app> |

Sign into tab 3 **before** you start talking. The credentials are printed in the
dark panel inside the login card, under the fields — click a value to copy it.

- Email · `demo@knowledgegraph.tech`
- Password · `kgc-demo-2027`

Leave it on **Tickets → Orders and Transactions → Attendee Orders**. That is the
screen you will cut back to.

### 4. The phone

**<https://kgc-2027-app.netlify.app>** — open it in any browser, on any device,
on any network. Sign in with username `demo`, password `123`; both are
prefilled and printed under the form.

This is the attendee app exported to the web and hosted, which exists for one
reason: **Expo Go loads its JavaScript from a Metro server on this laptop**, so
the phone has to be on the same Wi-Fi. That is fine at a desk and useless in a
conference room, impossible over cellular, and hopeless if you want anyone in
the audience to open it on their own phone. The hosted build needs nothing
installed and does not depend on this machine being awake.

The QR for it is on the Desktop as `kgc-app-qr.png` — put it on a slide and the
room can follow along on their own phones.

Expo Go still works and is still the better *native* demo — gestures, the tab
bar, the real thing:

```bash
cd ~/Documents/Claude/Projects/KGC/2KGC-App
npm start
```

Scan that QR with Expo Go, same Wi-Fi required.

---

## The run — about eight minutes

### Beat 1 · "This is the conference website" (60s)

Tab 1. Scroll the home page, then **Agenda**.

> "Seventy-two sessions across five days, eleven tracks. This is not a static
> page — every session on it is a document in the database, and the same
> documents drive the app in my pocket and the organizer's dashboard."

Click into **Speakers**. Forty-five of them.

### Beat 2 · "Someone buys a ticket" (90s)

Tab 2, already at the buy form.

1. Click **Fill the form** in the dark panel under the card box. Name, email and
   card fill in one click.
2. Change the ticket dropdown to **Main Conference — $799**.
3. Say what the audience needs to hear before you click:

> "There is no Stripe account behind this. The card box is for show. Everything
> after the button is real — the registration, the order, the claim code."

4. Click **Pay $799.00**.

You land on the confirmation page. **Point at the claim code** — six characters,
top of the ticket panel. Read it out; you will need it in a moment.

Below it, the confirmation now prints the app URL, the email and the password.
**Say that the account did not exist ten seconds ago** — the purchase created
it. That is the sentence Beat 4 pays off.

### Beat 3 · "The organizer sees it immediately" (90s)

Tab 3. **Reload.**

- **Paid 1**, where it said 0.
- Demo Attendee, Main Conference, $799.00, `paid`.

> "No integration, no nightly sync, no CSV. The website wrote to the database and
> the dashboard read from it. Whova charges for this and takes a percentage of
> every ticket."

Then go to **Attendees → Manage Attendees**. They are on the list, with the
ticket and "App: not yet" — because they have not signed in yet.

### Beat 4 · "And the attendee has an app" (2–3 min)

The phone. Sign in as `demo` / `123`.

**Sign in as the person you just registered**, not as `demo`: type the email
from the confirmation page and the password printed beside it. This is the
moment worth rehearsing — a ticket bought on a website ninety seconds ago is now
an account, a profile, and a badge.

Go to **Me → Badge** first: the claim code on screen is the same six characters
you read out in Beat 2.

Then show, in this order:

1. **Agenda** — the same 72 sessions. Star one; it syncs.
2. **Attendees** — the directory, 42 of 50 (the rest opted out of being listed,
   which is a privacy control the organizer does not get to override).
3. **Me → Badge** — the QR the check-in desk scans.
4. **Community** — posts and replies, threaded.

> "This is the whole Whova attendee experience. It is one codebase, it runs on
> iOS and Android, and nobody is paying per-attendee for it."

### Beat 5 · The close (60s)

Back to tab 3, and scroll the left-hand navigation.

> "One hundred and seventy-three screens, matched to Whova's own information
> architecture, all reading real data. What is left is capability, not layout."

---

## If something goes wrong

| Symptom | What it is | What to do |
| --- | --- | --- |
| Purchase button does nothing | The server action is cold-starting on Netlify | Wait five seconds; it is slow once, then fast |
| Orders screen still says Paid 0 | Browser cache | Hard reload — ⌘⇧R |
| Dashboard bounces back to login | Session cookie expired | Sign in again; the panel has the credentials |
| App says "email and password do not match" | The account is missing, or you typed a uid like `demo_004` instead of a name | Use `demo` / `123`, or re-run `npm run claims -- --confirm-live` |
| A dashboard page hangs, then 502s | A Netlify function timed out at 30s | Move on. Do not reload twice on stage |

**Never demo a page you have not opened once today.** The dashboard has 173
screens and only the ones on this sheet have been walked end to end.

---

## What is genuinely not built, if you are asked

Say these plainly. The one thing that will lose a room is claiming something
that then fails in front of it.

- **Push notifications.** The token plumbing exists; nothing sends yet, and it
  needs a development build — Expo Go cannot receive push at all.
- **Real payments.** No Stripe account. The code path is written and tested
  against fixtures, but it has never taken a live card.
- **Email.** No sending provider configured. Every receipt is logged as
  `skipped`, not failed.
- **Sign-in is email and password**, not the six-digit code the real product
  will use. That needs a Cloud Function, which needs the Blaze plan.
- **The dashboard's sign-in is one shared passphrase** — no SSO, no MFA. It is
  printed on its own login screen for this demo. That is fine while every
  attendee in the database is invented, and it is the first thing to change if
  a real attendee list is ever imported.
