import Link from 'next/link';
import { QuestionFormScreen } from '../../question-form-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › 1.2 Question Forms.
 *
 * This screen was an honest gap note for months, and the note was right about
 * the constraint: purchases go through hosted Stripe Checkout, the buyer leaves
 * our origin entirely — which is what keeps this project in PCI SAQ A — and
 * Stripe's own `custom_fields` cap at three, text and dropdown only. Enough for
 * a t-shirt size, not for a consent flow.
 *
 * The note also named the realistic design: ask before checkout, on our own
 * page, which we do own. That is what exists now.
 */
export default async function QuestionFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  return (
    <QuestionFormScreen
      searchParams={searchParams}
      audience="attendee"
      title="1.2 Question Forms"
      links={[
        <Link key="a" href="/attendees/manage-attendees/attendees">
          Attendees
        </Link>,
        <Link key="g" href="/tickets/ticket-setup/create-group-tickets">
          Group Tickets
        </Link>,
      ]}
      intro={
        <p className="body-2" style={{ marginTop: 0 }}>
          Dietary requirements and accessibility needs are the two worth asking, and both are
          <strong> catering and venue decisions with a deadline</strong> — asking on the
          confirmation page instead would be easier and would lose roughly half the answers, because
          that is the share of buyers who close the tab the moment they read
          &ldquo;you&rsquo;re registered&rdquo;.
        </p>
      }
    />
  );
}
