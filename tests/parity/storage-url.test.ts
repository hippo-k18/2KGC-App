/**
 * The Storage-URL constraint, asserted in both languages that hold it.
 *
 * `functions/src/lib/storage-url.ts` and `firestore.rules` enforce the same
 * rule — an image URL copied into a collection a thousand phones fetch must be
 * one Storage actually issued — and they enforce it twice, in TypeScript and in
 * the rules language. Neither can call the other: `@kgc/shared` is bundled into
 * the Expo app and cannot carry a Node-only `URL` check, and the rules language
 * cannot run TypeScript. Both files say so and both ask the next editor to
 * remember, which is not a mechanism.
 *
 * This is the mechanism. The rules regex is read out of `firestore.rules` at
 * test time rather than copied here — a copy would be a third place to drift —
 * and every URL below is put through both. A change to either side that the
 * other does not follow fails here.
 *
 * ── Why the table is mostly attacks ─────────────────────────────────────────
 *
 * The reason this constraint exists is that a URL is the one field these
 * projections carry whose value gets *fetched* by a device rather than
 * displayed as text, so an attacker-supplied one is a tracking beacon that
 * fires once per attendee. The cases that matter are therefore the ones that
 * look like a Storage URL and are not: userinfo before the host, the host as a
 * subdomain of somewhere else, a port, a different scheme.
 *
 * Run with: npm test — no emulator and no Java, deliberately. A guard against
 * drift is worth nothing if it only runs where the emulator does.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isFirebaseStorageUrl } from '../../functions/src/lib/storage-url';

const RULES = readFileSync(
  fileURLToPath(new URL('../../firestore.rules', import.meta.url)),
  'utf8',
);

/**
 * The pattern the rules actually ship, lifted from the file.
 *
 * `matches()` in the rules language requires a *full* match, and the pattern
 * already anchors itself with `^` and `$`, so a JS `RegExp` over the same
 * source is the same predicate. The rules source escapes the backslashes twice
 * — once for the rules string literal, once for the regex — so `\\.` on disk is
 * `\.` in the pattern.
 */
function rulesPatternSource(): string {
  const found = RULES.match(/url\.matches\('([^']+)'\)/g);
  expect(
    found,
    'No `url.matches(...)` call found in firestore.rules — the storage-URL check was renamed or removed, and this test can no longer see it.',
  ).toBeTruthy();
  expect(
    found!.length,
    `Expected exactly one \`url.matches(...)\` in firestore.rules; found ${found!.length}. A second one means there are two hostname constraints and this test is only comparing against one of them.`,
  ).toBe(1);

  return /url\.matches\('([^']+)'\)/.exec(found![0])![1].replace(/\\\\/g, '\\');
}

/** `[url, whether a projection may carry it]`. */
const CASES: [string, boolean][] = [
  // The real thing, as `getDownloadURL()` returns it.
  ['https://firebasestorage.googleapis.com/v0/b/kgc-2027.appspot.com/o/avatars%2Fabc.jpg?alt=media&token=1-2-3', true],
  ['https://firebasestorage.googleapis.com/v0/b/kgc-2027.appspot.com/o/logos%2Fx.png', true],
  // Nothing after the host is still a path, and still ours.
  ['https://firebasestorage.googleapis.com/', true],

  // No path at all. The parse-only check used to accept these and the rules
  // never did — the divergence this test was written to catch.
  ['https://firebasestorage.googleapis.com', false],
  ['https://firebasestorage.googleapis.com?alt=media', false],
  ['https://firebasestorage.googleapis.com#x', false],

  // The two tricks `firestore.rules` names in its own comment.
  ['https://firebasestorage.googleapis.com@evil.example/beacon.gif', false],
  ['https://firebasestorage.googleapis.com.evil.example/beacon.gif', false],
  ['https://evil.example/firebasestorage.googleapis.com/beacon.gif', false],

  // Scheme, port and case: all rejected verbatim by the rules pattern, so the
  // TypeScript side must reject them too even though `URL` would normalise
  // two of the three away.
  ['http://firebasestorage.googleapis.com/v0/b/x/o/y', false],
  ['https://FIREBASESTORAGE.GOOGLEAPIS.COM/v0/b/x/o/y', false],
  ['https://firebasestorage.googleapis.com:443/v0/b/x/o/y', false],
  ['https://user:pass@firebasestorage.googleapis.com/v0/b/x/o/y', false],
  ['//firebasestorage.googleapis.com/v0/b/x/o/y', false],

  // Not a URL at all, which is what a hand-edited document holds.
  ['', false],
  ['firebasestorage.googleapis.com/v0/b/x/o/y', false],
  ['javascript:alert(1)', false],
  ['data:image/gif;base64,R0lGOD', false],
];

describe('the Storage-URL constraint', () => {
  const source = rulesPatternSource();
  const pattern = new RegExp(source);

  it('is the pattern firestore.rules still ships', () => {
    // Pinned so that loosening the rules side — dropping the required `/`,
    // widening the host — is a deliberate edit to this line rather than a
    // silent one. Compared as the extracted source rather than `pattern.source`,
    // which re-escapes the forward slashes.
    expect(source).toBe('^https://firebasestorage\\.googleapis\\.com/.*$');
  });

  for (const [url, allowed] of CASES) {
    it(`agrees on ${url || '(empty string)'}`, () => {
      expect(isFirebaseStorageUrl(url), 'functions/src/lib/storage-url.ts').toBe(allowed);
      expect(pattern.test(url), 'firestore.rules').toBe(allowed);
    });
  }

  it('rejects everything that is not a string, which the rules do with `url is string`', () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(isFirebaseStorageUrl(value)).toBe(false);
    }
  });
});
