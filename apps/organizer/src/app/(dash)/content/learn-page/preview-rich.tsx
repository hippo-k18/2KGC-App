'use client';

import { useMemo } from 'react';
import { isRichDoc, sanitizeRichDoc, type RichContent } from '@kgc/shared';
import { RichBlocks as SiteRichBlocks, RichInline } from './preview-blocks/rich';

/**
 * Rich text in the editor preview: T319's twin of the website's renderer,
 * the v1 Markdown subset and a v2 RichDoc alike, node by node, never through
 * HTML.
 *
 * The twin trusts its input, because on the website `parseLearnPageContent`
 * has already run `sanitizeRichDoc` over every doc. The preview draws the raw
 * draft and old versions (T320), so a doc is sanitized here first: unknown
 * nodes and marks go, an unsafe link keeps its words and loses its target.
 * Memoised on the value, so a block that did not change is not walked again.
 */

function useSafeRich(value: RichContent | undefined): RichContent | undefined {
  return useMemo(() => {
    if (typeof value === 'string') return value;
    return isRichDoc(value) ? sanitizeRichDoc(value) : undefined;
  }, [value]);
}

/** Paragraphs and everything else, for a text-like block. */
export function RichBlocks({ value }: { value: RichContent | undefined }) {
  const safe = useSafeRich(value);
  return safe === undefined ? null : <SiteRichBlocks value={safe} />;
}

/** One line of inline text: paragraphs, if any slipped in, become line breaks. */
export function RichLine({ value }: { value: RichContent | undefined }) {
  const safe = useSafeRich(value);
  return safe === undefined ? null : <RichInline value={safe} />;
}
