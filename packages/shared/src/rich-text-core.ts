/**
 * The small Markdown subset an organizer may write into a custom page, turned
 * into a list of blocks that each app renders with its own components.
 *
 * ── Why a parser here rather than a Markdown library ────────────────────────
 *
 * Three surfaces have to draw the same page: the website (HTML), the phone
 * (React Native, which has no HTML at all) and the dashboard's preview. A
 * library that returns an HTML string serves exactly one of them, and the
 * phone would need a second implementation — which is how two renderers drift
 * until a bullet list is a paragraph on one of them. This returns data, so all
 * three walk the same array and only the leaf components differ.
 *
 * ── Raw HTML is not stripped, it is never parsed ────────────────────────────
 *
 * There is no branch below that looks at `<`. Everything that is not one of the
 * handful of markers this file knows about ends up in the `text` of a span, and
 * every renderer puts that text in a text node. So `<script>alert(1)</script>`
 * typed into the editor renders as those characters on the page, on all three
 * surfaces, without anything having to sanitise it. **Do not add an `html`
 * block kind, and do not render a span's text with `dangerouslySetInnerHTML`.**
 * The safety here is the absence of a path, not the presence of a filter, and
 * that is the only kind of safety that survives a refactor.
 *
 * ── What is deliberately not supported ──────────────────────────────────────
 *
 * Tables, images, block quotes, code fences, nested lists and footnotes. The
 * feature is venue notes, travel directions and an FAQ; every one of those is
 * headings, paragraphs, lists and links. Each thing added here is a thing three
 * renderers have to agree on, so the list stays short until something real
 * needs it, and unsupported syntax degrades to its own characters rather than
 * disappearing.
 */

/** A run of text inside a paragraph, heading or list item. */
export type InlineSpan =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

/** One block of a page. Blocks never nest. */
export type RichBlock =
  | { kind: "heading"; level: 2 | 3; spans: InlineSpan[] }
  | { kind: "paragraph"; spans: InlineSpan[] }
  | { kind: "list"; ordered: boolean; items: InlineSpan[][] };

/**
 * The schemes a link in body copy may use.
 *
 * `javascript:` is the reason this list exists rather than a check for what is
 * forbidden: the body is typed into a dashboard box and rendered on a page a
 * thousand people open, and an allowlist cannot be outflanked by a scheme
 * nobody thought of. A link with any other scheme is not dropped — its text
 * renders as plain text, so the words survive and only the click is refused.
 */
const SAFE_SCHEMES = ["http:", "https:", "mailto:", "tel:"];

/**
 * Whether a link target may become an anchor. Every link field on the Learn
 * page (rich text, buttons, logos, cards, image links, LinkedIn) goes through
 * this one check, on save and again on render.
 *
 * Relative targets (`/agenda`, `#wifi`) are allowed through unparsed: they
 * cannot carry a scheme, so there is nothing to smuggle, and an organizer
 * linking to another page of their own site should not have to type the origin.
 *
 * ⚠️ The browser is more forgiving than `new URL` looks, and every trick below
 * is a link that leaves the site while a `startsWith` test calls it ours, so
 * the renderer drops the new tab and `rel` (T324 U2, U3):
 * - A backslash counts as a slash for http and https: `/\evil.example`,
 *   `\\evil.example`, `https:/\evil.example` and `https:\\evil.example` all
 *   open `evil.example`. So a relative target may not start with two of
 *   either, and an http(s) one must be written `scheme://host` exactly, with
 *   no backslash or space in the host part.
 * - `https:evil.example` (no slashes) also opens `evil.example`.
 * - The URL parser drops leading control characters and spaces, and tab, CR
 *   and LF anywhere, so `\u0001https://evil.example` and `/\t/evil.example`
 *   (T321) are off-site too. Tab, CR and LF are removed before the relative
 *   check, as the browser will; any other control character refuses the link.
 */
