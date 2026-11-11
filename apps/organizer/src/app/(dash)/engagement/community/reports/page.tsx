import Link from 'next/link';
import { reportReasonLabel } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { ROUTES } from '@/lib/nav';
import { listReportQueue, reportCounts, type ReportQueueItem } from '@/lib/reports';
import { hideLabel, isGoneCard, noContentText, targetLabel } from '@/lib/reports-core';
import { dayOfInstant } from '@/lib/time';
import { EmptyState, PageHeader, Panel, StatTiles, Tabs, Tag } from '../../../ui';
import { keepAllForDeletedContentAction, resolveReportAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Engagement › Community › Reports.
 *
 * What attendees reported from the app: posts, replies, messages and profiles
 * (App Store guideline 1.2 asks for both the button and someone reading what it
 * sends). One row per reported thing, with every report on it, the content as
 * it is now, and three decisions: hide it, keep it, or reopen a closed one.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  await requireOrganizer();
  const { view: rawView } = await searchParams;
  const view = rawView === 'actioned' || rawView === 'dismissed' ? rawView : 'open';

  const items = await listReportQueue();
  const counts = reportCounts(items);
  const shown = items.filter((i) => i.status === view);
  const gone = items.filter(isGoneCard);

  return (
    <>
      <PageHeader
        title="Reports"
        info={
          <>
            <strong>Reports from the app</strong>
            <p>
              Attendees can report a post, a reply, a conversation or a profile. Only organizers see
              reports, and the person reported is not told who sent one.
            </p>
          </>
        }
        tags={
          counts.open > 0 ? (
            <Tag color="red" fill="outline">
              {counts.open} open
            </Tag>
          ) : (
            <Tag color="green" fill="outline">
              nothing open
            </Tag>
          )
        }
        links={[
          <Link key="b" href={ROUTES.moderateBoard}>
            Community Board
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Open', value: counts.open, sub: 'waiting for a decision' },
          { label: 'Hidden', value: counts.actioned, sub: 'content taken down' },
          { label: 'Kept', value: counts.dismissed, sub: 'nothing wrong found' },
        ]}
      />

      <Tabs
        tabs={[
          { label: `Open (${counts.open})`, href: '?', active: view === 'open' },
          { label: `Hidden (${counts.actioned})`, href: '?view=actioned', active: view === 'actioned' },
          { label: `Kept (${counts.dismissed})`, href: '?view=dismissed', active: view === 'dismissed' },
        ]}
      />

      <Panel>
        {view === 'open' && gone.length > 0 ? (
          <form
            action={keepAllForDeletedContentAction}
            style={{ alignItems: 'center', display: 'flex', gap: 10, marginBottom: 12 }}
          >
            <button type="submit" className="whova-btn-main secondary">
              Keep all for deleted content
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              Closes {gone.length} {gone.length === 1 ? 'card' : 'cards'} whose post, reply, conversation or profile
              is no longer there.
            </span>
          </form>
        ) : null}
        {shown.length === 0 ? (
          <EmptyState>
            <p className="empty-title">
              {view === 'open' ? 'No open reports' : view === 'actioned' ? 'Nothing hidden from a report yet' : 'No kept reports'}
            </p>
          </EmptyState>
        ) : (
          shown.map((item) => <ReportCard key={item.targetKey} item={item} />)
        )}
      </Panel>
    </>
  );
}

function ReportCard({ item }: { item: ReportQueueItem }) {
  const { content } = item;
  const open = item.status === 'open';
  const hide = hideLabel(item.target);
  const alreadyHidden = content.status === 'hidden' || content.status === 'removed';

  return (
    <div style={{ border: '1px solid var(--hairline)', borderRadius: 4, marginBottom: 14, overflow: 'hidden' }}>
      <div
        style={{
          alignItems: 'center',
          borderBottom: '1px solid var(--hairline)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          padding: '10px 14px',
        }}
      >
        <Tag color="blue" small>
          {content.unreadable ? 'Unreadable report' : targetLabel(item.target)}
        </Tag>
        <strong style={{ fontSize: 14 }}>
          {item.reports.length} {item.reports.length === 1 ? 'report' : 'reports'}
        </strong>
        <span className="muted" style={{ fontSize: 12 }}>
          {item.reasons}
        </span>
        {alreadyHidden && (
          <Tag color="red" fill="outline" small>
            {content.status}
          </Tag>
        )}
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11 }}>
          first {dayOfInstant(item.firstAt)}
        </span>
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.6, padding: '12px 14px' }}>
        {!content.exists ? (
          <p className="muted" style={{ margin: 0 }}>
            {noContentText(item)}
          </p>
        ) : (
          <>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
              {item.target?.type === 'user' ? 'Profile of' : 'By'} {content.authorName ?? 'unknown'}
            </div>
            {content.title && <strong style={{ display: 'block' }}>{content.title}</strong>}
            {content.body && <div style={{ whiteSpace: 'pre-wrap' }}>{content.body}</div>}
            {content.messages && (
              <div>
                <div className="muted" style={{ fontSize: 11, margin: '4px 0' }}>
                  Their latest messages in this conversation
                </div>
                {content.messages.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>No messages from them here.</p>
                ) : (
                  content.messages.map((m) => (
                    <div key={m.id} style={{ opacity: m.hidden ? 0.55 : 1, whiteSpace: 'pre-wrap' }}>
                      <span className="muted" style={{ fontSize: 11 }}>
                        {dayOfInstant(m.at)}
                        {m.hidden ? ' · hidden' : ''}
                      </span>{' '}
                      {m.body}
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--hairline)', fontSize: 12, padding: '8px 14px' }}>
        {item.reports.map((r) => (
          <div key={r.id} style={{ padding: '2px 0' }}>
            <span className="muted">
              {r.reporterName} · {dayOfInstant(r.createdAt)} · {reportReasonLabel(r.reason)}
            </span>
            {r.note ? <span> · “{r.note}”</span> : null}
          </div>
        ))}
        {!open && item.reports[0]?.resolvedBy ? (
          <div className="muted" style={{ marginTop: 4 }}>
            {item.status === 'actioned' ? 'Hidden' : 'Kept'} by {item.reports[0].resolvedBy}
            {item.reports[0].resolvedAt ? ` on ${dayOfInstant(item.reports[0].resolvedAt)}` : ''}
          </div>
        ) : null}
      </div>

      <div style={{ borderTop: '1px solid var(--hairline)', display: 'flex', gap: 8, padding: '8px 14px' }}>
        {open ? (
          <>
            {hide && content.exists && (
              <DecisionButton targetKey={item.targetKey} decision="hide" danger>
                {alreadyHidden ? 'Close as hidden' : hide}
              </DecisionButton>
            )}
            <DecisionButton targetKey={item.targetKey} decision="keep">
              Keep, nothing wrong
            </DecisionButton>
          </>
        ) : (
          <DecisionButton targetKey={item.targetKey} decision="reopen">
            Reopen
          </DecisionButton>
        )}
      </div>
    </div>
  );
}

function DecisionButton({
  targetKey,
  decision,
  danger,
  children,
}: {
  targetKey: string;
  decision: 'hide' | 'keep' | 'reopen';
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <form action={resolveReportAction}>
      <input type="hidden" name="targetKey" value={targetKey} />
      <input type="hidden" name="decision" value={decision} />
      <button type="submit" className={danger ? 'whova-btn-main danger' : 'whova-btn-main secondary'}>
        {children}
      </button>
    </form>
  );
}
