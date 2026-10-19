# Working on UI issues in this repo

## Where things are

- Organizer dashboard: `apps/organizer` (Next.js). A close replica of Whova's EMS.
- Public website: `apps/web` (Next.js).
- Attendee app: `app` (Expo, React Native, also builds for web).
- Shared: `packages/shared`, `scripts/src/lib`.

Branch `audit-fixes-2026-09-19`, open as PR 5 against `organizer-dashboard`.

## The three local servers

All point at a seeded Firestore emulator on 8080, so writing through them is safe.

| | URL | Sign in |
|---|---|---|
| Dashboard | http://localhost:3100 | `demo@knowledgegraph.tech`, passphrase in `apps/organizer/.env.local` |
| Website | http://localhost:3200 | none |
| Attendee app | http://localhost:8081 | `rune.petrova@example.test` / `kgc2027demo` |

If they are down, from the repo root, with `PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/openjdk@21/bin:$PATH`:

    npx firebase emulators:start --only firestore,auth --project kgc-conference-app-and-website &
    FIRESTORE_EMULATOR_HOST=localhost:8080 npm run seed
    cd apps/organizer && FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 npm run dev &
    cd apps/web       && FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 npm run dev &
    cd app            && EXPO_PUBLIC_USE_EMULATOR=1 npx expo start --web --port 8081 &

The emulator has run out of Java heap under load. Start it with `JAVA_TOOL_OPTIONS=-Xmx2g` if it dies.

## Seeing the pages

    docs/audit-2026-09-19/shots.sh <dash|web|app> <outDir> <width> <path>...

Writes a full-page PNG and a metrics JSON per run. Read the PNG. One invocation
at a time, at most about 15 paths, and set `SHOT_TAG` if two runs share a folder.
Route lists: `nav.ts`'s `allPaths()` for the dashboard's 215, and the website's
own `app/` tree.

`horizontalScroll` in the metrics is the first thing to grep for.

For the attendee app and for anything that needs a form filled, drive it with
Playwright directly. `/tmp/kgc-shots` has it installed after the first run.

## Rules that are not negotiable

- **The dashboard's desktop look does not move.** It is a replica measured
  against Whova's own shipped CSS. Keep the nav tree, tab names, screen titles
  and everything at 1024px and wider. Phone fixes go inside
  `@media (max-width: 767px)`.
- **Reuse what is there.** `(dash)/ui.tsx` (including `Table`'s `stackSm`),
  `(dash)/form.tsx`, the existing CSS classes.
- **Copy a user reads**: plain and short. No em dashes in prose, no filler
  words, nothing naming code, environment variables, collections, file paths or
  Whova. The single em dash used as an empty-cell marker in a table stays.
- **Never touch the live project.** Do not unset `FIRESTORE_EMULATOR_HOST`, do
  not run anything in `scripts/ops`, do not deploy.
- **Never run `tests/commerce`, `tests/denormalise` or `tests/attendance`
  against the emulator on 8080.** They delete the seeded data the servers are
  showing. Start your own emulator on other ports.

## What this project has learned the hard way

- **Check the running build, not the issue list.** `ui-issues.md` and
  `fresh/*.json` go stale within a round. Most of what one list called open had
  already been fixed. Open the page first.
- **`npm ci`, never `npm install`.** A plain install rewrote
  `apps/organizer/package.json`, pinning TypeScript two minor versions below
  what the project declares, and the build then failed on a type error that did
  not exist locally.
- **Fix the cause once.** Three separate issues asked for stacked tables; the
  answer was one default in `Table`, not three screens patched.
- **Mutation-check every test.** Undo the fix and confirm the test fails. Two
  security fixes here shipped green over an open hole because the test could not
  fail.
- **A custom property that was never declared is silent.** `var(--link)` with no
  declaration inherits the text colour, which drew a sales chart's bars fully
  transparent and rendered row actions as body text.
- **`curl` does not run JavaScript.** A badge injected after load is invisible
  to it. Use a browser.

## Verifying

    npx tsc --noEmit            # in apps/organizer, apps/web and app
    npm test                    # repo root
    FIRESTORE_EMULATOR_HOST=localhost:8080 npx vitest run tests/rules

Then look at what you changed at 390 and at 1280, and confirm no sideways scroll.

## History

`round1-review.md` through `round7.md` are the review and verification reports,
newest last. `results/gap-map.json` maps what an organizer needs to what exists.
`FIX-PLAN.md` has the waves and the owner actions still outstanding.
