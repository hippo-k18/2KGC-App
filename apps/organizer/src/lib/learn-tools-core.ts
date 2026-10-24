import { expandedBlockId, expandReusableBlocks, isSafeHref, LEARN_COLORS, parseRichContent, slugifyAnchor } from '@kgc/shared';
import type {
  BandBackground,
  ColorValue,
  LearnBlock,
  LearnPageContent,
  LearnSection,
  LinkButton,
  PageImage,
  RichContent,
  RichNode,
} from '@kgc/shared';
import { blockSummary, cloneBlockWithNewIds, cloneSectionWithNewIds, kindLabel, starterLines, starterList } from './learn-editor-core';
import { isRichDoc, mapRichText, richColors, richHeadings, richLinks, richOneLine, richTextRuns } from './learn-rich';

/**
 * The Learn editor's page-wide tools, with no React in them (T318): find and
 * replace over every piece of text, the accessibility and link checks, anchor
 * rules, colour contrast, the clipboard format and the status line.
 *
 * Each walks the content in one fixed order (page, then sections top to
 * bottom, then blocks), so a match or an issue found here names the same place
 * the outline shows, and "jump to" can select it.
 */

/** Where a piece of text, an issue or a link lives, in words a course lead can follow. */
export interface Where {
  sectionId?: string;
  blockId?: string;
  /** "Heading", "Button 2 label", "Person 3 bio". */
  field: string;
}

// ─── Colour ───────────────────────────────────────────────────────────────────

/**
 * The brand names a `ColorValue` may carry, as the website draws them. The
 * hex values are T319's tokens (`LEARN_COLORS`), the one list the site's
 * stylesheet, the rich text editor and these contrast checks all read.
 */
export const BRAND_COLORS: Record<Exclude<ColorValue, `#${string}`>, { hex: string; label: string }> = {
  navy: { hex: LEARN_COLORS.navy, label: 'Navy' },
  blue: { hex: LEARN_COLORS.blue, label: 'Blue' },
  'light-blue': { hex: LEARN_COLORS['light-blue'], label: 'Light blue' },
  teal: { hex: LEARN_COLORS.teal, label: 'Teal' },
  orange: { hex: LEARN_COLORS.orange, label: 'Orange' },
  grey: { hex: LEARN_COLORS.grey, label: 'Grey' },
  dark: { hex: LEARN_COLORS.dark, label: 'Dark' },
  white: { hex: LEARN_COLORS.white, label: 'White' },
};

/**
 * What each band background looks like behind text, ignoring the wave art:
 * the `--lp-band` values in the website's `learn-page-view.css`. The light
 * blue wash is the one colour there that is not a brand token.
 */
export const BAND_BG_HEX: Record<BandBackground, string> = {
  plain: LEARN_COLORS.white,
  'white-wave': LEARN_COLORS.white,
  'light-blue-wave': '#e3f5fd',
  blue: LEARN_COLORS['light-blue'],
  'grey-wave': LEARN_COLORS.grey,
};

/** The site's body text colour. */
export const DEFAULT_TEXT_HEX = LEARN_COLORS.dark;

