import Link from 'next/link';
import { TIME_ZONE, type HubspotRun } from '@kgc/shared';
import { maskToken } from '@kgc/scripts/src/lib/hubspot-core';
import { listHubspotRuns, queueCounts, readHubspotConfig, readHubspotTokenState } from '@kgc/scripts/src/lib/hubspot-sync';
import { requireOwner } from '@/lib/auth';
import { db } from '@/lib/firestore';
import { Banner, DetailList, PageHeader, Panel, Table, Tag } from '../../ui';
import { UNREADABLE_TOKEN } from './copy';
import { ConnectionControls, MappingPanel, SyncAllButton } from './forms';

export const dynamic = 'force-dynamic';

/**
 * Tickets › HubSpot (T333). Whova's Export to AMS/CRM › Native Direct
 * Integration › HubSpot: connect, map each registration field to a HubSpot
 * contact property or skip it, choose whether unknown registrants become new
 * contacts, and read the log of every sync run.
 *
 * Kept at Whova's old guide path so existing links and the nav node still
 * land here. Owners only: the token here opens the whole CRM, so the role map
 * keeps finance out of this one Tickets screen and the page checks again.
 *
 * The render reads Firestore only. The mapping needs HubSpot's live property
 * list, so the browser asks for it after the page is up (T335): a slow or
 * hanging HubSpot leaves the status, Disconnect and the sync log usable.
 */

