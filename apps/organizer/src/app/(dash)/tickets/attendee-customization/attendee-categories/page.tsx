import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapPanel, PageHeader, Panel } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Attendee Customization › Attendee Categories.
 *
 * Whova's nav lists categories twice — here and under Attendees — because the
 * same objects are used for two jobs: deciding what a *purchase* grants, and
 * labelling a *person*. This project already builds the second one at
 * `attendees/categories`, so this screen points at it rather than shipping a
 * duplicate list that could disagree with it.
 *
 * The half that genuinely belongs on the Tickets side — a category assigned by
 * which ticket somebody bought — is the part that does not exist, and it is
 * described as missing rather than implied by a link.
 */
export default async function AttendeeCategoriesPage() {
  await requireOrganizer();
  return (
    <>
      <PageHeader
        title="Attendee Categories"
        info={
          <>
            <strong>One list, kept under Attendees</strong>
            <p>
              Categories are the roles a person holds, such as speaker or attendee. Buying a
              ticket does not set a category.
            </p>
          </>
        }
        actions={
          <Link href="/attendees/categories" className="whova-btn-main">
            Open Attendees › Categories
          </Link>
        }
        links={[
          <Link key="t" href="/tickets/attendee-customization/ticket-tiering">
            Ticket Tiering
          </Link>,
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a category is here</h2>
        <p className="body-2">
          Categories are the roles a person holds, such as speaker or attendee. The list is at{' '}
          <Link href="/attendees/categories">Attendees › Categories</Link>.
        </p>
        <p className="body-2">
          What a ticket lets somebody attend is set on the ticket type. See{' '}
          <Link href="/attendees/ticket-session-mapping">Ticket Session Mapping</Link>.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No category list on this screen, deliberately.</strong> One list, at{' '}
            <Link href="/attendees/categories">Attendees › Categories</Link>.
          </li>
          <li>
            <strong>No ticket-to-category mapping.</strong> Nothing turns a purchase into a label,
            and <code>Role</code> is a closed union of six rather than a set an organizer can extend.
          </li>
          <li>
            <strong>No category-driven badge or access rules.</strong> Badge printing is modelled
            and unbuilt; access is decided by the <code>registered</code> claim, which does not vary
            by category.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
