import type { ReactNode } from 'react';
import { safeHref, sanitizeDoc, type Mark, type Node } from './doc';

/**
 * A stored post body as React elements.
 *
 * Every string below reaches the page as a React child or a checked attribute,
 * so there is no `dangerouslySetInnerHTML` and no path for markup a writer typed
 * to become markup a reader runs. The document is sanitised again on the way in,
 * whatever was stored.
 *
 * The class names are the ones the scraped archive uses (`center`, `button`,
 * `embed`), so an edited archive post and an untouched one look the same under
 * the existing `.post-body` styles.
 */
export function PostBodyDoc({ doc }: { doc: unknown }) {
  const clean = sanitizeDoc(doc);
  return <>{clean.content.map((n, i) => block(n, i))}</>;
}

function withMarks(text: string, marks: Mark[] | undefined, key: number): ReactNode {
  let out: ReactNode = text;
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'bold':
        out = <strong>{out}</strong>;
        break;
      case 'italic':
        out = <em>{out}</em>;
        break;
      case 'underline':
        out = <u>{out}</u>;
        break;
      case 'strike':
        out = <s>{out}</s>;
        break;
      case 'code':
        out = <code>{out}</code>;
        break;
      case 'link': {
        const href = safeHref(m.attrs.href);
        if (!href) break;
        const external = /^https?:/.test(href);
        out = (
          <a
            href={href}
            className={m.attrs.button ? 'button' : undefined}
            {...(external ? { rel: 'noopener noreferrer' } : {})}
          >
            {out}
          </a>
        );
        break;
      }
    }
  }
  return <span key={key}>{out}</span>;
}

function inline(nodes: Node[] | undefined): ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    if (n.type === 'text') return withMarks(n.text, n.marks, i);
    if (n.type === 'hardBreak') return <br key={i} />;
    return null;
  });
}

function block(n: Node, key: number): ReactNode {
  switch (n.type) {
    case 'paragraph':
      return (
        <p key={key} className={n.attrs?.textAlign === 'center' ? 'center' : undefined}>
          {inline(n.content)}
        </p>
      );
    case 'heading': {
      const Tag = `h${n.attrs.level}` as 'h2' | 'h3' | 'h4';
      return (
        <Tag key={key} className={n.attrs.textAlign === 'center' ? 'center' : undefined}>
          {inline(n.content)}
        </Tag>
      );
    }
    case 'bulletList':
      return <ul key={key}>{n.content.map(block)}</ul>;
    case 'orderedList':
      return (
        <ol key={key} start={n.attrs?.start}>
          {n.content.map(block)}
        </ol>
      );
    case 'listItem':
      return <li key={key}>{n.content.map(block)}</li>;
    case 'blockquote':
      return <blockquote key={key}>{n.content.map(block)}</blockquote>;
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>{(n.content ?? []).map((t) => (t.type === 'text' ? t.text : '')).join('')}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr key={key} />;
    case 'image': {
      const img = (
        // eslint-disable-next-line @next/next/no-img-element -- sizes vary per post and some are remote
        <img
          src={n.attrs.src}
          alt={n.attrs.alt ?? ''}
          width={n.attrs.width}
          height={n.attrs.height}
          loading="lazy"
          decoding="async"
        />
      );
      const href = n.attrs.href ? safeHref(n.attrs.href) : null;
      return (
        <figure key={key} className={n.attrs.center ? 'center' : undefined}>
          {href ? (
            <a href={href} {...(/^https?:/.test(href) ? { rel: 'noopener noreferrer' } : {})}>
              {img}
            </a>
          ) : (
            img
          )}
        </figure>
      );
    }
    case 'youtube':
      return (
        <div key={key} className="embed">
          <iframe
            src={n.attrs.src}
            title="YouTube video player"
            loading="lazy"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      );
    case 'table':
      return (
        <table key={key}>
          <tbody>{n.content.map(block)}</tbody>
        </table>
      );
    case 'tableRow':
      return <tr key={key}>{n.content.map(block)}</tr>;
    case 'tableHeader':
    case 'tableCell': {
      const Tag = n.type === 'tableHeader' ? 'th' : 'td';
      return (
        <Tag key={key} colSpan={n.attrs?.colspan} rowSpan={n.attrs?.rowspan}>
          {n.content.map(block)}
        </Tag>
      );
    }
    default:
      return null;
  }
}
