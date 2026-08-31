# File upload — how it works, and the one step only the owner can do

**Written 2026-08-30, alongside BUILD-PLAN task 0.8.**

Before this, nothing in the project put a file anywhere: `storage.rules` existed
with no writer, every image was a URL somebody typed or an importer copied, and
`apps/organizer/src/lib/images.ts` counted the result. That module's `uploaded`
figure was derived rather than hard-coded precisely so it would correct itself
the day this landed, and it now can.

---

## 1. What was built

| | |
|---|---|
| `apps/organizer/src/lib/uploads.ts` | `uploadImage()` / `removeImage()`. Server-side, Admin SDK. The only writer. |
| `apps/organizer/src/lib/upload-limits.ts` | The size and type limits, shared with the browser. No `server-only`, on purpose. |
| `apps/organizer/src/components/image-field.tsx` | The reusable picker: preview, in-browser downscale, remove. |
| `storage.rules` | Documented; `exhibitors/{id}/{file}` added. No write rule was loosened. |
| Exhibitor Manager | The one screen wired end to end, to prove it. |

### The shape of a stored object

```
exhibitors/{exhibitorId}/logo.png
sponsors/{sponsorId}/logo.png          ← same convention, not yet wired
speakers/{speakerId}/headshot.jpg      ← same convention, not yet wired
```

Deterministic, so re-uploading replaces rather than accumulates, and so a
listing of the bucket reads as the data model instead of as a pile of hashes.

### The URL that comes back

```
https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?alt=media&token={uuid}
```

Not `makePublic()` (a bucket with uniform bucket-level access — the default for
new buckets — refuses per-object ACLs) and not a signed URL (they expire, and
this string is written onto a Firestore document that outlives any sensible
expiry). The download token is the same mechanism the client SDK's
`getDownloadURL()` uses, and the host it produces is the one two other places in
this codebase already require:

- `firestore.rules`' `isFirebaseStorageUrl()` — a regex anchored on
  `https://firebasestorage.googleapis.com/`
- `functions/src/triggers/mirror-directory.ts` — the same check in TypeScript

A URL built any other way would be **silently dropped** from the attendee
directory rather than rejected loudly. That is why this is not a free choice.

**Revoking one image means clearing its token, not editing `storage.rules`.**
The token URL does not evaluate the rules at all — which is exactly what lets a
logo render for an anonymous visitor on the public website.

### Why organizer uploads do not use the browser SDK

`storage.rules` says `allow write: if false` on every organizer-owned prefix, and
that stays true. The dashboard writes with the Admin SDK, which bypasses rules —
the same posture as every Firestore write it makes. Loosening a rule to let the
browser upload would create a second, weaker authority over the same bytes,
gated on a Firebase Auth identity the dashboard does not even mint (it signs in
with an email and a passphrase).

Attendee avatars are the opposite case and still unbuilt: those *are* a browser
upload, under `avatars/{uid}/`, which the rules already permit. They also need
`expo-image-picker`, which is not in the Expo Go SDK 54 bundle — so that half
waits on a development build, the same prerequisite as push.

### The image-processing decision: resize in the browser

Three options were on the table (audit F §3.2.4). This takes the cheapest.

| Option | Cost | Verdict |
|---|---|---|
| `<canvas>` resize before upload | none | **chosen** — and it produces the preview for free |
| Firebase "Resize Images" extension | a 13th Cloud Function, a 13th image in Artifact Registry — the one thing here that bills *at idle* | no |
| `sharp` in the Next server | a native binary, ~30 MB, a real risk on a serverless host | no |

A second reason settles it independently of cost: **a Next 15 Server Action body
is capped at 1 MB**, and raising that cap raises it for every action in the app,
including the ones that take a CSV. A 4 MB photograph is otherwise a 413 with no
useful message. So `MAX_UPLOAD_BYTES` is 900 KB, deliberately under the
transport limit rather than at `storage.rules`' 5 MB.

The picker leaves two kinds of file alone: a GIF (a canvas destroys the
animation) and an image already small and already within `maxEdge` (re-encoding
a crisp PNG logo to lossy WebP to save 4 KB is a downgrade). Everything else is
scaled to a 1024px longest edge and re-encoded as WebP, which keeps transparency.

The server does not re-encode. It does the parts a client cannot be trusted
with: sniffing the real magic bytes (`File.type` is the browser's guess from the
extension and is trivially spoofed), enforcing the cap, and choosing the path.
**SVG is refused** — it is a script-bearing document that renders as a picture,
and Firebase serves an object back with the content type it was stored under.

---

## 2. What the owner still has to do — the bucket does not exist

⚠️ **Verified 2026-08-30, and still true:** the default Storage bucket has never
been provisioned. Both candidate names return 404 from the anonymous GCS API:

```
GET https://storage.googleapis.com/storage/v1/b/kgc-conference-app-and-website.firebasestorage.app
  → 404 "The specified bucket does not exist."
GET https://storage.googleapis.com/storage/v1/b/kgc-conference-app-and-website.appspot.com
  → 404 "The specified bucket does not exist."
```

The `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` value in `app/.env.local` is the SDK
config string the Firebase console hands out. It is not evidence that anything
was provisioned.

`uploadImage()` therefore turns the resulting bare 404 into an error naming both
steps below, rather than letting `@google-cloud/storage` report it.

### Step 1 — create the bucket (console, one time, **owner only**)

