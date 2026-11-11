import { Fragment, type CSSProperties, type ReactNode } from 'react';
import {
  learnColor,
  learnRichParagraphs,
  type InlineSpan,
  type RichContent,
  type RichMark,
  type RichNode,
} from '@kgc/shared';
import { SmartLink } from './parts';

/*
 * Rich text, v1 Markdown strings and v2 `RichDoc` trees alike. Every node and
 * mark maps to an element; colours are `lp-tc-*` / `lp-hl-*` classes for brand
 * names and an inline value only for a custom `#rrggbb` the parser has
 * already checked. No HTML string is ever rendered.
 */

/** A rich value as block content: paragraphs, headings, lists, tables. */
export function RichBlocks({ value }: { value: RichContent }) {
  if (typeof value === 'string') {
    return (
      <>
        {learnRichParagraphs(value).map((lines, i) => (
          <p key={i}>
            <MdLines paragraphs={[lines]} />
          </p>
        ))}
      </>
    );
  }
  return <>{value.content.map((n, i) => <RichBlockNode key={i} node={n} />)}</>;
}

/**
 * A rich value inside one element (a heading, a list item): every paragraph's
 * words joined by line breaks, block structure dropped.
 */
export function RichInline({ value }: { value: RichContent }) {
  if (typeof value === 'string') return <MdLines paragraphs={learnRichParagraphs(value)} />;
  const lines: RichNode[][] = [];
  const collect = (nodes: RichNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'codeBlock') lines.push(n.content ?? []);
      else if (n.type !== 'text' && n.type !== 'hardBreak' && 'content' in n) collect(n.content);
    }
  };
  collect(value.content);
  const shown = lines.filter((l) => l.length > 0);
  return (
    <>
      {shown.map((l, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <Inline nodes={l} />
        </Fragment>
      ))}
    </>
  );
}

/** Whether a rich value has any words to show. */
export function richHasText(value: RichContent | undefined): boolean {
  if (value === undefined) return false;
  return typeof value === 'string' ? value.trim() !== '' : value.content.length > 0;
}

const alignClass = (align: string | undefined) => (align ? `lp-ta-${align}` : undefined);

function RichBlockNode({ node }: { node: RichNode }): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return (
        <p className={alignClass(node.align)}>
          <Inline nodes={node.content} />
        </p>
      );
    case 'heading': {
      // Inside running text a level 1 heading is drawn as an h2 with h1 type:
      // the page keeps a single h1 (the heading block or the wordmark).
      const Tag = (node.level === 1 ? 'h2' : `h${node.level}`) as 'h2' | 'h3' | 'h4';
      return (
        <Tag className={['lp-rh', `lp-rh-${node.level}`, alignClass(node.align)].filter(Boolean).join(' ')}>
          <Inline nodes={node.content} />
        </Tag>
      );
    }
    case 'bulletList':
      return (
        <ul className="lp-rlist">
          {node.content.map((n, i) => (
            <RichBlockNode key={i} node={n} />
          ))}
        </ul>
      );
    case 'orderedList':
      return (
        <ol className="lp-rlist" start={node.start}>
          {node.content.map((n, i) => (
            <RichBlockNode key={i} node={n} />
          ))}
        </ol>
      );
    case 'listItem':
      return (
        <li>
          {node.content.map((n, i) => (
            <RichBlockNode key={i} node={n} />
          ))}
        </li>
      );
    case 'blockquote':
      return (
        <blockquote className="lp-rquote">
          {node.content.map((n, i) => (
            <RichBlockNode key={i} node={n} />
          ))}
        </blockquote>
      );
    case 'codeBlock':
      return (
        <pre className="lp-rcode">
          <code>
            <Inline nodes={node.content} />
          </code>
        </pre>
      );
    case 'horizontalRule':
      return <hr className="lp-rrule" />;
    case 'table':
      return <RichTable node={node} />;
    case 'text':
    case 'hardBreak':
      return (
        <p>
          <Inline nodes={[node]} />
        </p>
      );
    default:
      return null;
  }
}

