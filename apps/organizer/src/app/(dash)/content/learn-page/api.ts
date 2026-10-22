/**
 * The one file that names where the editor's server actions come from, so the
 * client components import from one place.
 */
export {
  loadLearnEditorAction,
  saveLearnDraftAction,
  publishLearnPageAction,
  revertLearnDraftAction,
  restoreLearnVersionAction,
  uploadLearnImageAction,
} from './actions';
export type { LearnResult } from './actions';
export { loadLearnVersionAction } from './version-actions';
export {
  listLearnMediaAction,
  learnMediaUsesAction,
  updateLearnMediaAction,
  deleteLearnMediaAction,
  backfillLearnMediaAction,
  listLearnLibraryAction,
  saveLearnLibraryItemAction,
  renameLearnLibraryItemAction,
  deleteLearnLibraryItemAction,
} from './media-actions';
export type { LearnLibraryRow, LearnMediaListing } from '@/lib/learn-media';
export type { MediaRow, MediaSort } from '@/lib/learn-media-core';
export {
  scheduleLearnPublishAction,
  cancelLearnScheduleAction,
  createLearnPreviewLinkAction,
  revokeLearnPreviewLinkAction,
  editLearnImageAction,
} from './ops-actions';
export type { LearnImageEdit, LearnImageOp } from '@/lib/learn-image-edit-core';
export type { LearnEditorState, LearnVersionSummary } from '@/lib/learn-page';

// v2 (T318). Stand-ins until T315 (media, library) and T316 (schedule,
// preview link, image tools) land; swap these lines for their actions.
export {
  listLearnMediaAction,
  updateLearnMediaAction,
  deleteLearnMediaAction,
  recordLearnMediaAction,
  transformLearnImageAction,
  listLearnLibraryAction,
  saveLearnLibraryAction,
  renameLearnLibraryAction,
  deleteLearnLibraryAction,
  scheduleLearnPublishAction,
  cancelLearnScheduleAction,
  createLearnPreviewLinkAction,
  revokeLearnPreviewLinkAction,
} from './standin-actions';
export type { MediaRow, LibraryRow } from './standin-actions';
