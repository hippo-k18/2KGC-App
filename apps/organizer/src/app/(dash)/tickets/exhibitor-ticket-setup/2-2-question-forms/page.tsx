import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › 2.2 Question Forms.
 *
 * The exhibitor question form is the one place Whova collects everything that
 * makes an exhibitor an exhibitor — company name, booth contacts, logo, product
 * categories, shipping details. Without it a purchase produces a payer and
 * nothing else, which is why this gap is larger than &ldquo;a form is missing&rdquo;.
 */
export default async function ExhibitorQuestionFormsPage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="2.2 Question Forms"
      links={[
        <Link key="t" href="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets">
          2.1 Exhibitor Tickets
        </Link>,
        <Link key="a" href="/tickets/ticket-setup/1-2-question-forms">
          1.2 Question Forms (attendee)
        </Link>,
      ]}
      lead={
        <>
          <strong>No question form exists, for any audience.</strong> Checkout collects a name, an
          email address and a card. Every other field Whova would ask an exhibitor for is simply
          not asked.
        </>
      }
      whova={
        <>
          A per-ticket-type form builder: text, dropdown, checkbox, file upload and consent fields,
          each optionally required, shown during registration and answered per exhibitor. Answers
          become columns in the exhibitor export and are editable afterwards by the organizer.
        </>
      }
      needs={
        <>
          Three pieces, none of which exists: a form definition to author, a place on the order or
          registration to store answers, and a checkout that renders the form. The third is the
          expensive one — Stripe hosted Checkout has no arbitrary-field support, so collecting
          answers means a form on our own page before the redirect, and then holding those answers
          until the webhook confirms payment.
        </>
      }
      size="4–6 days, most of it the pre-checkout form and its pending-answer storage"
      refs={
        <>
          <code>apps/web/src/app/checkout/</code> for what the purchase flow can currently collect,
          and <code>packages/shared/src/models.ts</code> for the absence of any answer field.
        </>
      }
      notBuilt={[
        <li key="builder">
          <strong>The form builder.</strong> No field-definition model, no editor, no per-tier
          assignment.
        </li>,
        <li key="upload">
          <strong>File upload questions.</strong> The logo is the one exhibitors always need to
          send. That means Storage, a size and type check, and a rule that lets an unauthenticated
          buyer write exactly once.
        </li>,
        <li key="export">
          <strong>Answers in the export.</strong>{' '}
          <Link href="/attendees/manage-attendees/analytics-and-exports">Analytics &amp; Exports</Link>{' '}
          emits fixed columns; arbitrary answers would need a dynamic header.
        </li>,
        <li key="edit">
          <strong>Editing an answer after purchase.</strong> Whova&rsquo;s organizers use this
          constantly, to fix a misspelled company name before the badge prints.
        </li>,
      ]}
    />
  );
}
