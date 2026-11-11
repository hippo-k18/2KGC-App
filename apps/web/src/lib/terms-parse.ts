import { parseRichText, type RichBlock } from '@kgc/shared';

export interface TermsDocument {
  title: string;
  blocks: RichBlock[];
  /** One entry per heading block, in order: its anchor id. */
  headingIds: string[];
}

const ANCHOR = /\s*\{#([a-z0-9-]+)\}\s*$/;

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The content file: a `# Title` line, then the body in the same Markdown
 * subset custom pages use (`parseRichText`, which never produces HTML). A
 * heading may end in `{#id}` to fix its anchor; one without gets a slug of its
 * text. Repeated ids get a number, so every anchor on the page is unique.
 */
export function parseTerms(markdown: string): TermsDocument {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const titleAt = lines.findIndex((l) => /^#\s+\S/.test(l));
  const title = titleAt >= 0 ? lines[titleAt]!.replace(/^#\s+/, '').trim() : 'Terms and conditions';
  const body = titleAt >= 0 ? lines.filter((_, i) => i !== titleAt) : lines;

  const explicit: (string | undefined)[] = [];
  const stripped = body.map((line) => {
    if (!/^#{1,6}\s/.test(line)) return line;
    const m = ANCHOR.exec(line);
    explicit.push(m?.[1]);
    return m ? line.slice(0, m.index) : line;
  });

  const blocks = parseRichText(stripped.join('\n'));
  const seen = new Map<string, number>();
  const headingIds: string[] = [];
  let h = 0;
  for (const block of blocks) {
    if (block.kind !== 'heading') continue;
    const base = explicit[h] ?? (slug(block.spans.map((s) => s.text).join('')) || 'section');
    h += 1;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    headingIds.push(n === 0 ? base : `${base}-${n + 1}`);
  }
  return { title, blocks, headingIds };
}
