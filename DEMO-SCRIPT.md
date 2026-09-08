# KGC 2027 — the demo run sheet

Written 2026-09-07. This is the sheet to follow on the day: what to open, what
to click, and what to say. It supersedes `PRESENT.md`, which was written for the
removed demo mode and no longer works.

**Everything runs locally.** That is not a compromise, it is forced: the button
that completes a purchase without a card is compiled out of any production
build (`apps/web/src/lib/demo-checkout.ts`), so the deployed Netlify sites
cannot show a sale. All three surfaces read the **live** Firebase project
`kgc-conference-app-and-website`, so a change on one appears on the others
while the room watches — which is the whole point.

---

## Before you stand up

### 1. Three servers, three terminals

```bash
cd ~/Documents/Claude/Projects/KGC/2KGC-App

# Terminal 1 — public website + the sign-in API      → localhost:3200
cd apps/web && npm run dev

# Terminal 2 — organizer dashboard                   → localhost:3100
cd apps/organizer && npm run dev

# Terminal 3 — attendee app                          → localhost:8081
npm run web
```

⚠️ **Restart `apps/web` if it was already running.** Its `.env.local` changed
(`ISSUE_TEMPORARY_PASSWORDS=0`, `EMAIL_FROM`), and Next reads those at boot.

⚠️ **Do not run `npm run build` in either website while its dev server is up.**
In `apps/organizer` it fails outright; in `apps/web` it *silently* leaves every
page unstyled and the dev server keeps answering 200. You find out from a
screenshot. See AGENTS.md.

### 2. Reset the sales from any rehearsal

Buying twice with the same address updates one order rather than creating a
second, so the counter will not move on your second run and the orders screen
will already read "Paid 1" before you have bought anything.

```bash
cd ~/Documents/Claude/Projects/KGC/2KGC-App
export GOOGLE_APPLICATION_CREDENTIALS="$PWD/.secrets/service-account.json"

node scripts/ops/reset-demo-sales.mjs --dry-run   # see what it would remove
node scripts/ops/reset-demo-sales.mjs             # actually remove it
```

It only touches orders marked `channel: 'demo'`, so it cannot delete a real
Stripe order. It does **not** put a changed ticket price back — if you did the
price edit in Act 4 during a rehearsal, set it back by hand first.

### 3. Sign into the dashboard now, not on stage

| | |
| --- | --- |
| URL | <http://localhost:3100/login> |
| Email | `demo@knowledgegraph.tech` |
| Passphrase | `kgc2027` |

Nothing prints these on screen any more. ⚠️ It is a seven-character shared
secret in front of the Admin SDK — rotate it before the event runs on real
attendees.

### 4. Pick the buyer's email address

Act 2 signs into the app as the person who bought in Act 1, so **use an address
you can act on**. Two ways in, and you should know which you are using before
you start — see *Getting the sign-in code* below.

### 5. Tabs, in this order

| Tab | URL |
| --- | --- |
| 1 — Website | <http://localhost:3200> |
| 2 — Tickets | <http://localhost:3200/tickets> |
| 3 — Dashboard | <http://localhost:3100> |
| 4 — App | <http://localhost:8081> |

---

## Act 1 — Buying a ticket (about 4 minutes)

**Say:** one backend, three surfaces. This is the public site.

1. **Tab 1, the homepage.** Scroll. Agenda, speakers, sponsors — all reading the
   same Firestore the app reads, not a copy.
2. **Tab 2, `/tickets`.** The tiers, their prices and what each includes. Prices
   come from `ticketTypes` in Firestore and there is no hard-coded fallback:
   an empty collection throws rather than charging a stale price.
3. **Expand a tier and fill the checkout form.** Use the address you chose in
   step 4. Multiple seats are one purchase with real quantities, not three
   separate sales — worth showing if you have time.
4. **Press "Skip payment and register (demo)".**

   **Say:** this is the localhost rehearsal button. It writes a real
   registration, a real order, an app account, entitlements, the sold count and
   the confirmation email — everything a paid purchase does, minus the card. The
   order is stamped `demo` so it can never be mistaken for money that arrived.
   The real button beside it hands you to Stripe's hosted Checkout.

5. **The confirmation page.** The claim code and the QR. Read the claim code out
   — it appears again on the phone in Act 2, because there is one
   `registrations` document and both surfaces are reading it.

---

## Act 2 — Opening the app (about 6 minutes)

**Say:** same database, different surface. This is what the attendee gets.

1. **Tab 4.** The login screen offers two named choices: **Sign in** and
   **Create account**.

   **Say:** buying a ticket does not hand you a password. First time in, you
   prove you can read the mailbox you bought with.

2. **Press Create account**, enter the buyer's address, press **Email me a
   code**.
3. **Get the code** — see the box below — and type it.
4. **Choose a password.** The app refuses every other route until you have. From
   now on that attendee uses **Sign in**.
5. **Home.** Now/next, announcements.
6. **Agenda.** Day tabs, track filter, search. Open a session, add it to your
   schedule.
7. **People.** Attendees, speakers, sponsors, exhibitors. Open a speaker.
8. **Community.** Post something, reply, react.
9. **Messages** — the header icon with the unread badge, deliberately not a tab.
10. **Me → My schedule**, then **Me → Badge**. The QR, and the claim code from
    Act 1. Leave this open; Act 5 scans it.

### Getting the sign-in code

Two routes. Know which you are using **before** you are standing up.

