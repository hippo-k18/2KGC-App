import { isSafeHref, type ColorValue } from '@kgc/shared';

/**
 * The rich text editor's small pure helpers (T317): colours and contrast,
 * link targets, find and replace, and the special character list. Kept out of
 * the components so Vitest can pin them without a browser.
 */

/* ── Colours ───────────────────────────────────────────────────────────── */

/**
 * What each brand colour name looks like in the editor. The website's
 * stylesheet is the authority (`apps/web/src/app/globals.css`, palette 1 to 6);
 * these are the same values.
 */
export const BRAND_COLORS: { value: Exclude<ColorValue, `#${string}`>; label: string; hex: string }[] = [
  { value: 'navy', label: 'Navy', hex: '#263759' },
  { value: 'blue', label: 'Blue', hex: '#1159af' },
  { value: 'light-blue', label: 'Light blue', hex: '#8dccee' },
  { value: 'teal', label: 'Teal', hex: '#17556a' },
  { value: 'orange', label: 'Orange', hex: '#f68621' },
  { value: 'grey', label: 'Grey', hex: '#5f6b7a' },
  { value: 'dark', label: 'Dark', hex: '#272338' },
  { value: 'white', label: 'White', hex: '#ffffff' },
];

export function colorHex(c: ColorValue): string {
  return BRAND_COLORS.find((b) => b.value === c)?.hex ?? c;
}

export function colorLabel(c: ColorValue): string {
  return BRAND_COLORS.find((b) => b.value === c)?.label ?? c.toLowerCase();
}