export function isHexColor(v: string): v is `#${string}` {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

export function colorHex(v: ColorValue | string | undefined): string | null {
  if (!v) return null;
  if (isHexColor(v)) return v.toLowerCase();
  return (BRAND_COLORS as Record<string, { hex: string }>)[v]?.hex ?? null;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** The colour text sits on in this section. A background photo is judged by its overlay. */
export function sectionBgHex(section: LearnSection): string {
  const custom = colorHex(section.backgroundColor);
  if (custom) return custom;
  // The site turns text white from an overlay of 0.3 (`sectionIsDark`), so
  // from there the text is judged against the dark photo it then sits on.
  if (section.backgroundImage?.src && (section.overlay ?? 0) >= 0.3) return LEARN_COLORS.dark;
  return BAND_BG_HEX[section.background];
}

/** Below 4.5:1 normal text is hard to read (WCAG AA). */
export const MIN_CONTRAST = 4.5;

// ─── Anchors ──────────────────────────────────────────────────────────────────

export const ANCHOR_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "Our Team!" to "our-team", by the same rule as the server. */
export { slugifyAnchor };

/** Every anchor on the page, with who holds it. */
export function pageAnchors(content: LearnPageContent): { anchor: string; sectionId: string; blockId?: string; label: string }[] {
  const out: { anchor: string; sectionId: string; blockId?: string; label: string }[] = [];
  for (const s of content.sections) {
    if (s.anchor) out.push({ anchor: s.anchor, sectionId: s.id, label: s.label || 'Section' });
    for (const b of s.blocks) if (b.anchor) out.push({ anchor: b.anchor, sectionId: s.id, blockId: b.id, label: blockSummary(b) });
  }
  return out;
}

/** What is wrong with `anchor` for the thing `ownerId`, or null when it is fine. */
export function anchorProblem(content: LearnPageContent, anchor: string, ownerId: string): string | null {
  if (!anchor) return null;
  if (!ANCHOR_RE.test(anchor)) return 'Use lower-case letters, numbers and dashes only, like our-team.';
  if (anchor.length > 64) return 'Keep it under 64 characters.';
  const clash = pageAnchors(content).find((a) => a.anchor === anchor && (a.blockId ?? a.sectionId) !== ownerId);
  return clash ? `"${clash.label}" already uses #${anchor}. Each link name must be different.` : null;
}

// ─── Walking every piece of text ─────────────────────────────────────────────

export type TextValue = { rich: true; value: RichContent } | { rich: false; value: string };
type Visit = (where: Where, v: TextValue) => RichContent | string;

/**
 * Calls `visit` on every visible piece of text in page order, and rebuilds the
 * content from what it returns. Returns `content` itself when nothing changed.
 * Editor-only notes and section names are not page text and are skipped.
 */
export function mapPageText(content: LearnPageContent, visit: Visit): LearnPageContent {
  const plain = (where: Where, v: string | undefined): string | undefined =>
    v === undefined ? undefined : (visit(where, { rich: false, value: v }) as string);
  const rich = (where: Where, v: RichContent | undefined): RichContent | undefined =>
    v === undefined ? undefined : (visit(where, { rich: true, value: v }) as RichContent);

  let changed = false;
  /** Sets `obj[key]` on a copy when the value changed. */
  const set = <T extends object>(obj: T, key: keyof T, next: unknown): T => {
    if (obj[key] === next || next === undefined) return obj;
    changed = true;
    return { ...obj, [key]: next };
  };

  const img = (where: Where, image: PageImage | undefined, label = 'Image description'): PageImage | undefined =>
    image ? set(image, 'alt', plain({ ...where, field: label }, image.alt)) : image;
  const link = (where: Where, l: LinkButton | undefined, label: string): LinkButton | undefined =>
    l ? set(l, 'label', plain({ ...where, field: label }, l.label)) : l;

  let page = content;
  page = set(page, 'seoTitle', plain({ field: 'Page title' }, page.seoTitle));
  page = set(page, 'seoDescription', plain({ field: 'Page description' }, page.seoDescription));
  if (page.ogImage) page = set(page, 'ogImage', img({ field: '' }, page.ogImage, 'Share image description'));

  const sections = page.sections.map((s) => {
    const before = changed;
    changed = false;
    const blocks = s.blocks.map((b) => block(s, b));
    const touched = changed;
    changed = before || touched;
    return touched ? { ...s, blocks } : s;
  });

  function block(s: LearnSection, b: LearnBlock): LearnBlock {
    const w: Where = { sectionId: s.id, blockId: b.id, field: '' };
    const f = (field: string): Where => ({ ...w, field });
    let n = b as LearnBlock;
    const put = (key: string, v: unknown) => {
      n = set(n as unknown as Record<string, unknown>, key, v) as unknown as LearnBlock;
    };
    const items = <T extends object>(list: T[], each: (item: T, i: number) => T): T[] => {
      let any = false;
      const next = list.map((it, i) => {
        const x = each(it, i);
        if (x !== it) any = true;
        return x;
      });
      return any ? next : list;
    };
    switch (n.kind) {
      case 'heading':
        put('text', rich(f('Heading'), n.text));
        break;
      case 'text':
        put('text', rich(f('Text'), n.text));
        break;
      case 'image':
        put('image', img(w, n.image));
        put('caption', plain(f('Caption'), n.caption));
        break;
      case 'buttons':
        put('buttons', items(n.buttons, (bt, i) => link(w, bt, `Button ${i + 1} label`)!));
        break;
      case 'people':
        put(
          'people',
          items(n.people, (p, i) => {
            let q = p;
            q = set(q, 'name', plain(f(`Person ${i + 1} name`), q.name));
            q = set(q, 'role', plain(f(`Person ${i + 1} role`), q.role));
            q = set(q, 'bio', rich(f(`Person ${i + 1} bio`), q.bio));
            q = set(q, 'photo', img(w, q.photo, `Person ${i + 1} photo description`));
            return q;
          }),
        );
        break;
      case 'list':
        put(
          'items',
          items(n.items, (it, i) => {
            let q = it;
            q = set(q, 'title', plain(f(`Item ${i + 1} title`), q.title));
            q = set(q, 'text', rich(f(`Item ${i + 1}`), q.text));
            if (q.children) q = set(q, 'children', items(q.children.map((c) => ({ c })), (o, j) => set(o, 'c', plain(f(`Item ${i + 1} sub-item ${j + 1}`), o.c))).map((o) => o.c));
            q = set(q, 'link', link(w, q.link, `Item ${i + 1} link`));
            return q;
          }),
        );
        break;
      case 'columns':
        put(
          'items',
          items(n.items, (it, i) => {
            let q = it;
            q = set(q, 'title', plain(f(`Column ${i + 1} title`), q.title));
            q = set(q, 'text', rich(f(`Column ${i + 1}`), q.text));
            q = set(q, 'link', link(w, q.link, `Column ${i + 1} link`));
            q = set(q, 'image', img(w, q.image, `Column ${i + 1} image description`));
            return q;
          }),
        );
        break;
      case 'video':
        put('caption', plain(f('Caption'), n.caption));
        break;
      case 'imageText':
        put('image', img(w, n.image));
        put('text', rich(f('Text'), n.text));
        if (n.buttons) put('buttons', items(n.buttons, (bt, i) => link(w, bt, `Button ${i + 1} label`)!));
        break;
      case 'gallery':
        put(
          'images',
          items(n.images, (im, i) => {
            let q = im;
            q = set(q, 'alt', plain(f(`Photo ${i + 1} description`), q.alt));
            q = set(q, 'caption', plain(f(`Photo ${i + 1} caption`), q.caption));
            return q;
          }),
        );
        break;
      case 'quote':
        put('text', rich(f('Quote'), n.text));
        put('name', plain(f('Name'), n.name));
        put('role', plain(f('Role'), n.role));
        put('photo', img(w, n.photo, 'Photo description'));
        break;
      case 'callout':
        put('title', plain(f('Title'), n.title));
        put('text', rich(f('Text'), n.text));
        break;
      case 'accordion':
      case 'tabs': {
        const noun = n.kind === 'tabs' ? 'Tab' : 'Question';
        put(
          'items',
          items(n.items as { id: string; title: string; text: RichContent }[], (it, i) => {
            let q = it;
            q = set(q, 'title', plain(f(`${noun} ${i + 1} title`), q.title));
            q = set(q, 'text', rich(f(`${noun} ${i + 1} text`), q.text));
            return q;
          }),
        );
        break;
      }
      case 'stats':
        put(
          'items',
          items(n.items, (it, i) => {
            let q = it;
            q = set(q, 'value', plain(f(`Number ${i + 1}`), q.value));
            q = set(q, 'label', plain(f(`Number ${i + 1} label`), q.label));
            return q;
          }),
        );
        break;
      case 'cards':
        put(
          'items',
          items(n.items, (it, i) => {
            let q = it;
            q = set(q, 'title', plain(f(`Card ${i + 1} title`), q.title));
            q = set(q, 'text', rich(f(`Card ${i + 1} text`), q.text));
            q = set(q, 'badge', plain(f(`Card ${i + 1} badge`), q.badge));
            q = set(q, 'link', link(w, q.link, `Card ${i + 1} link`));
            q = set(q, 'image', img(w, q.image, `Card ${i + 1} image description`));
            return q;
          }),
        );
        break;
      case 'logos':
        put('items', items(n.items, (it, i) => set(it, 'alt', plain(f(`Logo ${i + 1} name`), it.alt))));
        break;
      case 'embed':
        put('title', plain(f('Title'), n.title));
        break;
      case 'countdown':
        put('label', plain(f('Label'), n.label));
        put('doneText', plain(f('Text after the date'), n.doneText));
        break;
      case 'table':
        put('doc', rich(f('Table'), n.doc));
        put('caption', plain(f('Caption'), n.caption));
        break;
      case 'toc':
        put('title', plain(f('Title'), n.title));
        break;
      case 'divider':
      case 'spacer':
      case 'reusable':
        break;
    }
    return n;
  }

  const anySection = sections.some((s, i) => s !== page.sections[i]);
  if (anySection) page = { ...page, sections };
  return page === content ? content : page;
}

// ─── Find and replace ────────────────────────────────────────────────────────

export interface FindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
}

export interface FindMatch {
  /** Stable while the content is unchanged: field order, run, offset. */
  id: string;
  where: Where;
  /** The text around the match, for the results list. */
  before: string;
  match: string;
  after: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findRegex(query: string, opts: FindOptions = {}): RegExp | null {
  if (!query) return null;
  const body = escapeRe(query);
  const src = opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
  return new RegExp(src, `gu${opts.matchCase ? '' : 'i'}`);
}

/** Parts of a v1 Markdown string that are link targets, which find must not touch. */
function protectedRanges(run: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /\]\(([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(run)) !== null) out.push([m.index + 2, m.index + 2 + m[1].length]);
  return out;
}

function runMatches(run: string, re: RegExp, isMarkdown: boolean): { index: number; text: string }[] {
  const guard = isMarkdown ? protectedRanges(run) : [];
  const out: { index: number; text: string }[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(run)) !== null) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    const end = m.index + m[0].length;
    if (!guard.some(([a, b]) => m!.index < b && end > a)) out.push({ index: m.index, text: m[0] });
  }
  return out;
}

