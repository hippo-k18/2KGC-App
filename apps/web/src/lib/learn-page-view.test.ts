import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  expandReusableBlocks,
  LEARN_LIBRARY_SAMPLE,
  LEARN_PAGE_DEFAULT,
  LEARN_PAGE_KITCHEN_SINK,
  LEARN_PAGE_KITCHEN_SINK_V2,
  learnPageOrDefault,
  type LearnBlock,
} from '@kgc/shared';
import { V2_BLOCK_KINDS } from '../components/learn-blocks/blocks';
import { LearnPageView } from '../components/learn-page-view';
import { LEARN_FOUNDERS } from './people';

const render = (content = LEARN_PAGE_DEFAULT) => renderToStaticMarkup(createElement(LearnPageView, { content }));

describe('LearnPageView', () => {
  it('renders every block kind in the kitchen sink, and nothing hidden or disallowed', () => {
    const html = render(LEARN_PAGE_KITCHEN_SINK);
    for (const kind of ['heading', 'text', 'image', 'buttons', 'people', 'list', 'columns', 'video', 'divider', 'spacer']) {
      expect(html).toContain(`lp-${kind}`);
    }
    expect(html).toContain('lp-people-cards');
    expect(html).toContain('lp-people-list');
    expect(html).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(html).toContain('https://player.vimeo.com/video/76979871');
    expect(html).not.toContain('must never appear');
    for (const bg of ['plain', 'white-wave', 'light-blue-wave', 'blue', 'grey-wave']) expect(html).toContain(`lp-bg-${bg}`);
  });

  it('draws the default page with the wordmark as its only h1', () => {
    const html = render();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1 class="lp-art-inner"><img alt="KGC \| Learn"/);
    expect(html).toContain('Meet the <strong>KGC | Learn</strong> Team');
    expect(html).toContain('Meet the <strong>KGC|Learn</strong><br/>Continuing Education Team');
  });

  it('never renders markup typed into the text', () => {
    const html = render({
      ...LEARN_PAGE_DEFAULT,
      sections: [{ ...LEARN_PAGE_DEFAULT.sections[1]!, blocks: [{ id: 'x', kind: 'text', text: '<script>alert(1)</script> [x](javascript:alert(1))' }] }],
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;');
  });

  it('skips an Image or Video block not filled in yet, and an empty optional image, without throwing (T314 F1)', () => {
    const team = LEARN_PAGE_DEFAULT.sections[1]!;
    const html = render({
      ...LEARN_PAGE_DEFAULT,
      sections: [
        {
          ...team,
          blocks: [
            { id: 'ei', kind: 'image', image: { src: '', alt: 'Empty one', width: 0, height: 0 }, width: 'medium', shape: 'original' },
            { id: 'ev', kind: 'video', url: '', caption: 'Empty video' },
            {
              id: 'pp',
              kind: 'people',
              style: 'cards',
              columns: 2,
              people: [{ id: 'p', name: 'Ada', role: 'Teacher', photo: { src: '', alt: '', width: 0, height: 0 } }],
            },
            { id: 'tx', kind: 'text', text: 'Still here' },
          ],
        },
        { ...team, id: 'only-empty', waveBehindFirstImage: true, blocks: [{ id: 'e2', kind: 'image', image: { src: '', alt: '', width: 0, height: 0 }, width: 'large', shape: 'original' }] },
      ],
    });
    expect(html).toContain('Still here');
    expect(html).toContain('Ada');
    expect(html).not.toContain('Empty one');
    expect(html).not.toContain('Empty video');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('only-empty');
  });

  it('falls back to the default page for an invalid document', () => {
    expect(render(learnPageOrDefault({ seoTitle: 42, sections: 'nope' }))).toBe(render());
  });

  it("lists the same founders as /team, so the two pages cannot drift apart", () => {
    const team = LEARN_PAGE_DEFAULT.sections.find((s) => s.id === 'team')!;
    const cards = team.blocks.find((b): b is Extract<LearnBlock, { kind: 'people' }> => b.kind === 'people')!;
    expect(cards.people.map((p) => ({ name: p.name, role: p.role, img: p.photo?.src, li: p.linkedin }))).toEqual(
      LEARN_FOUNDERS.map((p) => ({ name: p.name, role: p.role, img: p.img, li: p.li })),
    );
  });
});

describe('LearnPageView, v2 (T319)', () => {
  const NOW = Date.UTC(2027, 3, 1, 12, 0, 0);
  // What Publish stores: the draft with its saved sections expanded (T315).
  const sink = () => learnPageOrDefault(expandReusableBlocks(LEARN_PAGE_KITCHEN_SINK_V2, LEARN_LIBRARY_SAMPLE));
  const html = renderToStaticMarkup(createElement(LearnPageView, { content: sink(), now: NOW }));

  it('draws every v2 block kind, with its id for the editor', () => {
    for (const kind of V2_BLOCK_KINDS) expect(html).toContain(`lp-${kind}`);
    for (const id of ['v2-it-left', 'v2-gal-grid', 'v2-acc', 'v2-tabs', 'v2-count', 'v2-table', 'v2-toc']) {
      expect(html).toContain(`data-block-id="${id}"`);
    }
    expect(html).not.toContain('must never appear');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('Never rendered');
  });

  it('draws every rich node and mark as an element, never as markup', () => {
    for (const tag of ['<strong>', '<em>', '<u>', '<s>', '<code>', '<sup>', '<sub>', '<mark', '<br/>', '<blockquote', '<pre', '<hr', '<table', '<th', '<td', '<ol class="lp-rlist" start="3"']) {
      expect(html).toContain(tag);
    }
    expect(html).toContain('class="lp-tc-navy"');
    expect(html).toContain('style="color:#b82105"');
    expect(html).toContain('lp-hl lp-hl-light-blue');
    expect(html).toContain('class="lp-fs-large"');
    expect(html).toContain('class="lp-ta-justify"');
    expect(html).toContain('<td colSpan="2">');
    expect(html).toMatch(/<a href="https:\/\/www.knowledgegraph.tech" target="_blank" rel="noreferrer noopener">a new tab link<\/a>/);
  });

  it('keeps a single h1, drawing a level 1 heading inside running text as an h2', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('links the table of contents to the ids the headings carry', () => {
    const links = [...html.matchAll(/<li class="lp-toc-l\d"><a href="#([^"]+)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(5);
    for (const id of links) expect(html).toMatch(new RegExp(`<h[2-4][^>]* id="${id}"`));
    expect(links).toContain('rich-text');
  });

  it('draws a page whose reusable block was expanded at publish, and never draws a reusable block itself', () => {
    expect(html).toContain('From the library: ready to start?');
    expect(html).toContain('data-block-id="v2-reuse--cta-h"');
    expect(html).not.toContain('lp-reusable');
    const raw = renderToStaticMarkup(createElement(LearnPageView, { content: learnPageOrDefault(LEARN_PAGE_KITCHEN_SINK_V2), now: NOW }));
    expect(raw).not.toContain('From the library');
    expect(raw).not.toContain('data-block-id="v2-reuse"');
  });

  it('applies section and block options as classes', () => {
    expect(html).toMatch(/<section class="[^"]*lp-bgc lp-bgc-navy lp-on-dark"[^>]*id="numbers"/);
    expect(html).toMatch(/lp-has-bgimg lp-on-dark lp-has-layout/);
    expect(html).toContain('lp-band-overlay" style="opacity:0.55"');
    expect(html).toContain('--lp-band:#eef6fc');
    expect(html).toContain('lp-layout lp-layout-two-equal');
    expect(html).toContain('lp-layout lp-layout-three');
    expect(html).toMatch(/data-block-id="v2-desktop"/);
    expect(html).toContain('lp-vis-desktop');
    expect(html).toContain('lp-vis-mobile lp-tc" style="color:#b82105"');
    expect(html).toContain('lp-mw-small lp-boxed');
  });

  it('frames embeds sandboxed, lazy and titled, and only from their provider', () => {
    const frames = [...html.matchAll(/<iframe [^>]*>/g)].map((m) => m[0]);
    const embeds = frames.filter((f) => f.includes('sandbox='));
    expect(embeds).toHaveLength(2);
    for (const f of embeds) {
      expect(f).toContain('loading="lazy"');
      expect(f).toMatch(/title="[^"]+"/);
      expect(f).not.toContain('allow-top-navigation');
    }
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('style="height:360px"');
  });

  it('draws the countdown from the server clock, and the done text after', () => {
    expect(html).toMatch(/<time dateTime="2027-05-04T13:00:00.000Z"/);
    expect(html).toContain('<span class="lp-countdown-n">33</span>');
    const after = renderToStaticMarkup(createElement(LearnPageView, { content: sink(), now: Date.UTC(2028, 0, 1) }));
    expect(after).toContain('The cohort has started.');
  });

  it('renders accordions as details, exclusive unless allowMany, and tabs with ARIA', () => {
    expect(html).toMatch(/<details class="lp-acc-item" name="lp-acc-v2-acc" open="">/);
    expect(html.match(/<details/g)).toHaveLength(3);
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toContain('aria-selected="true"');
    expect(html.match(/role="tabpanel"/g)).toHaveLength(3);
  });

  it('wraps tables in a focusable, named scroll box', () => {
    expect(html).toContain('<div class="lp-table-scroll" role="region" aria-label="Builder MC-1, spring cohort" tabindex="0">');
    expect(html).toContain('lp-rtable lp-striped');
  });

  it('reserves every image box with its stored size', () => {
    for (const img of html.match(/<img [^>]*>/g) ?? []) {
      if (img.includes('data-nimg="fill"')) continue;
      expect(img).toMatch(/width="\d+"/);
      expect(img).toMatch(/height="\d+"/);
    }
  });

  it('draws an Image and text block with no picture as its text and buttons in one column (T328 N3)', () => {
    const team = LEARN_PAGE_DEFAULT.sections[1]!;
    const block = {
      id: 'it-nopic',
      kind: 'imageText',
      image: { src: '', alt: '', width: 0, height: 0 },
      imageSide: 'right',
      imageWidth: 'third',
      shape: 'rounded',
      text: 'Words beside no picture',
      buttons: [{ label: 'Apply', href: 'https://example.com/c-1', style: 'primary' }],
    };
    // As the /learn route reads it: through the parser first.
    const page = learnPageOrDefault({ ...LEARN_PAGE_DEFAULT, sections: [{ ...team, blocks: [block] }] });
    const html = renderToStaticMarkup(createElement(LearnPageView, { content: page }));
    const out = html.slice(html.indexOf('data-block-id="it-nopic"') - 200);
    expect(out).toMatch(/class="[^"]*lp-imageText[^"]*lp-it-noimage[^"]*"[^>]*data-block-id="it-nopic"/);
    expect(out).not.toMatch(/lp-it-(right|third)/);
    expect(out).toContain('Words beside no picture');
    expect(out).toContain('href="https://example.com/c-1"');
    expect(out).not.toContain('lp-it-media');
    expect(out).not.toContain('<img');
  });

  it('draws a person with no photo as an initials tile, as the editor preview does (T324 D12)', () => {
    const team = LEARN_PAGE_DEFAULT.sections[1]!;
    const people = { id: 'pp', kind: 'people', style: 'cards', columns: 3, people: [{ id: 'a', name: 'Kay Graph', role: 'Lead' }] } as LearnBlock;
    const html = render({ ...LEARN_PAGE_DEFAULT, sections: [{ ...team, blocks: [people] }] });
    expect(html).toContain('<div class="lp-person-nophoto" aria-hidden="true">KG</div>');
    // Every founder on the built-in page has a photo, so /learn with nothing published is unchanged.
    expect(render()).not.toContain('lp-person-nophoto');
  });

  it('leaves the default page as it was: no v2 classes, one wrapper', () => {
    const v1 = render();
    expect(v1.match(/<div class="lp-page">/g)).toHaveLength(1);
    expect(v1.replace(/^<link [^>]*>/, '').startsWith('<div class="lp-page">')).toBe(true);
    expect(v1).not.toMatch(/lp-(vis|mw|tc|bgc|on-dark|layout)/);
  });
});
