import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { CATEGORY_LABEL, listCommunityPosts } from '@/lib/engagement';
import { GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Social Wall › Social Wall Customization.
 *
 * Whova's social wall is a public, auto-refreshing page of attendee posts, meant
 * for a projector in the lobby. This screen picks its theme, its colours and
 * which post types appear on it.
 *
 * ── The posts are real and deliberately not public ──────────────────────────
 *
 * `communityPosts` is live: the app's Community tab writes it and the moderation
 * queue reads it. So the wall's *content* exists. What does not exist is a
 * public surface for it, and that absence is a security position rather than a
 * missing route — `firestore.rules` gates the board behind the `registered`
 * custom claim, which is minted only for ticket holders. Attendees post ride
 * shares, hotel rooms and phone numbers there because it is a closed room.
 *
 * Projecting that room onto a lobby wall is a decision about the people who
 * already posted, taken after they posted. So this screen shows what the wall
 * would contain and how much of it is inappropriate for a projector, instead of
 * offering theme controls for a page that does not exist.
 */
export default async function SocialWallCustomizationPage() {
  await requireOrganizer();
  const posts = await listCommunityPosts();

  const visible = posts.filter((p) => p.status !== 'hidden');
  const hidden = posts.filter((p) => p.status === 'hidden');

  // Grouped by category because that is the only axis a wall could filter on —
  // and the grouping is itself the argument: ride-share and lost-and-found
  // carry contact details, and those are the two nobody would project.
  const byCategory = [...new Set(visible.map((p) => p.category))]
    .map((c) => ({
      category: c,
      count: visible.filter((p) => p.category === c).length,
      projectable: c !== 'ride-share' && c !== 'lost-and-found',
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <>
      <PageHeader
        title="Social Wall Customization"
        info={
          <>
            <strong>No public wall</strong>
            <p>
              A social wall is not available yet. Only registered attendees can read the community
              board, and some posts carry phone numbers.
            </p>
          </>
        }
        tags={<Tag color="red" fill="outline">no public wall</Tag>}
        links={[
          <Link key="a" href="/marketing/social-wall/activity-stream-webpage">
            Activity stream webpage
          </Link>,
          <Link key="m" href="/tools/moderator-tools/community-board">
            Moderate the board
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Posts on the board', value: visible.length, sub: hidden.length > 0 ? `${hidden.length} hidden by a moderator` : 'none hidden' },
          {
            label: 'Safe for a screen',
            value: byCategory.filter((c) => c.projectable).reduce((n, c) => n + c.count, 0),
            sub: 'categories without contact details',
          },
          {
            label: 'Hidden by a moderator',
            value: hidden.length,
            sub: hidden.length === 0 ? 'none so far' : 'already off the board',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Posts by category</h2>
        <Table
          cols={[
            { key: 'c', label: 'Category', className: 'cell-fill' },
            { key: 'n', label: 'Posts', className: 'cell-sm' },
            { key: 'p', label: 'On a screen', className: 'cell-md' },
          ]}
          rows={byCategory.map((c) => [
            CATEGORY_LABEL[c.category],
            c.count,
            c.projectable ? (
              <Tag key="p" color="green" fill="outline" small>
                fine
              </Tag>
            ) : (
              <span key="p" className="muted" style={{ fontSize: 12 }}>
                usually carries contact details
              </span>
            ),
          ])}
          empty={<NotInputted what="community posts" compact />}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>The wall itself.</strong> A public route rendering the board, plus a rules
            change or a server-side read that deliberately bypasses the <code>registered</code>{' '}
            gate. The rules change is the part to think hardest about.
          </li>
          <li>
            <strong>Themes, colours and layouts.</strong> Whova offers several. There is no page to
            apply one to, and a saved theme nothing reads is worse than no control at all.
          </li>
          <li>
            <strong>Pre-moderation for the wall.</strong> Moderation today is reactive — a
            moderator hides a post after it appears. A projector needs the opposite order, and
            approve-before-display is a different queue and a different screen.
          </li>
          <li>
            <strong>Attendee opt-in.</strong> Nothing asks a poster whether their words may be
            projected. That consent does not exist to be honoured, which is the real blocker.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
