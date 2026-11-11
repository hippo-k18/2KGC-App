import { describe, expect, it } from 'vitest';
import type { LearnBlock, LearnSection } from '@kgc/shared';
import { BLOCK_KINDS, layoutColumns } from './learn-editor-core';
import { SECTION_TEMPLATES, TEMPLATE_CATEGORIES } from './learn-templates';

/** Every `id` anywhere in the section: the section, its blocks and their items, people and images. */
function allIds(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => allIds(v, out));
  else if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (typeof rec.id === 'string') out.push(rec.id);
    Object.entries(rec).forEach(([k, v]) => k !== 'blockColumn' && allIds(v, out));
  }
  return out;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BACKGROUNDS = ['plain', 'white-wave', 'light-blue-wave', 'blue', 'grey-wave'];
const WIDTHS = ['narrow', 'normal', 'wide'];
const SPACING = ['none', 'small', 'medium', 'large'];
const LAYOUTS = ['single', 'two-equal', 'two-wide-left', 'two-wide-right', 'three'];
const ALIGN = ['left', 'center', 'right'];
const SIZES = ['small', 'normal', 'large', 'x-large'];
const BUTTON_STYLES = ['primary', 'secondary', 'text'];
const COLUMNS = [1, 2, 3, 4];

function checkBlock(b: LearnBlock): void {
  expect(BLOCK_KINDS.map((k) => k.kind)).toContain(b.kind);
  if (b.align !== undefined) expect(ALIGN).toContain(b.align);
  if (b.spaceAbove !== undefined) expect(SPACING).toContain(b.spaceAbove);
  if (b.spaceBelow !== undefined) expect(SPACING).toContain(b.spaceBelow);
  switch (b.kind) {
    case 'heading':
      expect([1, 2, 3, 4]).toContain(b.level);
      if (b.size) expect(SIZES).toContain(b.size);
      break;
    case 'text':
      if (b.size) expect(SIZES).toContain(b.size);
      break;
    case 'image':
      expect(['small', 'medium', 'large', 'full']).toContain(b.width);
      expect(['square', 'rounded', 'circle', 'original']).toContain(b.shape);
      break;
    case 'buttons':
      expect(b.buttons.length).toBeGreaterThan(0);
      b.buttons.forEach((x) => expect(BUTTON_STYLES).toContain(x.style));
      break;
    case 'people':
      expect(['cards', 'list']).toContain(b.style);
      expect(COLUMNS).toContain(b.columns);
      break;
    case 'cards':
      expect(COLUMNS).toContain(b.columns);
      b.items.forEach((i) => i.link && expect(BUTTON_STYLES).toContain(i.link.style));
      break;
    case 'stats':
      expect(COLUMNS).toContain(b.columns);
      break;
    case 'gallery':
      expect(['grid', 'carousel', 'masonry']).toContain(b.layout);
      expect(COLUMNS).toContain(b.columns);
      break;
    case 'quote':
      expect(['plain', 'large', 'card']).toContain(b.style);
      break;
    case 'embed':
      expect(['16:9', '4:3', '1:1', 'auto']).toContain(b.aspect);
      expect(b.title.trim()).not.toBe('');
      break;
  }
}

function checkSection(s: LearnSection): void {
  expect(BACKGROUNDS).toContain(s.background);
  expect(WIDTHS).toContain(s.width);
  expect(SPACING).toContain(s.paddingTop);
  expect(SPACING).toContain(s.paddingBottom);
  if (s.layout !== undefined) expect(LAYOUTS).toContain(s.layout);
  expect(s.label.trim()).not.toBe('');
  expect(s.blocks.length).toBeGreaterThan(0);
  s.blocks.forEach(checkBlock);
}

describe('SECTION_TEMPLATES', () => {
  it('has the eleven templates with unique ids and known categories', () => {
    expect(SECTION_TEMPLATES).toHaveLength(11);
    expect(new Set(SECTION_TEMPLATES.map((t) => t.id)).size).toBe(11);
    for (const t of SECTION_TEMPLATES) {
      expect(TEMPLATE_CATEGORIES).toContain(t.category);
      expect(t.name.trim()).not.toBe('');
      expect(t.hint.trim()).not.toBe('');
    }
    // Every category has at least one template, so no filter shows an empty grid.
    for (const c of TEMPLATE_CATEGORIES) expect(SECTION_TEMPLATES.some((t) => t.category === c)).toBe(true);
  });

  it.each(SECTION_TEMPLATES.map((t) => [t.name, t] as const))('%s builds a valid section', (_name, t) => {
    checkSection(t.build());
  });

  it('gives unique, well-formed ids, and fresh ones on every build', () => {
    for (const t of SECTION_TEMPLATES) {
      const a = allIds(t.build());
      const b = allIds(t.build());
      expect(new Set(a).size).toBe(a.length);
      a.forEach((id) => expect(id).toMatch(ID_RE));
      expect(a.filter((id) => b.includes(id))).toEqual([]);
    }
  });

  it('points every column entry at a block in the section, inside the layout', () => {
    for (const t of SECTION_TEMPLATES) {
      const s = t.build();
      if (!s.blockColumn) continue;
      const ids = new Set(s.blocks.map((b) => b.id));
      for (const [key, col] of Object.entries(s.blockColumn)) {
        expect(ids.has(key)).toBe(true);
        expect(col).toBeGreaterThanOrEqual(0);
        expect(col).toBeLessThan(layoutColumns(s.layout));
      }
    }
  });

  it('puts text in the first column and the image in the second for Text and image', () => {
    const s = SECTION_TEMPLATES.find((t) => t.id === 'text-image')!.build();
    expect(s.layout).toBe('two-equal');
    for (const b of s.blocks) expect(s.blockColumn?.[b.id]).toBe(b.kind === 'image' ? 1 : 0);
  });

  it('has no em dash anywhere', () => {
    const all = JSON.stringify(SECTION_TEMPLATES.map((t) => ({ ...t, section: t.build() })));
    expect(all).not.toContain(String.fromCharCode(0x2014));
  });
});