Firebase console → **Build → Storage → Get started**.

- **Choose `us-central1`.** It matches the `nam5` Firestore multi-region, so the
  dashboard's Admin SDK reads no cross-region, and it is free-tier eligible.
- **The location is permanent.** It cannot be changed afterwards without
  creating a second bucket, and a second bucket bills from the first byte.
- Start in production mode. The rules from step 2 replace whatever it offers.

This is deliberately **not** scripted and was **not** run by an agent: it creates
a cloud resource, and the standing constraint on this project is that nothing
spends money without the owner doing it deliberately.

> Note on the Blaze question. Since October 2024 the default bucket for new
> Firebase projects lives on `firebasestorage.app`, and at announcement time
> provisioning it required Blaze. That policy has moved at least once since. Do
> not read `AGENTS.md`'s "Storage works on Spark" as "a bucket could have been
> had on Spark" — on *this* project there is none, and the console will say
> which plan it wants.

### Step 2 — publish `storage.rules`

**No new script is needed.** `scripts/ops/deploy-rules.mjs:14` already takes the
source path and the release name on argv. `ROADMAP.md:313` says it "needs a
second release target"; it needs a second *argument*.

```bash
GOOGLE_APPLICATION_CREDENTIALS=.secrets/service-account.json \
node scripts/ops/deploy-rules.mjs \
  storage.rules \
  firebase.storage/kgc-conference-app-and-website.firebasestorage.app
```

Run it only after step 1 — a release cannot point at a bucket that does not
exist. Note the two identities the script uses: the service account uploads the
ruleset, the signed-in human publishes the release.

### Step 3 — tell the dashboard, only if the name differs

`uploads.ts` defaults to `{GCLOUD_PROJECT}.firebasestorage.app`, which is
correct for this project. If the console hands out a different name (an older
project gets `…appspot.com`), set it on the dashboard — locally in
`apps/organizer/.env.local`, and in the Netlify environment for the deployed
site:

```
FIREBASE_STORAGE_BUCKET=kgc-conference-app-and-website.firebasestorage.app
```

⚠️ Point this at the **default** bucket only. The no-cost tier applies to that
one bucket; any bucket you create by hand bills from the first byte.

---

## 3. Testing it without a bucket

`firebase.json` already runs a Storage emulator on port 9199. The Admin SDK
honours `FIREBASE_STORAGE_EMULATOR_HOST`, so the whole path can be exercised
locally with no cloud resource at all:

```bash
node_modules/.bin/firebase emulators:start --only firestore,storage \
  --project kgc-conference-app-and-website
```

and, for the dashboard:

```
FIRESTORE_EMULATOR_HOST=localhost:8080
FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199
```

`uploadImage()` refuses outright if Firestore is on the emulator and Storage is
not — otherwise the upload silently addresses the live bucket with no
credentials and fails several layers down.

It also refuses in **demo mode** (no emulator, no credentials), where `db()`
serves an in-memory fixture and there is no bucket behind anything. Saying so is
the point: a dashboard that reports a save that did not happen is the failure
mode this project keeps rediscovering.

---

## 4. Cost — does any of this bill?

**Not at this scale, on the default bucket.** Firebase's Cloud Storage no-cost
tier is roughly 5 GB stored, 1 GB/day download, 20k upload operations/day and
50k download operations/day. Verify current figures at
<https://firebase.google.com/pricing> before relying on them.

A realistic ceiling for KGC: ~18 sponsor logos, a few dozen exhibitor logos, 45
speaker headshots and a few hundred attendee avatars. At the picker's ~100 KB
output that is well under **100 MB** — about 2% of the free tier. Even at the
5 MB rules cap for avatars the worst case is ~2.5 GB, still inside it.

Three ways it could nonetheless bill, all avoidable:

1. **A second bucket.** The no-cost tier is the default bucket only. Never
   create another one; never point `FIREBASE_STORAGE_BUCKET` at a hand-made one.
2. **Video.** 1 GB/day egress is generous for logos and nothing for conference
   recordings. `content/documents-and-videos/documents` is link-based today —
   keep it that way. This is the single fastest route to a real bill in the
   whole infrastructure audit.
3. **The "Resize Images" extension.** It is a Cloud Function, and its container
   image sits in Artifact Registry, which bills at idle above 0.5 GB. Declined
   above, for exactly this reason.

Nothing in this task created a billable resource. Step 1 above is the first
thing that does, and it is left to the owner.

---

## 5. What is now unblocked, and what is not

`uploadImage()` is generic. Wiring another screen is a form field and four lines
in a server action — the exhibitor logo is the worked example:
`ImageField` in the form, `uploadImage(file, { folder, name })` in the action,
`FieldValue.delete()` when the hidden `…Removed` field says so.

The candidates, in the order the audits rank them: sponsor logos (which is also
what retires the 18 hotlinked CloudFront URLs and the hand-maintained whitelist
in `apps/web/src/lib/data.ts:230`), speaker headshots, session slides, event
branding and banner artwork, then the three photo screens.

Two things this does **not** unblock:

- **Attendee avatars.** A browser upload from the Expo app, needing
  `expo-image-picker` and therefore a development build.
- **An exhibitor surface outside the dashboard.** Neither the website nor the
  app reads `exhibitors`, so an exhibitor logo is currently visible on exactly
  one screen. That is a broken hop the audits already record (C, S-K/S-L), not
  something upload introduced.
