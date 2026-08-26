import Link from 'next/link';
import { QuestionFormScreen } from '../../question-form-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › 2.2 Question Forms.
 *
 * The exhibitor form is the one place a purchase can collect what makes an
 * exhibitor an exhibitor — company name, booth contacts, product categories,
 * shipping details. Without it a purchase produces a payer and nothing else,
 * which is why this gap was always larger than &ldquo;a form is missing&rdquo;.
 *
 * The logo is still missing and will stay missing until Storage uploads exist:
 * a file-upload question needs a rule letting an unauthenticated buyer write
 * exactly once, and that is blocker 3 rather than a field type.
 */
export default async function ExhibitorQuestionFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  return (
    <QuestionFormScreen
      searchParams={searchParams}
      audience="exhibitor"
      title="2.2 Question Forms"
      links={[
        <Link key="t" href="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets">
          2.1 Exhibitor Tickets
        </Link>,
        <Link key="m" href="/content/exhibitor-center/exhibitor-manager">
          Exhibitor Manager
        </Link>,
        <Link key="a" href="/tickets/ticket-setup/1-2-question-forms">
          1.2 Question Forms (attendee)
        </Link>,
      ]}
      intro={
        <p className="body-2" style={{ marginTop: 0 }}>
          Ask for the things that decide the floor plan and the load-in: company name as it should
          appear on signage, the booth contact&rsquo;s mobile number, whether they are shipping a
          stand. ⚠️ Answers land on the <em>registration</em>, not on an{' '}
          <code>exhibitors</code> record — the two collections have no link, so a purchase still
          does not create the exhibitor profile the app lists.
        </p>
      }
    />
  );
}
