import { redirect } from 'next/navigation';
import { isEditor } from '@/lib/blog/access';
import { requireViewer } from '@/lib/blog/auth';
import { blogBase, blogPath } from '@/lib/blog/paths';
import { studioPosts } from '@/lib/blog/store';
import { PostRows } from '../post-list';

export const metadata = { title: 'Review' };

export default async function ReviewPage() {
  const [viewer, base] = await Promise.all([requireViewer(), blogBase()]);
  if (!isEditor(viewer)) redirect(await blogPath('/write'));
  const posts = await studioPosts(viewer);
  const waiting = posts.filter((p) => p.draftState === 'review').sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
  const returned = posts.filter((p) => p.draftState === 'changes').sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="st-page">
      <div className="st-head">
        <div>
          <h1>Review</h1>
          <p>Oldest first. Open a post to publish it or send it back with a note.</p>
        </div>
      </div>
      <div className="st-panel">
        {waiting.length ? (
          <PostRows posts={waiting} base={base} showAuthor />
        ) : (
          <div className="st-empty">
            <strong>Nothing is waiting</strong>
            When a writer submits a post, it shows here and every editor gets an email.
          </div>
        )}
      </div>
      {returned.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, margin: '32px 0 10px' }}>Sent back to the writer</h2>
          <div className="st-panel">
            <PostRows posts={returned} base={base} showAuthor />
          </div>
        </>
      )}
    </div>
  );
}
