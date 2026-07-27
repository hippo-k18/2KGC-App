# KGC App

Event app for the Knowledge Graph Conference — a self-hosted replacement for the
Whova agenda, networking and messaging that KGC currently embeds.

At this stage the UI is deliberately empty: `/` renders the word **KGC** and
nothing else. Everything underneath it — auth, data model, security rules, push —
is in place so features can be built one route at a time.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4, Geist via `next/font/google` |
| Auth | Firebase Auth — email link, no passwords |
| Database | Cloud Firestore |
| Files | Firebase Storage (avatars, slides, sponsor collateral) |
| Push | Firebase Cloud Messaging (web push) |
| Validation | Zod |
| Dates | date-fns + date-fns-tz (sessions are authored in ET) |

## Getting started

```bash
cp .env.example .env.local   # then fill in from the Firebase console
npm run dev                  # http://localhost:3000
```

Without `.env.local` the pages still render, but anything touching Firebase
will fail.

## How auth works

1. `/login` calls `sendLoginLink(email)` — Firebase emails a one-time link.
2. The link returns to `/login`; `completeLogin()` signs in and POSTs the ID
   token to `/api/auth/session`.
3. That route checks the address against the `registrations` collection — the
   imported ticket list. **Not on the list, no session.** It then creates the
   user profile on first sign-in and sets an httpOnly session cookie.
4. `src/proxy.ts` (Next 16's rename of Middleware) redirects cookie-less
   requests to `/login`.

`proxy.ts` only checks that a cookie *exists*. Real verification is
`getCurrentUser()` in `src/lib/auth/session.ts` plus `firestore.rules` — treat
those two as the security boundary, never the proxy.

## Layout

```
src/
  app/
    api/auth/session/   session cookie: POST to create, DELETE to clear
    layout.tsx          fonts, metadata, AuthProvider
    page.tsx            the blank KGC screen
  config/event.ts       event constants, public/gated route lists
  lib/
    auth/               email-link sign-in, React context, server session
    firebase/           client SDK, admin SDK, collection names, FCM
  types/models.ts       every Firestore document shape
  proxy.ts              optimistic route gating
firestore.rules         authoritative access control
firestore.indexes.json  composite indexes the planned queries need
storage.rules           upload limits for avatars and collateral
```

## Firebase setup

1. Create the project, then add a **Web app** and copy its config into
   `.env.local`.
2. Authentication → Sign-in method → enable **Email/Password**, and inside it
   enable **Email link (passwordless sign-in)**.
3. Firestore → create a database in production mode.
4. Cloud Messaging → generate a **Web Push certificate** and copy the key pair
   into `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
5. Project settings → Service accounts → generate a private key, and copy the
   three `FIREBASE_*` values into `.env.local`.
6. Fill the same public config into `public/firebase-messaging-sw.js` — service
   workers cannot read environment variables.
7. Deploy the rules: `npm run deploy:rules`.

Import the ticket list into `registrations`, keyed by lowercased email, before
anyone tries to sign in.

## Before launch

- `public/icons/` — add `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`;
  `manifest.webmanifest` already references them.
- Firestore rules have no test suite yet; `firebase emulators:start` plus
  `@firebase/rules-unit-testing` is the natural next step.