export function isSafeHref(href: string): boolean {
  if (typeof href !== "string") return false;
  const trimmed = href.trim();
  if (trimmed === "") return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) return false;
  if (/^[/\\][/\\]/.test(trimmed.replace(/[\t\n\r]/g, ""))) return false;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return true;
  // The scheme as typed: a tab or space inside `ht tps:` is not a scheme.
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!scheme || !SAFE_SCHEMES.includes(`${scheme[1].toLowerCase()}:`)) return false;
  if (/^https?:$/i.test(scheme[0])) {
    const rest = trimmed.slice(scheme[0].length);
    if (!rest.startsWith("//")) return false;
    const authority = /^[^/?#]*/.exec(rest.slice(2))![0];
    if (authority === "" || /[\\\s]/.test(authority)) return false;
  }
  try {
    return SAFE_SCHEMES.includes(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}

/**
 * `[text](href)`, `**strong**`, `*em*`, `_em_` and `` `code` ``, left to right.
 *
 * One pass rather than four nested passes, because the alternative re-parses
 * the output of the previous stage and a literal asterisk inside a link's text
 * then becomes emphasis. Markers are not nested: `**bold with a [link](…)**`
 * renders the whole thing bold and the link as text. That is a real limitation
 * and an acceptable one for venue copy.
 *
 * The rules are exactly those of this regular expression, tried at each
 * position in turn, first alternative first:
 *
 *   \[([^\]\n]*)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`
 *
 * It used to be that regular expression, which is quadratic: at every `[` it
 * scans ahead for a `]` that is not there, so `'['.repeat(1e5)` took 6.6 s
 * (T324 U1). Here each "scan ahead" is a lookup in a table built in one pass
 * from the end, so the whole parse is linear.
 */
function nextTable(text: string, stop: (c: string) => boolean): Int32Array {
  const next = new Int32Array(text.length + 1);
  next[text.length] = text.length;
  for (let i = text.length - 1; i >= 0; i--) next[i] = stop(text[i]!) ? i : next[i + 1]!;
  return next;
}

type InlineMatch = { end: number; span: InlineSpan };

function inlineMatcher(text: string): (i: number) => InlineMatch | null {
  const n = text.length;
  const bracket = nextTable(text, (c) => c === "]" || c === "\n");
  const paren = nextTable(text, (c) => c === ")" || /\s/.test(c));
  const star = nextTable(text, (c) => c === "*" || c === "\n");
  const under = nextTable(text, (c) => c === "_" || c === "\n");
  const tick = nextTable(text, (c) => c === "`" || c === "\n");

  /** `open` + at least one character up to the next `close` (no newline) + `close`. */
  const delimited = (i: number, open: number, table: Int32Array, close: string): number => {
    const j = table[i + open]!;
    if (j === i + open || j >= n || text[j] !== close) return -1;
    if (close === "*" && open === 2 && text[j + 1] !== "*") return -1;
    return j;
  };

  return (i) => {
    const c = text[i];
    if (c === "[") {
      const j = bracket[i + 1]!;
      if (j < n && text[j] === "]" && text[j + 1] === "(") {
        const k = paren[j + 2]!;
        if (k > j + 2 && k < n && text[k] === ")") {
          const linkText = text.slice(i + 1, j);
          const href = text.slice(j + 2, k);
          // An unsafe or empty target keeps the words and loses the link. The
          // brackets go with it, because `[click here]` on a page is noise.
          const label = linkText === "" ? href : linkText;
          const span: InlineSpan = isSafeHref(href) ? { kind: "link", text: label, href: href.trim() } : { kind: "text", text: label };
          return { end: k + 1, span };
        }
      }
      return null;
    }
    if (c === "*") {
      if (text[i + 1] === "*") {
        const j = delimited(i, 2, star, "*");
        if (j >= 0) return { end: j + 2, span: { kind: "strong", text: text.slice(i + 2, j) } };
      }
      const j = delimited(i, 1, star, "*");
      return j >= 0 ? { end: j + 1, span: { kind: "em", text: text.slice(i + 1, j) } } : null;
    }
    if (c === "_") {
      const j = delimited(i, 1, under, "_");
      return j >= 0 ? { end: j + 1, span: { kind: "em", text: text.slice(i + 1, j) } } : null;
    }
    if (c === "`") {
      const j = delimited(i, 1, tick, "`");
      return j >= 0 ? { end: j + 1, span: { kind: "code", text: text.slice(i + 1, j) } } : null;
    }
    return null;
  };
}

export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const match = inlineMatcher(text);
  let last = 0;
  let i = 0;
  while (i < text.length) {
    const m = match(i);
    if (!m) {
      i++;
      continue;
    }
    if (i > last) spans.push({ kind: "text", text: text.slice(last, i) });
    spans.push(m.span);
    last = i = m.end;
  }
  if (last < text.length) spans.push({ kind: "text", text: text.slice(last) });
  return spans;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,3}\d+[.)]\s+(.*)$/;

/**
 * Markdown to blocks.
 *
 * Headings are demoted so the deepest an organizer can reach is `h3`: the page
 * title is the `h1` and the surrounding chrome owns it, so a body that starts
 * with `# Wi-Fi` must not produce a second `h1` on the website. `#` and `##`
 * both become level 2 and everything below becomes level 3, which keeps the
 * document outline legal whatever is typed.
 */
export function parseRichText(markdown: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  // Normalised first: the body arrives from a browser textarea, which submits
  // CRLF, and a stray `\r` at the end of a line defeats every regex below.
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", spans: parseInline(paragraph.join(" ").trim()) });
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    blocks.push({
      kind: "list",
      ordered: list.ordered,
      items: list.items.map((i) => parseInline(i)),
    });
    list = null;
  };

  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === "") {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length <= 2 ? 2 : 3;
      blocks.push({ kind: "heading", level, spans: parseInline(heading[2].trim()) });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1].trim());
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1].trim());
      continue;
    }

    // A plain line while a list is open continues the last item rather than
    // opening a paragraph inside the list, which is what wrapping a long bullet
    // in an editor produces and what Markdown itself does with it.
    if (list && list.items.length > 0) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}

/**
 * The page as one line of plain text — for a search summary or a meta
 * description, never for display.
 *
 * Headings are followed by a full stop so that "Wi-Fi Connect to KGC-Guest"
 * does not read as one sentence in a search result.
 */
export function richTextToPlainText(markdown: string): string {
  const parts: string[] = [];
  for (const block of parseRichText(markdown)) {
    if (block.kind === "list") {
      for (const item of block.items) parts.push(spansToText(item));
    } else {
      const text = spansToText(block.spans);
      parts.push(block.kind === "heading" && !/[.!?]$/.test(text) ? `${text}.` : text);
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function spansToText(spans: InlineSpan[]): string {
  return spans.map((s) => s.text).join("");
}
