import Image from 'next/image';
import { notFound } from 'next/navigation';
import * as rules from '@/lib/blog/access';
import { requireViewer } from '@/lib/blog/auth';
import { PostBodyDoc, PostCover } from '@/lib/blog/render';
import { allMembers, facts, findPost } from '@/lib/blog/store';
import { isFromEditor } from '@/lib/blog/types';
import { getAuthor, getPostBody } from '@/lib/post-content';
import { formatPostDate } from '@/lib/posts';

export const metadata = { title: 'Preview' };

/** The draft in the published post's card, for the writer and the editors. Never public. */
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer] = await Promise.all([params, requireViewer()]);
  const post = await findPost(id);
  if (!post || !rules.canView(viewer, facts(post))) notFound();
  const f = post.draft;
  const legacy = f.body.kind === 'legacy' ? getPostBody(f.body.slug) : null;
  const avatar = post.authorEmail
    ? (await allMembers()).find((m) => m.email === post.authorEmail)?.avatar
    : getAuthor(f.authorName)?.avatar;

  return (
    <>
      <div className="ed-note is-info" style={{ maxWidth: 'var(--max)', margin: '20px auto 0', boxSizing: 'border-box' }}>
        <p>Preview of the draft. Readers do not see this until it is published.</p>
      </div>
      <div className="post-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 1000, paddingTop: 28 }}>
        <div className="post-main">
          <article className="post-card">
            <header>
              <p className="post-categories">{f.categories.join(' | ')}</p>
              <h1 className="post-title">{f.title || 'Untitled post'}</h1>
              <div className="post-meta">
                {avatar && <Image src={avatar} alt="" width={75} height={75} className="post-meta-avatar" />}
                <span>By {f.authorName}</span>
                <span className="post-meta-divider" aria-hidden="true" />
                <span>{f.date ? formatPostDate(f.date) : 'Date set when published'}</span>
              </div>
            </header>
            {isFromEditor(post) && f.cover && <PostCover cover={f.cover} />}
            {f.body.kind === 'doc' ? (
              <div className="post-body">
                <PostBodyDoc doc={f.body.doc} />
              </div>
            ) : (
              <div className="post-body" dangerouslySetInnerHTML={{ __html: legacy ?? '' }} />
            )}
          </article>
        </div>
      </div>
    </>
  );
}
