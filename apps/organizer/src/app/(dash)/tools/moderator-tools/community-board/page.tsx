import Link from 'next/link';
import { COMMUNITY_CATEGORY_LABEL as CATEGORY_LABEL } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listBoardForModeration, type ModeratedPost } from '@/lib/moderation';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, GapPanel, PageHeader, Panel, StatTiles, Tabs, Tag } from '../../../ui';
import { moderatePostAction, moderateReplyAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Tools › Moderator Tools › Community Board.
 *
 * `gaps.ts` said this "would matter the first time it matters", which is the
 * right way to think about a moderation queue: it is worth nothing for months
 * and then it is the only screen anybody cares about, usually within an hour of
 * doors opening.
 *
 * ── Rendered as content, not as a table ─────────────────────────────────────
 *
 * Every other list screen here is a `whova-table`. This one shows posts in full
 * with their replies nested underneath, because moderation is a *reading* task
 * — the decision needs the whole post and the thread around it, and a truncated
 * cell is exactly how the wrong thing gets hidden.
 *
 * ── Hide is reversible and says so ──────────────────────────────────────────
 *
 * Nothing here deletes. A hidden post keeps its replies, keeps the counters
 * that derive from it, and — when it was hidden for being abusive — remains the
 * evidence a code-of-conduct process needs.
 *
 * ── The category names are the app's ────────────────────────────────────────
 *
 * `COMMUNITY_CATEGORY_LABEL` is imported rather than restated. A third copy
 * lived here and printed "Meet-up" and "Ride share" for what the app calls
 * "Meet-ups" and "Travel" — a moderator was reading a name the author of the
 * post had never seen, on the one screen where the two need to be discussing
 * the same thing.
 */

function PostCard({ post }: { post: ModeratedPost }) {
  const hidden = post.status !== 'visible';

  return (
    <div
      style={{
        border: '1px solid var(--hairline)',
        borderRadius: 4,
        marginBottom: 14,
        opacity: hidden ? 0.65 : 1,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          alignItems: 'center',
          background: hidden ? 'var(--surface-alt)' : 'transparent',
          borderBottom: '1px solid var(--hairline)',
          display: 'flex',
          gap: 10,
          padding: '10px 14px',
        }}
      >
        <Tag color="blue" small>
          {CATEGORY_LABEL[post.category] ?? post.category}
        </Tag>
        <strong style={{ fontSize: 14 }}>{post.title}</strong>
        {hidden && (
          <Tag color="red" fill="outline" small>
            {post.status}
          </Tag>
        )}
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11 }}>
          {post.authorName} · {post.createdAt.slice(0, 10)}
        </span>

        <form action={moderatePostAction}>
          <input type="hidden" name="id" value={post.id} />
          <input type="hidden" name="status" value={hidden ? 'visible' : 'hidden'} />
          <button
            type="submit"
            style={{
              background: 'none',
              border: 0,
              color: hidden ? 'var(--link)' : 'var(--danger, #b3352c)',
              cursor: 'pointer',
              fontSize: 12,
              padding: 0,
            }}
          >
            {hidden ? 'Restore' : 'Hide'}
          </button>
        </form>
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.6, padding: '12px 14px', whiteSpace: 'pre-wrap' }}>
        {post.body}
      </div>

      {post.replies.length > 0 && (
        <div style={{ borderTop: '1px solid var(--hairline)', padding: '4px 14px 10px 28px' }}>
          {post.replies.map((r) => {
            const rHidden = r.status !== 'visible';
            return (
              <div
                key={r.id}
                style={{
                  alignItems: 'flex-start',
                  borderBottom: '1px solid var(--hairline)',
                  display: 'flex',
                  gap: 10,
                  opacity: rHidden ? 0.6 : 1,
                  padding: '8px 0',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {r.authorName} · {r.createdAt.slice(0, 10)}
                    {rHidden && (
                      <>
                        {' '}
                        <Tag color="red" fill="outline" small>
                          {r.status}
                        </Tag>
                      </>
                    )}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {r.body}
                  </div>
                </div>
                {/*
                  Replies are moderated on their own. The common case is a fine
                  post with one abusive reply under it, and hiding the whole
                  thread to deal with that punishes everyone else on it.
                */}
                <form action={moderateReplyAction}>
                  <input type="hidden" name="postId" value={r.postId} />
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="status" value={rHidden ? 'visible' : 'hidden'} />
                  <button
                    type="submit"
                    style={{
                      background: 'none',
                      border: 0,
                      color: rHidden ? 'var(--link)' : 'var(--danger, #b3352c)',
                      cursor: 'pointer',
                      fontSize: 11,
                      padding: 0,
                    }}
                  >
                    {rHidden ? 'Restore' : 'Hide'}
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default async function ModerateCommunityBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  await requireOrganizer();
  const { view } = await searchParams;
  const posts = await listBoardForModeration();

  const hiddenPosts = posts.filter((p) => p.status !== 'visible');
  const hiddenReplies = posts.flatMap((p) => p.replies.filter((r) => r.status !== 'visible'));
  const shown = view === 'hidden' ? hiddenPosts : posts;

  return (
    <>
      <PageHeader
        title="Community Board"
        tags={
          hiddenPosts.length + hiddenReplies.length > 0 ? (
            <Tag color="orange" fill="outline">
              {hiddenPosts.length + hiddenReplies.length} hidden
            </Tag>
          ) : (
            <Tag color="green" fill="outline">
              nothing hidden
            </Tag>
          )
        }
        links={[
          <Link key="a" href={ROUTES.announcements}>
            Announcements
          </Link>,
          <Link key="q" href={ROUTES.qaManager}>
            Session Q&amp;A Manager
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Posts', value: posts.length, sub: `${hiddenPosts.length} hidden` },
          {
            label: 'Replies',
            value: posts.reduce((n, p) => n + p.replies.length, 0),
            sub: `${hiddenReplies.length} hidden`,
          },
          {
            label: 'Categories in use',
            value: new Set(posts.map((p) => p.category)).size,
            sub: 'of 6',
          },
        ]}
      />

      <Banner kind="info">
        Hiding removes a post from the app immediately but <strong>does not delete it</strong>.
        Restore is one click, the replies and counters survive, and if it was hidden for being
        abusive the post is the evidence a code-of-conduct process needs.
      </Banner>

      <Tabs
        tabs={[
          { label: `All posts (${posts.length})`, href: '?', active: view !== 'hidden' },
          { label: `Hidden (${hiddenPosts.length})`, href: '?view=hidden', active: view === 'hidden' },
        ]}
      />

      <Panel>
        {shown.length === 0 ? (
          <EmptyState icon="✓">
            <strong>{view === 'hidden' ? 'Nothing is hidden.' : 'The board is empty.'}</strong>
            <p className="muted" style={{ marginTop: 6 }}>
              {view === 'hidden'
                ? 'Every post and reply is visible to attendees.'
                : 'Posts appear here as soon as attendees start using the Community tab.'}
            </p>
          </EmptyState>
        ) : (
          shown.map((p) => <PostCard key={p.id} post={p} />)
        )}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Photos and session chats.</strong> Whova moderates both from the same place.
            Neither feature exists in the app yet, so there is nothing to queue.
          </li>
          <li>
            <strong>Attendee reporting.</strong> Whova lets attendees flag a post, which is what
            fills a moderation queue in practice — an organizer refreshing this page is not a
            substitute. It needs a `reports` collection and a rule letting any signed-in attendee
            write one.
          </li>
          <li>
            <strong>Banning an author.</strong> Hiding content does not stop the person posting
            again, and blocking needs a claim the rules can read.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
