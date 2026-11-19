import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DRAFT_COVER_SIZES, DraftArticle } from '@/lib/blog/draft-article';
import { draftAvatar, findSharedDraft } from '@/lib/blog/store';
import { isFromEditor } from '@/lib/blog/types';
import { getPostBody } from '@/lib/post-content';

/**
 * `/shared/{token}` — a draft shown, read-only, to whoever holds the link.
 *
 * A capability URL like `/review/{token}`: kept out of indexes and caches, and
 * per request, because a revoke has to take effect on the next load. The
 * headers in `next.config.ts` say the same thing as this metadata, for crawlers
 * and proxies that do not read HTML. Who may see what, and why every dead link
 * is the same 404, is in `@/lib/blog/review-link`.
 *
 * The title is deliberately generic: it is the one part of the page a browser
 * puts in history, tabs and bookmarks shared with other people.
 */
export const metadata: Metadata = {
  title: 'Draft for review',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

export default async function SharedDraftPage({ params }: { params: Promise<{ token: string }> }) {
  const post = await findSharedDraft((await params).token);
  if (!post) notFound();
  const f = post.draft;

  return (
    <DraftArticle
      fields={f}
      fromEditor={isFromEditor(post)}
      avatar={await draftAvatar(post)}
      legacyHtml={f.body.kind === 'legacy' ? getPostBody(f.body.slug) : null}
      coverSizes={DRAFT_COVER_SIZES}
      banner={
        <p className="notice" role="note">
          <strong>Draft shared for review. It is not published.</strong> It may still change. This link
          stops working when it expires, is turned off or replaced, or when the post is published,
          unpublished, discarded or deleted.
        </p>
      }
    />
  );
}
