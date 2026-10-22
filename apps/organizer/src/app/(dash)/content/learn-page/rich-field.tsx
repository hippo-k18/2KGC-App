'use client';

import { useId, type ReactNode } from 'react';
import type { RichContent, RichDoc, RichNode } from '@kgc/shared';
import { richWordCount } from '@/lib/learn-rich';
import { useEditorServices } from './editor-context';

/**
 * Every rich text field in the Learn editor's settings goes through here
 * (T318), so swapping in T317's `RichEditor` is one file.
 *
 * ── Stand-in ─────────────────────────────────────────────────────────────────
 * Until `apps/organizer/src/components/rich-editor` lands, this is a textarea
 * over the v1 Markdown subset (bold, italic, links, paragraphs). It takes the
 * props T317 published (`value`, `onChange`, `variant`, `anchors`,
 * `placeholder`, `maxWords`) so the swap is:
 *
 *   import { RichEditor } from '@/components/rich-editor';
 *   <RichEditor value={value} onChange={onChange} variant={variant} anchors={anchors} ... />
 *
 * A RichDoc that holds more than the subset shows as plain paragraphs here and
 * is only rewritten if the person types in the box, which the hint says.
 */

export interface RichFieldProps {
  label: string;
  value: RichContent;
  onChange: (v: RichContent) => void;
  variant?: 'inline' | 'full';
  placeholder?: string;
  maxWords?: number;
  rows?: number;
  hint?: ReactNode;
}

function inlineMd(nodes: RichNode[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === 'hardBreak') return '\n';
      if (n.type !== 'text') return inlineMd('content' in n ? n.content : undefined);
      let t = n.text;
      const link = n.marks?.find((m) => m.type === 'link');
      if (link && link.type === 'link') t = `[${t}](${link.href})`;
      if (n.marks?.some((m) => m.type === 'italic')) t = `*${t}*`;
      if (n.marks?.some((m) => m.type === 'bold')) t = `**${t}**`;
      return t;
    })
    .join('');
}

/** A RichDoc as the Markdown subset, block by block; anything richer is flattened. */
export function richDocToMarkdown(doc: RichDoc): string {
  const block = (n: RichNode): string => {
    switch (n.type) {
      case 'paragraph':
      case 'heading':
      case 'codeBlock':
        return inlineMd(n.content);
      case 'bulletList':
      case 'orderedList':
      case 'blockquote':
      case 'table':
      case 'tableRow':
        return n.content.map(block).join('\n');
      case 'listItem':
      case 'tableCell':
      case 'tableHeader':
        return n.content.map(block).join(' ');
      default:
        return inlineMd([n]);
    }
  };
  return doc.content.map(block).join('\n\n');
}

const RICH_TYPES = new Set(['paragraph', 'text', 'hardBreak']);
function onlySubset(doc: RichDoc): boolean {
  const ok = (n: RichNode): boolean =>
    RICH_TYPES.has(n.type) &&
    (n.type !== 'text' || (n.marks ?? []).every((m) => m.type === 'bold' || m.type === 'italic' || m.type === 'link')) &&
    (!('content' in n) || !n.content || n.content.every(ok));
  return doc.content.every(ok);
}

export function RichField({ label, value, onChange, placeholder, maxWords, rows = 4, hint }: RichFieldProps) {
  const id = useId();
  useEditorServices();
  const text = typeof value === 'string' ? value : richDocToMarkdown(value);
  const lossy = typeof value !== 'string' && !onlySubset(value);
  const words = richWordCount(value);
  return (
    <div className="le-set-field">
      <label className="le-set-label" htmlFor={id}>
        {label}
        {maxWords ? (
          <span className={`le-set-count${words > maxWords ? ' over' : ''}`}>
            {words} / {maxWords} words
          </span>
        ) : null}
      </label>
      <textarea
        id={id}
        className="whova-text-input le-set-input le-set-area"
        rows={rows}
        value={text}
        placeholder={placeholder}
        spellCheck
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="le-set-hint">
        {hint ?? <>Use **bold**, *italic* and [link text](https://...). Leave a blank line to start a new paragraph.</>}
        {lossy && <> This text has formatting this box cannot show; typing here keeps only bold, italic and links.</>}
      </p>
    </div>
  );
}
