/**
 * The one URL check every projection in this codebase needs.
 *
 * Two triggers copy an image URL out of an organizer-owned document and into a
 * collection a thousand phones fetch: `mirrorDirectory` copies
 * `users/{uid}.photoURL` into `directory/{uid}`, and `mirrorExhibitorListing`
 * copies `exhibitors/{id}.logoURL` into `exhibitorListings/{id}`. A URL is the
 * one kind of field those projections carry whose value gets *fetched* by the
 * device rather than merely displayed as text, so an attacker-supplied one is a
 * tracking beacon that fires once per attendee — which is exactly the reason
 * `firestore.rules` refuses a client write on both projections.
 *
 * Only a URL Storage actually issued for an upload passes. `firestore.rules`
 * has enforced this identical hostname constraint directly on
 * `users/{uid}.photoURL` since the `fix-photourl-validation` PR, and the only
 * writer of `exhibitors/{id}.logoURL` is `uploadImage()` in the organizer
 * console, which returns a Storage URL by construction. Neither of those makes
 * this check redundant: it is defense in depth against any future writer that
 * reaches the source document through the Admin SDK and bypasses rules entirely
 * — a seed script, a Whova import, a console edit.
 *
 * `.protocol` is checked explicitly, unlike the rules-side regex which bakes
 * `https://` into the match itself — kept in sync by hand, not by a shared
 * implementation: `@kgc/shared` is bundled into the Expo app, which cannot
 * carry a Node-only `URL`-based check, and the rules language cannot run this
 * file's code. If this constraint ever changes, change it in both places.
 */
export function isFirebaseStorageUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'firebasestorage.googleapis.com';
  } catch {
    return false;
  }
}

/**
 * A link an attendee's device will be handed to `Linking.openURL()`.
 *
 * Restricted to `http:`/`https:` because the exhibitor's `website` is free text
 * typed into the console form, which validates nothing, and the scheme is the
 * part that decides whether "open this link" means a browser tab or something
 * else entirely. Anything that is not a parseable web URL is dropped rather
 * than published — an exhibitor with no link is a listing that still works.
 */
export function isWebUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
