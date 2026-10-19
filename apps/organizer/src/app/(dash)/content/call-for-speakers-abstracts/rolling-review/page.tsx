import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { currentCfpCallId, getCfpCall, listCfpSubmissions } from '@/lib/cfp';
import {
  closeDecisionDate,
  closeDecisionOpen,
  closeDecisionPlan,
  formatDay,
  stillOpenRecipients,
} from '@kgc/scripts/src/lib/cfp-core';
import { cfpStatusReplyText } from '@kgc/scripts/src/lib/email';
import { NotInputted, PageHeader, Panel, Tag } from '../../../ui';
import { CfpSettingsWarning } from '../cfp-ui';
import { CFA_BASE } from '../routes';
import { ConfirmedSend, CopyBlock, ReasonForm, SettingsForm } from './forms';

export const dynamic = 'force-dynamic';


/**
 * The rolling review's settings and its two manual sends (T249).
 *
 * Dates and addresses first, because every email reads them. Then S1 for the
 * inbox to copy, E6 for January, and E4 for two weeks after the close. Both
 * sends go only to people who have not had them, so pressing again after a
 * partial failure retries only the ones that did not go.
 */
export default async function RollingReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ call?: string }>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const callId = sp.call ?? (await currentCfpCallId());
  const call = callId ? await getCfpCall(callId) : null;
  if (!call) {
    return (
      <>
        <PageHeader title="Rolling review: dates and emails" />
        <Panel>
          <NotInputted what="call for speakers" />
        </Panel>
      </>
    );
  }

  const rows = await listCfpSubmissions(call.id);
  const plan = closeDecisionPlan(rows);
  const e6 = stillOpenRecipients(rows);
  const e6Done = rows.filter((r) => r.stillOpenSentAtMs).length;
  const e4Done = rows.filter((r) => r.closeDecisionSent).length;
  const decisionDay = formatDay(call.cfp.decisionDate);
  const e4Day = formatDay(closeDecisionDate(call.cfp));
  /*
   * E4 stays disabled until two weeks after the close (T252): one early press
   * would tell every rejected author months before everyone else hears.
   */
  const e4Blocked = closeDecisionOpen(Date.now(), call.cfp, call.timeZone)
    ? undefined
    : e4Day
      ? `This send opens on ${e4Day}, two weeks after the close. Until then it cannot be sent.`
      : 'Set the close date above first. This send opens two weeks after it.';

  return (
    <>
      <PageHeader
        title="Rolling review: dates and emails"
        tags={
          <>
            <Tag color="blue">{call.title}</Tag>
            {!call.enabled && <Tag color="orange">not switched on yet</Tag>}
          </>
        }
        links={[
          <Link key="r" href={`${CFA_BASE}/review?call=${call.id}`}>
            Weekly review
          </Link>,
          <Link key="s" href={`${CFA_BASE}/submissions?call=${call.id}`}>
            All submissions
          </Link>,
          <Link key="l" href="/tools/email-log?group=cfp">
            Email log
          </Link>,
          <Link key="q" href="/tools/email-log?tab=scheduled">
            Scheduled emails
          </Link>,
        ]}
      />

      <CfpSettingsWarning callId={call.id} cfp={call.cfp} />

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Dates and addresses
        </h2>
        {!call.enabled && (
          <p className="body-2">
            Saving switches this call onto the rolling review: Min&apos;s emails, the talk and
            workshop form, and the weekly review list.
          </p>
        )}
        <SettingsForm callId={call.id} cfp={call.cfp} />
      </Panel>

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          S1: reply to &ldquo;where does my submission stand?&rdquo;
        </h2>
        <p className="body-2">
          For the inbox to copy. Check the submission&apos;s status first: this is for one that is
          still open. Each submission page has this with the author&apos;s name filled in.
        </p>
        <CopyBlock label="S1 reply" text={cfpStatusReplyText({ decisionDay })} />
      </Panel>

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          E6: the mid-point note
        </h2>
        <p className="body-2">
          One send, early January, to everyone still in the queue. {e6.length} would get it now.
          {e6Done ? ` ${e6Done} already have.` : ''}
        </p>
        <ConfirmedSend
          kind="still-open"
          callId={call.id}
          count={e6.length}
          label={`Send E6 to ${e6.length}`}
          confirmLabel={`Email ${e6.length} author${e6.length === 1 ? '' : 's'} that their submission is still open`}
        />
      </Panel>

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          E4: the decision after the close
        </h2>
        <p className="body-2">
          {e4Day ? `Due two weeks after the close, on ${e4Day}. ` : 'Due two weeks after the close. '}
          The &ldquo;not accepted&rdquo; version goes to every rejection not yet told. The
          &ldquo;accepted&rdquo; version goes to acceptances made after the close, and their
          acceptance email with the details link follows it.
          {e4Done ? ` ${e4Done} have already been sent.` : ''}
        </p>
        {plan.undecided.length > 0 && (
          <p className="body-2">
            <strong>{plan.undecided.length} still undecided.</strong> Decide them on the{' '}
            <Link href={`${CFA_BASE}/review?call=${call.id}`}>weekly review</Link> first; this
            send leaves them alone.
          </p>
        )}

        <h3 style={{ fontSize: 14 }}>Not accepted ({plan.declined.length})</h3>
        {plan.declined.length === 0 ? (
          <p className="body-2">Nobody to tell.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {plan.declined.map((r) => (
              <li key={r.id} style={{ borderTop: '1px solid var(--hairline)', padding: '10px 0' }}>
                <div>
                  <Link href={`${CFA_BASE}/submissions/${r.id}`}>{r.title}</Link>{' '}
                  <span className="muted">{r.name}</span>
                </div>
                <ReasonForm submissionId={r.id} reason={r.declineReason} />
              </li>
            ))}
          </ul>
        )}

        <h3 style={{ fontSize: 14 }}>Accepted at the close ({plan.accepted.length})</h3>
        {plan.accepted.length === 0 ? (
          <p className="body-2">None.</p>
        ) : (
          <ul>
            {plan.accepted.map((r) => (
              <li key={r.id}>
                {r.title} <span className="muted">{r.name}</span>
              </li>
            ))}
          </ul>
        )}

        <ConfirmedSend
          kind="close"
          callId={call.id}
          count={plan.declined.length + plan.accepted.length}
          label={`Send E4 to ${plan.declined.length + plan.accepted.length}`}
          confirmLabel={`Email ${plan.declined.length} “not accepted” and ${plan.accepted.length} “accepted”`}
          blocked={e4Blocked}
        />
      </Panel>
    </>
  );
}
