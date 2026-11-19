import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DRAFT_COVER_SIZES, DraftArticle } from './draft-article';
import { isFromEditor, type PostFields } from './types';

const fields: PostFields = {
  title: 'A draft',
  slug: 'a-draft',
  excerpt: '',
  date: '',
  authorName: 'Test Writer',
  categories: [],
  tags: [],
  cover: { src: '/kgc/blog/cover.jpg', width: 800, height: 450 },
  body: { kind: 'doc', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body.' }] }] } },
};

/** The page the review link renders, given a stored post. */
const render = (post: { legacySlug?: string }) =>
  renderToStaticMarkup(
    <DraftArticle fields={fields} fromEditor={isFromEditor(post)} legacyHtml={null} coverSizes={DRAFT_COVER_SIZES} />,
  );

describe('the shared draft keeps the published page’s cover rule', () => {
  it('shows the cover above a post written in the editor', () => {
    const html = render({});
    expect(html.match(/class="post-cover"/g)).toHaveLength(1);
    expect(html).toContain('Body.');
  });

  it('shows no cover above an archive post, whose body already carries its image', () => {
    const html = render({ legacySlug: 'knowledge-graph-news-roundup-5-september-2025' });
    expect(html).not.toContain('post-cover');
    expect(html).toContain('Body.');
  });

  it('shows no cover when there is none', () => {
    const html = renderToStaticMarkup(
      <DraftArticle fields={{ ...fields, cover: null }} fromEditor legacyHtml={null} coverSizes={DRAFT_COVER_SIZES} />,
    );
    expect(html).not.toContain('post-cover');
  });
});
