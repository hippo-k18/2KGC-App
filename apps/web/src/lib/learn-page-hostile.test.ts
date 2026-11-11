import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  LEARN_PAGE_KITCHEN_SINK,
  LEARN_PAGE_KITCHEN_SINK_V2,
  readLearnPage,
  type LearnBlock,
  type LearnPageContent,
} from '@kgc/shared';
import { LearnPageView } from '../components/learn-page-view';

/*
 * A Learn page written straight to Firestore, past the save validator
 * (T324 F1, F2, U2, U3). www parses it (`readLearnPage`) and draws it, and
 * neither step may throw: a throw is a 500 on the preview link and a page
 * stuck on its last good copy at /learn.
 */

const BUCKET = 'kgc-conference-app-and-website.firebasestorage.app';
const OPTS = { bucket: BUCKET, allowEmulator: false };
const render = (content: LearnPageContent) =>
  renderToStaticMarkup(createElement(LearnPageView, { content, remoteImages: 'optimize', now: Date.UTC(2026, 9, 22) }));

const HOSTILE: unknown[] = [
  undefined,
  null,
  true,
  0,
  -1,
  0.5,
  1e16,
  8.7e15,
  1e300,
  -1e300,
  NaN,
  Infinity,
  -Infinity,
  '',
  ' ',
  'x',
  '<script>alert(1)</script>',
  'javascript:alert(1)',
  'https:/\\evil.example',
  '\u0001https://evil.example',
  'https://evil.example/a.png',
  '['.repeat(2000),
  [],
  [null],
  [[]],
  [1, 'x', {}],
  {},
  { type: 'doc' },
  { type: 'doc', content: 5 },
  { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 5 }] }] },
  { src: 'https://evil.example/a.png', width: 1e300 },
];

/** Every path into a value, up to `depth` keys deep. */
function paths(v: unknown, depth: number, at: (string | number)[] = []): (string | number)[][] {
  if (depth === 0 || typeof v !== 'object' || v === null) return [];
  const out: (string | number)[][] = [];
  for (const [k, child] of Object.entries(v)) {
    const p = [...at, Array.isArray(v) ? Number(k) : k];
    out.push(p, ...paths(child, depth - 1, p));
  }
  return out;
}

function setAt(root: unknown, path: (string | number)[], value: unknown): unknown {
  const copy = structuredClone(root) as Record<string | number, unknown>;
  let o = copy;
  for (const k of path.slice(0, -1)) o = o[k] as Record<string | number, unknown>;
  o[path.at(-1)!] = value;
  return copy;
}

/** One example of every block kind, from the two sample pages. */
function oneOfEachKind(): LearnBlock[] {
  const seen = new Map<string, LearnBlock>();
  for (const page of [LEARN_PAGE_KITCHEN_SINK, LEARN_PAGE_KITCHEN_SINK_V2]) {
    for (const s of page.sections) for (const b of s.blocks) if (!seen.has(b.kind) && b.kind !== 'reusable') seen.set(b.kind, b);
  }
  return [...seen.values()];
}

describe('a stored page full of wrong-typed fields', () => {
  it('parses and renders without throwing, whatever any field of any block holds', () => {
    const blocks = oneOfEachKind();
    expect(blocks.length).toBeGreaterThanOrEqual(23);
    let renders = 0;
    for (const block of blocks) {
      for (const path of paths(block, 3)) {
        if (path[0] === 'id' || path[0] === 'kind') continue;
        for (const value of HOSTILE) {
          const stored = { seoTitle: 'T', sections: [{ id: 's', blocks: [setAt(block, path, value), { id: 'keep', kind: 'text', text: 'kept' }] }] };
          const where = `${block.kind}.${path.join('.')} = ${String(value).slice(0, 40)}`;
          let html = '';
          expect(() => {
            const page = readLearnPage(stored, OPTS);
            html = page ? render(page) : '';
          }, where).not.toThrow();
          expect(html, where).toContain('kept');
          // As words any value is fine. An image from another host is not, nor
          // a link in disguise (an honest https:// link elsewhere is allowed).
          expect(html, where).not.toMatch(/(src|srcset)="[^"]*evil\.example/i);
          expect(html, where).not.toMatch(/href="[^"]*(javascript:|\\|\u0001)/i);
          expect(html, where).not.toContain('<script');
          renders++;
        }
      }
    }
    expect(renders).toBeGreaterThan(1000);
  });

  it('renders section and page options of the wrong type', () => {
    for (const value of HOSTILE) {
      const section: Record<string, unknown> = { id: 's', blocks: [{ id: 'keep', kind: 'text', text: 'kept' }] };
      for (const k of ['label', 'background', 'width', 'paddingTop', 'backgroundColor', 'backgroundImage', 'overlay', 'anchor', 'visibleOn', 'layout', 'blockColumn', 'waveBehindFirstImage']) {
        section[k] = value;
      }
      const page = readLearnPage({ seoTitle: 'T', seoDescription: value, ogImage: value, noindex: value, sections: [section] }, OPTS);
      expect(page && render(page)).toContain('kept');
    }
  });
});

