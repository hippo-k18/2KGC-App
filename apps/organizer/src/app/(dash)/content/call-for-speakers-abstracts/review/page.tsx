import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { currentCfpCallId, getCfpCall, listCfpSubmissions } from '@/lib/cfp';
import { reviewCounts, reviewQueue, sessionTypeLine } from '@kgc/scripts/src/lib/cfp-core';
import { NotInputted, PageHeader, Panel, StatTiles, Tag } from '../../../ui';
import { CfpSettingsWarning, TypeFilter } from '../cfp-ui';
import { CFA_BASE } from '../routes';
import { FinishPass, RowDecision } from './row-decision';

export const dynamic = 'force-dynamic';

/**
 * François's weekly pass (T249, Min's plan §4).
 *
 * One list: every submission nobody has decided, what arrived since the last
 * pass first. Per row only what the plan names: name, organisation, track,
 * type, title, abstract. Per row three choices, and Leave is the default.
 * Three counters. Nothing else, so the pass stays short.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ call?: string; type?: string }>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const callId = sp.call ?? (await currentCfpCallId());
  const call = callId ? await getCfpCall(callId) : null;

  if (!call) {
    return (
      <>
        <PageHeader title="Weekly review" />
        <Panel>
          <NotInputted what="call for speakers" />
        </Panel>
      </>
    );
  }

  const all = await listCfpSubmissions(call.id);
  const type = sp.type && (call.sessionTypes as string[]).includes(sp.type) ? sp.type : undefined;
  const counts = reviewCounts(all);
  const queue = reviewQueue(all, call.cfp.lastPassAtMs).filter(
    ({ row }) => !type || row.sessionType === type,
  );
  const fresh = queue.filter((q) => q.isNew).length;

  return (
    <>
      <PageHeader
        title="Weekly review"
        tags={<Tag color="blue">{call.title}</Tag>}
        links={[
          <Link key="s" href={`${CFA_BASE}/submissions?call=${call.id}`}>
            All submissions
          </Link>,
          <Link key="r" href={`${CFA_BASE}/rolling-review?call=${call.id}`}>
            Dates and emails
          </Link>,
          <Link key="l" href="/tools/email-log?group=cfp">
            Email log
          </Link>,
        ]}
      />

      <CfpSettingsWarning callId={call.id} cfp={call.cfp} />

      <StatTiles
        tiles={[
          { label: 'Open', value: counts.open, sub: fresh ? `${fresh} new since your last pass` : 'nothing new' },
          { label: 'Accepted', value: counts.accepted },
          { label: 'Rejected', value: counts.rejected, sub: 'told when you press Send' },
        ]}
      />

      <Panel>
        <TypeFilter base={`${CFA_BASE}/review`} current={type} params={{ call: sp.call }} types={call.sessionTypes} />
        {queue.length === 0 ? (
          <p className="body-2" style={{ margin: 0 }}>
            Nothing is waiting for a decision{type ? ` among the ${type}s` : ''}.
          </p>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {queue.map(({ row, isNew }) => (
              <li
                key={row.id}
                style={{ borderTop: '1px solid var(--hairline)', padding: '16px 0' }}
                data-submission={row.id}
              >
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  {isNew && (
                    <Tag color="blue" fill="solid" small>
                      New
                    </Tag>
                  )}
                  <strong>{row.name ?? 'No author on file'}</strong>
                  <span className="muted">{row.organisation ?? ''}</span>
                </div>
                <div className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>
                  {[row.trackName, sessionTypeLine(row.sessionType, row.durationMinutes)].filter(Boolean).join(' · ')}
                </div>
                <h3 style={{ fontSize: 16, margin: '0 0 6px' }}>
                  <Link href={`${CFA_BASE}/submissions/${row.id}`}>{row.title || 'Untitled'}</Link>
                </h3>
                <p className="body-2" style={{ whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>
                  {row.abstract}
                </p>
                <RowDecision submissionId={row.id} />
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel>
        <FinishPass callId={call.id} />
      </Panel>
    </>
  );
}
