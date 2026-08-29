import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel } from '../../../ui';

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

      <Banner kind="info">
        <strong>Categories live under Attendees.</strong> Whova puts the same feature in two places
        in its nav; duplicating the screen would mean two lists of the same people that can drift
        apart, so this one is a signpost.{' '}
        <Link href="/attendees/categories">Attendees › Categories</Link> has the real data.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What a category is here</h2>
        <p className="body-2">
          Not an organizer-authored label. Categories are <code>UserDoc.roles</code> — the list this
          project already keeps because a speaker is also an attendee — surfaced as the cohorts they
          already are. That is a smaller thing than Whova&rsquo;s and it has one advantage: nobody
          has to maintain it, and it cannot disagree with what the app and{' '}
          <code>firestore.rules</code> actually believe about a person.
        </p>

        <h2 className="section-header">The Tickets-side half that is missing</h2>
        <p className="body-2">
          Whova can say &ldquo;anyone who buys the Workshops ticket is categorised as a Workshop
          Attendee&rdquo;, and then use that category for badge colour, session access and who a
          message goes to. Ours cannot: a purchase writes a registration and increments a tier
          count, and nothing derives a label from it.
        </p>
        <p className="body-2">
          Where a purchase <em>does</em> decide something, it does it through an entitlement rather
          than a category — <code>includesWorkshops</code> on the ticket type, read by{' '}
          <Link href="/attendees/ticket-session-mapping">Ticket Session Mapping</Link>. That is the
          narrower, more reliable version of the same idea, and it covers the one case KGC actually
          has.
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
