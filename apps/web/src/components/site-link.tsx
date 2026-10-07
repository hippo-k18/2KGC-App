'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import type { ComponentProps } from 'react';

/**
 * A link to a main-site page, made absolute on the blog host.
 *
 * The footer is shared by both hosts. On blog.knowledgegraph.tech a relative
 * `/about` went through a redirect to the main site; this sends the reader
 * there directly, during server rendering as well, because the blog host
 * rewrites to the `/blog` routes and the top segment says so. Without
 * `BLOG_ORIGIN` (`blogOrigin` unset) `/blog` is a main-site page and the link
 * stays relative.
 */
export function SiteLink({
  href,
  mainOrigin,
  blogOrigin,
  ...rest
}: Omit<ComponentProps<typeof Link>, 'href'> & {
  href: string;
  mainOrigin?: string;
  blogOrigin?: string;
}) {
  const onBlog = useSelectedLayoutSegment() === 'blog' && Boolean(blogOrigin && mainOrigin);
  return <Link href={onBlog && href.startsWith('/') ? `${mainOrigin}${href}` : href} {...rest} />;
}
