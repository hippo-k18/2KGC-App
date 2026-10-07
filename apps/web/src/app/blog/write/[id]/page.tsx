import { notFound } from 'next/navigation';
import * as rules from '@/lib/blog/access';
import { currentViewer, requireViewer } from '@/lib/blog/auth';
import { blogBase, blogOrigin } from '@/lib/blog/paths';
import { categoriesOf, publicPosts } from '@/lib/blog/public';
import { facts, findPost } from '@/lib/blog/store';
import { getPostBody } from '@/lib/post-content';
import { statusClass } from '../post-list';
import { PostEditor } from './editor';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  // Checked here too: metadata renders before the page, and a title is a leak.
  const [post, viewer] = await Promise.all([findPost((await params).id), currentViewer()]);
  if (!post || !viewer || !rules.canView(viewer, facts(post))) return { title: 'Not found' };
  return { title: post.draft.title || 'Untitled post' };
}

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer, base] = await Promise.all([params, requireViewer(), blogBase()]);
  const post = await findPost(id);
  if (!post || !rules.canView(viewer, facts(post))) notFound();

  const f = facts(post);
  const legacyHtml = post.draft.body.kind === 'legacy' ? (getPostBody(post.draft.body.slug) ?? '') : null;
  const categories = categoriesOf(await publicPosts()).map((c) => c.name);

  return (
    <PostEditor
      // A new key after a status change remounts nothing: only the props change.
      id={post.id}
      base={base}
      slugPrefix={`${blogOrigin().replace(/^https?:\/\//, '')}/`}
      draft={post.draft}
      legacyHtml={legacyHtml}
      isLive={post.live !== null}
      liveSlug={post.live?.slug ?? null}
      everPublished={post.everPublished}
      status={{ label: rules.statusLabel(f), className: statusClass(post) }}
      reviewNote={post.draftState === 'changes' ? (post.reviewNote ?? '') : undefined}
      reviewNoteBy={post.reviewNoteBy}
      isArchive={Boolean(post.legacySlug)}
      categorySuggestions={categories}
      can={{
        editor: rules.isEditor(viewer),
        canEdit: rules.canEdit(viewer, f),
        canSubmit: rules.canSubmit(viewer, f),
        canWithdraw: rules.canWithdraw(viewer, f),
        canRequestChanges: rules.canRequestChanges(viewer, f),
        canUnpublish: rules.canUnpublish(viewer, f),
        canDiscard: rules.canDiscardDraft(viewer, f),
        canDelete: rules.canDelete(viewer, f) && !post.legacySlug,
        canChangeSlug: rules.canChangeSlug(viewer, f),
      }}
    />
  );
}