const CONTEXT = 30;

/** Every match of `query` in the page, in page order. */
export function findInPage(content: LearnPageContent, query: string, opts: FindOptions = {}): FindMatch[] {
  const re = findRegex(query, opts);
  if (!re) return [];
  const out: FindMatch[] = [];
  let field = 0;
  mapPageText(content, (where, v) => {
    const runs = v.rich ? richTextRuns(v.value) : [v.value];
    const md = typeof v.value === 'string' && v.rich;
    runs.forEach((run, r) => {
      for (const m of runMatches(run, re, md)) {
        out.push({
          id: `${field}:${r}:${m.index}`,
          where,
          before: run.slice(Math.max(0, m.index - CONTEXT), m.index),
          match: m.text,
          after: run.slice(m.index + m.text.length, m.index + m.text.length + CONTEXT),
        });
      }
    });
    field++;
    return v.value;
  });
  return out;
}

function replaceInRun(run: string, re: RegExp, replacement: string, isMarkdown: boolean, only?: number): string {
  const hits = runMatches(run, re, isMarkdown).filter((m) => only === undefined || m.index === only);
  if (hits.length === 0) return run;
  let out = '';
  let last = 0;
  for (const h of hits) {
    out += run.slice(last, h.index) + replacement;
    last = h.index + h.text.length;
  }
  return out + run.slice(last);
}

