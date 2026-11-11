import { describe, expect, it } from 'vitest';
import * as r from './access';

const editor: r.Viewer = { email: 'ed@kgc.test', name: 'Ed', role: 'editor' };
const writer: r.Viewer = { email: 'Wri@kgc.test', name: 'Wri', role: 'writer' };
const other: r.Viewer = { email: 'other@kgc.test', name: 'O', role: 'writer' };

const post = (over: Partial<r.PostAccessFacts> = {}): r.PostAccessFacts => ({
  authorEmail: 'wri@kgc.test',
  isLive: false,
  everPublished: false,
  draftState: 'editing',
  ...over,
});

describe('writers are gated', () => {
  it('see and edit only their own posts, never the archive', () => {
    expect(r.canView(writer, post())).toBe(true);
    expect(r.canEdit(writer, post())).toBe(true);
    expect(r.canView(other, post())).toBe(false);
    expect(r.canEdit(other, post())).toBe(false);
    const archive = post({ authorEmail: null, isLive: true, everPublished: true, draftState: 'none' });
    expect(r.canView(writer, archive)).toBe(false);
    expect(r.canEdit(writer, archive)).toBe(false);
  });

  it('can never publish, unpublish or run review', () => {
    expect(r.canPublish(writer)).toBe(false);
    expect(r.canUnpublish(writer, post({ isLive: true }))).toBe(false);
    expect(r.canRequestChanges(writer, post({ draftState: 'review' }))).toBe(false);
    expect(r.canManagePeople(writer)).toBe(false);
  });

  it('submit, then are locked out until they withdraw or an editor decides', () => {
    expect(r.canSubmit(writer, post())).toBe(true);
    const inReview = post({ draftState: 'review' });
    expect(r.canEdit(writer, inReview)).toBe(false);
    expect(r.canSubmit(writer, inReview)).toBe(false);
    expect(r.canWithdraw(writer, inReview)).toBe(true);
    expect(r.canWithdraw(other, inReview)).toBe(false);
    expect(r.canSubmit(writer, post({ draftState: 'changes' }))).toBe(true);
  });

  it('cannot delete or re-address what readers have seen', () => {
    const seen = post({ everPublished: true, isLive: false });
    expect(r.canDelete(writer, seen)).toBe(false);
    expect(r.canChangeSlug(writer, seen)).toBe(false);
    expect(r.canDelete(writer, post())).toBe(true);
    expect(r.canDelete(other, post())).toBe(false);
  });
});

describe('editors run the blog', () => {
  it('see, edit, publish and decide on anything', () => {
    const inReview = post({ draftState: 'review' });
    expect(r.canView(editor, inReview)).toBe(true);
    expect(r.canEdit(editor, inReview)).toBe(true);
    expect(r.canPublish(editor)).toBe(true);
    expect(r.canRequestChanges(editor, inReview)).toBe(true);
    expect(r.canRequestChanges(editor, post())).toBe(false);
    expect(r.canSubmit(editor, post({ authorEmail: 'ed@kgc.test' }))).toBe(false);
  });
});

describe('status labels', () => {
  it('say where a post stands', () => {
    expect(r.statusLabel({ isLive: false, draftState: 'editing' })).toBe('Draft');
    expect(r.statusLabel({ isLive: true, draftState: 'none' })).toBe('Published');
    expect(r.statusLabel({ isLive: true, draftState: 'editing' })).toBe('Published, with unpublished edits');
    expect(r.statusLabel({ isLive: true, draftState: 'review' })).toBe('Edits in review');
    expect(r.statusLabel({ isLive: false, draftState: 'changes' })).toBe('Changes requested');
  });
});
