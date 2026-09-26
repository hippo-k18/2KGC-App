/**
 * Who may do what in the blog editor. Pure, so the whole policy is tested in
 * `access.test.ts` without a database.
 *
 * Two roles:
 *
 *  - **Editors** run the blog. They see every post, edit any of them, publish,
 *    unpublish, delete, and invite people.
 *  - **Writers** are invited. They see only their own posts and can never
 *    publish: a writer's post goes to review, and an editor publishes it. A
 *    writer editing their own post that is already live edits a draft beside
 *    it; readers keep seeing the published version until an editor approves.
 *
 * Every action in `actions.ts` asks one of these functions, with the post as it
 * is in Firestore at that moment, never as the browser described it.
 */

export type BlogRole = 'editor' | 'writer';

export interface Viewer {
  email: string;
  name: string;
  role: BlogRole;
}

/**
 * Where the working copy stands.
 *
 *  - `none`: nothing pending. The draft is the live version.
 *  - `editing`: being written or changed, not yet submitted.
 *  - `review`: submitted, waiting for an editor. Locked for its writer.
 *  - `changes`: an editor sent it back with a note.
 */
export type DraftState = 'none' | 'editing' | 'review' | 'changes';

export interface PostAccessFacts {
  /** The writer who owns it; null for archive posts, which only editors touch. */
  authorEmail: string | null;
  /** Is a version of it live right now? */
  isLive: boolean;
  /** Has it ever been published? A writer cannot delete what readers have seen. */
  everPublished: boolean;
  draftState: DraftState;
}

const owns = (v: Viewer, p: PostAccessFacts) =>
  p.authorEmail !== null && p.authorEmail === v.email.toLowerCase();

export const isEditor = (v: Viewer) => v.role === 'editor';

export const canView = (v: Viewer, p: PostAccessFacts) => isEditor(v) || owns(v, p);

/** Change the working copy. A writer's post in review is locked until withdrawn or decided. */
export const canEdit = (v: Viewer, p: PostAccessFacts) =>
  isEditor(v) || (owns(v, p) && p.draftState !== 'review');

export const canSubmit = (v: Viewer, p: PostAccessFacts) =>
  !isEditor(v) && owns(v, p) && (p.draftState === 'editing' || p.draftState === 'changes');

export const canWithdraw = (v: Viewer, p: PostAccessFacts) =>
  owns(v, p) && p.draftState === 'review';

export const canPublish = (v: Viewer) => isEditor(v);

export const canRequestChanges = (v: Viewer, p: PostAccessFacts) =>
  isEditor(v) && p.draftState === 'review';

export const canUnpublish = (v: Viewer, p: PostAccessFacts) => isEditor(v) && p.isLive;

/** Throw away the pending edits of a live post and go back to what is published. */
export const canDiscardDraft = (v: Viewer, p: PostAccessFacts) =>
  canEdit(v, p) && p.isLive && p.draftState !== 'none';

export const canDelete = (v: Viewer, p: PostAccessFacts) =>
  isEditor(v) || (owns(v, p) && !p.everPublished && p.draftState !== 'review');

/** A slug is a URL. Once readers have it, only an editor may break it. */
export const canChangeSlug = (v: Viewer, p: PostAccessFacts) =>
  isEditor(v) || (owns(v, p) && !p.everPublished);

export const canManagePeople = (v: Viewer) => isEditor(v);

/** The label a post carries in the editor's list. */
export function statusLabel(p: Pick<PostAccessFacts, 'isLive' | 'draftState'>): string {
  if (p.draftState === 'review') return p.isLive ? 'Edits in review' : 'In review';
  if (p.draftState === 'changes') return 'Changes requested';
  if (p.isLive) return p.draftState === 'editing' ? 'Published, with unpublished edits' : 'Published';
  return 'Draft';
}
