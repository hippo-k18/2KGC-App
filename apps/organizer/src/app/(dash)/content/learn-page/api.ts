/**
 * The one file that names where the editor's server actions come from.
 *
 * ⚠️ Points at `./dev-actions` (stand-ins) until T309's `./actions` merges;
 * then change the line below to `'./actions'` and delete `dev-actions.ts`.
 */
export {
  loadLearnEditorAction,
  saveLearnDraftAction,
  publishLearnPageAction,
  revertLearnDraftAction,
  restoreLearnVersionAction,
  uploadLearnImageAction,
} from './dev-actions';
export type { LearnResult } from './dev-actions';
export { loadLearnVersionAction } from './version-actions';
export type { LearnEditorState, LearnVersionSummary } from '@/lib/learn-page-dev';
