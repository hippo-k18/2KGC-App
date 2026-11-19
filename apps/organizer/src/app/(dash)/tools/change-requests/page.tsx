import Link from 'next/link';
import { headers } from 'next/headers';
import { TIME_ZONE } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import {
  CHANGE_REQUESTS_PATH,
  CHANGE_REQUEST_FORM_PATH,
  STATUSES,
  STATUS_LABEL,
  parseStatusFilter,
} from '@/lib/change-requests-core';
import { listChangeRequests } from '@/lib/change-requests';
import { formatWhen } from '@/lib/email-log-core';
import { recordError } from '@/lib/errors';
import { Banner, EmptyState, PER_PAGE, PageHeader, Pagination, Panel, Table, Tabs, paginate } from '../../ui';
import { ChangeStatusTag } from './status-tag';

export const dynamic = 'force-dynamic';

/**
 * Tools › Change requests (T428): what people sent on the public form at
 * `/request`, newest first. Owners only, by the role rules: no team role
 * covers `tools`.
 */
export default async function ChangeRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const status = parseStatusFilter(sp.status);
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);

  let result: Awaited<ReturnType<typeof listChangeRequests>> | null = null;
  try {
    result = await listChangeRequests(status);
  } catch (err) {
    recordError('change-requests.list', err);
  }

  // The address to hand out, from the host this screen was opened on.
  const h = await headers();
  const proto = h.get('x-forwarded-proto') === 'http' ? 'http' : 'https';
  const formLink = `${proto}://${h.get('host') ?? 'dashboard.knowledgegraph.tech'}${CHANGE_REQUEST_FORM_PATH}`;
  const header = (
    <PageHeader
      title="Change requests"
      info={
        <>
          Small changes people asked for on the public form, which needs no sign-in. The sender gets one email
          when you mark a request Built and one when you mark it Live, never more. Notes are for the team only.
          Every request except declined ones is listed on the form page with its short description, status and
          date, never the sender. Untick Show on public list on a request to take it off.
        </>
      }
      links={[
        <a key="form" href={CHANGE_REQUEST_FORM_PATH} target="_blank" rel="noreferrer">
          Open the form
        </a>,
        <span key="link" className="muted">
          {formLink}
        </span>,
      ]}
    />
  );

  if (!result) {
    return (
      <>
        {header}
        <Panel>
          <Banner kind="danger">The change requests could not be read just now. Reload the page to try again.</Banner>
        </Panel>
      </>
    );
  }

  const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
  const rows = paginate(result.rows, page, PER_PAGE);
  const base = new URLSearchParams(status ? { status } : {});

  return (
    <>
      {header}
      <Tabs
        tabs={[
          { label: `All (${total})`, href: CHANGE_REQUESTS_PATH, active: !status },
          ...STATUSES.map((s) => ({
            label: `${STATUS_LABEL[s]} (${result.counts[s]})`,
            href: `${CHANGE_REQUESTS_PATH}?status=${s}`,
            active: status === s,
          })),
        ]}
      />
      <Panel>
        <Table
          cols={[
            { key: 'when', label: 'Received', className: 'cell-sm' },
            { key: 'from', label: 'From', className: 'cell-md' },
            { key: 'what', label: 'Change', className: 'cell-fill' },
            { key: 'status', label: 'Status', className: 'cell-sm' },
          ]}
          rows={rows.map((r) => [
            <Link key="w" href={`${CHANGE_REQUESTS_PATH}/${r.id}`}>
              {formatWhen(r.createdAtMs, TIME_ZONE)}
            </Link>,
            r.email,
            <Link key="d" href={`${CHANGE_REQUESTS_PATH}/${r.id}`} className="change-excerpt" style={{ color: 'inherit' }}>
              {r.description}
              {r.screenshots.length ? ` (${r.screenshots.length} screenshot${r.screenshots.length > 1 ? 's' : ''})` : ''}
            </Link>,
            <span key="s">
              <ChangeStatusTag status={r.status} />
              {r.hiddenFromPublic && r.status !== 'declined' ? <span className="muted change-hidden-note">Hidden</span> : null}
            </span>,
          ])}
          empty={
            <EmptyState compact>
              {status ? `No requests are ${STATUS_LABEL[status].toLowerCase()}.` : 'No change requests yet.'}
            </EmptyState>
          }
        />
        <Pagination total={result.rows.length} page={page} perPage={PER_PAGE} baseParams={base} />
      </Panel>
    </>
  );
}
