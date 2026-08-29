import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import {
  CATEGORY_LABEL,
  inCategories,
  listCommunityPosts,
  type CommunityCategory,
  type CommunityPostRow,
} from '@/lib/engagement';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, GapPanel, PageHeader, Panel, StatTiles, Tag } from '../../ui';

/**
 * One screen, rendered three times: Meet-ups, Discussion Topics, Social Groups.
 *
 * ── These are views, not features ───────────────────────────────────────────
 *
 * Whova has three separate products here, each with its own posting flow and
 * its own data. We have one community board whose posts already carry a
 * `category`, and these three screens are that field filtered three ways. That
 * is a real difference and it is stated on each screen rather than hidden: an
 * organizer who expects an RSVP list will not find one, because a meet-up here
 * is a post with replies under it.
 *
 * ── Replies are not attendance, and the label says so ───────────────────────
 *
 * The nearest thing the data has to "who is coming to this meet-up" is the set
 * of people who replied. That is a genuinely different thing — somebody may
 * reply to say they cannot make it — so every count here is labelled *replies*
 * and never *attending*. Getting that wrong would put a number in front of an
 * organizer that they would then book a table for.
 */
export async function CategoryScreen({
  title,
  categories,
  intro,
  notBuilt,
}: {
  title: string;
  categories: readonly CommunityCategory[];
  intro: string;
  notBuilt: string[];
}) {
  await requireOrganizer();
  const all = await listCommunityPosts();
  const posts = inCategories(all, categories);

  const visible = posts.filter((p) => p.status === 'visible');
  const replies = posts.reduce((n, p) => n + p.replyCount, 0);
  const people = new Set(posts.flatMap((p) => p.participants.map((x) => x.name))).size;

  return (
    <>
      <PageHeader
        title={title}
        tags={<Tag color="blue">{visible.length} live</Tag>}
        links={[
          <Link key="m" href={ROUTES.moderateBoard}>
            Moderate the board
          </Link>,
          <Link key="a" href={ROUTES.announcements}>
            Announcements
          </Link>,
        ]}
      />

      <Banner kind="info">{intro}</Banner>

      <StatTiles
        tiles={[
          { label: 'Posts', value: posts.length, sub: `${posts.length - visible.length} hidden` },
          { label: 'Replies', value: replies, sub: 'not RSVPs — see below' },
          { label: 'People replying', value: people, sub: 'distinct attendees' },
        ]}
      />

      <Panel>
        {posts.length === 0 ? (
          <EmptyState icon="◌">
            <strong>Nothing posted yet.</strong>
            <p className="muted" style={{ marginTop: 6 }}>
              Attendees create these from the Community tab in the app. Organizers cannot post on
              their behalf — a meet-up nobody proposed is a meet-up nobody attends.
            </p>
          </EmptyState>
        ) : (
          posts.map((p) => <PostRow key={p.id} post={p} />)
        )}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          {notBuilt.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>
            <strong>Organizers cannot post.</strong> Everything here is attendee-authored. Use
            Announcements to say something to everyone.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}

function PostRow({ post }: { post: CommunityPostRow }) {
  const hidden = post.status !== 'visible';
  return (
    <div
      style={{
        borderBottom: '1px solid var(--hairline)',
        opacity: hidden ? 0.6 : 1,
        padding: '12px 0',
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
        <Tag color="blue" small>
          {CATEGORY_LABEL[post.category]}
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
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 6, whiteSpace: 'pre-wrap' }}>
        {post.body}
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
        {/*
          "replied", never "attending". Somebody may well have replied to say
          they cannot come, and an organizer booking a table off this number
          would book the wrong size.
        */}
        <strong>{post.replyCount}</strong> {post.replyCount === 1 ? 'reply' : 'replies'}
        {post.hiddenReplyCount > 0 && ` (${post.hiddenReplyCount} hidden)`}
        {post.lastReplyAt && ` · last ${post.lastReplyAt.slice(0, 10)}`}
        {post.participants.length > 0 && (
          <> · replied: {post.participants.map((x) => x.name).join(', ')}</>
        )}
      </div>
    </div>
  );
}