/** A typed custom colour as `#rrggbb`, or null. Accepts `#abc`, `abc`, `#AABBCC`. */
export function parseHex(input: string): `#${string}` | null {
  const t = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(t)) return `#${t.split('').map((ch) => ch + ch).join('')}`;
  if (/^[0-9a-f]{6}$/.test(t)) return `#${t}`;
  return null;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: ColorValue, b: ColorValue): number {
  const la = luminance(colorHex(a));
  const lb = luminance(colorHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The warning to show for text in `fg` on `bg`, or null when it reads well.
 * 4.5 is WCAG AA for body text; large text gets away with 3.
 */
export function contrastWarning(fg: ColorValue, bg: ColorValue = 'white'): string | null {
  const r = contrastRatio(fg, bg);
  if (r >= 4.5) return null;
  const shown = r.toFixed(1);
  return r < 3
    ? `Hard to read: contrast ${shown}:1 against ${colorLabel(bg).toLowerCase()}. Aim for 4.5:1.`
    : `Only for large text: contrast ${shown}:1. Body text needs 4.5:1.`;
}

/* ── Links ─────────────────────────────────────────────────────────────── */

export type LinkKind = 'url' | 'anchor' | 'email' | 'phone';

export interface LinkTarget {
  kind: LinkKind;
  /** What the dialog's field shows: the address without `mailto:`, the anchor without `#`. */
  value: string;
}

/** Which tab of the link dialog a stored href belongs to. */
export function describeHref(href: string): LinkTarget {
  if (href.startsWith('#')) return { kind: 'anchor', value: href.slice(1) };
  if (/^mailto:/i.test(href)) return { kind: 'email', value: decodeURIComponent(href.slice(7).split('?')[0]) };
  if (/^tel:/i.test(href)) return { kind: 'phone', value: href.slice(4) };
  return { kind: 'url', value: href };
}

export type LinkResult = { href: string; warning?: string } | { error: string };

/** A typed link target as a safe href, or why it is not one. */
export function buildHref(kind: LinkKind, input: string): LinkResult {
  const t = input.trim();
  if (!t) return { error: 'Type an address.' };
  switch (kind) {
    case 'anchor': {
      const id = t.replace(/^#/, '');
      return /^[a-z0-9-]+$/.test(id) ? { href: `#${id}` } : { error: 'Pick a section from the list.' };
    }
    case 'email': {
      const addr = t.replace(/^mailto:/i, '');
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) ? { href: `mailto:${addr}` } : { error: 'That is not an email address.' };
    }
    case 'phone': {
      const num = t.replace(/^tel:/i, '').replace(/[\s().-]/g, '');
      return /^\+?\d{4,16}$/.test(num) ? { href: `tel:${num}` } : { error: 'Use digits, with + and the country code if abroad.' };
    }
    case 'url': {
      let href = t;
      if (/^[^\s@/]+@[^\s@]+\.[^\s@]+$/.test(t)) return buildHref('email', t);
      if (!/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith('/') && !t.startsWith('#')) {
        if (!/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(t)) return { error: 'That is not a web address.' };
        href = `https://${t}`;
      }
      href = href.replace(/\s/g, '%20');
      if (!isSafeHref(href)) return { error: 'Links can start with https://, mailto:, tel: or /.' };
      if (/^http:/i.test(href)) return { href, warning: 'This link is not secure (http). Use https:// if the site supports it.' };
      return { href };
    }
  }
}

/* ── Find and replace ──────────────────────────────────────────────────── */

export interface FindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
}

export interface TextMatch {
  from: number;
  to: number;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every non-overlapping occurrence of `query` in `text`. */
export function findMatches(text: string, query: string, opts: FindOptions = {}): TextMatch[] {
  if (!query) return [];
  const body = escapeRe(query);
  const pattern = opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
  const re = new RegExp(pattern, opts.matchCase ? 'gu' : 'giu');
  const out: TextMatch[] = [];
  for (const m of text.matchAll(re)) out.push({ from: m.index, to: m.index + m[0].length });
  return out;
}

/* ── Special characters ────────────────────────────────────────────────── */

export const SPECIAL_CHARS: { group: string; chars: { ch: string; name: string }[] }[] = [
  {
    group: 'Punctuation',
    chars: [
      { ch: '–', name: 'En dash' },
      { ch: '…', name: 'Ellipsis' },
      { ch: '‘', name: 'Left single quote' },
      { ch: '’', name: 'Right single quote' },
      { ch: '“', name: 'Left double quote' },
      { ch: '”', name: 'Right double quote' },
      { ch: '«', name: 'Left guillemet' },
      { ch: '»', name: 'Right guillemet' },
      { ch: '•', name: 'Bullet' },
      { ch: '·', name: 'Middle dot' },
      { ch: '§', name: 'Section' },
      { ch: '¶', name: 'Pilcrow' },
      { ch: ' ', name: 'Non-breaking space' },
    ],
  },
  {
    group: 'Symbols',
    chars: [
      { ch: '©', name: 'Copyright' },
      { ch: '®', name: 'Registered' },
      { ch: '™', name: 'Trade mark' },
      { ch: '°', name: 'Degree' },
      { ch: '€', name: 'Euro' },
      { ch: '£', name: 'Pound' },
      { ch: '¥', name: 'Yen' },
      { ch: '¢', name: 'Cent' },
      { ch: '✓', name: 'Check mark' },
      { ch: '✗', name: 'Cross mark' },
      { ch: '★', name: 'Star' },
      { ch: '♥', name: 'Heart' },
    ],
  },
  {
    group: 'Arrows',
    chars: [
      { ch: '→', name: 'Right arrow' },
      { ch: '←', name: 'Left arrow' },
      { ch: '↑', name: 'Up arrow' },
      { ch: '↓', name: 'Down arrow' },
      { ch: '↔', name: 'Left right arrow' },
      { ch: '⇒', name: 'Double right arrow' },
    ],
  },
  {
    group: 'Maths',
    chars: [
      { ch: '×', name: 'Multiply' },
      { ch: '÷', name: 'Divide' },
      { ch: '±', name: 'Plus minus' },
      { ch: '≈', name: 'Almost equal' },
      { ch: '≠', name: 'Not equal' },
      { ch: '≤', name: 'Less or equal' },
      { ch: '≥', name: 'Greater or equal' },
      { ch: '∞', name: 'Infinity' },
      { ch: '½', name: 'One half' },
      { ch: '¼', name: 'One quarter' },
      { ch: '¾', name: 'Three quarters' },
      { ch: 'µ', name: 'Micro' },
    ],
  },
  {
    group: 'Accented',
    chars: ['é', 'è', 'ê', 'ë', 'à', 'â', 'ç', 'ñ', 'ö', 'ü', 'ß', 'ø', 'å', 'æ'].map((ch) => ({ ch, name: ch })),
  },
];

export const EMOJI: { group: string; chars: { ch: string; name: string }[] }[] = [
  {
    group: 'Smileys',
    chars: [
      ['😀', 'Grinning'], ['😊', 'Smiling'], ['🙂', 'Slight smile'], ['😉', 'Wink'], ['😍', 'Heart eyes'],
      ['🤔', 'Thinking'], ['😎', 'Cool'], ['🥳', 'Party'], ['😮', 'Surprised'], ['😢', 'Sad'],
    ].map(([ch, name]) => ({ ch, name })),
  },
  {
    group: 'Hands',
    chars: [
      ['👍', 'Thumbs up'], ['👏', 'Clapping'], ['🙌', 'Raised hands'], ['👋', 'Wave'], ['🤝', 'Handshake'],
      ['💪', 'Strong'], ['🙏', 'Thanks'], ['👉', 'Pointing right'],
    ].map(([ch, name]) => ({ ch, name })),
  },
  {
    group: 'Objects',
    chars: [
      ['🎓', 'Graduation cap'], ['📚', 'Books'], ['💡', 'Idea'], ['🧠', 'Brain'], ['🔗', 'Link'],
      ['📅', 'Calendar'], ['📍', 'Pin'], ['🎤', 'Microphone'], ['💻', 'Laptop'], ['📈', 'Chart'],
      ['🏆', 'Trophy'], ['🎉', 'Celebration'], ['✨', 'Sparkles'], ['🚀', 'Rocket'], ['⭐', 'Star'],
      ['✅', 'Check'], ['❗', 'Exclamation'], ['❓', 'Question'],
    ].map(([ch, name]) => ({ ch, name })),
  },
  {
    group: 'Places',
    chars: [
      ['🗽', 'Statue of Liberty'], ['🏙️', 'City'], ['🌍', 'Globe'], ['☕', 'Coffee'], ['🍽️', 'Dinner'],
    ].map(([ch, name]) => ({ ch, name })),
  },
];

/* ── Keyboard shortcuts ────────────────────────────────────────────────── */

export const SHORTCUTS: { group: string; items: { label: string; keys: string }[] }[] = [
  {
    group: 'Text',
    items: [
      { label: 'Bold', keys: 'Cmd+B' },
      { label: 'Italic', keys: 'Cmd+I' },
      { label: 'Underline', keys: 'Cmd+U' },
      { label: 'Strikethrough', keys: 'Cmd+Shift+S' },
      { label: 'Inline code', keys: 'Cmd+E' },
      { label: 'Superscript', keys: 'Cmd+.' },
      { label: 'Subscript', keys: 'Cmd+,' },
      { label: 'Link', keys: 'Cmd+K' },
      { label: 'Clear formatting', keys: 'Cmd+\\' },
    ],
  },
  {
    group: 'Paragraphs',
    items: [
      { label: 'Normal text', keys: 'Cmd+Alt+0' },
      { label: 'Heading 1 to 4', keys: 'Cmd+Alt+1 to 4' },
      { label: 'Bulleted list', keys: 'Cmd+Shift+8' },
      { label: 'Numbered list', keys: 'Cmd+Shift+7' },
      { label: 'Quote', keys: 'Cmd+Shift+B' },
      { label: 'Code block', keys: 'Cmd+Alt+C' },
      { label: 'Indent or outdent a list item', keys: 'Tab / Shift+Tab' },
      { label: 'Align left, center, right, justify', keys: 'Cmd+Shift+L / E / R / J' },
      { label: 'Line break', keys: 'Shift+Enter' },
    ],
  },
  {
    group: 'Editing',
    items: [
      { label: 'Undo', keys: 'Cmd+Z' },
      { label: 'Redo', keys: 'Cmd+Shift+Z' },
      { label: 'Find and replace', keys: 'Cmd+F' },
      { label: 'Paste as plain text', keys: 'Cmd+Shift+V' },
      { label: 'Focus mode', keys: 'Cmd+Shift+F' },
      { label: 'Keyboard shortcuts', keys: 'Cmd+/' },
    ],
  },
  {
    group: 'Markdown as you type',
    items: [
      { label: 'Heading', keys: '# to #### then space' },
      { label: 'Bulleted list', keys: '* or - then space' },
      { label: 'Numbered list', keys: '1. then space' },
      { label: 'Quote', keys: '> then space' },
      { label: 'Divider', keys: '---' },
      { label: 'Code block', keys: '``` then space' },
      { label: 'Bold, italic, code', keys: '**bold**, *italic*, `code`' },
    ],
  },
];

/** `Cmd` on a Mac, `Ctrl` elsewhere. */
export function platformKeys(keys: string, mac: boolean): string {
  return mac ? keys.replace(/Alt/g, 'Option') : keys.replace(/Cmd/g, 'Ctrl');
}
