import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { GapScreen } from '../../../gap-screen';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Exhibitor Ticket Setup › 2.4 Confirmation Emails.
 *
 * ── The email itself is real; the editor is what is missing ─────────────────
 *
 * This project does send transactional mail — `scripts/src/lib/email.ts` holds
 * four templates and Resend delivers them, with every send written to
 * `emailLog`. What it does not have is an *editor*, or any notion of a
 * per-audience variant: `purchase-confirmation` is one function with one body,
 * and an exhibitor buying a booth package would receive the attendee wording
 * describing a conference pass.
 *
 * Saying that precisely matters more here than on the thinner screens, because
 * &ldquo;we have no email&rdquo; would be false and &ldquo;we have confirmation
 * emails&rdquo; would be misleading in the opposite direction.
 */
export default async function ExhibitorConfirmationEmailsPage() {
  await requireOrganizer();

  return (
    <GapScreen
      title="2.4 Confirmation Emails"
      links={[
        <Link key="t" href="/tickets/exhibitor-ticket-setup/2-1-exhibitor-tickets">
          2.1 Exhibitor Tickets
        </Link>,
        <Link key="h" href={ROUTES.transactionHistory}>
          Transaction History
        </Link>,
      ]}
      lead={
        <>
          <strong>There is one confirmation email, it is attendee wording, and it is code.</strong>{' '}
          No editor, no per-audience variant, no preview and no test send — an exhibitor purchase
          would receive the pass confirmation.
        </>
      }
      whova={
        <>
          A rich-text editor per audience with merge fields, an attachment slot for the exhibitor
          prospectus or floor plan, a preview, a test send, and a resend-to-one-registrant action
          from the orders screen.
        </>
      }
      needs={
        <>
          A stored template document, a renderer that substitutes merge fields safely, and a
          selector that picks the variant by the tier&rsquo;s <code>audience</code> at send time.
          The sending half is already solved: Resend is wired, sends are logged, and{' '}
          <Link href={ROUTES.transactionHistory}>Transaction History</Link> shows what went out.
        </>
      }
      size="2–3 days for a stored, previewable template; more if attachments are wanted"
      refs={
        <>
          <code>scripts/src/lib/email.ts</code> — the four templates that exist (
          <code>purchase-confirmation</code>, <code>invoice-raised</code>,{' '}
          <code>refund-confirmation</code>, <code>bulk-message</code>) and why they are shared code
          rather than copied into each app.
        </>
      }
      notBuilt={[
        <li key="editor">
          <strong>The editor.</strong> Templates are TypeScript string builders; changing wording is
          a code change and a deploy.
        </li>,
        <li key="variant">
          <strong>Per-audience variants.</strong> Nothing branches on <code>audience</code> at send
          time, so there is no exhibitor version to write.
        </li>,
        <li key="attach">
          <strong>Attachments.</strong> The prospectus is the usual reason an exhibitor
          confirmation differs at all, and the sender has no attachment path.
        </li>,
        <li key="resend">
          <strong>Resend to one buyer.</strong> The most-used button on Whova&rsquo;s version of
          this screen, and there is no equivalent anywhere in this dashboard.
        </li>,
      ]}
    />
  );
}
