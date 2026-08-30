# kgc-one-backend.mp4

2m25s, 1920×1080, 30fps, 19 MB, with sound. Recorded 29 August 2026.

```
open demo/out/kgc-one-backend.mp4
```

A copy is also at `~/Downloads/kgc-one-backend.mp4`.

## What's in it

| From | To | |
|---|---|---|
| 0:00 | 0:03 | Title — "One backend. Three surfaces." |
| 0:03 | 0:09 | **The caveat card** — Stripe and HubSpot, and what each one not being installed actually means |
| 0:09 | 0:12 | "One — buying a ticket" |
| 0:12 | 0:47 | The tickets page, the four tiers, the checkout form filled in, the payment, and the confirmation pass with its QR and claim code |
| 0:47 | 0:50 | "Two — using the ticket" |
| 0:50 | 1:31 | The app: signing in with the address that bought the ticket, home, agenda, people, and the badge |
| 1:31 | 1:34 | "Three — one price, one backend" |
| 1:34 | 2:16 | The public price, the dashboard, the order that was just placed, the price edit, and the public page showing the new figure |
| 2:16 | 2:25 | Close and credit |

## The claims it makes, and why each one holds

**Everything is the deployed product.** Not localhost, not the emulator. Act one
drives `kgc-2027-website.netlify.app`, act two `kgc-2027-app.netlify.app`, act
three `kgc-2027-dashboard.netlify.app` — all three against the live
`kgc-conference-app-and-website` Firestore project. The August cut in
`../../whova-rebuild/demo/` ran on three localhost servers and an emulator, which
could not have demonstrated the one thing this cut exists to demonstrate.

**The claim code on the badge is the code the website printed.** This run wrote
claim code **QKESVP**. It appears on the confirmation page at 0:44 and on the
phone at 1:28, because there is one `registrations` document and both surfaces
are reading it. Codes rotate on every run — the closing card is generated with
`CLAIM=… node cards.mjs` so it always names the code from that take.

**The price change is real and was not restored.** Main Conference moved from
**$799 to $699** on camera, and it is still $699 on the live site. Putting it
back would make the one claim a viewer can independently check the one thing
that does not check out.

**The caveats are pinned, not mentioned.** `caveat()` in `lib.mjs` re-applies a
fixed card after every navigation in acts one and three, so there is no frame of
the payment or the dashboard without it, and the same two facts get a full card
of their own at 0:03. A disclaimer that has faded out by the time somebody pauses
the video has not been made.

## What is not in it

The **check-in desk** — the dashboard scanning the badge from act two and writing
a `checkIns` document. It is built and it is the strongest single moment in the
product, but it needs a two-window shot (the phone beside the scan screen) rather
than the single-viewport recording used here.

## Rebuilding it

```bash
cd demo
npm install && npx playwright install chromium

# A rehearsal leaves a sale and a changed price behind. Start clean:
export GOOGLE_APPLICATION_CREDENTIALS=$PWD/../.secrets/service-account.json
node ../scripts/ops/reset-demo-sales.mjs

node act1-buy.mjs         # website + purchase  → raw/buy/*.webm, prints CLAIM
node act2-app.mjs         # the app             → raw/app/*.webm
node act3-dashboard.mjs   # dashboard + website → raw/dash/*.webm
node phone-frame.mjs      # the iPhone bezel    → cards/phone-frame.png
CLAIM=<from act1> node cards.mjs
./build.sh                # → out/kgc-one-backend.mp4
```

Order matters. Act two signs in as the account act one's purchase created, and
act three shows act one's order on the dashboard. Act three also needs Main
Conference to be back at $799, which `reset-demo-sales.mjs` does **not** do — set
`priceCents: 79900` on `ticketTypes/main-conference` first, or the act records a
price changing from $699 to $699.

Requires `ffmpeg` (`brew install ffmpeg`) and `python3`, which `music.sh` uses.

## How it is recorded

**No screen capture, and nothing drives the real cursor.** Playwright's
`recordVideo` captures the page itself in a headless browser, so the recording is
deterministic, repeatable on any machine, and does not lock up the desktop for
three minutes. `lib.mjs` injects everything that makes it read as a person: an
SVG cursor that eases between points, a two-ring press animation, paced scrolling
at a reading speed, typing at human cadence, the caption cards and the caveat.
None of it touches the app under test.

`build.sh` is the whole edit — normalise to 1080p/30fps, register the portrait
phone capture into a drawn iPhone bezel, hold each title card, join ten segments
with 0.6s crossfades, and lay a synthesised piano bed under it. It is diffable
and it produces the same file every run, which a GUI editor's binary project file
would not.

Two things that cost time here and are now fixed in place, both in `build.sh`:
`console.log` of a number wraps it in ANSI colour when `FORCE_COLOR` is set, and
a coloured scale factor substituted into a later `node -e` fails as a syntax
error nowhere near its cause; and `read` returns 1 at EOF without a trailing
newline, which under `set -e` ends the script silently at exit 1.

## Why the two sites were redeployed first

Both Netlify sites were behind the repository when this was recorded — the
website by an unshipped redesign of the tickets and confirmation pages, the
dashboard by a commit from the previous day. Recording a demo of production means
production has to be the thing you built. `../DEPLOY-NETLIFY.md` is the procedure;
the `.env.local`-aside step in it is not optional.
