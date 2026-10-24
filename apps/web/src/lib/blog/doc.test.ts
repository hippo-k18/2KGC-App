import { describe, expect, it } from 'vitest';
import { autoExcerpt, isEmptyDoc, safeHref, safeImageSrc, sanitizeDoc, youtubeId } from './doc';

const para = (text: string, marks?: unknown[]) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });

describe('sanitizeDoc', () => {
  it('keeps the archive features: links, buttons, centring, linked and centred images, embeds', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Sign me up', marks: [{ type: 'link', attrs: { href: 'https://x.test/a', class: 'button', target: null, rel: null } }] }] },
        { type: 'image', attrs: { src: '/kgc/blog/a.jpg', alt: 'Logo', width: 400, height: 200, href: 'https://sponsor.test/', center: true } },
        { type: 'youtube', attrs: { src: 'https://www.youtube.com/watch?v=W2R83qKWSfo', start: 0 } },
      ],
    });
    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
      content: [{ type: 'text', text: 'Sign me up', marks: [{ type: 'link', attrs: { href: 'https://x.test/a', button: true } }] }],
    });
    expect(doc.content[1]).toEqual({
      type: 'image',
      attrs: { src: '/kgc/blog/a.jpg', alt: 'Logo', width: 400, height: 200, href: 'https://sponsor.test/', center: true },
    });
    expect(doc.content[2]).toEqual({ type: 'youtube', attrs: { src: 'https://www.youtube-nocookie.com/embed/W2R83qKWSfo' } });
  });

  it('drops script-shaped links, unsafe images and unknown nodes', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        para('click', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
        para('data', [{ type: 'link', attrs: { href: 'data:text/html,<script>' } }]),
        { type: 'image', attrs: { src: 'http://insecure.test/a.png' } },
        { type: 'image', attrs: { src: 'data:image/png;base64,AAAA' } },
        { type: 'image', attrs: { src: '//evil.test/a.png' } },
        { type: 'iframe', attrs: { src: 'https://evil.test' } },
        { type: 'youtube', attrs: { src: 'https://evil.test/embed/abcdefgh' } },
        { type: 'paragraph', attrs: { onclick: 'x', textAlign: 'right' }, content: [{ type: 'text', text: 'ok', marks: [{ type: 'highlight' }] }] },
      ],
    });
    expect(doc.content).toEqual([
      para('click'),
      para('data'),
      { type: 'paragraph', content: [{ type: 'text', text: 'ok' }] },
    ]);
  });

  it('starts headings at h2, since the title is the h1', () => {
    const doc = sanitizeDoc({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'A' }] }, { type: 'heading', attrs: { level: 6 } }] });
    expect(doc.content.map((n) => (n as { attrs: { level: number } }).attrs.level)).toEqual([2, 4]);
  });

  it('never lets text sit directly in a block list', () => {
    const doc = sanitizeDoc({ type: 'doc', content: [{ type: 'text', text: 'loose' }, { type: 'bulletList', content: [{ type: 'text', text: 'x' }] }] });
    expect(doc.content).toEqual([{ type: 'paragraph' }]);
  });

  it('turns anything that is not a document into an empty one', () => {
    expect(sanitizeDoc(null)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(sanitizeDoc('<p>hi</p>')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(sanitizeDoc({ type: 'doc', content: 'x' })).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('stops at the size limits instead of storing a pasted book', () => {
    const huge = { type: 'doc', content: Array.from({ length: 30_000 }, () => para('x')) };
    expect(sanitizeDoc(huge).content.length).toBeLessThan(25_000);
  });
});

describe('URL checks', () => {
  it('allows web, mail, phone and on-site links', () => {
    expect(safeHref('https://a.test/x')).toBe('https://a.test/x');
    expect(safeHref('mailto:hello@knowledgegraph.tech')).toBe('mailto:hello@knowledgegraph.tech');
    expect(safeHref('/tickets')).toBe('/tickets');
    expect(safeHref('#top')).toBe('#top');
    expect(safeHref(' JavaScript:alert(1)')).toBeNull();
    expect(safeHref('//evil.test')).toBeNull();
  });
  it('allows images from this site or https only', () => {
    expect(safeImageSrc('/blog-media/a.jpg')).toBe('/blog-media/a.jpg');
    expect(safeImageSrc('https://cdn.test/a.jpg')).toBe('https://cdn.test/a.jpg');
    expect(safeImageSrc('http://cdn.test/a.jpg')).toBeNull();
  });
  it('reads every shape of YouTube link', () => {
    for (const url of [
      'https://youtu.be/W2R83qKWSfo',
      'https://www.youtube.com/watch?v=W2R83qKWSfo&t=3',
      'https://m.youtube.com/watch?v=W2R83qKWSfo',
      'https://www.youtube-nocookie.com/embed/W2R83qKWSfo',
      'https://www.youtube.com/shorts/W2R83qKWSfo',
    ]) expect(youtubeId(url)).toBe('W2R83qKWSfo');
    expect(youtubeId('https://vimeo.com/123')).toBeNull();
  });
});

describe('reading a document', () => {
  it('takes the excerpt from the first paragraph with words, cut at a word', () => {
    const doc = sanitizeDoc({ type: 'doc', content: [{ type: 'paragraph' }, para('word '.repeat(100).trim())] });
    const ex = autoExcerpt(doc, 40);
    expect(ex.endsWith('…')).toBe(true);
    expect(ex).not.toMatch(/wor…$/);
  });
  it('knows an empty post from one with only a picture', () => {
    expect(isEmptyDoc(sanitizeDoc({ type: 'doc', content: [{ type: 'paragraph' }] }))).toBe(true);
    expect(isEmptyDoc(sanitizeDoc({ type: 'doc', content: [{ type: 'image', attrs: { src: '/blog-media/a.jpg' } }] }))).toBe(false);
  });
});
