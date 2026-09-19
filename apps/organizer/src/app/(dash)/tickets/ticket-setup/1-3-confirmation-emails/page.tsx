import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { recentEmails } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, NotInputted, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Setup › 1.3 Confirmation Emails.
 *
 * Confirmation email is one of the few things on the Tickets tab that is fully
 * real: three transactional templates that send through Resend and write a row
 * to `emailLog` per recipient, so "I never got my confirmation" has an answer.
 *
 * ── Why there is no editor, and why that is a deliberate line ───────────────
 *
 * The templates are TypeScript functions in `scripts/src/lib/email.ts`, shared
 * by `apps/web` and this dashboard because neither can import the other. They
 * are code because the confirmation is not a newsletter: it carries the claim
 * code that turns a purchase into an account and the capability-token order
 * link, and a WYSIWYG editor over a message containing a credential is a way to
 * accidentally delete the credential. Editing copy therefore means editing the
 * file and deploying.
 *
 * That is a real limitation, not a virtue, and it is stated as one below.
 */
/** The mail service answers in JSON. Show its message, not the envelope. */
function errorText(raw: string): string {
  const at = raw.indexOf('{');
  if (at < 0) return raw;
  try {
    const body = JSON.parse(raw.slice(at)) as { message?: unknown };
    return typeof body.message === 'string' ? body.message : raw;
  } catch {
    return raw;
  }
}

export default async function ConfirmationEmailsPage() {
  await requireOrganizer();
  const emails = await recentEmails(200);

  const transactional = emails.filter((e) => e.template !== 'bulk-message');
  const failed = transactional.filter((e) => e.status === 'failed');
  const skipped = transactional.filter((e) => e.status === 'skipped');

  return (
    <>
      <PageHeader
        title="1.3 Confirmation Emails"
        info={
          <>
            <strong>Three emails, sent for you</strong>
            <p>
              Buyers get an email when they pay, when an invoice is raised and when a refund is
              issued. The wording cannot be edited here yet.
            </p>
          </>
        }
        tags={
          failed.length > 0 ? (
            <Tag color="red" fill="solid">
              {failed.length} failed
            </Tag>
          ) : (
            <Tag color="green" fill="outline">Sending</Tag>
          )
        }
        links={[
          <Link key="t" href={ROUTES.transactionHistory}>
            Transaction History
          </Link>,
          <Link key="o" href={ROUTES.attendeeOrders}>
            Attendee Orders
          </Link>,
        ]}
      />

      {failed.length > 0 && (
        <Banner kind="danger">
          <strong>
            {failed.length} {failed.length === 1 ? 'confirmation' : 'confirmations'} did not reach
            the buyer.
          </strong>{' '}
          Each failed row below gives the reason. These buyers have paid and have no claim code, so
          they cannot create their account yet.
        </Banner>
      )}

      <StatTiles
        tiles={[
          { label: 'Sent', value: transactional.filter((e) => e.status === 'sent').length, sub: 'of the last 200' },
          { label: 'Failed', value: failed.length, sub: 'rejected by the mail service' },
          { label: 'Skipped', value: skipped.length, sub: 'email sending is not set up' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The three emails</h2>
        <Table
          cols={[
            { key: 't', label: 'Email', className: 'cell-md' },
            { key: 'w', label: 'Sent when', className: 'cell-sm' },
            { key: 'c', label: 'Contents', className: 'cell-fill' },
          ]}
          rows={[
            [
              <span key="t">Purchase confirmation</span>,
              'Card payment clears',
              'Ticket type, amount, the claim code for the app account and a link to the order page.',
            ],
            [
              <span key="t">Invoice raised</span>,
              'Group invoice is finalised',
              'Company, seat count, total, due date and a link to pay the invoice. Tickets are issued once it is paid.',
            ],
            [
              <span key="t">Refund confirmation</span>,
              'A refund is issued',
              'Amount returned. A partial refund leaves the ticket valid.',
            ],
          ]}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Recent sends</h2>
        <Table
          cols={[
            { key: 'to', label: 'To', className: 'cell-md' },
            { key: 'tp', label: 'Email', className: 'cell-sm' },
            { key: 's', label: 'Status', className: 'cell-sm' },
            { key: 'sub', label: 'Subject', className: 'cell-fill' },
          ]}
          rows={transactional.slice(0, 15).map((e) => [
            e.to,
            <span key="tp" className="muted" style={{ fontSize: 12 }}>
              {e.template.replace(/-/g, ' ')}
            </span>,
            <Tag key="s" color={e.status === 'sent' ? 'green' : e.status === 'failed' ? 'red' : 'grey'}>
              {e.status}
            </Tag>,
            <span key="sub">
              {e.subject}
              {e.error ? <div className="muted" style={{ fontSize: 12 }}>{errorText(e.error)}</div> : null}
              {e.reason ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  {/API_KEY/.test(e.reason) ? 'Email sending is not set up.' : e.reason}
                </div>
              ) : null}
            </span>,
          ])}
          empty={<NotInputted what="confirmation emails" compact />}
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          The full log, including bulk messages, is on{' '}
          <Link href={ROUTES.transactionHistory}>Transaction History</Link>.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No template editor, no preview, no test send.</strong> A preview is the one of
            those three worth building, and it is cheap: the templates are pure functions returning
            HTML.
          </li>
          <li>
            <strong>No per-ticket-type confirmation.</strong> Whova sends different copy per tier —
            joining instructions for virtual, venue directions for in person. Ours sends one message
            and names the tier inside it.
          </li>
          <li>
            <strong>No attachments and no calendar file.</strong> No PDF ticket, no{' '}
            <code>.ics</code>. The badge is a QR generated in the app rather than a file mailed out,
            which is the deliberate design — see the badge notes in <code>AGENTS.md</code>.
          </li>
          <li>
            <strong>No resend button.</strong> Failures are visible above and recovering from one
            means running the send again from the server, not clicking here.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
