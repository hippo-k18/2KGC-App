import { parseRichText, type InlineSpan, type RichBlock } from '@kgc/shared';

/**
 * An organizer-written page body, rendered as HTML.
 *
 * ⚠️ **Nothing here goes near `dangerouslySetInnerHTML`, and nothing may.**
 * `parseRichText` in `@kgc/shared` has no branch that reads markup: everything
 * an organizer types that is not one of a handful of Markdown markers ends up
 * as the `text` of a span, and every span below is a React child, which React
 * escapes. So a `<script>` typed into the dashboard renders as those characters
 * on this page, with no sanitiser anywhere in the path — the safety is the
 * absence of an HTML parser rather than a filter in front of one, which is the
 * only kind that survives somebody refactoring this file.
 *
 * `apps/organizer` has a near-copy for its preview. The two apps are separate
 * installs and neither may import the other; the half that decides what the
 * Markdown *means* is shared, so they cannot disagree about that, and only the
 * tags differ.
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
            // `noreferrer noopener` on every outbound link, as the rest of this
            // site does. A relative target keeps the tab: it is our own page.
            return s.href.startsWith('/') || s.href.startsWith('#') ? (
              <a key={i} href={s.href}>
                {s.text}
              </a>
            ) : (
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
    // Level 2 and 3 only. The page's `<h1>` is its title, drawn by the route,
    // so `parseRichText` demotes everything an organizer types.
    return block.level === 2 ? (
      <h2>
        <Spans spans={block.spans} />
      </h2>
    ) : (
      <h3>
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
    return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
  }

  return (
    <p>
      <Spans spans={block.spans} />
    </p>
  );
}

export function RichText({ body }: { body: string }) {
  return (
    <>
      {parseRichText(body).map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </>
  );
}
