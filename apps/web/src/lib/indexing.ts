import 'server-only';

import { headers } from 'next/headers';
import { publicSiteOrigin } from '@kgc/shared';
import { isBlogHost } from './blog/host';
import { mainHostIndexable } from './indexing-core';

/**
 * Which host this request is on, and whether search engines may index it.
 *
 * Only the two real addresses are indexable: the site at `WEB_PUBLIC_ORIGIN`
 * (and only once `SITE_INDEXABLE=true`, see `indexing-core.ts`) and the blog at
 * `BLOG_ORIGIN`. Any other name the app answers on (a leftover staging address,
 * the droplet's IP) gets a disallow-all robots.txt, so Google never finds a
 * second copy of the site.
 */
export async function requestHost(): Promise<{ origin: string; blog: boolean; indexable: boolean }> {
  const host = (await headers()).get('host') ?? '';
  const blog = isBlogHost(host);
  const own = blog ? process.env.BLOG_ORIGIN : publicSiteOrigin();
  const origin = (own ?? `https://${host}`).replace(/\/$/, '');
  let indexable = false;
  if (blog) {
    try {
      indexable = new URL(origin).host === host;
    } catch {}
  } else {
    indexable = mainHostIndexable(host, origin);
  }
  return { origin, blog, indexable };
}
