'use client';

import { createContext, useContext } from 'react';
import type { LearnPageContent, LearnSection, PageImage } from '@kgc/shared';
import type { UploadImage } from './editor-types';

/**
 * What any form deep in the Learn editor may ask the shell for (T318): the
 * media library, the image editor, the page's anchors. A context rather than
 * props, because an image field three levels into a card list should not need
 * five props threaded down to open a dialog the shell owns.
 */
export interface EditorServices {
  siteOrigin: string;
  uploadImage: UploadImage;
  /** Opens the media library to choose one image. Resolves null when cancelled. */
  pickImage: (opts?: { title?: string }) => Promise<PageImage | null>;
  /** Opens the image editor (crop, rotate, flip, focal point). Resolves the edited image, or null. */
  editImage: (image: PageImage) => Promise<PageImage | null>;
  /** Link targets on this page, for "link to a part of this page". */
  anchors: { anchor: string; label: string }[];
  /** The draft as it is now, for checks such as anchor uniqueness. */
  content: LearnPageContent;
  /** Saved sections by id, and their names. Null while the library loads. */
  library?: ReadonlyMap<string, LearnSection> | null;
  libraryNames?: ReadonlyMap<string, string>;
  /** Turns a Saved section block into a copy that can be changed here (one undo step). */
  unlinkBlock?: (sectionId: string, blockId: string) => void;
  /** Starts changing the saved section a Saved section block shows. */
  editSavedSection?: (sectionId: string, blockId: string) => void;
  /** The saved section being changed on the page right now, if any. */
  editingSavedSection?: { libraryId: string; sectionId: string } | null;
}

export const EditorServicesContext = createContext<EditorServices | null>(null);

/** The shell's services, or null outside the editor (a form rendered on its own in a test page). */
export function useEditorServices(): EditorServices | null {
  return useContext(EditorServicesContext);
}
