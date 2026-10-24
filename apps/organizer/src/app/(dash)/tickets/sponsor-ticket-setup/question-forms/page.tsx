import Link from 'next/link';
import { QuestionFormScreen } from '../../question-form-screen';

export const dynamic = 'force-dynamic';

/** Tickets › Sponsor Ticket Setup › Question Forms. */
export default async function SponsorQuestionFormsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  return (
    <QuestionFormScreen
      searchParams={searchParams}
      audience="sponsor"
      title="Question Forms"
      links={[
        <Link key="t" href="/tickets/sponsor-ticket-setup/sponsor-tickets">
          Sponsor Tickets
        </Link>,
        <Link key="m" href="/content/sponsor-center/sponsor-manager">
          Sponsor Manager
        </Link>,
      ]}
      intro={
        <p className="body-2" style={{ marginTop: 0 }}>
          Useful questions for sponsors: the marketing contact, the legal entity name for the
          invoice, and who should get the deliverables checklist.
        </p>
      }
    />
  );
}
