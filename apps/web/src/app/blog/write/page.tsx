import Link from 'next/link';
import { isEditor } from '@/lib/blog/access';
import { requireViewer } from '@/lib/blog/auth';
import { blogBase } from '@/lib/blog/paths';
import { studioPosts } from '@/lib/blog/store';
import type { StoredPost } from '@/lib/blog/types';
import { NewPostButton } from './go-buttons';
import { PostRows } from './post-list';

export const metadata = { title: 'Posts' };

const TABS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'drafts', label: 'Drafts', test: (p: StoredPost) => !p.live && p.draftState !== 'review' },
  { key: 'review', label: 'In review', test: (p: StoredPost) => p.draftState === 'review' || p.draftState === 'changes' },
  { key: 'live', label: 'Published', test: (p: StoredPost) => p.live !== null },
] as const;

const PAGE = 40;

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; q?: string; n?: string }>;
}) {
  const [viewer, base, params] = await Promise.all([requireViewer(), blogBase(), searchParams]);
  const editor = isEditor(viewer);
  const all = (await studioPosts(viewer)).sort(
    (a, b) => b.updatedAt - a.updatedAt || (b.live?.date ?? '').localeCompare(a.live?.date ?? ''),
  );

  const tab = TABS.find((t) => t.key === params.show) ?? TABS[0];
  const q = (params.q ?? '').trim().toLowerCase();
  const shown = all
    .filter(tab.test)
    .filter((p) => !q || `${p.draft.title} ${p.draft.authorName} ${p.draft.slug}`.toLowerCase().includes(q));
  const limit = Math.max(PAGE, Number(params.n) || PAGE);

  const href = (show: string, extra: Record<string, string> = {}) => {
    const qs = new URLSearchParams({ ...(show !== 'all' ? { show } : {}), ...(q ? { q } : {}), ...extra });
    return `${base}/write${qs.size ? `?${qs}` : ''}`;
  };

  return (
    <div className="st-page">
      <div className="st-head">
        <div>
          <h1>{editor ? 'Posts' : 'Your posts'}</h1>
          {!editor && <p>An editor reviews each post before it goes on the blog.</p>}
        </div>
        <NewPostButton />
      </div>

      {viewer.member.name === viewer.email.split('@')[0] && (
        <div className="ed-note is-info">
          <p>
            Add your name on your <Link href={`${base}/write/profile`}>profile</Link>. It is the byline on your
            posts and the name writers see on review notes.
          </p>
        </div>
      )}

      <div className="st-panel">
        <nav className="st-tabs" aria-label="Filter posts" style={{ padding: '0 8px' }}>
          {TABS.map((t) => (
            <Link key={t.key} href={href(t.key)} aria-current={t === tab ? 'true' : undefined}>
              {t.label}
              <span>{all.filter(t.test).length}</span>
            </Link>
          ))}
        </nav>
        {all.length > 8 && (
          <form className="st-toolbar-row" action={`${base}/write`}>
            {tab.key !== 'all' && <input type="hidden" name="show" value={tab.key} />}
            <input className="st-input" type="search" name="q" defaultValue={params.q} placeholder="Search titles and authors" aria-label="Search posts" />
          </form>
        )}

        {shown.length === 0 ? (
          <div className="st-empty">
            {all.length === 0 ? (
              <>
                <strong>No posts yet</strong>
                Start one with New post. It saves as you type.
              </>
            ) : (
              <>Nothing here{q ? ` matches "${params.q}"` : ''}.</>
            )}
          </div>
        ) : (
          <>
            <PostRows posts={shown.slice(0, limit)} base={base} showAuthor={editor} />
            {shown.length > limit && (
              <div className="st-more">
                <Link href={href(tab.key, { n: String(limit + PAGE) })}>
                  Show {Math.min(PAGE, shown.length - limit)} more of {shown.length - limit}
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
