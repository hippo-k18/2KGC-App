/**
 * The hostile values the stored-doc run writes (T325, T328). Plain data and
 * one walker, no imports, so both `seed.mts` (which can reach the validator)
 * and the spec can use them.
 *
 * Every hostile value points at `evil.test` or sets `window.__kgcCanary`,
 * so the checks only have to look for those two.
 */

type Json = Record<string, unknown>;

export const CANARY = 'window.__kgcCanary=1';
export const UNSAFE_LINKS = [
  `javascript:${CANARY}`,
  ` JaVaScRiPt:${CANARY}`,
  `\u0001javascript:${CANARY}`,
  'data:text/html;base64,PHNjcmlwdD53aW5kb3cuX19rZ2NDYW5hcnk9MTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  'https:/\\evil.test/a',
  'https:\\\\evil.test/b',
  '\\\\evil.test/c',
  '//evil.test/d',
  '\u0001https://evil.test/e',
  'https://evil.test/f',
];
/** The one off-site link a page may really hold; drawn as a plain link, it opens nothing by itself. */
export const OFFSITE_LINK = /^https:\/\/evil\.test\/[a-z]$/;
export const UNSAFE_IMAGES = ['https://evil.test/x.png', 'http://evil.test/y.png', '//evil.test/z.png', `javascript:${CANARY}`, 'data:image/svg+xml,<svg onload="window.__kgcCanary=1"/>'];
export const MARKUP = `<img src="https://evil.test/i.png" onerror="${CANARY}"><script>${CANARY}</script><style>body{background:url(https://evil.test/s)}</style> KGCSHOWN`;
/** For fields too short to hold MARKUP. */
export const SHORT_MARKUP = `<b onclick="${CANARY}">KGCSHOWN`;
export const CSS = 'red;background-image:url(https://evil.test/css)';

export const LINK_KEY = /href|url|link|linkedin|website|action/i;
export const IMAGE_KEY = /src|image|photo|logo|avatar|poster|background(image)?$/i;
export const STYLE_KEY = /colou?r|tone|highlight|width|height|padding|align|size|style/i;

/** Hostile nodes and marks added to the end of a rich text doc. */
export function hostileRichNodes(): Json[] {
  return [
    {
      type: 'paragraph',
      attrs: { style: `background:url(https://evil.test/p)`, onclick: CANARY, class: 'x" onmouseover="' + CANARY },
      content: UNSAFE_LINKS.map((href) => ({
        type: 'text',
        text: `link ${href.length} KGCSHOWN `,
        marks: [
          { type: 'link', attrs: { href, target: '_blank', onclick: CANARY, rel: 'opener' } },
          { type: 'textStyle', attrs: { color: CSS, fontSize: CSS } },
          { type: 'highlight', attrs: { color: CSS } },
        ],
      })),
    },
    { type: 'image', attrs: { src: 'https://evil.test/rich.png', onerror: CANARY } },
    { type: 'iframe', attrs: { src: 'https://evil.test/frame' } },
    { type: 'heading', attrs: { level: 2, id: `"><img src=x onerror=${CANARY}>` }, content: [{ type: 'text', text: MARKUP }] },
  ];
}

/** The hostile value for one string, picked by its key. */
export function hostileString(key: string, i: number): string {
  if (LINK_KEY.test(key)) return UNSAFE_LINKS[i % UNSAFE_LINKS.length];
  if (IMAGE_KEY.test(key)) return UNSAFE_IMAGES[i % UNSAFE_IMAGES.length];
  if (STYLE_KEY.test(key)) return CSS;
  if (/anchor|slug/i.test(key)) return `"><img src=x onerror=${CANARY}>`;
  return MARKUP;
}

/** Every string in the page swapped for a hostile one picked by its key; rich text also gets hostile nodes and marks. */
export function hostile(v: unknown, key = '', n = { i: 0 }): unknown {
  if (Array.isArray(v)) return v.map((x) => hostile(x, key, n));
  if (v && typeof v === 'object') {
    const o = v as Json;
    const out: Json = {};
    for (const [k, x] of Object.entries(o)) out[k] = k === 'id' || k === 'kind' || k === 'type' ? x : hostile(x, k, n);
    if (o.type === 'doc' && Array.isArray(o.content)) out.content = [...(out.content as unknown[]), ...hostileRichNodes()];
    return out;
  }
  if (typeof v !== 'string') return v;
  n.i++;
  if (key === 'id' || key === 'kind' || key === 'libraryId') return v;
  return hostileString(key, n.i);
}

type Path = (string | number)[];

/** The path of every string and every rich text doc under `v`, ids and kinds left out. */
export function leaves(v: unknown, at: Path = []): Path[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, [...at, i]));
  if (v && typeof v === 'object') {
    const o = v as Json;
    if (o.type === 'doc') return [at];
    return Object.entries(o).flatMap(([k, x]) => (['id', 'kind', 'type', 'libraryId'].includes(k) ? [] : leaves(x, [...at, k])));
  }
  return typeof v === 'string' ? [at] : [];
}

export function getAt(root: unknown, p: Path): unknown {
  let cur = root as Record<string | number, unknown>;
  for (const k of p) cur = cur?.[k] as Record<string | number, unknown>;
  return cur;
}

export function setAt(root: unknown, p: Path, value: unknown): unknown {
  const copy = structuredClone(root) as Json;
  let cur = copy as Record<string | number, unknown>;
  for (const k of p.slice(0, -1)) {
    // A parent already set to a wrong value has nothing left to reach into.
    if (!cur[k] || typeof cur[k] !== 'object') return copy;
    cur = cur[k] as Record<string | number, unknown>;
  }
  cur[p[p.length - 1]] = value;
  return copy;
}

/**
 * The most hostile copy of `page` that `accepts` still takes: each string and
 * each rich text doc gets the first hostile value the check accepts, else
 * keeps its own. This is what a member could really save, so it is what the
 * editor, Compare and History must draw safely.
 */
export function hostileButValid(page: unknown, accepts: (candidate: unknown) => boolean): unknown {
  let out = structuredClone(page);
  let i = 0;
  for (const p of leaves(page)) {
    const key = String([...p].reverse().find((k) => typeof k === 'string') ?? '');
    const own = getAt(page, p);
    const tries: unknown[] =
      typeof own === 'string'
        ? [hostileString(key, i++), ...(LINK_KEY.test(key) ? UNSAFE_LINKS : []), MARKUP, SHORT_MARKUP]
        : [hostile(own), { ...(own as Json), content: [...((own as Json).content as unknown[]), ...hostileRichNodes().slice(0, 1)] }];
    for (const t of tries) {
      const next = setAt(out, p, t);
      if (accepts(next)) {
        out = next;
        break;
      }
    }
  }
  return out;
}
