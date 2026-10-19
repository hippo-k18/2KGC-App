import Link from 'next/link';
import { statusLabel } from '@/lib/blog/access';
import { facts } from '@/lib/blog/store';
import type { StoredPost } from '@/lib/blog/types';

export function statusClass(p: StoredPost): string {
  if (p.draftState === 'review') return 'st-status-review';
  if (p.draftState === 'changes') return 'st-status-changes';
  if (p.live) return p.draftState === 'editing' ? 'st-status-pending' : 'st-status-live';
  return 'st-status-draft';
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function when(p: StoredPost): string {
  if (p.draftState === 'review' && p.submittedAt) return `Sent ${dateFmt.format(p.submittedAt)}`;
  if (p.updatedAt) return `Edited ${dateFmt.format(p.updatedAt)}`;
  const d = p.live?.date;
  return d ? dateFmt.format(new Date(`${d}T00:00:00Z`)) : '';
}

export function PostRows({ posts, base, showAuthor }: { posts: StoredPost[]; base: string; showAuthor: boolean }) {
  return (
    <ul className="st-list">
      {posts.map((p) => {
        const f = p.draft;
        const cover = f.cover?.src;
        return (
          <li key={p.id} className="st-row">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="st-thumb" src={cover} alt="" loading="lazy" />
            ) : (
              <span className="st-thumb" aria-hidden="true" />
            )}
            <div style={{ minWidth: 0 }}>
              <Link className="st-row-title" href={`${base}/write/${p.id}`}>
                {f.title || 'Untitled post'}
              </Link>
              <div className="st-row-sub">
                {showAuthor && <>{f.authorName || p.authorEmail} · </>}
                {f.slug ? `/${f.slug}` : 'No web address yet'}
              </div>
            </div>
            <span className={`st-status ${statusClass(p)}`}>{statusLabel(facts(p))}</span>
            <span className="st-row-when">{when(p)}</span>
          </li>
        );
      })}
    </ul>
  );
}
