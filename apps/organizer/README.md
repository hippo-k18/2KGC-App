# `@kgc/organizer` — the organizer dashboard

A one-to-one rebuild of **Whova's EMS** (their organizer dashboard) on KGC's own
Firestore. Same navigation tree, same chrome, same names, same nesting — an
organizer who has run an event on Whova should be able to find things here by
muscle memory.

Runs on **port 3100**, leaving 3200 for `apps/web` so the website and the
dashboard can run side by side. It is not a
member of the root npm workspace, so you install and run each from its own
directory.

```bash
cd apps/organizer
npm install
export FIRESTORE_EMULATOR_HOST=localhost:8080          # safe, local
export CONSOLE_ALLOWLIST=you@example.com
export CONSOLE_SESSION_SECRET=$(openssl rand -hex 32)
npm run dev                                            # → http://localhost:3100
```

You need the Firestore emulator running with seeded data:

```bash
cd ../..            # repo root
npm run dev:emulators
npm run seed
```

The emulator needs Java. `brew install openjdk` and put
`/opt/homebrew/opt/openjdk/bin` on your `PATH`.

## Where the design came from

Not from screenshots. `https://whova.com/xems/` is a public React SPA, and its
webpack chunks are readable without an account:

- **`.../webpack/index.*.css`** and three sibling chunks — the production
  stylesheet. Every colour, dimension and font stack in `src/app/globals.css`
  was read out of it. `#2180b2` for the tab strip, `#ecf0f5` for the page
  background, `9.75px` for the sidebar bullets, `1060px` for the page box, the
  `.whova-table` cell width ladder — all theirs, verbatim.
- **`.../webpack/index.*.xems-webpack.bundle.js`** — the navigation tree as
  data: an array of `{name, title, widthClass, children}` that the sidebar and
  the tab bar both render. `src/lib/nav.ts` is a transcription of it, 215 paths
  deep, with Whova's internal feature keys kept in the `name` field.

That matters because `whova-rebuild/research/02-organizer-backend.md` §1
reconstructed the same IA from ~900 help-centre article paths and got the
nesting right but the **sequence wrong** — the live product puts Virtual &
Hybrid second and Tickets fifth, and has a `Pay` tab the research folded into
`Publish`. **Where the two disagree, `nav.ts` wins.**

Two things Whova's own CSS revealed that are worth knowing before you edit
anything:

1. The chrome is **AdminLTE 2** underneath (`.content-wrapper`,
   `.treeview-menu`, `#3c8dbc` on the primary button). That is why the layout is
   a fixed-width centred box in 2026 and why the palette contains two unrelated
   blues.
2. The newer screens are a **separate in-house design system** on top
   (`.whova-table`, `.whova-btn-main`, `.whova-form-*`). Whova is mid-migration,
   so both vocabularies are live at once and a real page mixes them.
   `globals.css` keeps both, for the same reason.

## What is real

Nine screens read and write real Firestore documents through the Admin SDK:

| Whova path | What it does here |
|---|---|
| Content → Basics | Read-only. The event's identity is compile-time constants in `@kgc/shared`. |
| Content → Agenda Center → Session Manager | Whova's hour-bucket layout, day tabs, search; edit one session. |
| Content → Agenda Center → Track Manager | Read-only, with cross-listing counts. |
| Content → Speaker Center → Speaker Manager | Completeness filters — the thing this list is actually for. |
| Content → Sponsor Center → Sponsor Manager | Tier group bars, Whova's layout, read-only. |
| Engagement → Announcements | **Writes.** One document; the app's home screen picks it up in ~1s. Push sends via the Admin SDK — no Cloud Function, so no Blaze. |
| Attendees → Manage Attendees → Attendees | Search, role filter, the registrations-vs-profiles gap. |
| Attendees → Check-in & Checkout → Check-in | **Writes.** Badge QR scan → idempotent check-in. |
| Tools → Report | Ours: live numbers, audit trail, error ring. |

The other **206 paths resolve rather than 404**. A group renders an index of its
children; a leaf renders what Whova does there, what this repo would need, and
roughly how big that is (`src/lib/gaps.ts`). That is deliberate: an empty state
implying "this half-works" is worse than one that names the gap.

## Security

⚠️ **Do not deploy this.** `src/lib/auth.ts` is an email allowlist with no
password, no SSO and no MFA, and the Admin SDK behind it **bypasses
`firestore.rules` entirely**. Knowing an allowlisted address is currently
sufficient for full write access to the event. That is acceptable for a tool
bound to localhost on one laptop and for nothing else. Google SSO with enforced
MFA (DECISIONS.md #5) lands before this is reachable over a network.

No Firebase credential of any kind may reach the browser. Every read is a server
component and every write is a server action; `server-only` in `src/lib/*` turns
a mistaken client import into a build error rather than a leak.

## Conventions

- Colours come from the custom properties at the top of `globals.css`. Never
  hard-code a hex in a component.
- Whova's strings are Whova's. Do not rename a nav node to something clearer or
  flatten a level because it looks redundant — the point is that an organizer
  finds things where they expect them.
- Deviate only where there is a reason, and say so **on the page**. The three
  current deviations are: the check-in desk's 40px verdict, `Tools → Report`
  replacing a 10-day PDF, and the absence of scheduled announcements.

## Push, and why it does not need the Blaze plan

`src/lib/push.ts` sends Firebase Cloud Messaging directly with the Admin SDK,
from this server. There is no Cloud Function involved, which matters because
**Blaze is required to deploy a Cloud Function and for nothing else in this
project** — unconditionally so since February 2026. FCM's send API is part of
`firebase-admin`, and this dashboard is already a trusted Node process holding
credentials, so the free plan is no obstacle.

Two sends:

- `announcementPush()` — one topic send to `event-{EVENT_ID}-announcements`,
  never a per-device fan-out. The per-user `notificationPrefs.announcements`
  switch is honoured at *subscribe* time, so it costs nothing at send time.
- `roomChangePush()` — targeted, not a topic. A collection-group query over
  `savedSessions` filtered on `remind` and `sessionId` (the composite index for
  it is already in `firestore.indexes.json`), then each user's `fcmTokens`,
  minus anyone with `sessionReminders: false`, sent in chunks of 500.

**What is verified and what is not.** The targeting half runs against the
emulator and is correct — a seeded fixture of 12 users returns 8 saved, 1 opted
out, 10 devices, which is what the fixture describes. The FCM call itself has
never reached Google: `canSend()` returns false whenever
`FIRESTORE_EMULATOR_HOST` is set or credentials are absent, and every function
then returns `wired: false` with the audience it *would* have reached. Finishing
it needs service-account credentials and a development build of the app, because
Expo Go cannot receive push.

The refusal is deliberate. A push path that silently no-ops while reporting
success is the defect class `AGENTS.md` catalogues fourteen instances of; one
that says "10 devices, not sent, pointed at the emulator" is useful on the way
to being finished.
