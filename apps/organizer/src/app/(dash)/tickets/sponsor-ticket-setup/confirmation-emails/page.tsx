import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Sponsor Ticket Setup › Confirmation Emails.
 *
 * The email machinery is real — Resend, four coded templates, every send logged
 * to `emailLog` and visible on Transaction History. The editor is not, and
 * neither is any notion of a per-audience variant.
 *
 * The sponsor case is the one where a generic confirmation is most obviously
 * wrong: what a sponsor needs on purchase is not a receipt but a list of what
 * they now owe the event — logo by a date, a blurb, a booth contact — and none
 * of that fits in a template nobody can edit.
 */
export default async function SponsorConfirmationEmailsPage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="Confirmation Emails"
      links={[
        <Link key="h" href={ROUTES.transactionHistory}>
          Transaction History
        </Link>,
        <Link key="m" href={ROUTES.messageSponsors}>
          Message Sponsors
        </Link>,
      ]}
      lead={
        <>
          <strong>One confirmation email exists, it is attendee wording, and it is code.</strong>{' '}
          No editor, no sponsor variant, no preview, no test send.
        </>
      }
      whova={
        <>
          An editable confirmation per sponsor tier with merge fields, attachments, a preview and a
          test send — usually carrying the sponsorship deliverables and their deadlines rather than
          a receipt.
        </>
      }
      needs={
        <>
          A stored template, a safe merge-field renderer, and selection by the tier&rsquo;s{' '}
          <code>audience</code> at send time. Delivery itself is solved and logged, which is why
          this is a two-day gap rather than a two-week one.
        </>
      }
      size="2–3 days, shared with the exhibitor confirmation screen"
      refs={
        <>
          <code>scripts/src/lib/email.ts</code> for the four coded templates, and{' '}
          <Link href={ROUTES.transactionHistory}>Transaction History</Link> for what a send looks
          like once it has happened.
        </>
      }
      notBuilt={[
        <li key="editor">
          <strong>The editor.</strong> Wording changes are a code change and a deploy.
        </li>,
        <li key="variant">
          <strong>A sponsor variant.</strong> Nothing branches on <code>audience</code> at send
          time.
        </li>,
        <li key="deliver">
          <strong>Deliverables and deadlines in the email.</strong> The actual content a sponsor
          confirmation should carry, and nothing models a deliverable.
        </li>,
        <li key="bulk">
          <strong>The workaround, named honestly.</strong>{' '}
          <Link href={ROUTES.messageSponsors}>Message Sponsors</Link> sends bulk email to sponsors
          after the fact. It is not a confirmation and it is not triggered by a purchase.
        </li>,
      ]}
    />
  );
}