/**
 * Replace every match, or only the one whose id is `onlyId`. Returns the new
 * content and how many were replaced; the same content object when none.
 */
export function replaceInPage(
  content: LearnPageContent,
  query: string,
  replacement: string,
  opts: FindOptions = {},
  onlyId?: string,
): { content: LearnPageContent; count: number } {
  const re = findRegex(query, opts);
  if (!re) return { content, count: 0 };
  const [onlyField, onlyRun, onlyAt] = onlyId ? onlyId.split(':').map(Number) : [];
  let count = 0;
  let field = 0;
  const next = mapPageText(content, (_where, v) => {
    const f = field++;
    if (onlyId && f !== onlyField) return v.value;
    const md = typeof v.value === 'string';
    if (!v.rich || typeof v.value === 'string') {
      if (onlyId && onlyRun !== 0) return v.value;
      const run = v.value as string;
      const n = runMatches(run, re, v.rich && md).filter((m) => !onlyId || m.index === onlyAt).length;
      if (n === 0) return run;
      count += n;
      return replaceInRun(run, re, replacement, v.rich && md, onlyId ? onlyAt : undefined);
    }
    let r = 0;
    return mapRichText(v.value, (run) => {
      const ri = r++;
      if (onlyId && ri !== onlyRun) return run;
      const n = runMatches(run, re, false).filter((m) => !onlyId || m.index === onlyAt).length;
      if (n === 0) return run;
      count += n;
      return replaceInRun(run, re, replacement, false, onlyId ? onlyAt : undefined);
    });
  });
  return { content: next, count };
}

// ─── Accessibility checker ───────────────────────────────────────────────────

export type IssueRule = 'alt' | 'heading-order' | 'contrast' | 'empty-link' | 'vague-link' | 'table-header' | 'starter-text' | 'no-name' | 'no-words';

export interface Issue {
  id: string;
  rule: IssueRule;
  severity: 'error' | 'warning';
  message: string;
  /** One line on how to fix it, for someone who is not technical. */
  fix: string;
  where: Where;
}

export const ISSUE_RULE_LABEL: Record<IssueRule, string> = {
  alt: 'Missing image description',
  'heading-order': 'Heading order',
  contrast: 'Hard to read colours',
  'empty-link': 'Empty link',
  'vague-link': 'Unclear link text',
  'table-header': 'Table without a header row',
  'starter-text': 'Starter text left in',
  'no-name': 'Person with no name',
  'no-words': 'List item with no words',
};

/** Link words that say nothing out of context, which is how screen reader users often hear links. */
const VAGUE = new Set(['click here', 'here', 'read more', 'more', 'learn more', 'link', 'this', 'this link', 'go', 'details', 'click', 'more info', 'info']);

export function isVagueLinkText(text: string): boolean {
  return VAGUE.has(text.trim().toLowerCase().replace(/[.!:…]+$/, '').trim());
}

