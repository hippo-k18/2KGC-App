import type { LearnPageContent, PageImage } from "./learn-page.js";
import { isLearnImageSrc, parseLearnPageContent, type LearnImageOptions } from "./learn-page-view-core.js";

/**
 * The parts of the KGC | Learn page the website needs outside the renderer
 * (T316): the page's sharing image and noindex flag for `<head>`, and the check
 * on a draft preview link's token. Plain TypeScript, so both are tested here
 * and the website and dashboard agree on the token's shape.
 */

/** What /learn puts in `<head>` beyond the title and description. */
export interface LearnPageMeta {
  ogImage?: PageImage;
  noindex?: boolean;
}

/**
 * `ogImage` and `noindex` from a stored `published` (or `draft`) value.
 * Anything malformed is dropped rather than failing the page: a page with no
 * sharing image is better than no page.
 */
export function parseLearnPageMeta(value: unknown, o: LearnImageOptions = {}): LearnPageMeta {
  if (typeof value !== "object" || value === null) return {};
  const v = value as Record<string, unknown>;
  const out: LearnPageMeta = {};
  if (v.noindex === true) out.noindex = true;
  const img = v.ogImage as Record<string, unknown> | undefined;
  if (img && typeof img === "object" && typeof img.src === "string" && isLearnImageSrc(img.src, o)) {
    const size = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 100_000 ? n : undefined);
    const width = size(img.width);
    const height = size(img.height);
    out.ogImage = {
      src: img.src.trim(),
      alt: typeof img.alt === "string" ? img.alt : "",
      width: width ?? 1200,
      height: height ?? 630,
    };
  }
  return out;
}

/**
 * A stored `published` or `draft` value as the website renders it, sharing
 * image and noindex included, or `null` when it is not a usable page. The
 * website passes its bucket (`LearnImageOptions`), so an image from anywhere
 * else is dropped.
 */
export function readLearnPage(value: unknown, o: LearnImageOptions = {}): LearnPageContent | null {
  const content = parseLearnPageContent(value, o);
  return content ? { ...content, ...parseLearnPageMeta(value, o) } : null;
}

/** A preview token as the dashboard mints it: 32 random bytes in base64url (43 characters). */
export function isPreviewTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/**
 * Does the token in a preview link match the stored one?
 *
 * Compared in constant time over the fixed token length, so the response time
 * says nothing about how many leading characters were right. A missing stored
 * token (never created, or revoked) matches nothing.
 */
export function previewTokenMatches(stored: unknown, given: unknown): boolean {
  if (!isPreviewTokenShape(stored) || !isPreviewTokenShape(given)) return false;
  let diff = 0;
  for (let i = 0; i < stored.length; i++) diff |= stored.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
