import type { LearnPageContent, PageImage } from '@kgc/shared';
import type { EditAction, Selection, Warning } from '@/lib/learn-editor-core';

/** What every pane of the editor is handed by the shell (`learn-editor.tsx`). */
export interface PaneProps {
  content: LearnPageContent;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  /** Every change goes through here, so it lands on the undo stack and in the autosave. */
  onEdit: (action: EditAction) => void;
  warnings: Warning[];
}

export type Device = 'desktop' | 'tablet' | 'phone';

/** Preview frame widths in CSS pixels. */
export const DEVICE_WIDTH: Record<Device, number> = { desktop: 1280, tablet: 820, phone: 390 };

/**
 * `mediaId` is the media library row the upload wrote (T315), when that write
 * worked; the library uses it to show the new image without reloading.
 */
export type UploadResult = { ok: true; image: PageImage; mediaId?: string } | { ok: false; error: string };
/** Uploads one file and resolves with the stored image (alt empty, to be filled). */
export type UploadImage = (file: File) => Promise<UploadResult>;

/**
 * `/kgc/...` site assets live on the website, not here; the preview and the
 * settings thumbnails resolve them against the website's origin.
 */
export function resolveSrc(src: string, siteOrigin: string): string {
  return src.startsWith('/') && !src.startsWith('//') ? `${siteOrigin}${src}` : src;
}