/** Things on the visible page that make it harder to use with a screen reader or to read. Hidden parts are skipped. */
export function accessibilityIssues(content: LearnPageContent): Issue[] {
  const out: Issue[] = [];
  let n = 0;
  const add = (rule: IssueRule, severity: Issue['severity'], message: string, fix: string, where: Where) =>
    out.push({ id: `${rule}-${n++}`, rule, severity, message, fix, where });

  const altFix = 'Select it and fill in "Description". Say what the picture shows, in a few words.';
  const linkCheck = (where: Where, label: string, href: string, what: string) => {
    if (!label.trim() || !href.trim())
      add('empty-link', 'error', `${what} has no ${!label.trim() ? 'text' : 'link'}.`, 'Give it words and an address, or remove it.', where);
    else if (isVagueLinkText(label))
      add('vague-link', 'warning', `${what} says "${label.trim()}".`, 'Say where it goes, like "Download the brochure".', where);
  };

  let lastLevel = 0;
  let h1s = 0;
  const heading = (level: number, text: string, where: Where) => {
    if (level === 1) h1s++;
    if (level === 1 && h1s === 2)
      add('heading-order', 'warning', 'The page has more than one big title (H1).', 'Keep one H1 at the top; make the others H2.', where);
    if (lastLevel > 0 && level > lastLevel + 1)
      add(
        'heading-order',
        'warning',
        `"${text.slice(0, 40)}" jumps from H${lastLevel} to H${level}.`,
        `Use H${lastLevel + 1} here, or change the heading above it.`,
        where,
      );
    else if (lastLevel === 0 && level > 2)
      add('heading-order', 'warning', `The first heading on the page is H${level}.`, 'Start with H1 or H2.', where);
    lastLevel = level;
  };

  if (content.ogImage?.src && !content.ogImage.alt.trim())
    add('alt', 'warning', 'The share image has no description.', altFix, { field: 'Share image' });

  for (const s of content.sections) {
    if (s.hidden) continue;
    const bg = sectionBgHex(s);
    for (const b of s.blocks) {
      if (b.hidden) continue;
      const w = (field: string): Where => ({ sectionId: s.id, blockId: b.id, field });
      const img = (image: PageImage | undefined, field: string) => {
        if (image?.src && !image.alt.trim()) add('alt', 'error', `${field} has no description.`, altFix, w(field));
      };
      const richCheck = (c: RichContent | undefined, field: string) => {
        if (!c) return;
        for (const h of richHeadings(c)) heading(h.level, h.text, w(field));
        for (const l of richLinks(c)) linkCheck(w(field), l.text, l.href, `A link in ${field.toLowerCase()}`);
        for (const col of richColors(c)) {
          const hex = colorHex(col);
          if (hex && contrastRatio(hex, bg) < MIN_CONTRAST)
            add('contrast', 'warning', `Coloured text in ${field.toLowerCase()} is hard to read on this background (${contrastRatio(hex, bg)}:1).`, 'Pick a darker or lighter colour. Aim for 4.5:1 or more.', w(field));
        }
      };

      const text = colorHex(b.textColor);
      if (text && contrastRatio(text, bg) < MIN_CONTRAST)
        add(
          'contrast',
          'warning',
          `Text colour is hard to read on this background (${contrastRatio(text, bg)}:1).`,
          'Choose another text colour or section background. Aim for 4.5:1 or more.',
          w('Text colour'),
        );

      switch (b.kind) {
        case 'heading':
          heading(b.level, richOneLine(b.text), w('Heading'));
          richCheck(b.text, 'Heading');
          if (!richOneLine(b.text)) add('heading-order', 'warning', 'A heading is empty.', 'Type a heading or remove the block.', w('Heading'));
          break;
        case 'text':
          richCheck(b.text, 'Text');
          break;
        case 'image':
          img(b.image, 'Image');
          if (b.href) linkCheck(w('Image link'), b.image.alt || b.caption || 'image', b.href, 'The image link');
          break;
        case 'buttons':
          b.buttons.forEach((bt, i) => linkCheck(w(`Button ${i + 1}`), bt.label, bt.href, `Button ${i + 1}`));
          break;
        case 'people':
          b.people.forEach((p, i) => {
            // The website leaves out a person with no name, and publish refuses one (T343).
            if (!p.name.trim())
              add('no-name', 'error', `Person ${i + 1} has no name, so the website would leave them out.`, 'Type their name, or remove them.', w(`Person ${i + 1} name`));
            img(p.photo, `Photo of ${p.name || `person ${i + 1}`}`);
            richCheck(p.bio, `Bio of ${p.name || `person ${i + 1}`}`);
          });
          break;
        case 'list':
          b.items.forEach((it, i) => {
            // The website leaves out an item with no words, and its sub-items with it; publish refuses one (T348).
            if (parseRichContent(it.text) === undefined && !it.title?.trim() && (it.children ?? []).some((c) => c.trim()))
              add('no-words', 'error', `Item ${i + 1} has no words, so the website would leave it out with its sub-items.`, 'Type its words, or remove it.', w(`Item ${i + 1}`));
            richCheck(it.text, `Item ${i + 1}`);
            if (it.link) linkCheck(w(`Item ${i + 1} link`), it.link.label, it.link.href, `The link in item ${i + 1}`);
          });
          break;
        case 'columns':
          b.items.forEach((it, i) => {
            img(it.image, `Column ${i + 1} image`);
            richCheck(it.text, `Column ${i + 1}`);
            if (it.link) linkCheck(w(`Column ${i + 1} link`), it.link.label, it.link.href, `The link in column ${i + 1}`);
          });
          break;
        case 'imageText':
          img(b.image, 'Image');
          richCheck(b.text, 'Text');
          b.buttons?.forEach((bt, i) => linkCheck(w(`Button ${i + 1}`), bt.label, bt.href, `Button ${i + 1}`));
          break;
        case 'gallery':
          b.images.forEach((im, i) => img(im, `Photo ${i + 1}`));
          break;
        case 'quote':
          img(b.photo, 'Quote photo');
          richCheck(b.text, 'Quote');
          break;
        case 'callout':
          richCheck(b.text, 'Note box');
          break;
        case 'accordion':
        case 'tabs':
          b.items.forEach((it, i) => richCheck(it.text, `${b.kind === 'tabs' ? 'Tab' : 'Question'} ${i + 1}`));
          break;
        case 'cards':
          b.items.forEach((it, i) => {
            img(it.image, `Card ${i + 1} image`);
            richCheck(it.text, `Card ${i + 1}`);
            if (it.link) linkCheck(w(`Card ${i + 1} link`), it.link.label, it.link.href, `The link on card ${i + 1}`);
          });
          break;
        case 'logos':
          b.items.forEach((it, i) => img(it, `Logo ${i + 1}`));
          break;
        // No 'embed' case: an empty title is fine, www uses the service's name ("Map", "Video"). T326 item 6.
        case 'table': {
          const table = b.doc.content.find((x) => x.type === 'table') as Extract<RichNode, { type: 'table' }> | undefined;
          const first = table?.content[0] as Extract<RichNode, { type: 'tableRow' }> | undefined;
          if (table && !first?.content.some((c) => c.type === 'tableHeader'))
            add('table-header', 'warning', 'The table has no header row.', 'Turn the first row into headers in the table toolbar.', w('Table'));
          richCheck(b.doc, 'Table');
          break;
        }
        default:
          break;
      }

      // T326 N3: a new block's own words, left in, publish as real copy.
      const starter = starterLines(b);
      if (starter.length)
        add(
          'starter-text',
          'warning',
          `The ${kindLabel(b.kind)} block still has starter text: ${starterList(starter)}.`,
          'Replace it with your own words, or delete it.',
          w(kindLabel(b.kind)),
        );
    }
  }
  return out;
}

