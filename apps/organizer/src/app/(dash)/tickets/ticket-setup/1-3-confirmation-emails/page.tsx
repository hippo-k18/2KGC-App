import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { recentEmails } from '@/lib/commerce';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

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

      <StatTiles
        tiles={[
          { label: 'Sent', value: transactional.filter((e) => e.status === 'sent').length, sub: 'last 200 log rows' },
          { label: 'Failed', value: failed.length, sub: 'provider rejected' },
          { label: 'Skipped', value: skipped.length, sub: 'no API key configured' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>The three templates, and what each one carries</h2>
        <Table
          cols={[
            { key: 't', label: 'Template', className: 'cell-md' },
            { key: 'w', label: 'Sent when', className: 'cell-sm' },
            { key: 'c', label: 'Contents', className: 'cell-fill' },
          ]}
          rows={[
            [
              <code key="t">purchase-confirmation</code>,
              'Card payment clears',
              'Ticket type, amount, the claim code that turns the purchase into an app account, and a link to the order page behind an HMAC capability token. Demo purchases are labelled as such so a receipt never implies money changed hands.',
            ],
            [
              <code key="t">invoice-raised</code>,
              'Group invoice is finalised',
              'Company, seat count, total, due date and the hosted Stripe invoice link finance can pay and download. Not a ticket — fulfilment waits for payment.',
            ],
            [
              <code key="t">refund-confirmation</code>,
              'A refund is issued',
              'Amount returned and what it means for the badge. A partial refund leaves the ticket valid, and the wording has to say so.',
            ],
          ]}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Recent sends</h2>
        <Table
          cols={[
            { key: 'to', label: 'To', className: 'cell-md' },
            { key: 'tp', label: 'Template', className: 'cell-sm' },
            { key: 's', label: 'Status', className: 'cell-sm' },
            { key: 'sub', label: 'Subject', className: 'cell-fill' },
          ]}
          rows={transactional.slice(0, 15).map((e) => [
            e.to,
            <span key="tp" className="muted" style={{ fontSize: 12 }}>
              {e.template}
            </span>,
            <Tag key="s" color={e.status === 'sent' ? 'green' : e.status === 'failed' ? 'red' : 'grey'}>
              {e.status}
            </Tag>,
            <span key="sub">
              {e.subject}
              {e.error ? <div className="muted" style={{ fontSize: 12 }}>{e.error}</div> : null}
              {e.reason ? <div className="muted" style={{ fontSize: 12 }}>{e.reason}</div> : null}
            </span>,
          ])}
          empty="Nothing sent yet. Every send writes one row per recipient, so this fills as soon as a ticket is bought."
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          The full log, including bulk messages, is on{' '}
          <Link href={ROUTES.transactionHistory}>Transaction History</Link>.
        </p>
      </Panel>

      <Banner kind="warning">
        <strong>Changing the wording is a code change and a deploy.</strong> The templates live in{' '}
        <code>scripts/src/lib/email.ts</code> — one shared copy, because a second copy would own the
        claim code and drift. There is no editor here and adding one would mean moving a message
        that contains a credential into a database somebody can edit at 2am.
      </Banner>

      <Panel style={{ marginTop: 16 }}>
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
      </Panel>
    </>
  );
}
