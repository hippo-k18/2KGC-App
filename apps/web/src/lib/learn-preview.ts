import { readLearnPage, storedDraftAsPublished, type LearnImageOptions, type LearnPageContent } from '@kgc/shared';

/**
 * The stored Learn draft as the preview link `/learn/preview/<token>` shows
 * it, before saved sections are filled in. A saved section in the middle of
 * Edit saved section is shown as its link, as Publish would put it live
 * (T326 R1): the editable copy is unsaved, and when it was opened from the
 * library it would otherwise appear on the page a second time.
 */
export function learnPreviewDraft(raw: unknown, images: LearnImageOptions = {}): LearnPageContent | null {
  return readLearnPage(storedDraftAsPublished(raw), images);
}