- **Read it from the browser** — reliable, no email involved:

  ```
  http://localhost:3200/api/auth/dev-code?email=THE-BUYERS-ADDRESS
  ```

  Localhost only. The endpoint 404s on any deployed build, by compile-time
  constant rather than by configuration.

- **From a real inbox** — only works for the address that owns the Resend
  account, because mail now goes out as `onboarding@resend.dev`.

  ⚠️ **Sending from `knowledgegraph.tech` does not work at all.** Resend answers
  `403 The knowledgegraph.tech domain is not verified` and every receipt and
  sign-in code is logged as `failed`. Verifying the domain at
  <https://resend.com/domains> is the real fix, and it is an owner action.

**Recommendation: use the browser route on stage.** Waiting on an inbox in front
of an audience is the one beat here that can stall, and it buys nothing a viewer
can see.

---

## Act 3 — Editing the content (about 5 minutes)

**Say:** now the other side. This is what the organizer runs, and it is a
one-to-one rebuild of Whova's dashboard — the navigation tree came out of
Whova's own shipped bundle.

1. **Content → Agenda Center → Session Manager.** Open the session you added to
   your schedule in Act 2. Change its title or its room. Save.
2. **Switch to tab 4 and reopen that session.** It has changed. One database.
3. **Track Manager** — the tracks that drive the agenda's filter chips.
4. **Conflict Check** — a speaker double-booked, or two sessions in one room.
5. **Speaker Center → Speaker Manager.** Open a speaker, change the bio.
6. **Exhibitor Center → Exhibitor Manager.** Upload a logo — file upload works
   end to end as of 2026-09-01.
7. **Sponsor Center → Sponsor Manager**, and Sponsor Tiering if there is time.

---

## Act 4 — The money (about 5 minutes)

**Say:** one price, one backend.

1. **Tab 2** — note the public price of Main Conference out loud.
2. **Tickets → Ticket Setup.** Change that price. Save.
3. **Back to tab 2, reload.** The new figure is on the public site.

   ⚠️ Change it back afterwards, or the next rehearsal records a price moving
   from the new figure to the same figure. `reset-demo-sales.mjs` does not do
   this for you.

4. **Tickets → Orders & Transactions → Attendee Orders.** The sale from Act 1 is
   there, marked paid, with the buyer's name. Export the CSV.
5. **Refund it.** Note that a *partial* refund leaves the ticket valid — a
   deliberate decision, not an oversight.
6. **Ticket Setup → Discount Codes.** These are Stripe promotion codes read
   live, not mirrored into Firestore.
7. **Create Group Tickets.** An invoice is **one** order with several line
   items, not one order per seat.

---

## Act 5 — Attendees and check-in (about 4 minutes)

This is the strongest moment in the product. It needs the phone (or tab 4) next
to the dashboard so the room sees both at once.

1. **Attendees → Attendee List.** Everyone who holds a ticket, including the
   person from Act 1.
2. **Import attendees from CSV** — the generic importer.
3. **Cohorts**, if you have time.
4. **Check-in.** Open the check-in desk, scan the badge QR from Act 2.
5. **Watch the phone.** The badge reflects the check-in live.

   **Say:** a second scan is not an error to handle, it is a `create` that fails
   with `already-exists` — the idempotency is the mechanism, so there is no
   read-then-write race to lose. The QR carries a rotating secret and nothing
   else: no email, no user id, nothing that turns a photographed badge into a
   harvested address.

---

## Act 6 — Engagement and marketing (about 4 minutes)

Move quickly here; it is breadth, not depth.

1. **Engagement → Announcements.** Send one, watch it land on the app's Home.
2. **Surveys** — build one, then open it under Home → Surveys in the app.
3. **Session Q&A Manager** and **live polls**. ⚠️ See the caveats below before
   you promise anything about the counts.
4. **Marketing → Campaigns** and tracked links — counted by the `/r/{code}`
   redirect itself, so none of it waits on Cloud Functions.
5. **Marketing → Web Pages.**
6. **The Publish tab** — the pre-flight before an event goes live.
7. **Tools → Exports.**

---

## What is inert, and what to say if asked

Say these plainly. Every one of them is a configuration or an account, not a
missing feature.

| | |
| --- | --- |
| **Email does not arrive** | Resend refuses to send from an unverified domain. The templates, the logging and the failure record all work; the domain needs verifying. |
| **Poll tallies and Q&A counts** | Server-side counters need the `functions/` deploy, which is blocked on one IAM grant only the project owner can give. The app counts client-side as a fallback, so the screens are not empty. |
| **Push notifications** | The dashboard can send. The app cannot receive: that needs a development build rather than Expo Go. |
| **Real card payments** | A Stripe **test** key is configured, so hosted Checkout works. `STRIPE_WEBHOOK_SECRET` is missing, so a real Checkout does not finish fulfilment — which is why the demo uses the rehearsal button. |
| **Badge printing** | Modelled only. |
| **Offline** | Does not work. The Firebase JS SDK has no disk persistence on React Native. |

---

## If something goes wrong

- **A screen is blank.** Almost always a Firestore read failing, and the hooks
  render an empty state on error rather than shouting. Check the dev server's
  terminal.
- **"Quota exceeded" everywhere.** The project has hit the free daily read cap
  before, and nothing announces it — every surface just degrades into looking
  unfinished. It resets at midnight Pacific.
- **The code says it expired.** Codes last 10 minutes and are single-use, and
  five wrong guesses kills the code even with time left on it. Send another.
- **Sign-in says the address has no ticket.** The code was right; the address
  holds no active registration. Buy under that address, or use the one you did.