/**
 * The checker's counts by severity (T332, C N1): a warning is "worth a look",
 * never a thing to fix, so starter text no longer shows as a red "1 thing to
 * fix" under a rule that says "Worth a look".
 */
export function issueCounts(issues: readonly Issue[]): { fix: number; look: number } {
  const fix = issues.filter((i) => i.severity === 'error').length;
  return { fix, look: issues.length - fix };
}

/** "2 things to fix, 1 worth a look", for the top of the checker. */
export function issueSummary(counts: { fix: number; look: number }): string {
  const parts: string[] = [];
  if (counts.fix) parts.push(counts.fix === 1 ? '1 thing to fix' : `${counts.fix} things to fix`);
  if (counts.look) parts.push(`${counts.look} worth a look`);
  return parts.join(', ');
}

// ─── Link checker ────────────────────────────────────────────────────────────

export type LinkStatus = 'ok' | 'warning' | 'error';

export interface PageLink {
  id: string;
  href: string;
  text: string;
  where: Where;
  /** What the site does with it: another website, this site, part of this page, email, phone. */
  type: 'external' | 'internal' | 'anchor' | 'email' | 'phone' | 'other';
  status: LinkStatus;
  message: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Every link on the page, each checked without leaving the browser. */
export function pageLinks(content: LearnPageContent): PageLink[] {
  const anchors = new Set(pageAnchors(content).map((a) => a.anchor));
  const out: PageLink[] = [];
  let n = 0;
  const add = (href: string, text: string, where: Where) => {
    const h = href.trim();
    let type: PageLink['type'] = 'other';
    let status: LinkStatus = 'ok';
    let message = '';
    if (!h) {
      status = 'error';
      message = 'No address yet.';
    } else if (h.startsWith('#')) {
      type = 'anchor';
      if (!anchors.has(h.slice(1))) {
        status = 'error';
        message = `Nothing on this page is named ${h}. Give a section or block that link name.`;
      } else message = 'Jumps to a part of this page.';
    } else if (/^mailto:/i.test(h)) {
      type = 'email';
      const addr = decodeURIComponent(h.slice(7).split('?')[0]);
      if (!EMAIL.test(addr)) {
        status = 'error';
        message = `"${addr}" does not look like an email address.`;
      } else message = `Opens an email to ${addr}.`;
    } else if (/^tel:/i.test(h)) {
      type = 'phone';
      if (!/^\+?[\d\s().-]{5,}$/.test(h.slice(4))) {
        status = 'error';
        message = 'That phone number has letters or is too short.';
      } else message = 'Calls this number on a phone.';
    } else if (h.startsWith('/') && !h.startsWith('//')) {
      type = 'internal';
      message = 'Opens a page on this website.';
    } else if (/^https?:\/\//i.test(h)) {
      type = 'external';
      let host = '';
      try {
        host = new URL(h).hostname;
      } catch {
        status = 'error';
        message = 'That address is not complete.';
      }
      if (status === 'ok') {
        if (/^http:/i.test(h)) {
          status = 'warning';
          message = 'Starts with http:, which browsers mark as not secure. Use https: if the site has it.';
        } else if (/(^|\.)knowledgegraph\.tech$/.test(host)) {
          type = 'internal';
          message = 'Opens a page on this website.';
        } else message = `Opens ${host}.`;
      }
    } else {
      status = 'error';
      message = 'Links should start with https://, mailto:, tel:, / or #.';
    }
    if (status === 'ok' && h && !isSafeHref(h)) {
      status = 'error';
      message = 'The site will not open this kind of link.';
    }
    out.push({ id: `l${n++}`, href: h, text, where, type, status, message });
  };

  for (const s of content.sections) {
    for (const b of s.blocks) {
      const w = (field: string): Where => ({ sectionId: s.id, blockId: b.id, field });
      const rich = (c: RichContent | undefined, field: string) => {
        for (const l of richLinks(c)) add(l.href, l.text, w(field));
      };
      const btn = (l: LinkButton | undefined, field: string) => {
        if (l) add(l.href, l.label, w(field));
      };
      switch (b.kind) {
        case 'heading':
        case 'text':
          rich(b.text, b.kind === 'heading' ? 'Heading' : 'Text');
          break;
        case 'image':
          if (b.href) add(b.href, b.image.alt || 'Image', w('Image link'));
          break;
        case 'buttons':
          b.buttons.forEach((x, i) => btn(x, `Button ${i + 1}`));
          break;
        case 'people':
          b.people.forEach((p) => {
            if (p.linkedin) add(p.linkedin, `${p.name} on LinkedIn`, w(`${p.name || 'Person'} LinkedIn`));
            rich(p.bio, `${p.name || 'Person'} bio`);
          });
          break;
        case 'list':
          b.items.forEach((it, i) => {
            rich(it.text, `Item ${i + 1}`);
            btn(it.link, `Item ${i + 1} link`);
          });
          break;
        case 'columns':
          b.items.forEach((it, i) => {
            rich(it.text, `Column ${i + 1}`);
            btn(it.link, `Column ${i + 1} link`);
          });
          break;
        case 'imageText':
          rich(b.text, 'Text');
          b.buttons?.forEach((x, i) => btn(x, `Button ${i + 1}`));
          break;
        case 'quote':
        case 'callout':
          rich(b.text, b.kind === 'quote' ? 'Quote' : 'Note box');
          break;
        case 'accordion':
        case 'tabs':
          b.items.forEach((it, i) => rich(it.text, `${b.kind === 'tabs' ? 'Tab' : 'Question'} ${i + 1}`));
          break;
        case 'cards':
          b.items.forEach((it, i) => {
            rich(it.text, `Card ${i + 1}`);
            btn(it.link, `Card ${i + 1} link`);
          });
          break;
        case 'logos':
          b.items.forEach((it, i) => {
            if (it.href) add(it.href, it.alt || `Logo ${i + 1}`, w(`Logo ${i + 1} link`));
          });
          break;
        case 'table':
          rich(b.doc, 'Table');
          break;
        default:
          break;
      }
    }
  }
  return out;
}

// ─── Clipboard ───────────────────────────────────────────────────────────────

/**
 * What a copy puts on the system clipboard: JSON text with a marker, so a
 * paste in another browser tab (or after a reload) still works, and anything
 * else on the clipboard is ignored. Ids are replaced on paste, never trusted.
 */
export const CLIP_MARKER = 'kgc-learn-clipboard';
export const CLIP_VERSION = 1;

export type Clip = { kind: 'blocks'; blocks: LearnBlock[] } | { kind: 'sections'; sections: LearnSection[] };

export function serializeClip(clip: Clip): string {
  return JSON.stringify({ [CLIP_MARKER]: CLIP_VERSION, ...clip });
}

const MAX_CLIP_ITEMS = 60;

function looksLikeBlock(v: unknown): v is LearnBlock {
  return typeof v === 'object' && v !== null && typeof (v as LearnBlock).kind === 'string' && typeof (v as LearnBlock).id === 'string';
}

function looksLikeSection(v: unknown): v is LearnSection {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as LearnSection).id === 'string' &&
    Array.isArray((v as LearnSection).blocks) &&
    (v as LearnSection).blocks.every(looksLikeBlock)
  );
}

