import 'server-only';

import { headers } from 'next/headers';
import { blogPublicOrigin, separateBlogOrigin } from '@kgc/shared';
import { isBlogHost } from './host';

/**
 * A link inside the blog, right for the host the reader is on: `/write` on
 * blog.knowledgegraph.tech, `/blog/write` on the main site and on localhost.
 */
export async function blogBase(): Promise<string> {
  return (await isBlogRequest()) ? '' : '/blog';
}

/** Did this request come in on the blog host? `next.config.ts` rewrites it, keeping the Host. */
export async function isBlogRequest(): Promise<boolean> {
  return Boolean(separateBlogOrigin()) && isBlogHost((await headers()).get('host'));
}

export async function blogPath(path: string): Promise<string> {
  const base = await blogBase();
  return base + (path === '/' ? (base ? '' : '/') : path);
}

/**
 * The blog's absolute address, for canonicals, the feed, share links and
 * emails: its own host, or the main site's `/blog`.
 */
export const blogOrigin = () => blogPublicOrigin();

export const blogUrl = (path: string) => blogOrigin() + (path === '/' ? '' : path);

/**
 * Where the browser should go after a server action: `/blog/write` on the main
 * site, `/write` on the blog host. See the note at the top of `actions.ts`.
 */
export async function actionRedirect(path: string): Promise<string> {
  return (await isBlogRequest()) ? path : `/blog${path}`;
}
