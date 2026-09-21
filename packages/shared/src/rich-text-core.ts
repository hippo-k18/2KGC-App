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
 * Whether a link target may become an anchor.
 *
 * Relative targets (`/agenda`, `#wifi`) are allowed through unparsed: they
 * cannot carry a scheme, so there is nothing to smuggle, and an organizer
 * linking to another page of their own site should not have to type the origin.
 */
export function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed === "") return false;
  // A bare `//host` is scheme-relative and inherits the page's scheme, which is
  // an off-site link wearing the clothes of a relative one. Checked before the
  // single slash below, which would otherwise let it through.
  //
  // ⚠️ A backslash counts as a slash here, and that is not pedantry. The WHATWG
  // URL parser treats `\` as `/` for http and https, so a browser resolves
  // `/\evil.example` to `https://evil.example` while every `startsWith("//")`
  // test in the world says it is relative. `rich-text.tsx` then classifies it
  // as one of our own pages and drops `rel="noreferrer noopener"` and the new
  // tab. Same for `\\host` and `\/host`.
  if (/^[/\\][/\\]/.test(trimmed)) return false;
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) return true;
  try {
    return SAFE_SCHEMES.includes(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}

/**
 * `[text](href)`, `**strong**`, `*em*`, `_em_` and `` `code` ``, left to right.
 *
 * One pass with one regular expression rather than four nested passes, because
 * the alternative re-parses the output of the previous stage and a literal
 * asterisk inside a link's text then becomes emphasis. Markers are not nested:
 * `**bold with a [link](…)**` renders the whole thing bold and the link as
 * text. That is a real limitation and an acceptable one for venue copy.
 */
const INLINE =
  /\[([^\]\n]*)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`/g;

export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let last = 0;

  // `exec` in a loop, with `lastIndex` reset first: the regex is a module
  // constant with the `g` flag, so a previous call leaves its cursor behind and
  // the second page an app renders would start parsing halfway down.
  INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) spans.push({ kind: "text", text: text.slice(last, m.index) });
    last = m.index + m[0].length;

    const [, linkText, href, strong, star, underscore, code] = m;
    if (href !== undefined) {
      // An unsafe or empty target keeps the words and loses the link. The
      // brackets go with it, because `[click here]` on a page is noise.
      const label = linkText === "" ? href : linkText;
      if (isSafeHref(href)) spans.push({ kind: "link", text: label, href: href.trim() });
      else spans.push({ kind: "text", text: label });
    } else if (strong !== undefined) {
      spans.push({ kind: "strong", text: strong });
    } else if (star !== undefined) {
      spans.push({ kind: "em", text: star });
    } else if (underscore !== undefined) {
      spans.push({ kind: "em", text: underscore });
    } else if (code !== undefined) {
      spans.push({ kind: "code", text: code });
    }
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
