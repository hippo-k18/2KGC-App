import Link from 'next/link';
import { COLLECTIONS } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { countWhereEvent } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Attendees › Manage Attendees › Attendee Limit Upgrade.
 *
 * This is a billing screen in Whova: the attendee list is capped by the package
 * an organizer bought, and this is where they buy a bigger one.
 *
 * There is no equivalent here and there is nothing to sell. KGC runs its own
 * software; the attendee list is not a metered product, no tier exists to
 * upgrade to, and inventing one so this screen has something to display would
 * be a fiction with a price on it. So the screen says plainly that the cap does
 * not exist, and then says what the *real* limits are — because "unlimited" is
 * itself the kind of reassuring claim AGENTS.md warns about, and it is not
 * quite true.
 */
export default async function AttendeeLimitUpgradePage() {
  await requireOrganizer();

  // A single `where('eventId', '==', …)` count. No second field, so no
  // composite index — the emulator would not catch a missing one and it fails
  // in production rather than here.
  const registrations = await countWhereEvent(COLLECTIONS.registrations);

  return (
    <>
      <PageHeader
        title="Attendee Limit Upgrade"
        tags={<Tag color="grey">nothing to buy</Tag>}
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="o" href={ROUTES.ordersSummary}>
            Orders summary
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>There is no attendee cap and no package to upgrade.</strong> Whova meters the
        attendee list and sells more of it. This dashboard is not a product with tiers — nothing
        here bills anybody, and no screen in it will ever ask for a card. The limits that do exist
        are infrastructural, and they are below.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Registrations', value: registrations, sub: 'no ceiling applies' },
          { label: 'Attendee cap', value: 'none', sub: 'no tier, no metering' },
          { label: 'Cost per attendee', value: '$0', sub: 'from this dashboard' },
        ]}
      />

      <Panel>
        <h2 className="section-header">The limits that are real</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Firestore&rsquo;s free tier, not an attendee count.</strong> The project is on
            the Spark plan: 50,000 document reads and 20,000 writes a day. A conference of a
            thousand attendees is comfortably inside that, and the thing that would breach it is a
            badly shaped query rather than a big list — which is why every read in this dashboard is
            a single equality filter with the sorting done in memory.
          </li>
          <li>
            <strong>Stripe takes a percentage of each ticket</strong>, which is the only per-attendee
            cost on the money path and belongs to the ticket price rather than to this screen. The{' '}
            <Link href={ROUTES.ordersSummary}>Orders summary</Link> has the actual figures.
          </li>
          <li>
            <strong>The one hard ceiling is human.</strong> Check-in throughput at the door, and the
            room. Neither is purchasable from here.
          </li>
        </ul>
      </Panel>

      <Panel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Any billing at all.</strong> This dashboard has no subscription, no plan, no
            invoice for itself and no payment form. The Stripe integration sells{' '}
            <em>event tickets</em> to attendees and is unrelated to this screen.
          </li>
          <li>
            <strong>A metered attendee cap.</strong> Not modelled, not enforced, and not planned —
            it exists in Whova because Whova is sold by the seat.
          </li>
          <li>
            <strong>Usage alerts against the Firestore quota.</strong> Worth having and absent. It
            would be a scheduled job reading the project&rsquo;s usage, which needs a trusted server
            — there are two, so this is cheap when somebody wants it.
          </li>
        </ul>
      </Panel>
    </>
  );
}
