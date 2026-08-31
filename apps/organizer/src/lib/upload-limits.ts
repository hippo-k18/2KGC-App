/**
 * What counts as an acceptable image, stated once for both sides of the wire.
 *
 * Split out of `uploads.ts` for the reason AGENTS.md gives for
 * `conflicts-core.ts` versus `conflicts.ts`: that module imports `server-only`,
 * and the file picker that has to enforce the same limits *before* the user
 * waits for an upload is a client component. Two copies of "900 KB" would drift,
 * and the way they would drift is a picker that happily submits a file the
 * server then refuses.
 *
 * The client applies these as courtesy; the server applies them as law.
 */

/**
 * The hard cap on what reaches the server.
 *
 * Deliberately under Next's 1 MB Server Action body limit rather than at
 * `storage.rules`' 5 MB, because the limit that actually bites is the transport
 * one and a framework 413 is a far worse error message than ours.
 */
export const MAX_UPLOAD_BYTES = 900 * 1024;

/**
 * What may be uploaded.
 *
 * SVG is excluded on purpose. It is a script-bearing document that happens to
 * render as a picture, and Firebase serves an object back with the content type
 * it was stored under — so an uploaded SVG is an HTML page hosted on a Google
 * domain, reachable by anyone holding the download URL. Nothing in this product
 * needs vector logos badly enough to accept that.
 */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/** Ready for an `<input accept="…">`. */
export const IMAGE_ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_TYPES.join(',');

export const IMAGE_EXTENSIONS: Record<AcceptedImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * The longest edge an image is scaled down to before it is submitted.
 *
 * 1024 is the size at which a logo still looks right on a retina screen at the
 * ~200 px it is actually rendered at, and it takes a 4 MB phone photograph to
 * roughly 100 KB — comfortably inside the cap above, which is the point.
 */
export const DEFAULT_MAX_EDGE = 1024;