const when = (ms: number | undefined) =>
  typeof ms === 'number'
    ? new Date(ms).toLocaleString('en-US', { timeZone: TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' })
    : '';

const TRIGGER_LABEL: Record<HubspotRun['trigger'], string> = {
  order: 'New order',
  refund: 'Refund',
  change: 'Ticket change',
  checkin: 'Check-in',
  backfill: 'Sync all',
  retry: 'Retry',
  manual: 'Sync all now',
  cron: 'Retry timer',
};

export default async function HubspotPage() {
  await requireOwner();

  const store = db();
  const [config, tokenState, counts, runs] = await Promise.all([
    readHubspotConfig(store),
    readHubspotTokenState(store),
    queueCounts(store),
    listHubspotRuns(store),
  ]);
  const connected = config.hasToken;
  // A token this server cannot decrypt is our key's problem, not HubSpot's: never call it refused.
  const unreadable = connected && (tokenState === 'unreadable' || Boolean(config.tokenUnreadableAt));
  const refused = connected && !unreadable && Boolean(config.tokenRejectedAt);

  const status = !connected ? (
    <Tag color="grey">Not connected</Tag>
  ) : unreadable ? (
    <Tag color="red">Token unreadable</Tag>
  ) : refused ? (
    <Tag color="red">Token refused</Tag>
  ) : config.enabled ? (
    <Tag color="green">Sync on</Tag>
  ) : (
    <Tag color="orange">Sync off</Tag>
  );

  const syncBlocked = !connected
    ? 'Connect HubSpot first.'
    : unreadable
      ? 'Paste the token again first.'
      : refused
        ? 'HubSpot refused the saved token. Paste a new one or press Test connection first.'
        : !config.enabled
          ? 'Turn the sync on under Field mapping first.'
          : undefined;

  return (
    <>
      <PageHeader
        title="HubSpot"
        tags={status}
        links={[
          <Link key="e" href="/tickets/export-to-ams-crm">
            Export to AMS/CRM
          </Link>,
          <Link key="o" href="/tickets/orders-and-transactions/attendee-orders">
            Attendee Orders
          </Link>,
        ]}
      />

      {unreadable ? <Banner kind="danger">{UNREADABLE_TOKEN}</Banner> : null}
      {refused ? (
        <Banner kind="danger">
          HubSpot refused the saved token on {when(config.tokenRejectedAt)}. It may have been rotated or the app
          deleted. Paste a new token below, or press Test connection if you fixed it in HubSpot. Changes keep
          queueing and go out once a new token is saved or Test connection succeeds.
        </Banner>
      ) : null}

      <Panel>
        <h2 className="section-header">Connection</h2>
        {connected ? (
          <DetailList
            items={[
              { label: 'Access token', value: <code>{maskToken(config.tokenLast4)}</code> },
              { label: 'HubSpot account', value: config.portalId ? String(config.portalId) : 'Not shown by HubSpot' },
              {
                label: 'Connected',
                value: `${config.connectedBy ?? ''}${config.connectedAt ? `, ${when(config.connectedAt)}` : ''}` || 'Unknown',
              },
            ]}
          />
        ) : (
          <p className="body-2">
            Each registration becomes a HubSpot contact, matched by email. Connect with a private app access token.
          </p>
        )}
        <ConnectionControls connected={connected} />
        <details style={{ marginTop: 16 }}>
          <summary className="linkish" style={{ cursor: 'pointer' }}>
            How to get a token
          </summary>
          <p className="body-2" style={{ margin: '8px 0 0' }}>
            Only a HubSpot super admin can create the app.
          </p>
          <ol className="body-2" style={{ marginTop: 8, paddingLeft: 20 }}>
            <li>In HubSpot, go to Development &gt; Legacy apps.</li>
            <li>Choose Create legacy app, then Private.</li>
            <li>
              On the Scopes tab, add <code>crm.objects.contacts.read</code>, <code>crm.objects.contacts.write</code>,{' '}
              <code>crm.schemas.contacts.read</code> and <code>crm.schemas.contacts.write</code>.
            </li>
            <li>Choose Create.</li>
            <li>On the Auth tab, choose Show token, then Copy, and paste it above.</li>
          </ol>
        </details>
      </Panel>

      {connected ? (
        <Panel>
          <h2 className="section-header">Field mapping</h2>
          {unreadable ? (
            <p className="body-2 muted">The field mapping loads once the token is pasted again.</p>
          ) : refused ? (
            <p className="body-2 muted">The field mapping loads once HubSpot accepts the token.</p>
          ) : (
            <MappingPanel />
          )}
        </Panel>
      ) : null}

      <Panel>
        <h2 className="section-header">Sync</h2>
        <div style={{ alignItems: 'flex-start', display: 'flex', flexWrap: 'wrap', gap: 24, marginBottom: 16 }}>
          <SyncAllButton disabledReason={syncBlocked} />
          <DetailList
            items={[
              { label: 'Waiting to send', value: String(counts.waiting) },
              { label: 'Failed, not retried', value: String(counts.parked) },
            ]}
          />
        </div>
        {counts.parked > 0 ? (
          <p className="body-2 muted">
            A failed contact is tried again when its registration next changes, or with Sync all now.
          </p>
        ) : null}

        <h3 className="section-header" style={{ fontSize: 16 }}>
          Sync log
        </h3>
        <Table
          stackSm
          // Nine columns have to fit the 1000px panel without a sideways scroll, or
          // Details (where a failure is explained) sits off the right edge.
          cols={[
            { key: 'w', label: 'Date and time', className: 'cell-sm' },
            { key: 't', label: 'Trigger', className: 'cell-xsm' },
            { key: 'b', label: 'By', className: 'cell-sm' },
            { key: 's', label: 'Sent', className: 'cell-xs' },
            { key: 'c', label: 'Created', className: 'cell-xs' },
            { key: 'u', label: 'Updated', className: 'cell-xs' },
            { key: 'k', label: 'Skipped', className: 'cell-xs' },
            { key: 'f', label: 'Failed', className: 'cell-xs' },
            { key: 'd', label: 'Details', className: 'cell-fill' },
          ]}
          empty="No sync has run yet."
          rows={runs.map((r) => [
            when(r.startedAt),
            TRIGGER_LABEL[r.trigger] ?? r.trigger,
            r.actor || 'Automatic',
            String(r.sent),
            String(r.created),
            String(r.updated),
            String(r.skipped),
            r.failed ? <strong key="f" style={{ color: 'var(--danger)' }}>{r.failed}</strong> : '0',
            <RunDetails key={r.id} run={r} />,
          ])}
        />
      </Panel>
    </>
  );
}

function RunDetails({ run }: { run: HubspotRun }) {
  return (
    <div>
      {run.stopped ? <div style={{ color: 'var(--danger)' }}>Stopped: {run.stopped}</div> : null}
      {run.errors.length ? (
        <details>
          <summary className="linkish" style={{ cursor: 'pointer' }}>
            {run.errors.length} {run.errors.length === 1 ? 'contact' : 'contacts'}
          </summary>
          <ul style={{ fontSize: 12, margin: '6px 0 0', paddingLeft: 16 }}>
            {run.errors.map((e, i) => (
              <li key={`${e.email}-${i}`}>
                <strong>{e.email}</strong>: {e.message}
              </li>
            ))}
          </ul>
        </details>
      ) : run.stopped ? null : (
        <span className="muted">None</span>
      )}
    </div>
  );
}
