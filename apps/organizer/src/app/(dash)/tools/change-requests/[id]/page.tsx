import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TIME_ZONE } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { CHANGE_REQUESTS_PATH, NOTE_MAX, STATUSES, STATUS_LABEL } from '@/lib/change-requests-core';
import { getChangeRequest } from '@/lib/change-requests';
import { formatWhen } from '@/lib/email-log-core';
import { Banner, DetailList, Email, PageHeader, Panel } from '../../../ui';
import { saveChangeRequestNoteAction, setChangeRequestStatusAction } from '../actions';
import { ChangeStatusTag } from '../status-tag';

export const dynamic = 'force-dynamic';

const MAIL_LINE: Record<string, { kind: 'success' | 'warning'; text: string }> = {
  'built-sent': { kind: 'success', text: 'Marked Built. The sender was emailed that the change is built and being tested.' },
  'live-sent': { kind: 'success', text: 'Marked Live. The sender was emailed that the change is live.' },
  'built-skipped': { kind: 'warning', text: 'Marked Built. The email was not sent because this server cannot send email. See the Email Log.' },
  'live-skipped': { kind: 'warning', text: 'Marked Live. The email was not sent because this server cannot send email. See the Email Log.' },
  'built-failed': { kind: 'warning', text: 'Marked Built, but the email to the sender failed. The Email Log has the reason.' },
  'live-failed': { kind: 'warning', text: 'Marked Live, but the email to the sender failed. The Email Log has the reason.' },
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** One change request: the full text, the screenshots, the status and the team's note (T428). */
export default async function ChangeRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const { id } = await params;
  const sp = await searchParams;
  const row = await getChangeRequest(id);
  if (!row) notFound();

  const mail = MAIL_LINE[first(sp.mail) ?? ''];
  const saved = first(sp.saved);
  const error = first(sp.error);
  const emailedLine = [
    row.emailed.built ? `Built email ${formatWhen(row.emailed.built, TIME_ZONE)}` : null,
    row.emailed.live ? `Live email ${formatWhen(row.emailed.live, TIME_ZONE)}` : null,
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        title="Change requests"
        links={[
          <Link key="b" href={CHANGE_REQUESTS_PATH}>
            Back to the list
          </Link>,
        ]}
      />
      {mail ? (
        <Banner kind={mail.kind}>{mail.text}</Banner>
      ) : saved === 'status' ? (
        <Banner kind="success">Status saved. No email was due for this change.</Banner>
      ) : saved === 'note' ? (
        <Banner kind="success">Note saved.</Banner>
      ) : error ? (
        <Banner kind="danger">{error === 'note' ? 'The note could not be saved. Try again.' : 'The status could not be saved. Try again.'}</Banner>
      ) : null}

      <Panel>
        <DetailList
          items={[
            { label: 'From', value: <Email address={row.email} /> },
            { label: 'Received', value: formatWhen(row.createdAtMs, TIME_ZONE) },
            { label: 'Status', value: <ChangeStatusTag status={row.status} /> },
            {
              label: 'Page',
              value: row.pageUrl ? (
                <a href={row.pageUrl} target="_blank" rel="noreferrer noopener nofollow" style={{ overflowWrap: 'anywhere' }}>
                  {row.pageUrl}
                </a>
              ) : (
                <span className="muted">Not given</span>
              ),
            },
            { label: 'Emails sent', value: emailedLine.length ? emailedLine.join(' · ') : <span className="muted">None yet</span> },
            ...(row.updatedBy ? [{ label: 'Last changed by', value: `${row.updatedBy}, ${formatWhen(row.updatedAtMs, TIME_ZONE)}` }] : []),
          ]}
        />
      </Panel>

      <Panel>
        <h3 className="change-heading">The change</h3>
        <p className="change-text">{row.description}</p>
      </Panel>

      {row.screenshots.length ? (
        <Panel>
          <h3 className="change-heading">
            Screenshots ({row.screenshots.length})
          </h3>
          <div className="change-shots">
            {row.screenshots.map((_, i) => {
              const href = `${CHANGE_REQUESTS_PATH}/${row.id}/shot/${i + 1}`;
              return (
                <a key={i} href={href} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- an authed route, not a public asset; next/image would proxy it without the session. */}
                  <img src={href} alt={`Screenshot ${i + 1} from the sender`} loading="lazy" />
                </a>
              );
            })}
          </div>
        </Panel>
      ) : null}

      <Panel>
        <form action={setChangeRequestStatusAction} style={{ alignItems: 'flex-end', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <input type="hidden" name="id" value={row.id} />
          <label style={{ display: 'grid', fontSize: 12, gap: 4 }}>
            Status
            <select className="whova-text-input" name="status" defaultValue={row.status} key={row.status}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                  {s === 'built' && !row.emailed.built ? ' (emails the sender)' : ''}
                  {s === 'live' && !row.emailed.live ? ' (emails the sender)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="whova-btn-main primary">
            Save status
          </button>
        </form>
      </Panel>

      <Panel>
        <form action={saveChangeRequestNoteAction}>
          <input type="hidden" name="id" value={row.id} />
          <div className="whova-form-group">
            <div className="whova-form-label">
              <label htmlFor="notes">Internal note</label>
            </div>
            <textarea
              id="notes"
              name="notes"
              rows={4}
              maxLength={NOTE_MAX}
              defaultValue={row.notes ?? ''}
              key={row.notes ?? ''}
              className="whova-text-input"
              style={{ height: 'auto', padding: '8px 10px', width: '100%' }}
            />
            <div className="whova-checkbox-description">Only the team sees this. It is never sent to the sender.</div>
          </div>
          <button type="submit" className="whova-btn-main">
            Save note
          </button>
        </form>
      </Panel>
    </>
  );
}
