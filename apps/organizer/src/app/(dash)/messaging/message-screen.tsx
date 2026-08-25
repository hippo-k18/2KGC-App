import Link from 'next/link';
import { emailEnabled } from '@kgc/scripts/src/lib/email';
import { requirePassphrase, requireOrganizer } from '@/lib/auth';
import { AUDIENCES, listCampaigns, resolveAudience, type AudienceId } from '@/lib/messaging';
import { Banner, PageHeader, Panel, Table, Tabs, Tag } from '../ui';
import { MessageForm } from './message-form';

/**
 * One screen, rendered twice: Message Speakers and Message Sponsors.
 *
 * Whova's two are visually identical and differ only in whose addresses they
 * resolve, so this is one component taking an audience. Adding Message
 * Exhibitors later is a nav entry and one branch in `resolveAudience`.
 *
 * ── The recipient list is shown, not summarised ─────────────────────────────
 *
 * Every address that will be mailed is on screen before the send, together with
 * everyone excluded for having no address. Whova shows a count. A count is the
 * thing you cannot check — "45 speakers" reads as correct whether or not the
 * seven you actually meant to chase are in it.
 */
export async function MessageScreen({
  audienceId,
  searchParams,
}: {
  audienceId: AudienceId;
  searchParams: Promise<{ segment?: string }>;
}) {
  await requireOrganizer();
  const audience = AUDIENCES[audienceId];
  const { segment: raw } = await searchParams;

  const segment = audience.segments.some((s) => s.id === raw) ? raw! : 'all';
  const [{ recipients, withoutEmail }, campaigns] = await Promise.all([
    resolveAudience(audienceId, segment),
    listCampaigns(10),
  ]);

  const active = audience.segments.find((s) => s.id === segment)!;

  return (
    <>
      <PageHeader
        title={audience.title}
        tags={
          emailEnabled() ? (
            <Tag color="green" fill="outline">
              email configured
            </Tag>
          ) : (
            <Tag color="grey">no email provider</Tag>
          )
        }
      />

      {!emailEnabled() && (
        <Banner kind="warning">
          <code>RESEND_API_KEY</code> is not set on this deployment, so nothing can actually be
          sent. The form still resolves and previews the audience — see{' '}
          <code>SETUP-PAYMENTS.md</code> §3.
        </Banner>
      )}

      <Tabs
        tabs={audience.segments.map((s) => ({
          label: s.label,
          href: `?segment=${s.id}`,
          active: s.id === segment,
        }))}
      />

      <Panel>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          {active.describe} — <strong>{recipients.length}</strong>{' '}
          {recipients.length === 1 ? 'person' : 'people'}
          {withoutEmail > 0 && `, plus ${withoutEmail} with no email address on file`}.
        </p>
        <MessageForm
          audience={audience}
          segment={segment}
          recipients={recipients}
          withoutEmail={withoutEmail}
          needsPassphrase={requirePassphrase()}
          emailReady={emailEnabled()}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>
          Who gets this ({recipients.length})
        </h2>
        <Table
          cols={[
            { key: 'name', label: 'Name', className: 'cell-md' },
            { key: 'email', label: 'Email', className: 'cell-fill' },
            { key: 'detail', label: '', className: 'cell-md' },
          ]}
          rows={recipients.map((r) => [
            r.name,
            <span key="e" style={{ fontSize: 13 }}>
              {r.email}
            </span>,
            <span key="d" className="muted" style={{ fontSize: 12 }}>
              {r.detail ?? ''}
            </span>,
          ])}
          empty={`No ${audience.noun} match this segment, or none of them have an email address on file.`}
        />
        {withoutEmail > 0 && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
            <strong>{withoutEmail}</strong> {withoutEmail === 1 ? 'record has' : 'records have'} no
            email address and are not in the list above.
            {audienceId === 'speakers' &&
              ' A speaker only has one once they hold a ticket — contact details live on the user record, not the speaker record.'}
            {audienceId === 'sponsors' && ' Add a main contact in Sponsor Manager.'}
          </p>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Recently sent</h2>
        <Table
          cols={[
            { key: 'when', label: 'When', className: 'cell-sm' },
            { key: 'subject', label: 'Subject', className: 'cell-fill' },
            { key: 'by', label: 'By', className: 'cell-md' },
            { key: 'result', label: 'Result', className: 'cell-md' },
          ]}
          rows={campaigns.map((c) => [
            <span key="w" className="muted" style={{ fontSize: 12 }}>
              {c.at.slice(0, 10)}
              <br />
              {c.at.slice(11, 16)}
            </span>,
            <span key="s" style={{ fontSize: 13 }}>
              {c.subject}
            </span>,
            <span key="b" className="muted" style={{ fontSize: 12 }}>
              {c.actor ?? '—'}
            </span>,
            <span key="r" style={{ fontSize: 12 }}>
              {c.sent > 0 && (
                <Tag color="green" fill="outline" small>
                  {c.sent} sent
                </Tag>
              )}{' '}
              {c.failed > 0 && (
                <Tag color="red" fill="outline" small>
                  {c.failed} failed
                </Tag>
              )}{' '}
              {c.skipped > 0 && (
                <Tag color="grey" fill="outline" small>
                  {c.skipped} skipped
                </Tag>
              )}
            </span>,
          ])}
          empty="Nothing has been sent yet."
        />
        <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
          Every recipient of every send is recorded individually — see{' '}
          <Link href="/tickets/orders-and-transactions/transaction-history">
            Transaction History
          </Link>{' '}
          to answer &ldquo;did this specific person get it?&rdquo;. There is no scheduling here on
          purpose: a queued blast fires whether or not anybody is awake to stop it.
        </p>
      </Panel>
    </>
  );
}
