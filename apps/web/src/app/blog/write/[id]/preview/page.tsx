import { notFound } from 'next/navigation';
import * as rules from '@/lib/blog/access';
import { requireViewer } from '@/lib/blog/auth';
import { DRAFT_COVER_SIZES, DraftArticle } from '@/lib/blog/draft-article';
import { draftAvatar, facts, findPost } from '@/lib/blog/store';
import { isFromEditor } from '@/lib/blog/types';
import { getPostBody } from '@/lib/post-content';

export const metadata = { title: 'Preview' };

/** The draft in the published post's card, for the writer and the editors. Never public. */
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer] = await Promise.all([params, requireViewer()]);
  const post = await findPost(id);
  if (!post || !rules.canView(viewer, facts(post))) notFound();
  const f = post.draft;

  return (
    <>
      <div className="ed-note is-info" style={{ maxWidth: 'var(--max)', margin: '20px auto 0', boxSizing: 'border-box' }}>
        <p>Preview of the draft. Readers do not see this until it is published.</p>
      </div>
      <DraftArticle
        fields={f}
        fromEditor={isFromEditor(post)}
        avatar={await draftAvatar(post)}
        legacyHtml={f.body.kind === 'legacy' ? getPostBody(f.body.slug) : null}
        coverSizes={DRAFT_COVER_SIZES}
      />
    </>
  );
}
