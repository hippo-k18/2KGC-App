/**
 * Whether a redirect destination stays on this site: a path starting with one
 * "/". `//evil.com` is protocol-relative, and `/\evil.com` is read by browsers
 * as `//evil.com` too, so both are refused (T263). Used by the dashboard when a
 * campaign link is saved and by the website's `/r/{code}` when it redirects.
 */
export function isSitePath(destination: string): boolean {
  return destination.startsWith("/") && !destination.startsWith("//") && destination[1] !== "\\";
}
