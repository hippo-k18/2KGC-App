import { EXACT, SECTIONS } from './old-site-map';

/**
 * Where an address from the old WordPress site goes on this one, or `null`
 * when the path is not an old address.
 *
 * knowledgegraph.tech ran on WordPress until 2026-09-26. Search engines, old
 * newsletters and other people's links still point at its 926 addresses, so
 * each one answers with a single 301 to the closest page here, which is the
 * redirect that passes its search standing on. The map is in `old-site-map.ts`;
 * the reasoning is in `docs/audit-2026-09-19/domain/MOVE-TO-DOMAIN.md`.
 *
 * A trailing slash is ignored, because every WordPress address had one.
 */
export function oldSiteTarget(path: string): string | null {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (p in EXACT) return EXACT[p];
  for (const [prefix, to] of SECTIONS) {
    if (p === prefix || p.startsWith(prefix + '/')) return to;
  }
  return null;
}
