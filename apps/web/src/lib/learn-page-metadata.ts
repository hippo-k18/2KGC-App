import type { Metadata } from 'next';
import type { LearnPageContent } from '@kgc/shared';

/**
 * `<head>` for /learn from the published page (T316): title, description, the
 * sharing image and noindex, all set in the dashboard's page editor.
 *
 * `openGraph` is written whole because a page's `openGraph` replaces the
 * layout's rather than merging into it; without the title and description here
 * a share card would lose them the moment an image was set.
 */
export function learnPageMetadata(page: LearnPageContent): Metadata {
  const meta: Metadata = { title: page.seoTitle, description: page.seoDescription || undefined };
  if (page.ogImage) {
    meta.openGraph = {
      title: page.seoTitle,
      description: page.seoDescription || undefined,
      type: 'website',
      images: [
        {
          url: page.ogImage.src,
          width: page.ogImage.width,
          height: page.ogImage.height,
          alt: page.ogImage.alt || undefined,
        },
      ],
    };
  }
  if (page.noindex) meta.robots = { index: false, follow: true };
  return meta;
}

/**
 * `<head>` for a draft preview link: never indexed, never followed, and the
 * canonical points at the real page in case a link is ever shared publicly.
 */
export function learnPreviewMetadata(page: LearnPageContent): Metadata {
  return {
    ...learnPageMetadata(page),
    robots: { index: false, follow: false },
    alternates: { canonical: '/learn' },
    referrer: 'no-referrer',
  };
}
