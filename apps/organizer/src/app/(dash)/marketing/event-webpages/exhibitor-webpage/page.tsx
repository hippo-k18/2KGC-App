import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listBooths } from '@/lib/booths';
import { exhibitorSummary, listExhibitors } from '@/lib/exhibitors';
import { exhibitorLogoRenders, publicUrl } from '@/lib/webpages';
import { Banner, GapPanel, PageHeader, Panel, ProgressBar, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Event Webpages › Exhibitor Webpage.
 *
 * ── This screen used to be the one place Whova was ahead of us ─────────────
 *
 * It said so for months: `exhibitors` was a real collection with real records
 * and Exhibitor Manager edited them, and **no page on knowledgegraph.tech
 * rendered an exhibitor**. The data was in the building and nobody outside
 * could see it, which was the version of that gap with an invoice attached —
 * `/tickets/exhibitor` sells "a listing attendees can find".
 *
 * **`/exhibitors` exists now**, reads `exhibitors` and `booths` live, and is
 * linked from the site footer beside the agenda. So this is a readiness report
 * like every other webpage screen: change an exhibitor and the public page
 * changes. What it measures is the half that is still an organizer's job —
 * how many records are missing a field the page has to print — because the
 * work left is chasing exhibitors, not writing a route.
 *
 * ⚠️ Two of that page's rules are easy to get wrong here, and this screen got
 * both wrong for months. It publishes `status === 'confirmed'` only — a
 * provisional exhibitor has not signed — and it takes the booth number from a
 * `booths` document whose own status is `assigned`, never from
 * `ExhibitorDoc.boothNumber`, which the exhibitor form writes as free text
 * without touching the floor plan. Counting `status !== 'cancelled'` and
 * `boothNumber` instead told an organizer an exhibitor was 100% ready here
 * while the public card carried no booth number at all, which is the one thing
 * a visitor standing in the hall needs. The counts below now use
 * `listExhibitorsByZone()`'s predicates; see `apps/web/src/lib/data.ts`.
 *
 * Deliberately no "Publish" button. There is nothing to publish — the page
 * reads Firestore on every request.
 */
export default async function ExhibitorWebpagePage() {
  await requireOrganizer();
  const [rows, summary, booths] = await Promise.all([
    listExhibitors(),
    exhibitorSummary(),
    listBooths(),
  ]);

  /*
   * The spaces the floor plan agrees an exhibitor holds, which is what the
   * public card prints. A `held` booth is promised in a sales conversation and
   * unpaid, so it is not a number anyone may be sent to.
   */
  const assignedBooths = new Map<string, string[]>();
  for (const b of booths) {
    if (b.status !== 'assigned' || !b.exhibitorId) continue;
    assignedBooths.set(b.exhibitorId, [...(assignedBooths.get(b.exhibitorId) ?? []), b.number]);
  }
  for (const [id, numbers] of assignedBooths) {
    assignedBooths.set(id, numbers.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  }

  // Only the confirmed ones reach `/exhibitors`, so only they can be missing
  // anything on it. A provisional exhibitor with no logo is not a page problem.
  const listed = rows.filter((r) => r.status === 'confirmed');

  // What a public listing would need per exhibitor, in the order a visitor
  // notices it missing: a hole where a logo goes, then a booth they cannot
  // find, then a blurb that says nothing, then a dead link.
  const gaps = [
    {
      label: 'no logo — leaves a hole in the grid',
      count: listed.filter((r) => !exhibitorLogoRenders(r.logoURL)).length,
    },
    {
      label: 'no booth on the floor plan — not findable in the hall',
      count: listed.filter((r) => !assignedBooths.has(r.id)).length,
    },
    {
      label: 'no description — the card would be a name only',
      count: listed.filter((r) => !r.description).length,
    },
    {
      label: 'no website link — nowhere for a visitor to go next',
      count: listed.filter((r) => !r.website).length,
    },
  ].filter((g) => g.count > 0);

  const ready = listed.filter(
    (r) =>
      exhibitorLogoRenders(r.logoURL) && assignedBooths.has(r.id) && r.description && r.website,
  ).length;
  const pct = listed.length === 0 ? 0 : Math.round((ready / listed.length) * 100);

  return (
    <>
      <PageHeader
        title="Exhibitor Webpage"
        tags={<Tag color="green" fill="outline">live at /exhibitors</Tag>}
        actions={
          <a href={publicUrl('/exhibitors')} target="_blank" rel="noreferrer" className="whova-btn-main">
            View the live page ↗
          </a>
        }
        links={[
          <Link key="m" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
          <Link key="w" href="/marketing/event-website">
            Event Website
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>Everything you confirm here is on the public site.</strong> The{' '}
        <code>exhibitors</code> collection holds {summary.total} records and{' '}
        <a href={publicUrl('/exhibitors')} target="_blank" rel="noreferrer">
          /exhibitors
        </a>{' '}
        renders the confirmed ones, grouped by aisle, on every request. ⚠️ The <em>app</em> still
        has no exhibitor surface, so somebody standing in the hall cannot look one up on their
        phone — see below.
      </Banner>

      <StatTiles
        tiles={[
          {
            label: 'On the public page',
            value: listed.length,
            sub:
              summary.provisional > 0
                ? `${summary.provisional} provisional, not published`
                : 'every confirmed exhibitor',
          },
          {
            label: 'In the collection',
            value: summary.total,
            sub: summary.cancelled > 0 ? `${summary.cancelled} cancelled` : 'none cancelled',
          },
          {
            label: 'Would render cleanly',
            value: `${ready}/${listed.length}`,
            sub: 'all four public fields present',
          },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What is wrong with the page today?</h2>
        {listed.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Nothing — no exhibitor is confirmed yet, so the page shows an empty hall. Confirm them
            in Exhibitor Manager first.
          </p>
        ) : gaps.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Nothing. Every exhibitor has a logo, a booth, a description and a link, so the listing
            renders complete.
          </p>
        ) : (
          <>
            <ProgressBar pct={pct} />
            <Table
              cols={[
                { key: 'p', label: 'Problem', className: 'cell-fill' },
                { key: 'n', label: 'Exhibitors', className: 'cell-sm' },
                { key: 'a', label: '', className: 'cell-sm' },
              ]}
              rows={gaps.map((g) => [
                g.label,
                g.count,
                <Link key="a" href="/content/exhibitor-center/exhibitor-manager" style={{ fontSize: 12 }}>
                  Fix in Exhibitor Manager
                </Link>,
              ])}
            />
            <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
              Ordered by how obvious each one would be to a visitor, not by how many there are.
            </p>
          </>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The hall as it stands</h2>
        <Table
          cols={[
            { key: 'b', label: 'Booth', className: 'cell-sm' },
            { key: 'n', label: 'Exhibitor', className: 'cell-fill' },
            { key: 's', label: 'Status', className: 'cell-sm' },
            { key: 'p', label: 'Public fields', className: 'cell-md' },
          ]}
          rows={rows.map((r) => {
            const assigned = assignedBooths.get(r.id) ?? [];
            const missing = [
              !exhibitorLogoRenders(r.logoURL) ? 'logo' : null,
              assigned.length === 0 ? 'booth' : null,
              !r.description ? 'description' : null,
              !r.website ? 'link' : null,
            ].filter(Boolean);
            return [
              assigned.length > 0 ? (
                assigned.join(', ')
              ) : r.boothNumber ? (
                /*
                  Typed in Exhibitor Manager and not assigned in the floor plan.
                  The public card prints no number at all in this case rather
                  than a number that may belong to somebody else, so showing the
                  typed one unqualified here is how an exhibitor ends up
                  believing they are findable.
                */
                <span key="b" className="muted">
                  {r.boothNumber} — not on the plan
                </span>
              ) : (
                <span key="b" className="muted">—</span>
              ),
              r.name,
              <Tag
                key="s"
                color={r.status === 'confirmed' ? 'green' : r.status === 'cancelled' ? 'red' : 'orange'}
                fill="outline"
                small
              >
                {r.status}
              </Tag>,
              r.status !== 'confirmed' ? (
                // Nothing is missing from a card the page does not render.
                <span key="p" className="muted" style={{ fontSize: 12 }}>
                  not on the page
                </span>
              ) : missing.length === 0 ? (
                <span key="p" style={{ fontSize: 12 }}>
                  complete
                </span>
              ) : (
                <span key="p" className="muted" style={{ fontSize: 12 }}>
                  missing {missing.join(', ')}
                </span>
              ),
            ];
          })}
          empty="No exhibitors yet."
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Logos, which are blocked one layer down.</strong> The public card has a box for
            one and falls back to the name in a grey square without it. Exhibitor Manager has a
            real upload field and <code>lib/uploads.ts</code> is a real writer — but the Cloud
            Storage bucket itself has never been created (<code>OWNER-ACTIONS.md</code> §1), so
            every upload fails with an actionable error. The count in the table above is how many
            cards that costs.
          </li>
          <li>
            <strong>An exhibitor surface in the app.</strong> The People tab has attendees,
            speakers and sponsors. There is no exhibitor segment, so a visitor standing in the hall
            cannot look one up on their phone.
          </li>
          <li>
            <strong>Per-exhibitor detail pages with downloads and offers.</strong> Sponsors carry
            offers and downloads on their document; <code>ExhibitorDoc</code> does not, and adding
            them before there is a page to show them on would be modelling for nothing.
          </li>
          <li>
            <strong>Exhibitor self-service.</strong> Whova sends each exhibitor a personal link to
            fill in their own listing. That needs the link-token pattern the badge already uses,
            pointed at a public form nobody has written.
          </li>
          <li>
            <strong>An embed snippet.</strong> Whova gives you an iframe for your own site. Ours{' '}
            <em>is</em> the site, so there is nothing to embed it into.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
