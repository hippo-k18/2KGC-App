import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { readMatchmaking } from '@/lib/engagement';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Community › Attendee Matchmaking.
 *
 * ── This is a report, not a recommender ─────────────────────────────────────
 *
 * Whova's version pushes suggested people into an attendee's app. Ours shows an
 * organizer where the overlaps are, and stops there — because pushing an
 * introduction is a privacy act, not a feature. An attendee who opted out of
 * the directory has said they do not want to be found by other attendees, and
 * suggesting them anyway would use exactly the data they asked us not to use.
 *
 * So opted-out attendees are excluded from the pairs below, counted separately,
 * and the count is shown. An organizer looking at a smaller number than they
 * expected should be able to see why.
 *
 * ── Two shared interests, not one ───────────────────────────────────────────
 *
 * With fifty attendees and a short interest list, a one-interest threshold
 * pairs almost everybody with almost everybody — a page of noise that suggests
 * the feature works. Two is the point at which a pair means something.
 */
export default async function AttendeeMatchmakingPage() {
  await requireOrganizer();
  const m = await readMatchmaking();

  return (
    <>
      <PageHeader
        title="Attendee Matchmaking"
        tags={<Tag color="blue">{m.clusters.length} interests</Tag>}
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="x" href={ROUTES.analyticsExports}>
            Analytics &amp; Exports
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>Nothing here is sent to anybody.</strong> This shows an organizer where interests
        overlap so they can seed a discussion topic or a meet-up. Whova pushes suggested
        introductions into the app; doing that would mean using the profiles of people who opted
        out of being found, so we do not.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Attendees', value: m.totalAttendees, sub: `${m.withInterests} listed interests` },
          { label: 'Interest clusters', value: m.clusters.length, sub: 'two or more people' },
          { label: 'Strong pairs', value: m.pairsFound, sub: 'two or more shared interests' },
          { label: 'Opted out', value: m.optedOut, sub: 'excluded from pairs' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Interest clusters</h2>
        {m.clusters.length === 0 ? (
          <EmptyState icon="◌">
            <strong>Nobody has listed an interest yet.</strong>
            <p className="muted" style={{ marginTop: 6 }}>
              Interests come from the attendee&rsquo;s own profile in the app, which they fill in
              during onboarding.
            </p>
          </EmptyState>
        ) : (
          <Table
            cols={[
              { key: 'i', label: 'Interest', className: 'cell-md' },
              { key: 'n', label: 'People', className: 'cell-xs' },
              { key: 'w', label: 'Who', className: 'cell-fill' },
            ]}
            rows={m.clusters.map((c) => [
              <strong key="i">{c.interest}</strong>,
              c.members.length,
              <span key="w" className="muted" style={{ fontSize: 12 }}>
                {c.members
                  .slice(0, 8)
                  .map((x) => x.name)
                  .join(', ')}
                {c.members.length > 8 && ` and ${c.members.length - 8} more`}
              </span>,
            ])}
          />
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>People worth introducing</h2>
        {m.pairs.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            No two attendees share two or more interests yet.
          </p>
        ) : (
          <Table
            cols={[
              { key: 'a', label: 'Attendee', className: 'cell-md' },
              { key: 'b', label: 'Attendee', className: 'cell-md' },
              { key: 's', label: 'In common', className: 'cell-fill' },
            ]}
            rows={m.pairs.map((p) => [
              <span key="a">
                <strong>{p.a.name}</strong>
                <div className="muted" style={{ fontSize: 11 }}>
                  {[p.a.title, p.a.company].filter(Boolean).join(', ')}
                </div>
              </span>,
              <span key="b">
                <strong>{p.b.name}</strong>
                <div className="muted" style={{ fontSize: 11 }}>
                  {[p.b.title, p.b.company].filter(Boolean).join(', ')}
                </div>
              </span>,
              <span key="s" style={{ fontSize: 12 }}>
                {p.shared.join(', ')}
              </span>,
            ])}
          />
        )}
        {m.pairsFound > m.pairs.length && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
            Showing {m.pairs.length} of {m.pairsFound}. The rest are cut for length, not filtered
            out — said plainly because a silently truncated list reads as a complete one.
          </p>
        )}
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Suggestions in the app.</strong> Deliberate, per the note above — it would use
            the profiles of people who asked not to be findable.
          </li>
          <li>
            <strong>Matching on anything but interests.</strong> Whova matches on registration
            answers and stated goals too. Question Forms is unbuilt, so there are no answers.
          </li>
          <li>
            <strong>1-1 meeting scheduling.</strong> Its own unbuilt screen — it needs availability,
            which nothing collects.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
