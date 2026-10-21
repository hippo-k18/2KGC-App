import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  LEARN_PAGE_DEFAULT,
  LEARN_PAGE_KITCHEN_SINK,
  learnPageOrDefault,
  type LearnBlock,
} from '@kgc/shared';
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
