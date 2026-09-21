# Adversarial verification, reply rule
All checks green. Report follows.

## 1. Every read path a non-author, non-organizer ticket holder can try

Throwaway probe run against the emulator in isolated project ids (`kgc-probe-r3-<pid>`, `kgc-probe-r3b-<pid>`, `kgc-probe-r3old-<pid>`), then deleted. Fixture: `communityPosts/p1/replies` holding `rVisible` (`status: 'visible'`), `rHidden` (`status: 'hidden'`, body `DOXXING TEXT`), `rNoStatus` (no `status` field), plus `rHidden2` under a second post for the collection-group probe.

| who | read path | result |
|---|---|---|
| B | `getDocs`, no filter | denied |
| B | `getDocs where eventId == 'kgc-2027'` | denied |
| B | `getDocs where authorId == 'authorA'` | denied |
| B | `getDocs where createdAt >= 2026-01-01` (range) | denied |
| B | `getDocs orderBy createdAt`, no filter | denied |
| B | `getDocs orderBy status`, no filter | denied |
| B | `getDocs orderBy status desc, limit 1` | denied |
| B | `getDocs where status == 'hidden'` | denied |
| B | `getDocs where status in ['visible','hidden']` | denied |
| B | `getDocs where status != 'visible'` | denied |
| B | `getDocs where status not-in ['visible']` | denied |
| B | `getDocs where status >= 'a'` (range) | denied |
| B | `getDocs or(status=='visible', status=='hidden')` | denied |
| B | `getDocs where documentId() == 'rHidden'` | denied |
| B | `getDocs and(status=='visible', eventId=='kgc-2027')` | allowed → `[rVisible]` |
| B | `getDocs where status in ['visible']` (single-element `in`) | allowed → visible only |
| B | `getDocs where status == 'visible'` (the app's query) | allowed → `[rVisible]` |
| B | `getDocs where status=='visible' && authorId==A` | allowed → `[rVisible]` |
| B | `getCountFromServer`, no filter | denied |
| B | `getCountFromServer where eventId ==` | denied |
| B | `getCountFromServer where authorId ==` | denied |
| B | `getCountFromServer where status == 'hidden'` | denied |
| B | `getCountFromServer or(visible, hidden)` | denied |
| B | `getCountFromServer where status == 'visible'` (the app's count) | allowed → 1 |
| B | direct `get rHidden` | denied |
| B | direct `get rVisible` | allowed → `OK TEXT` |
| B | direct `get rNoStatus` (legacy) | allowed → `LEGACY TEXT` |
| B | direct `get` a non-existent id | allowed → missing |
| B | `collectionGroup('replies')`, no filter | denied, "No matching allow statements" |
| B | `collectionGroup('replies') where status == 'visible'` | denied, same |
| B | `collectionGroup('replies') where status == 'hidden'` | denied, same |
| B | `collectionGroup('replies')` count, no filter | denied |
| anon | `getDocs` no filter / `get rHidden` | denied / denied |
| signed in, no ticket | `where status=='visible'` / `get rHidden` | denied / denied |
| A (author) | direct `get` own `rHidden` | allowed → `DOXXING TEXT` (intended) |
| A (author) | `getDocs where authorId == self` | denied (own hidden not reachable by query) |
| A (author) | `where status=='visible'` + `orderBy` + count | allowed, visible only |
| ORG | `getDocs`, no filter | allowed → all three |
| ORG | `getCountFromServer`, no filter | allowed → 3 |
| ORG | `where status == 'hidden'` (moderation queue) | allowed → `[rHidden]` |
| ORG | direct `get rHidden` | allowed |

**Verdict: CLOSED.** No path that is not the author or an organizer returned the body of a hidden reply, through a list or a count. The `get`/`list` split is what does it: `allow list` reads a bare `resource.data.status`, which a query can only satisfy by carrying `where('status','==','visible')`, and Firestore's rewrite of `in`/`!=`/`not-in`/`or` into equality sub-queries does not get round it — each sub-query is evaluated and the `hidden` one is refused, taking the whole query with it.

**Proved against the old behaviour**, not just asserted: I re-ran the same probe with `git show 0dda7b5:firestore.rules`. Old rules, same attendee B — `where('eventId','==','kgc-2027')` → `[rHidden, rVisible]` with `DOXXING TEXT`; `where('authorId','==',A)` → same; `getCountFromServer` with that filter → 2. So `tests/rules/firestore.test.ts`'s new cases ("is not returned by a query filtered on some other field", "is not counted by a query filtered on some other field") genuinely fail on the old rules and pass on the new.

## 2. Author, organizer and the app's own queries

`app/src/lib/data/community.ts` sends exactly three reply queries and all three are the permitted ones:
- `useReplies` (line 154): `where('status','==','visible')`, `orderBy('createdAt','asc')`, `limitToLast(50)` — probed verbatim, allowed.
- `useReplyCounts` (line 119): `query(c, where('status','==','visible'))` — allowed, counts visible only.
- `addReply` (line 255) writes `status: 'visible'` — allowed.

No other client surface queries `replies`. The organizer's reads (`lib/moderation.ts:128`, `lib/engagement.ts:151`, `moderator-tools/community-board/actions.ts`) are Admin SDK and bypass rules. `firestore.indexes.json:544` carries the `replies(status ASC, createdAt ASC)` COLLECTION-scope index the query needs in production.

## 3. The same `resource.data.get(field, default)` idiom elsewhere in an `allow read`

Three in the file, all probed:

| where | default | probed | verdict |
|---|---|---|---|
| `firestore.rules:1371` replies `allow get` | `'visible'` | above | safe — `get` binds the whole document; it is no longer inside a `list` |
| `firestore.rules:1215` `consentForms/{id}/responses` | `''` | no filter / `eventId` / `formVersion` / somebody else's `uid` / count / direct get of a `uid`-less link signature / direct get of A's → **all denied**; `where('uid','==',self)` → allowed, own rows only | safe — the default `''` matches no uid |
| `firestore.rules:183` `registrationIsMine`, `data.get('altEmails', [])`, used by `registrations` `allow get, list` | `[]` | no filter / `array-contains` self / `array-contains` somebody else's alt / `eventId` / `email ==` somebody else's / count / direct get of `reg_a` → **all denied** | safe — `[]` contains nobody, and the left operand `data.email.lower()` throws on any query not naming `email`, which denies |

## 4. The create rule and the backfill script

| attempt as attendee B | result |
|---|---|
| create a reply with **no** `status` field | denied |
| `setDoc` at a chosen id with no `status` | denied |
| `status: 'hidden'` | denied |
| `status: ''` | denied |
| `status: null` | denied |
| `authorId` spoofed to somebody else | denied |
| `status: 'visible'` (the app's write) | allowed |
| update `rVisible.status` to `'hidden'` as an attendee | denied |
| delete somebody else's reply | denied |

`scripts/ops/backfill-reply-status.ts` exists. It names the project explicitly (`GCLOUD_PROJECT ?? 'kgc-conference-app-and-website'`, line 47), exits with a message unless either `GOOGLE_APPLICATION_CREDENTIALS` or `FIRESTORE_EMULATOR_HOST` is set, **defaults to a dry run** and writes nothing without `--apply`, and only ever sets `visible` on replies with no `status` (a `hidden` one is left alone). It is referenced in three docblocks and wired into **no** npm script, so nothing runs it incidentally. I did not run it, per the scripts/ops prohibition.

## 5. tmp-probe and the step-up test

`tmp-probe/` is gone from the working tree. ⚠️ The deletion is **uncommitted** — `git ls-tree HEAD` still lists `tmp-probe/probe-f1.test.ts` at `c4a3b89`, and `git status` shows it as an unstaged `D`. A fresh clone still gets it until somebody commits.

`tests/parity/step-up-guard.test.ts` now slices one action's own source with `bodyOf(source, action)` (signature to the next top-level `export`) and asserts `await reauthenticate(` inside that slice, for all four actions. It also carries a meta-test that the slice is real: `saveConsentFormAction`'s body must **not** contain `reauthenticate(` or `sendSigningLinksAction`. It checks the action it names.

## 6. Check results

- `npx tsc --noEmit` — `apps/organizer` clean, `apps/web` clean, `app` clean
- `npm test` at the repo root — **52 files, 944 passed**
- `FIRESTORE_EMULATOR_HOST=localhost:8080 npx vitest run tests/rules` — **3 files, 321 passed**

## 7. Anything else I found

**A. A real regression, on the database the dev servers are using.** The seed now writes `status` on every reply, but the running emulator was seeded before that change. Queried through the emulator REST API as owner: **16 replies exist, 15 of them have no `status` field.** The app's board query returns zero of the 5 replies under `seed-post-1` — I ran that exact filter and it came back empty. So on the phone the board now prints "No replies yet" under posts that have five replies, which is the specific false claim `useReplyCounts`'s own docblock says is worse than printing nothing. The dashboard still shows all 16, because it reads with the Admin SDK and treats an absent status as visible, so the two surfaces disagree. `app/src/lib/data/community.ts:191` asserts "That set is empty in this database" — **that is false here**, and it is very likely false on live, which holds the same pre-change seeded demo event. The backfill is not a precaution for a hypothetical restored backup; it is required before or with the rules deploy, exactly as the script's own docblock says. Re-seeding fixes the emulator.

**B. A narrow existence oracle on `allow get`.** `resource == null` is permitted, a hidden reply is denied, so a non-author can distinguish "no reply at this id" from "a hidden reply is at this id". It needs a guessed 20-character Firestore auto-id and discloses no body. Negligible, but it is the one thing the `get` rule tells a stranger.

**C.** An author cannot reach their own hidden reply by query, only by `get`. Deliberate, documented in the rule, and asserted in the suite — noted only so it is not mistaken for a gap.

## Files changed

**None.** Verification only. I wrote three throwaway probe files under `/Users/hartigan/Documents/Claude/Projects/KGC/2KGC-App/.probe-r3/` and deleted the directory; `git status` is unchanged from what the other agent left. Probe data lives only in the three throwaway emulator project namespaces above and never touched `kgc-conference-app-and-website`; nothing in the seeded database was written or restored.

## Must be run or deployed against live

- `firestore.rules` through `scripts/ops/deploy-rules.mjs` — finding 1 is closed in the file, not on the live database.
- `firestore.indexes.json` — the `replies(status, createdAt)` COLLECTION index, or the board's reply query fails with `failed-precondition` in production.
- `scripts/ops/backfill-reply-status.ts --apply`, before or with the rules deploy. Evidence A says this is not a no-op: the equivalent database here is 15 replies short.
- Still outstanding from round two: the one-time save of Tools › Admin Control › Code Access Control, to drop `joinCode` out of `settings/appAccess`.