/**
 * A clipboard text back to blocks or sections with fresh ids, or null when it
 * is not ours. Only the shape is checked here; the server validates the draft
 * on save as it does for every edit.
 */
export function parseClip(text: string): Clip | null {
  if (!text || text.length > 400_000 || !text.includes(CLIP_MARKER)) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o[CLIP_MARKER] !== CLIP_VERSION) return null;
  if (o.kind === 'blocks' && Array.isArray(o.blocks) && o.blocks.length > 0 && o.blocks.length <= MAX_CLIP_ITEMS && o.blocks.every(looksLikeBlock))
    return { kind: 'blocks', blocks: o.blocks.map(cloneBlockWithNewIds) };
  if (o.kind === 'sections' && Array.isArray(o.sections) && o.sections.length > 0 && o.sections.length <= MAX_CLIP_ITEMS && o.sections.every(looksLikeSection))
    return { kind: 'sections', sections: o.sections.map((s) => cloneSectionWithNewIds(s, s.label)) };
  return null;
}

/** The blocks `ids` name, in page order, for a copy. */
export function blocksInPageOrder(content: LearnPageContent, ids: Iterable<string>): LearnBlock[] {
  const want = new Set(ids);
  const out: LearnBlock[] = [];
  for (const s of content.sections) for (const b of s.blocks) if (want.has(b.id)) out.push(b);
  return out;
}

// ─── Selecting several ───────────────────────────────────────────────────────

/** Block ids in page order from `fromId` to `toId` inclusive, for shift-click. */
export function blockRange(content: LearnPageContent, fromId: string, toId: string): string[] {
  const all = content.sections.flatMap((s) => s.blocks.map((b) => b.id));
  const a = all.indexOf(fromId);
  const b = all.indexOf(toId);
  if (a < 0 || b < 0) return b >= 0 ? [toId] : [];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return all.slice(lo, hi + 1);
}

// ─── Outline search ──────────────────────────────────────────────────────────

/** Sections and blocks whose words match `query`, for filtering the outline. Null means no filter. */
export function outlineMatches(content: LearnPageContent, query: string): { sections: Set<string>; blocks: Set<string> } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const sections = new Set<string>();
  const blocks = new Set<string>();
  const words = new Map<string, string>();
  mapPageText(content, (where, v) => {
    if (where.blockId) {
      const t = (v.rich ? richOneLine(v.value) : v.value).toLowerCase();
      words.set(where.blockId, `${words.get(where.blockId) ?? ''} ${t}`);
    }
    return v.value;
  });
  for (const s of content.sections) {
    const sectionHit = `${s.label} ${s.anchor ?? ''} ${s.note ?? ''}`.toLowerCase().includes(q);
    for (const b of s.blocks) {
      const hay = `${blockSummary(b)} ${b.kind} ${b.anchor ?? ''} ${b.note ?? ''} ${words.get(b.id) ?? ''}`.toLowerCase();
      if (hay.includes(q)) {
        blocks.add(b.id);
        sections.add(s.id);
      }
    }
    if (sectionHit) sections.add(s.id);
  }
  return { sections, blocks };
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