describe('the renderer checks again what the parser checked', () => {
  const page = (blocks: unknown[]) => ({ seoTitle: 'T', sections: [{ id: 's', label: '', background: 'plain', width: 'normal', paddingTop: 'large', paddingBottom: 'large', blocks }] }) as LearnPageContent;

  it('draws no countdown for a date outside the range, rather than throwing (T324 F1)', () => {
    for (const until of [1e16, 8.7e15, 1e300, NaN, -1e16]) {
      let html = '';
      expect(() => (html = render(page([{ id: 'c', kind: 'countdown', until }, { id: 'k', kind: 'text', text: 'kept' }]))), String(until)).not.toThrow();
      expect(html).toContain('kept');
      expect(html).not.toContain('lp-countdown');
    }
    expect(render(page([{ id: 'c', kind: 'countdown', until: Date.UTC(2027, 4, 4) }]))).toContain('2027-05-04T00:00:00.000Z');
  });

  it('draws no image from another host, in any image field (T324 F2)', () => {
    const img = { src: 'https://evil.example/a.png', alt: 'a', width: 10, height: 10 };
    const html = render({
      ...page([
        { id: 'i', kind: 'image', image: img, width: 'medium', shape: 'original' },
        { id: 'p', kind: 'people', style: 'cards', columns: 3, people: [{ id: 'p', name: 'P', role: '', photo: img }] },
        { id: 'g', kind: 'gallery', layout: 'grid', columns: 3, lightbox: true, images: [{ id: 'g', ...img }] },
        { id: 'l', kind: 'logos', grayscale: false, items: [{ id: 'l', ...img, href: '/x' }] },
        { id: 'q', kind: 'quote', style: 'plain', text: 'q', name: 'N', photo: img },
        { id: 'k', kind: 'cards', columns: 3, items: [{ id: 'k', title: 'K', text: '', image: img }] },
        { id: 'it', kind: 'imageText', image: img, imageSide: 'left', imageWidth: 'half', shape: 'rounded', text: 'x' },
        { id: 'keep', kind: 'text', text: 'kept' },
      ]),
      sections: [{ ...page([]).sections[0]!, backgroundImage: img, blocks: [{ id: 'keep', kind: 'text', text: 'kept' } as LearnBlock] }],
    });
    expect(html).toContain('kept');
    expect(html).not.toContain('evil.example');
  });

  it('drops an unsafe link and keeps its words; an off-site link opens a new tab with rel (T324 U2, U3)', () => {
    const doc = (href: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'words', marks: [{ type: 'link', href }] }] }] });
    for (const href of ['https:/\\evil.example', 'https:\\\\evil.example', '\u0001https://evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      const html = render(
        page([
          { id: 'b', kind: 'buttons', buttons: [{ label: 'Button', href, style: 'primary' }] },
          { id: 't', kind: 'text', text: doc(href) },
          { id: 'm', kind: 'text', text: `[md](${href})` },
          { id: 'p', kind: 'people', style: 'list', columns: 2, people: [{ id: 'p', name: 'P', role: '', linkedin: href }] },
        ]),
      );
      expect(html, href).not.toContain('evil.example');
      expect(html, href).not.toContain('javascript:');
      expect(html, href).toContain('Button');
      expect(html, href).toContain('words');
    }
    const ok = render(page([{ id: 'b', kind: 'buttons', buttons: [{ label: 'Out', href: 'https://example.com', style: 'text' }, { label: 'In', href: '/agenda', style: 'text' }] }]));
    expect(ok).toContain('<a href="https://example.com" class="lp-btn-text" target="_blank" rel="noreferrer noopener">Out</a>');
    expect(ok).toContain('<a href="/agenda" class="lp-btn-text">In</a>');
  });
});
