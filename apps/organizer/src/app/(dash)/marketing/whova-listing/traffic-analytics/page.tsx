import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { Banner, GapPanel, PageHeader, Panel, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Marketing › Whova Listing › Traffic Analytics.
 *
 * ── Two reasons this is empty, and they are different reasons ───────────────
 *
 * First: it measures traffic to a **Whova listing page**, which does not exist
 * for us, so there is nothing to count. That half is not applicable in the same
 * way My Event Listing is — the object being measured belongs to a directory we
 * are not in.
 *
 * Second, and separately: even for the pages we *do* own, nothing measures
 * traffic. `apps/web` carries no analytics of any kind. So an organizer who
 * arrives here reasonably asking "fine, how many people visit our site then"
 * gets the same answer as on Agenda Webpage › Analytics, and it is a privacy
 * decision rather than an oversight.
 *
 * Keeping the two apart matters: the first cannot be fixed and the second can.
 * Collapsing them into one "coming soon" would hide the half that is a choice.
 */
export default async function WhovaListingTrafficPage() {
  await requireOrganizer();

  return (
    <>
      <PageHeader
        title="Listing Traffic Analytics"
        tags={<Tag color="grey" fill="outline">not applicable</Tag>}
        links={[
          <Link key="l" href="/marketing/whova-listing/my-event-listing">
            My event listing
          </Link>,
          <Link key="a" href="/marketing/event-webpages/agenda-webpage/analytics">
            Agenda webpage analytics
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>Nothing to measure, and nothing measuring.</strong> This screen counts views of a
        Whova directory listing, and we are not in a directory. Separately, no page on
        knowledgegraph.tech is instrumented either — that second one is a decision we could take and
        have not.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The two halves, kept apart</h2>
        <dl className="gap-grid">
          <dt>Listing traffic</dt>
          <dd>
            Not applicable. Reproducing it means running an event directory, which is a marketplace
            business rather than a screen. Same answer as{' '}
            <Link href="/marketing/organizer-co-promo">Organizer Co-Promo</Link>.
          </dd>
          <dt>Our own site&rsquo;s traffic</dt>
          <dd>
            Genuinely unmeasured. No Google Analytics, no Plausible, no first-party beacon, no log
            aggregation. The options and what each one costs a visitor are laid out under{' '}
            <Link href="/marketing/event-webpages/agenda-webpage/analytics">
              Agenda Webpage &rsaquo; Analytics
            </Link>
            .
          </dd>
          <dt>What is countable today</dt>
          <dd>
            Ticket sales and app sign-ins, because both are records in Firestore rather than page
            views. Those are real numbers and they live in{' '}
            <Link href="/tickets/orders-and-transactions/summary">Orders</Link> and{' '}
            <Link href="/attendees/manage-attendees/analytics-and-exports">
              Analytics &amp; Exports
            </Link>
            . They answer &ldquo;did it work&rdquo; without answering &ldquo;where did they come
            from&rdquo;.
          </dd>
        </dl>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Listing views, saves and clicks.</strong> No listing exists, so these have no
            subject.
          </li>
          <li>
            <strong>Traffic to knowledgegraph.tech.</strong> Unmeasured by choice. Adding a tracker
            is a privacy position, not a feature request.
          </li>
          <li>
            <strong>Attribution from a source to a ticket.</strong> Orders are real; nothing records
            where a buyer arrived from, and joining the two is exactly what a tracker is for.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
