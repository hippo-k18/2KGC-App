import Link from 'next/link';
import { COLLECTIONS } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { countWhereEvent } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { GapPanel, PageHeader, Panel, StatTiles, Tag } from '../../../ui';

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
        info={
          <>
            <strong>No attendee limit</strong>
            <p>This event has no cap on attendees, so there is nothing to upgrade.</p>
          </>
        }
        tags={<Tag color="grey">no limit</Tag>}
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="o" href={ROUTES.ordersSummary}>
            Orders summary
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Registrations', value: registrations },
          { label: 'Attendee cap', value: 'none' },
        ]}
      />

      <Panel>
        <p className="body-2" style={{ margin: 0 }}>
          There is no attendee limit on this event. Ticket sales and fees are on the{' '}
          <Link href={ROUTES.ordersSummary}>Orders summary</Link>.
        </p>
      </Panel>

      <GapPanel>
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
      </GapPanel>
    </>
  );
}