/**
 * A table scrolls sideways inside its own box on a narrow screen, so the page
 * never does. The box is focusable and named, so a keyboard can scroll it.
 */
export function RichTable({
  node,
  caption,
  striped,
}: {
  node: Extract<RichNode, { type: 'table' }>;
  caption?: string;
  striped?: boolean;
}) {
  return (
    <div className="lp-table-scroll" role="region" aria-label={caption || 'Table'} tabIndex={0}>
      <table className={striped ? 'lp-rtable lp-striped' : 'lp-rtable'}>
        {caption && <caption>{caption}</caption>}
        <tbody>
          {node.content.map((row, r) =>
            row.type === 'tableRow' ? (
              <tr key={r}>
                {row.content.map((cell, c) => {
                  if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') return null;
                  const Tag = cell.type === 'tableHeader' ? 'th' : 'td';
                  return (
                    <Tag key={c} colSpan={cell.colspan} rowSpan={cell.rowspan} scope={Tag === 'th' ? (r === 0 ? 'col' : 'row') : undefined}>
                      {cell.content.map((n, i) => (
                        <RichBlockNode key={i} node={n} />
                      ))}
                    </Tag>
                  );
                })}
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </div>
  );
}

function Inline({ nodes }: { nodes: RichNode[] | undefined }) {
  return (
    <>
      {(nodes ?? []).map((n, i) => {
        if (n.type === 'hardBreak') return <br key={i} />;
        if (n.type !== 'text') return null;
        return <Fragment key={i}>{withMarks(n.text, n.marks ?? [])}</Fragment>;
      })}
    </>
  );
}

/** Marks wrap from the inside out in a fixed order, so the same text always gives the same tree. */
function withMarks(text: string, marks: RichMark[]): ReactNode {
  const has = <T extends RichMark['type']>(t: T) => marks.find((m) => m.type === t) as Extract<RichMark, { type: T }> | undefined;
  let out: ReactNode = text;
  if (has('code')) out = <code>{out}</code>;
  if (has('superscript')) out = <sup>{out}</sup>;
  else if (has('subscript')) out = <sub>{out}</sub>;
  if (has('strike')) out = <s>{out}</s>;
  if (has('underline')) out = <u>{out}</u>;
  if (has('italic')) out = <em>{out}</em>;
  if (has('bold')) out = <strong>{out}</strong>;

  const size = has('fontSize');
  const color = learnColor(has('color')?.color);
  const highlight = learnColor(has('highlight')?.color);
  if (highlight.token || highlight.hex) {
    out = (
      <mark
        className={highlight.token ? `lp-hl lp-hl-${highlight.token}` : 'lp-hl'}
        style={highlight.hex ? ({ '--lp-hl': highlight.hex } as CSSProperties) : undefined}
      >
        {out}
      </mark>
    );
  }
  if (size || color.token || color.hex) {
    const cls = [size ? `lp-fs-${size.size}` : '', color.token ? `lp-tc-${color.token}` : '', color.hex ? 'lp-tc' : '']
      .filter(Boolean)
      .join(' ');
    out = (
      <span className={cls} style={color.hex ? { color: color.hex } : undefined}>
        {out}
      </span>
    );
  }
  const link = has('link');
  if (link) {
    out = (
      <SmartLink href={link.href} newTab={link.newTab}>
        {out}
      </SmartLink>
    );
  }
  return out;
}

/** v1 Markdown: paragraphs of lines, all joined by line breaks (inside one element). */
function MdLines({ paragraphs }: { paragraphs: InlineSpan[][][] }) {
  const lines = paragraphs.flat();
  return (
    <>
      {lines.map((spans, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <MarkdownSpans spans={spans} />
        </Fragment>
      ))}
    </>
  );
}

/** v1 Markdown spans on one line. */
export function MarkdownSpans({ spans }: { spans: InlineSpan[] }) {
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
              <SmartLink key={i} href={s.href}>
                {s.text}
              </SmartLink>
            );
          default:
            return s.text;
        }
      })}
    </>
  );
}
