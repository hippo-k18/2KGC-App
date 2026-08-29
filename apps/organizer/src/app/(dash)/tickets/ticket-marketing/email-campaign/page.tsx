import Link from 'next/link';
import { emailEnabled } from '@kgc/scripts/src/lib/email';
import { requireOrganizer, requirePassphrase } from '@/lib/auth';
import { audienceFor, listContacts, summariseContacts } from '@/lib/campaigns';
import { listCampaigns } from '@/lib/messaging';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tabs, Tag } from '../../../ui';
import { CampaignForm } from './campaign-form';

export const dynamic = 'force-dynamic';

/**
 * Tickets › Ticket Marketing › Email Campaign.
 *
 * ── The tool `lib/messaging.ts` said would be needed ────────────────────────
 *
 * That module says in as many words that attendee mail is "a genuinely
 * different tool — contact lists, link tracking, an unsubscribe register. Forty
 * five speakers is a different problem from a thousand attendees, and
 * pretending otherwise is how a conference gets its sending domain blocked."
 * This is that tool. The compose box is nearly identical to Message Speakers;
 * everything around it is different.
 *
 * ── Suppression is applied before anything is counted ───────────────────────
 *
 * ⚠️ Every number on this page is post-suppression. "938 will receive this"
 * rather than "1,000 on this list", with the difference shown beside it. Mailing
 * somebody who unsubscribed is how a domain gets blocked, and the damage lands
 * on the ticket receipts rather than on the newsletter that caused it.
 *
 * ── Sends are grouped from `emailLog`, not stored ───────────────────────────
 *
 * `listCampaigns` derives the history from the per-recipient rows. The
 * per-recipient row is what answers "did Ada get it?", and a summary derived
 * from those rows can never disagree with them — a stored counter could.
 */
