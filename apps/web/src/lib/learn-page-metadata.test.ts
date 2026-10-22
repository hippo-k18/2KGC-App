import { describe, expect, it } from 'vitest';
import { LEARN_PAGE_DEFAULT } from '@kgc/shared';
import { learnPageMetadata, learnPreviewMetadata, learnPreviewNotice } from './learn-page-metadata';

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

describe('learnPreviewNotice (T324 F13)', () => {
  it('says the draft is a draft', () => {
    expect(learnPreviewNotice(true)).toEqual({
      className: 'learn-preview-bar',
      text: 'Preview, not published. This is the current draft; the public page may differ.',
    });
  });

  it('tells the holder of a turned-off, replaced or made-up link that it no longer works', () => {
    const off = learnPreviewNotice(false);
    expect(off.className).toBe('learn-preview-bar is-off');
    expect(off.text).toMatch(/^This preview link no longer works\./);
    expect(off.text).toContain('public page');
  });
});
