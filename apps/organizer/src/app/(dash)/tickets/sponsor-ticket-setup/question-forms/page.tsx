import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapScreen } from '../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Sponsor Ticket Setup › Question Forms.
 *
 * ── Where the sponsor version differs from the exhibitor one ────────────────
 *
 * The missing machinery is identical — no form builder, no answer storage, no
 * field collection at checkout. What differs is that a sponsor profile is
 * already modelled and already editable: `sponsors` documents exist, Sponsor
 * Manager edits them, and the attendee app renders them. So the sponsor gap is
 * narrower and more specific than the exhibitor one: not &ldquo;we cannot
 * collect a logo&rdquo;, but &ldquo;the sponsor cannot supply it themselves&rdquo;.
 */
export default async function SponsorQuestionFormsPage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="Question Forms"
      links={[
        <Link key="s" href={ROUTES.sponsorManager}>
          Sponsor Manager
        </Link>,
        <Link key="m" href={ROUTES.messageSponsors}>
          Message Sponsors
        </Link>,
      ]}
      lead={
        <>
          <strong>No question form exists, for any audience.</strong> A sponsor&rsquo;s logo,
          blurb and links reach the app only because an organizer types them into{' '}
          <Link href={ROUTES.sponsorManager}>Sponsor Manager</Link> by hand.
        </>
      }
      whova={
        <>
          A form attached to sponsor tiers, collecting exactly what the sponsor listing needs — logo
          upload, description, website, contacts, social links — at the moment of purchase, with
          required fields and a deadline, and a reminder to sponsors who have not completed it.
        </>
      }
      needs={
        <>
          A form definition, answer storage, and collection before the Stripe redirect. Then the
          piece that would make it genuinely worthwhile: writing those answers into the existing{' '}
          <code>sponsors</code> document, so a completed form becomes the app listing instead of a
          second copy of it that someone has to transcribe.
        </>
      }
      size="4–6 days shared with the exhibitor form; roughly a day more to map answers onto sponsors"
      refs={
        <>
          <code>packages/shared/src/models.ts</code> — <code>SponsorDoc</code>, which is the shape
          any sponsor form should be collecting into.
        </>
      }
      notBuilt={[
        <li key="builder">
          <strong>The form builder.</strong> Shared with the exhibitor screen; neither exists.
        </li>,
        <li key="self">
          <strong>Sponsor self-service.</strong> No sponsor-facing login of any kind. Sponsors
          cannot see or edit their own listing.
        </li>,
        <li key="chase">
          <strong>Chasing an incomplete profile.</strong>{' '}
          <Link href={ROUTES.messageSponsors}>Message Sponsors</Link> can email everyone; it cannot
          target the sponsors who have not sent a logo, because nothing records that they were
          asked.
        </li>,
        <li key="upload">
          <strong>Logo upload by the sponsor.</strong> Needs Storage plus a rule permitting one
          write from an unauthenticated buyer.
        </li>,
      ]}
    />
  );
}
