/**
 * Pasted HTML from Word, Google Docs or a web page, cut down to structure
 * before ProseMirror reads it (T317).
 *
 * The editor's schema already drops every node and mark the contract does not
 * name, so this is not the safety layer. It exists for the two things the
 * schema gets wrong on its own:
 *
 * - Formatting carried in `style` instead of tags. Google Docs marks bold as
 *   `<span style="font-weight:700">` and wraps the whole paste in
 *   `<b style="font-weight:normal" id="docs-internal-guid-…">`; with the styles
 *   stripped naively, everything would paste bold and nothing would paste
 *   italic. Styles are read once, turned into `<strong>`, `<em>` and so on,
 *   and then every style, class and font goes.
 * - Word lists, which arrive as paragraphs with a typed bullet glyph in a
 *   `mso-list:Ignore` span. They are rebuilt as real lists.
 *
 * Colours, fonts and sizes from the source are deliberately lost: the page
 * uses the brand's. Our own marks survive (`data-rt-*`), so copy and paste
 * inside the editor keeps colour and size.
 */

const DROP = new Set(['style', 'meta', 'link', 'script', 'title', 'head', 'xml', 'template', 'noscript', 'iframe', 'object', 'svg']);
const UNWRAP = new Set(['font', 'center', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'figure', 'figcaption', 'label']);
const KEEP_ATTR: Record<string, string[]> = {
  a: ['href', 'target'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  ol: ['start'],
};

function unwrap(el: Element) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function wrapChildren(el: Element, tag: string) {
  const w = el.ownerDocument.createElement(tag);
  while (el.firstChild) w.appendChild(el.firstChild);
  el.appendChild(w);
}

function styleOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (el.getAttribute('style') ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim().toLowerCase();
  }
  return out;
}

const INLINE_STYLED = new Set(['span', 'font', 'a']);

/** Turn style-carried formatting on inline elements into tags. */
function semanticFromStyle(el: Element) {
  const tag = el.tagName.toLowerCase();
  const s = styleOf(el);
  const weight = s['font-weight'];
  // `<b style="font-weight:normal">` is Google Docs' wrapper, not bold.
  if ((tag === 'b' || tag === 'strong') && (weight === 'normal' || weight === '400')) {
    unwrap(el);
    return;
  }
  if (!INLINE_STYLED.has(tag)) return;
  const deco = `${s['text-decoration'] ?? ''} ${s['text-decoration-line'] ?? ''}`;
  if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) wrapChildren(el, 'strong');
  if (s['font-style'] === 'italic') wrapChildren(el, 'em');
  if (deco.includes('underline')) wrapChildren(el, 'u');
  if (deco.includes('line-through')) wrapChildren(el, 's');
  if (s['vertical-align'] === 'super') wrapChildren(el, 'sup');
  if (s['vertical-align'] === 'sub') wrapChildren(el, 'sub');
}

/** Word's list paragraphs (`mso-list`) back into `<ul>` / `<ol>`. */
function rebuildWordLists(doc: Document) {
  const isListPara = (el: Element | null): el is Element =>
    !!el &&
    el.tagName.toLowerCase() === 'p' &&
    (/MsoListParagraph/i.test(el.getAttribute('class') ?? '') || /mso-list\s*:/i.test(el.getAttribute('style') ?? ''));

  for (const p of Array.from(doc.body.querySelectorAll('p'))) {
    if (!p.isConnected || !isListPara(p)) continue;
    const prev = p.previousElementSibling;
    if (prev && isListPara(prev)) continue; // handled from the first paragraph of the run
    const run: Element[] = [];
    for (let el: Element | null = p; isListPara(el); el = el.nextElementSibling) run.push(el);
    const glyph = (el: Element) => {
      const ignore = Array.from(el.querySelectorAll('span')).find((s) => /mso-list\s*:\s*ignore/i.test(s.getAttribute('style') ?? ''));
      const text = ignore?.textContent?.trim() ?? '';
      ignore?.remove();
      return text;
    };
    const first = glyph(run[0]);
    const ordered = /^[\da-z]{1,3}[.)]$/i.test(first);
    const list = doc.createElement(ordered ? 'ol' : 'ul');
    run[0].parentNode?.insertBefore(list, run[0]);
    run.forEach((el, i) => {
      if (i > 0) glyph(el);
      const li = doc.createElement('li');
      while (el.firstChild) li.appendChild(el.firstChild);
      list.appendChild(li);
      el.remove();
    });
  }
}

export function cleanPastedHtml(html: string, parser: DOMParser = new DOMParser()): string {
  const doc = parser.parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, 128 /* NodeFilter.SHOW_COMMENT */);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));

  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    if (DROP.has(el.tagName.toLowerCase())) el.remove();
  }
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    // Office namespaces (`o:p`, `v:shape`, `w:sdt`) carry nothing worth keeping.
    if (el.tagName.includes(':')) el.remove();
  }
  rebuildWordLists(doc);
  for (const el of Array.from(doc.body.querySelectorAll('*'))) if (el.isConnected) semanticFromStyle(el);

  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (UNWRAP.has(tag)) {
      unwrap(el);
      continue;
    }
    const keep = KEEP_ATTR[tag] ?? [];
    for (const attr of Array.from(el.attributes)) {
      // `data-pm-slice` tells ProseMirror how a copy from another editor was cut.
      if (keep.includes(attr.name) || attr.name.startsWith('data-rt-') || attr.name === 'data-pm-slice') continue;
      el.removeAttribute(attr.name);
    }
    // A span with nothing left on it is noise.
    if (tag === 'span' && el.attributes.length === 0) unwrap(el);
  }
  return doc.body.innerHTML;
}