export interface StatusInput {
  saveState: SaveState;
  /** The draft differs from what visitors see. */
  unpublished: boolean;
  /** Anything has ever been published (or the built-in page is live). */
  live: boolean;
  scheduledAt?: number;
}

export interface StatusChip {
  label: 'Unsaved' | 'Saving' | 'Saved' | 'Not saved' | 'Scheduled' | 'Live' | 'Draft';
  tone: 'grey' | 'amber' | 'green' | 'red' | 'blue';
  detail: string;
}

/** The two chips the top bar always shows: how the draft is saved, and what visitors see. */
export function statusChips(s: StatusInput, formatTime: (ms: number) => string): [StatusChip, StatusChip] {
  const save: StatusChip =
    s.saveState === 'saving'
      ? { label: 'Saving', tone: 'grey', detail: 'Saving your draft.' }
      : s.saveState === 'unsaved'
        ? { label: 'Unsaved', tone: 'amber', detail: 'Your latest changes save in a moment.' }
        : s.saveState === 'error' || s.saveState === 'conflict'
          ? { label: 'Not saved', tone: 'red', detail: 'Your latest changes are not saved yet.' }
          : { label: 'Saved', tone: 'green', detail: 'Your draft is saved.' };
  const pub: StatusChip = s.scheduledAt
    ? { label: 'Scheduled', tone: 'blue', detail: `The draft goes live ${formatTime(s.scheduledAt)}.` }
    : s.unpublished
      ? { label: 'Draft', tone: 'amber', detail: 'The draft has changes that are not live yet.' }
      : { label: 'Live', tone: 'green', detail: s.live ? 'Visitors see exactly this page.' : 'Visitors see the built-in page.' };
  return [save, pub];
}

/** Why `at` cannot be a publish time, or null. */
export function scheduleProblem(at: number, now: number): string | null {
  if (!Number.isFinite(at)) return 'Choose a date and time.';
  if (at < now + 60_000) return 'Choose a time at least a minute from now.';
  if (at > now + 366 * 24 * 3600_000) return 'Choose a time within the next year.';
  return null;
}

/** Is `c` worth showing in a list as empty? A cheap check, no walk. */
export function isEmptyRich(c: RichContent | undefined): boolean {
  if (!c) return true;
  if (typeof c === 'string') return c.trim() === '';
  return isRichDoc(c) && richOneLine(c) === '';
}

// ─── Where an image is used ──────────────────────────────────────────────────

/** Every place `src` appears in `content`, as "Section › Block" lines, for the media library. */
export function imageUsage(content: LearnPageContent | null | undefined, src: string, prefix = ''): string[] {
  if (!content || !src) return [];
  const out: string[] = [];
  if (content.ogImage?.src === src) out.push(`${prefix}Page share image`);
  for (const s of content.sections) {
    if (s.backgroundImage?.src === src) out.push(`${prefix}${s.label || 'Section'} › background`);
    for (const b of s.blocks) {
      if (JSON.stringify(b).includes(JSON.stringify(src))) out.push(`${prefix}${s.label || 'Section'} › ${blockSummary(b)}`);
    }
  }
  return out;
}

// ─── Saved sections in the preview ───────────────────────────────────────────

/** The draft as the preview draws it, and where each drawn block came from. */
export interface PreviewExpansion {
  content: LearnPageContent;
  /** An expanded block's id to the id of the `reusable` block it stands in for. */
  hosts: ReadonlyMap<string, string>;
}

const NO_HOSTS: ReadonlyMap<string, string> = new Map();

/**
 * The draft with its `reusable` blocks expanded by T315's
 * `expandReusableBlocks`, the function Publish runs, so the preview shows
 * what will go live.
 *
 * A section keeps its `reusable` blocks (and the preview its placeholder for
 * them) while the library is loading, when one names a saved section that no
 * longer exists, or when one is hidden: expansion would make those vanish,
 * and the editor must still show something to select. Sections without
 * reusable blocks come back as the same objects, so their memoised blocks are
 * not drawn again.
 */
export function expandForPreview(
  content: LearnPageContent,
  library: ReadonlyMap<string, LearnSection> | null | undefined,
): PreviewExpansion {
  const has = (s: LearnSection) => s.blocks.some((b) => b.kind === 'reusable');
  if (!library || !content.sections.some(has)) return { content, hosts: NO_HOSTS };
  const expanded = expandReusableBlocks(content, library);
  const hosts = new Map<string, string>();
  const sections = content.sections.map((s, i) => {
    if (!has(s)) return s;
    const ready = s.blocks.every((b) => b.kind !== 'reusable' || (!b.hidden && library.has(b.libraryId)));
    if (!ready) return s;
    for (const b of s.blocks) {
      if (b.kind !== 'reusable') continue;
      for (const saved of library.get(b.libraryId)?.blocks ?? []) hosts.set(expandedBlockId(b.id, saved.id), b.id);
    }
    return expanded.sections[i];
  });
  return { content: { ...content, sections }, hosts };
}