export default async function EmailCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  await requireOrganizer();
  const { list: raw } = await searchParams;

  const [contacts, campaigns] = await Promise.all([listContacts(), listCampaigns(15)]);
  const summary = summariseContacts(contacts);

  const selected =
    raw && summary.lists.some((l) => l.name === raw) ? raw : (summary.lists[0]?.name ?? '');
  const { recipients, suppressed } = selected
    ? audienceFor(contacts, selected)
    : { recipients: [], suppressed: 0 };

  return (
    <>
      <PageHeader
        title="Email Campaign"
        tags={
          emailEnabled() ? (
            <Tag color="green" fill="outline">
              email configured
            </Tag>
          ) : (
            <Tag color="red" fill="solid">
              no provider
            </Tag>
          )
        }
        links={[
          <Link key="c" href="/tickets/ticket-marketing/campaign-contact-list">
            Contact List
          </Link>,
          <Link key="l" href="/tickets/ticket-marketing/campaign-link-tracking">
            Link Tracking
          </Link>,
          <Link key="t" href="/tickets/orders-and-transactions/transaction-history">
            Email log
          </Link>,
        ]}
      />

      {summary.lists.length === 0 ? (
        <Banner kind="info">
          <strong>No contact lists yet.</strong> A campaign goes to a named list, not to
          &ldquo;everyone&rdquo; — import one on{' '}
          <Link href="/tickets/ticket-marketing/campaign-contact-list">Campaign Contact List</Link>{' '}
          first.
        </Banner>
      ) : (
        <Banner kind="warning">
          <strong>A campaign cannot be recalled, and there is no scheduling.</strong> It goes when
          you press the button, in the room, awake — a queued blast fires whether or not anybody is
          there to stop it, and the classic failure is 6am in the wrong timezone to a list of a
          thousand. ⚠️ There is also{' '}
          <strong>no public unsubscribe link yet</strong>, which is a legal requirement in several
          jurisdictions before a bulk send goes out.
        </Banner>
      )}

      <StatTiles
        tiles={[
          { label: 'On this list', value: recipients.length + suppressed, sub: selected || 'none' },
          { label: 'Will receive', value: recipients.length, sub: 'after suppression' },
          { label: 'Excluded', value: suppressed, sub: 'unsubscribed or bounced' },
          { label: 'Campaigns sent', value: campaigns.length, sub: 'all audiences' },
        ]}
      />

      {summary.lists.length > 1 && (
        <Tabs
          tabs={summary.lists.map((l) => ({
            href: `?list=${encodeURIComponent(l.name)}`,
            label: `${l.name} (${l.mailable})`,
            active: l.name === selected,
          }))}
        />
      )}

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Compose</h2>
        <CampaignForm
          lists={summary.lists}
          selected={selected}
          recipientCount={recipients.length}
          suppressed={suppressed}
          needsPassphrase={requirePassphrase()}
          emailReady={emailEnabled()}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>
          Who would receive this
          {selected ? (
            <span className="muted" style={{ fontWeight: 400 }}> — {selected}</span>
          ) : null}
        </h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Every address is listed rather than counted. A count is the thing you cannot check —
          &ldquo;938 contacts&rdquo; reads as correct whether or not the people you meant are in it.
        </p>
        <Table
          cols={[
            { key: 'e', label: 'Address', className: 'cell-fill' },
            { key: 'n', label: 'Name', className: 'cell-md' },
            { key: 'c', label: 'Company', className: 'cell-md' },
          ]}
          rows={recipients
            .slice(0, 200)
            .map((r) => [r.email, r.name || '—', r.company || '—'])}
          empty="Nobody. Either the list is empty or everybody on it has unsubscribed."
        />
        {recipients.length > 200 && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Showing the first 200 of {recipients.length}. The send is not truncated — only this
            table is, and it says so rather than quietly showing a subset.
          </p>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Sent</h2>
        <Table
          cols={[
            { key: 's', label: 'Subject', className: 'cell-fill' },
            { key: 'w', label: 'When', className: 'cell-md' },
            { key: 'b', label: 'By', className: 'cell-md' },
            { key: 'r', label: 'Result', className: 'cell-sm' },
          ]}
          rows={campaigns.map((c) => [
            c.subject,
            <span key="w" className="muted" style={{ fontSize: 12 }}>
              {c.at.slice(0, 16).replace('T', ' ')}
            </span>,
            <span key="b" className="muted" style={{ fontSize: 12 }}>
              {c.actor ?? '—'}
            </span>,
            <span key="r" style={{ fontSize: 12 }}>
              {c.sent} sent
              {c.failed > 0 ? <span style={{ color: 'var(--danger)' }}> · {c.failed} failed</span> : null}
              {c.skipped > 0 ? <span className="muted"> · {c.skipped} skipped</span> : null}
            </span>,
          ])}
          empty="Nothing has been sent from this dashboard yet."
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No public unsubscribe link.</strong> ⚠️ The most significant gap on this page,
            and a legal requirement in several jurisdictions. It needs a capability-token route on
            the website — the same pattern <code>/order/{'{token}'}</code> already uses, so the
            mechanism exists and is simply not wired to this. Until it is, an unsubscribe is
            recorded by an organizer on the contact list.
          </li>
          <li>
            <strong>No open or click tracking inside the email.</strong> Open tracking is a
            tracking pixel; click tracking means rewriting every link through a redirector. The{' '}
            <code>/r/</code> links you paste in yourself already answer the question that matters —
            did this campaign sell tickets — without either.
          </li>
          <li>
            <strong>No templates, drafts or scheduling.</strong> A draft is state to own, list and
            clean up; the form keeps what you typed across a failed send, which covers the real
            case. Scheduling is refused on purpose, as above.
          </li>
          <li>
            <strong>No segmentation beyond the list.</strong> &ldquo;Everyone on last year&rsquo;s
            list who has not bought yet&rsquo;&rdquo; is the segment an organizer actually wants,
            and it needs the <code>converted</code> flag computed — which is a read of both
            collections and the obvious next piece.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
