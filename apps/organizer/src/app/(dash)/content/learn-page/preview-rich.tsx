'use client';

import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { isSafeHref, type RichContent, type RichDoc, type RichMark, type RichNode } from '@kgc/shared';
import { markdownToDoc, type InlineNode } from '@/lib/learn-editor-core';
import { colorHex } from '@/lib/learn-tools-core';

/**
 * Rich text in the editor preview (T318): the v1 Markdown subset and a v2
 * RichDoc, node by node, never through HTML.
 *
 * ── Interim ──────────────────────────────────────────────────────────────────
 * T319 builds the website's RichDoc renderer and a dashboard twin of it in
 * `preview-blocks/`. Until that lands this one draws every node and mark of
 * the contract plainly enough to edit against; at integration `RichBlocks`
 * and `RichLine` become thin wrappers over T319's component.
 */

function renderV1(nodes: InlineNode[] | undefined): ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    if (n.type === 'hardBreak') return <br key={i} />;
    let out: ReactNode = n.text ?? '';
    const marks = n.marks ?? [];
    const link = marks.find((m) => m.type === 'link');
    if (link?.attrs?.href && isSafeHref(link.attrs.href)) out = <a href={link.attrs.href}>{out}</a>;
    if (marks.some((m) => m.type === 'italic')) out = <em>{out}</em>;
    if (marks.some((m) => m.type === 'bold')) out = <strong>{out}</strong>;
    return <Fragment key={i}>{out}</Fragment>;
  });
}

const SIZE_EM = { small: '0.875em', normal: '1em', large: '1.25em', 'x-large': '1.6em' } as const;

function marked(text: string, marks: RichMark[] | undefined, key: number): ReactNode {
  let out: ReactNode = text;
  const style: CSSProperties = {};
  for (const m of marks ?? []) {
    if (m.type === 'color') style.color = colorHex(m.color) ?? undefined;
    if (m.type === 'highlight') style.backgroundColor = colorHex(m.color) ?? undefined;
    if (m.type === 'fontSize') style.fontSize = SIZE_EM[m.size];
  }
  // Inner marks first, so a bold link is <strong><a>, as the website draws it.
  for (const m of marks ?? []) {
    switch (m.type) {
      case 'code':
        out = <code>{out}</code>;
        break;
      case 'superscript':
        out = <sup>{out}</sup>;
        break;
      case 'subscript':
        out = <sub>{out}</sub>;
        break;
      case 'strike':
        out = <s>{out}</s>;
        break;
      case 'underline':
        out = <u>{out}</u>;
        break;
      case 'italic':
        out = <em>{out}</em>;
        break;
      case 'bold':
        out = <strong>{out}</strong>;
        break;
      case 'link':
        out = isSafeHref(m.href) || m.href.startsWith('#') ? <a href={m.href}>{out}</a> : out;
        break;
      default:
        break;
    }
  }
  if (Object.keys(style).length > 0) out = <span style={style}>{out}</span>;
  return <Fragment key={key}>{out}</Fragment>;
}

function inline(nodes: RichNode[] | undefined): ReactNode[] {
  return (nodes ?? []).map((n, i) => {
    if (n.type === 'text') return marked(n.text, n.marks, i);
    if (n.type === 'hardBreak') return <br key={i} />;
    return <Fragment key={i}>{block(n, i)}</Fragment>;
  });
}

function alignStyle(align: string | undefined): CSSProperties | undefined {
  return align ? { textAlign: align as CSSProperties['textAlign'] } : undefined;
}

function block(n: RichNode, key: number): ReactNode {
  switch (n.type) {
    case 'paragraph':
      return (
        <p key={key} style={alignStyle(n.align)}>
          {inline(n.content)}
        </p>
      );
    case 'heading': {
      const Tag = `h${Math.min(4, Math.max(1, n.level))}` as 'h1' | 'h2' | 'h3' | 'h4';
      return (
        <Tag key={key} className={`lp-rich-h lp-rich-h${n.level}`} style={alignStyle(n.align)}>
          {inline(n.content)}
        </Tag>
      );
    }
    case 'bulletList':
      return <ul key={key}>{n.content.map(block)}</ul>;
    case 'orderedList':
      return (
        <ol key={key} start={n.start}>
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
          <code>{inline(n.content)}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr key={key} />;
    case 'table':
      return (
        <div key={key} className="lp-rich-table">
          <table>
            <tbody>{n.content.map(block)}</tbody>
          </table>
        </div>
      );
    case 'tableRow':
      return <tr key={key}>{n.content.map(block)}</tr>;
    case 'tableHeader':
      return (
        <th key={key} colSpan={n.colspan} rowSpan={n.rowspan}>
          {n.content.map(block)}
        </th>
      );
    case 'tableCell':
      return (
        <td key={key} colSpan={n.colspan} rowSpan={n.rowspan}>
          {n.content.map(block)}
        </td>
      );
    default:
      return inline([n]);
  }
}

/** Paragraphs and everything else, for a text-like block. */
export function RichBlocks({ value }: { value: RichContent | undefined }) {
  if (value === undefined) return null;
  if (typeof value === 'string') {
    const doc = markdownToDoc(value);
    return (
      <>
        {doc.content.map((p, i) => (
          <p key={i}>{renderV1(p.content)}</p>
        ))}
      </>
    );
  }
  return <>{(value as RichDoc).content.map(block)}</>;
}

/** One line of inline text: paragraphs, if any slipped in, become line breaks. */
export function RichLine({ value }: { value: RichContent | undefined }) {
  if (value === undefined) return null;
  const paras: RichNode[][] =
    typeof value === 'string'
      ? []
      : value.content.map((n) => ('content' in n && n.content ? n.content : []));
  if (typeof value === 'string') {
    const doc = markdownToDoc(value);
    return (
      <>
        {doc.content.map((p, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {renderV1(p.content)}
          </Fragment>
        ))}
      </>
    );
  }
  return (
    <>
      {paras.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {inline(p)}
        </Fragment>
      ))}
    </>
  );
}
