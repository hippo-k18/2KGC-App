import { describe, expect, it } from 'vitest';
import { LEARN_PAGE_DEFAULT } from '@kgc/shared';
import { learnPageMetadata, learnPreviewMetadata } from './learn-page-metadata';

const OG = { src: '/kgc/learn-wordmark.png', alt: 'KGC | Learn', width: 1000, height: 275 };

describe('learnPageMetadata', () => {
  it('is the title and description alone by default, so the layout keeps its share card and indexing', () => {
    const meta = learnPageMetadata(LEARN_PAGE_DEFAULT);
    expect(meta).toEqual({ title: LEARN_PAGE_DEFAULT.seoTitle, description: LEARN_PAGE_DEFAULT.seoDescription });
  });

  it('sets the sharing image with the title and description beside it', () => {
    const meta = learnPageMetadata({ ...LEARN_PAGE_DEFAULT, ogImage: OG });
    expect(meta.openGraph).toMatchObject({
      title: LEARN_PAGE_DEFAULT.seoTitle,
      description: LEARN_PAGE_DEFAULT.seoDescription,
      images: [{ url: OG.src, width: 1000, height: 275, alt: 'KGC | Learn' }],
    });
  });

  it('noindex keeps links followed', () => {
    expect(learnPageMetadata({ ...LEARN_PAGE_DEFAULT, noindex: true }).robots).toEqual({ index: false, follow: true });
  });
});

describe('learnPreviewMetadata', () => {
  it('is never indexed, points at /learn, and sends no referrer', () => {
    const meta = learnPreviewMetadata(LEARN_PAGE_DEFAULT);
    expect(meta).toMatchObject({
      robots: { index: false, follow: false },
      alternates: { canonical: '/learn' },
      referrer: 'no-referrer',
    });
  });
});
