import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { CATEGORY_LABEL, listCommunityPosts } from '@/lib/engagement';
import { Banner, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

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

      <Banner kind="warning">
        <strong>The board is closed on purpose.</strong> <code>firestore.rules</code> requires the{' '}
        <code>registered</code> claim to read <code>communityPosts</code>, and that claim is minted
        only for ticket holders. Attendees post ride shares and phone numbers there because it is a
        closed room; a public wall would open it after the fact.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Posts on the board', value: visible.length, sub: hidden.length > 0 ? `${hidden.length} hidden by a moderator` : 'none hidden' },
          {
            label: 'Safe to project',
            value: byCategory.filter((c) => c.projectable).reduce((n, c) => n + c.count, 0),
            sub: 'no contact details by category',
          },
          { label: 'Theme settings', value: 0, sub: 'nothing to theme' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a wall would be showing the lobby</h2>
        <Table
          cols={[
            { key: 'c', label: 'Category', className: 'cell-fill' },
            { key: 'n', label: 'Posts', className: 'cell-sm' },
            { key: 'p', label: 'On a projector', className: 'cell-md' },
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
          empty="Nothing on the board yet."
        />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
          The categories, not the individual posts — the judgement a wall needs is per category, and
          two of them fail it every time.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
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
      </Panel>
    </>
  );
}
