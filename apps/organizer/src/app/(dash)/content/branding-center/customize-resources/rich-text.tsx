import { parseRichText, type InlineSpan, type RichBlock } from '@kgc/shared';

/**
 * The preview of a page body, drawn from the same blocks the website and the
 * phone draw.
 *
 * ⚠️ **Every piece of author text below is a React child, never an `innerHTML`.**
 * `parseRichText` has no branch that reads markup, so a `<script>` an organizer
 * types is five spans of ordinary text — but only while it stays in a text
 * node. `dangerouslySetInnerHTML` anywhere in this file would undo the whole
 * arrangement, and a preview is exactly the place somebody would reach for it.
 *
 * A near-copy of `apps/web/src/components/rich-text.tsx`, and deliberately so:
 * the two are separate installs and neither may import the other. The shared
 * half — the parse — is in `@kgc/shared`, which is what stops them disagreeing
 * about what the Markdown means. Only the tags differ.
 */
function Spans({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((s, i) => {
        switch (s.kind) {
          case 'strong':
            return <strong key={i}>{s.text}</strong>;
          case 'em':
            return <em key={i}>{s.text}</em>;
          case 'code':
            return <code key={i}>{s.text}</code>;
          case 'link':
            return (
              <a key={i} href={s.href} target="_blank" rel="noreferrer noopener">
                {s.text}
              </a>
            );
          default:
            return <span key={i}>{s.text}</span>;
        }
      })}
    </>
  );
}

function Block({ block }: { block: RichBlock }) {
  if (block.kind === 'heading') {
    // Level 2 and 3 only — `parseRichText` demotes everything else, so the page
    // title above keeps the only h1 on the screen.
    return block.level === 2 ? (
      <h2 style={{ fontSize: 15, marginBottom: 4 }}>
        <Spans spans={block.spans} />
      </h2>
    ) : (
      <h3 style={{ fontSize: 13, marginBottom: 4 }}>
        <Spans spans={block.spans} />
      </h3>
    );
  }

  if (block.kind === 'list') {
    const items = block.items.map((item, i) => (
      <li key={i}>
        <Spans spans={item} />
      </li>
    ));
    return block.ordered ? (
      <ol style={{ paddingLeft: 20 }}>{items}</ol>
    ) : (
      <ul style={{ paddingLeft: 20 }}>{items}</ul>
    );
  }

  return (
    <p className="body-2">
      <Spans spans={block.spans} />
    </p>
  );
}

export function RichText({ body }: { body: string }) {
  const blocks = parseRichText(body);
  return (
    <div style={{ fontSize: 13, lineHeight: 1.7 }}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
