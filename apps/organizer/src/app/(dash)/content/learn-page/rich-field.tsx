'use client';

import { useCallback, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import type { RichContent, RichDoc } from '@kgc/shared';
import { RichEditor, type RichAnchor } from '@/components/rich-editor';
import { collapseToSingleParagraph, toRichDoc } from '@/lib/rich-editor/convert';
import { useEditorServices } from './editor-context';

/**
 * Every rich text field in the Learn editor's settings goes through here
 * (T318), with T317's `RichEditor` inside, so the forms never deal with the
 * editor's props themselves.
 */

export interface RichFieldProps {
  label: string;
  value: RichContent;
  onChange: (v: RichContent) => void;
  variant?: 'inline' | 'full';
  placeholder?: string;
  maxWords?: number;
  /** Roughly how many lines the box shows before it grows. */
  rows?: number;
  hint?: ReactNode;
  /** One paragraph only (a heading's text): Enter makes a line break. */
  singleLine?: boolean;
}

/** `value` as the editor holds it, so an edit can be told apart from a reload. */
function asDoc(value: RichContent, singleLine: boolean): string {
  const doc = toRichDoc(value);
  return JSON.stringify(singleLine ? collapseToSingleParagraph(doc) : doc);
}

/**
 * The `onChange` to give a `RichEditor` over stored text. A v1 Markdown string
 * stays a string until somebody changes the words: opening an old page must
 * not leave it with unsaved changes. The editor only reports real
 * transactions; this also compares with what is stored, in case a load ever
 * normalises the document on its own.
 */
export function useRichChange(value: RichContent, singleLine: boolean, onChange: (doc: RichDoc) => void): (doc: RichDoc) => void {
  const latest = useRef({ value, singleLine, onChange });
  useEffect(() => {
    latest.current = { value, singleLine, onChange };
  });
  return useCallback((doc: RichDoc) => {
    const { value: current, singleLine: single, onChange: emit } = latest.current;
    if (JSON.stringify(doc) === asDoc(current, single)) return;
    emit(doc);
  }, []);
}

/** The page's anchors as the link dialog lists them. */
export function useRichAnchors(): RichAnchor[] {
  const services = useEditorServices();
  return useMemo(() => (services?.anchors ?? []).map((a) => ({ id: a.anchor, label: a.label })), [services?.anchors]);
}

export function RichField({ label, value, onChange, variant = 'full', placeholder, maxWords, rows = 4, hint, singleLine = false }: RichFieldProps) {
  const anchors = useRichAnchors();
  const change = useRichChange(value, singleLine, onChange);

  return (
    <div className="le-set-field le-set-rich" style={{ ['--le-rich-rows' as string]: rows } as CSSProperties}>
      <span className="le-set-label">{label}</span>
      <RichEditor
        value={value}
        onChange={change}
        variant={variant}
        anchors={anchors}
        placeholder={placeholder}
        maxWords={maxWords}
        ariaLabel={label}
        singleLine={singleLine}
      />
      {hint && <p className="le-set-hint">{hint}</p>}
    </div>
  );
}
