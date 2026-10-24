'use client';

import { useMemo } from 'react';
import type { LearnPageContent, LearnSection } from '@kgc/shared';
import type { Selection } from '@/lib/learn-editor-core';
import { expandForView, readOnlyViewNote } from '@/lib/learn-version-view-core';
import type { Device } from './editor-types';
import { LearnPreview } from './preview';

const PAGE_SELECTION: Selection = { kind: 'page' };
const noop = () => {};

/**
 * A page to look at, not edit, for Compare and History: linked sections are
 * drawn from the library as it is now (T324 E F11), with a short note when
 * that matters. `inert`, so nothing in it can be selected or focused.
 */
export function ReadOnlyPreview({
  content,
  library,
  what,
  siteOrigin,
  device,
  width,
  zoom,
  frameClassName,
}: {
  content: LearnPageContent;
  /** Saved sections by id; null while loading. */
  library: ReadonlyMap<string, LearnSection> | null | undefined;
  what: 'version' | 'draft';
  siteOrigin: string;
  device: Device;
  width: number;
  zoom: number;
  frameClassName: string;
}) {
  const view = useMemo(() => expandForView(content, library), [content, library]);
  const note = readOnlyViewNote(view, what);
  return (
    <>
      {note && <p className="le-muted" style={{ margin: '0 0 6px', fontSize: 12 }}>{note}</p>}
      <div className={frameClassName} inert>
        <div style={{ width, zoom }}>
          <LearnPreview
            content={view.content}
            selection={PAGE_SELECTION}
            onSelect={noop}
            onEdit={noop}
            warnings={[]}
            siteOrigin={siteOrigin}
            device={device}
            // Only placeholders are left to draw from it: "Loading" while it loads.
            library={library}
          />
        </div>
      </div>
    </>
  );
}
