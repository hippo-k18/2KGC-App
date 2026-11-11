import Link from 'next/link';
import { TIME_ZONE } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import {
  EMAIL_LOG_PATH,
  FROM_NOT_RECORDED,
  GROUP_LABEL,
  TEMPLATES,
  TEMPLATE_INFO,
  formatWhen,
  parseFilters,
  rangeMs,
  relatedLink,
  splitAddress,
  statusDetail,
  templateLabel,
  type EmailGroup,
  type EmailLogRow,
} from '@/lib/email-log-core';
import { listEmailLog } from '@/lib/email-log';
import { cronHealth } from '@/lib/email-schedule-core';
import { CONTACT_ADDRESS, EMAIL_FORMATS, renderFormat, searchFormats } from '@kgc/scripts/src/lib/email-catalogue';
import { loadSchedule } from '@/lib/email-schedule';
import { recordError } from '@/lib/errors';
import { Banner, EmptyState, PER_PAGE, PageHeader, Pagination, Panel, SearchInput, Table, Tabs, Tag, paginate } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Tools › Email Log (T274). The owner's words: "a log of every email that gets
 * sent out and every email that is scheduled to send", with the email shown as
 * the recipient saw it.
 *
 * Three tabs. Sent reads `emailLog`, every row any part of the system writes.
 * Scheduled works out what the hourly run and the bulk sends will do, and
 * what is waiting on somebody's button. All email formats (T292) shows every
 * email the system can send, filled with sample data.
 *
 * ⚠️ Nothing on these screens sends. There is no server action here at all,
 * so there is nothing a stray click or a replayed POST could set off.
 */
export default async function EmailLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const tab = sp.tab === 'scheduled' || sp.tab === 'formats' ? sp.tab : 'sent';

  return (
    <>
      <PageHeader
        title="Email Log"
        info={
          <>
            Every email the system has sent or tried to send, and everything it will send by itself.
            Click a row to see the email as the recipient got it. Sign-in codes are hidden. Nothing on
            this screen sends anything.
          </>
        }
      />
      <Tabs
        tabs={[
          { label: 'Sent', href: EMAIL_LOG_PATH, active: tab === 'sent' },
          { label: 'Scheduled', href: `${EMAIL_LOG_PATH}?tab=scheduled`, active: tab === 'scheduled' },
          { label: 'All email formats', href: `${EMAIL_LOG_PATH}?tab=formats`, active: tab === 'formats' },
        ]}
      />
      {tab === 'sent' ? <SentTab sp={sp} /> : tab === 'scheduled' ? <ScheduledTab /> : <FormatsTab sp={sp} />}
    </>
  );
}

function statusTag(r: Pick<EmailLogRow, 'status' | 'bounced' | 'complained'>) {
  if (r.status === 'sent' && r.complained) return <Tag color="red" small>spam</Tag>;
  if (r.status === 'sent' && r.bounced) return <Tag color="red" small>bounced</Tag>;
  const color = r.status === 'sent' ? 'green' : r.status === 'failed' ? 'red' : 'orange';
  return (
    <Tag color={color} small>
      {r.status}
    </Tag>
  );
}

async function SentTab({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const filters = parseFilters(sp);
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);
  let result: Awaited<ReturnType<typeof listEmailLog>> | null = null;
  try {
    result = await listEmailLog(filters, rangeMs(filters, TIME_ZONE));
  } catch (err) {
    recordError('email-log.list', err);
  }

  const baseParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'page' || v == null) continue;
    baseParams.set(k, Array.isArray(v) ? v[0] : v);
  }
  const filtered = Object.keys(filters).length > 0;
  const groups = Object.entries(GROUP_LABEL) as [EmailGroup, string][];
  const typeValue = filters.template ?? (filters.group ? `group:${filters.group}` : '');

  if (!result) {
    return (
      <Panel>
        <Banner kind="danger">The email log could not be read just now. Reload the page to try again.</Banner>
      </Panel>
    );
  }

  const rows = paginate(result.rows, page, PER_PAGE);

  return (
    <Panel>
      {/*
        A GET form: the filters live in the address, so a filtered view is a
        link someone can send, and the back button undoes a filter.
      */}
      <form method="get" action={EMAIL_LOG_PATH} style={{ alignItems: 'flex-end', display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <label style={{ display: 'grid', fontSize: 12, gap: 4 }}>
          From
          <input className="whova-text-input" type="date" name="from" defaultValue={filters.from ?? ''} />
        </label>
        <label style={{ display: 'grid', fontSize: 12, gap: 4 }}>
          To
          <input className="whova-text-input" type="date" name="to" defaultValue={filters.to ?? ''} />
        </label>
        <label style={{ display: 'grid', fontSize: 12, gap: 4 }}>
          Email
          <select className="whova-text-input" name="type" defaultValue={typeValue}>
            <option value="">All emails</option>
            {groups.map(([g, label]) => (
              <optgroup key={g} label={label}>
                <option value={`group:${g}`}>All {label.toLowerCase()}</option>
                {TEMPLATES.filter((t) => TEMPLATE_INFO[t].group === g).map((t) => (
                  <option key={t} value={t}>
                    {TEMPLATE_INFO[t].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', fontSize: 12, gap: 4 }}>
          Status
          <select className="whova-text-input" name="status" defaultValue={filters.status ?? ''}>
            <option value="">Any</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
        </label>
        <SearchInput defaultValue={filters.q ?? ''} placeholder="Recipient, subject or id" width={260} />
        <button type="submit" className="btn btn-default">
          Show
        </button>
        {filtered ? (
          <Link className="btn btn-default" href={EMAIL_LOG_PATH}>
            Clear
          </Link>
        ) : null}
      </form>

      {result.capped ? (
        <Banner kind="warning">
          There are more emails in this range than one page of results can read, so the oldest are not
          shown. Pick a shorter date range to see them.
        </Banner>
      ) : null}

      <Table
        cols={[
          { key: 'when', label: 'When (New York)', className: 'cell-sm' },
          // Narrow, and gone on a phone: it is the same address on every row
          // written since T305, and the single-email page shows it in full.
          { key: 'from', label: 'From', className: 'cell-sm hide-sm' },
          { key: 'to', label: 'To', className: 'cell-md' },
          { key: 'what', label: 'Email', className: 'cell-fill' },
          { key: 'status', label: 'Status', className: 'cell-sm' },
          { key: 'rel', label: 'Related', className: 'cell-sm' },
        ]}
        rows={rows.map((r) => {
          const detail = statusDetail(r);
          const rel = relatedLink(r);
          const from = r.from ? splitAddress(r.from).address : undefined;
          return [
            <Link key="w" href={`${EMAIL_LOG_PATH}/${r.id}`} className="row-link" style={{ fontSize: 12 }}>
              {formatWhen(r.atMs, TIME_ZONE)}
            </Link>,
            from ? (
              <span key="f" style={{ fontSize: 12 }} title={r.from}>
                {/* Break after the @ rather than mid-word when the column is too narrow. */}
                {from.split('@')[0]}
                {from.includes('@') ? (
                  <>
                    @<wbr />
                    {from.slice(from.indexOf('@') + 1)}
                  </>
                ) : null}
              </span>
            ) : (
              <span key="f" className="muted" style={{ fontSize: 12 }}>
                {FROM_NOT_RECORDED}
              </span>
            ),
            <span key="t" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
              {r.to || 'Address removed'}
            </span>,
            <span key="e" style={{ display: 'grid', gap: 2 }}>
              <Link href={`${EMAIL_LOG_PATH}/${r.id}`} className="row-link" style={{ fontWeight: 600 }}>
                {r.subject || '(no subject)'}
              </Link>
              <span className="muted" style={{ fontSize: 12 }}>
                {templateLabel(r.template)}
                {r.actor ? ` · sent by ${r.actor}` : ''}
              </span>
            </span>,
            <span key="s" style={{ display: 'grid', gap: 4 }}>
              {statusTag(r)}
              {detail ? (
                <span className="muted" style={{ fontSize: 11, overflowWrap: 'anywhere' }}>
                  {detail}
                </span>
              ) : null}
            </span>,
            rel ? (
              <Link key="r" href={rel.href} className="row-link" style={{ fontSize: 12 }}>
                {rel.label}
              </Link>
            ) : (
              <span key="r" className="muted" style={{ fontSize: 12 }}>
                None
              </span>
            ),
          ];
        })}
        empty={
          filtered ? (
            'No emails match these filters.'
          ) : (
            <EmptyState compact>Every email the system sends or tries to send will be listed here.</EmptyState>
          )
        }
      />
      <Pagination total={result.rows.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
    </Panel>
  );
}

async function ScheduledTab() {
  let view: Awaited<ReturnType<typeof loadSchedule>> | null = null;
  try {
    view = await loadSchedule();
  } catch (err) {
    recordError('email-log.schedule', err);
  }
  if (!view) {
    return (
      <Panel>
        <Banner kind="danger">
          What is scheduled could not be worked out just now, because the submissions or the sends could
          not be read. Reload the page to try again.
        </Banner>
      </Panel>
    );
  }
  const now = Date.now();
  const health = cronHealth(view.env, now);
  const timed = view.items.filter((i) => i.kind !== 'waiting');
  const waiting = view.items.filter((i) => i.kind === 'waiting');

  const table = (items: typeof view.items, empty: string) => (
    <Table
      cols={[
        { key: 'what', label: 'Email', className: 'cell-fill' },
        { key: 'to', label: 'To', className: 'cell-md' },
        { key: 'when', label: 'When (New York)', className: 'cell-md' },
        { key: 'p', label: 'Preview', className: 'cell-sm' },
      ]}
      rows={items.map((i) => [
        <span key="e" style={{ display: 'grid', gap: 3 }}>
          <strong>{i.email}</strong>
          {i.about ? (
            <Link href={i.about.href} className="row-link" style={{ fontSize: 12 }}>
              {i.about.label}
            </Link>
          ) : null}
          {i.blocked ? (
            <span style={{ color: '#b42318', fontSize: 12 }}>{i.blocked}</span>
          ) : null}
          {i.note ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {i.note}
            </span>
          ) : null}
        </span>,
        <span key="t" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
          {i.to}
        </span>,
        <span key="w" style={{ display: 'grid', gap: 3, fontSize: 12 }}>
          {i.whenMs !== undefined ? <strong>{formatWhen(i.whenMs, TIME_ZONE)}</strong> : null}
          <span className="muted">{i.when}</span>
          {i.where ? (
            <Link href={i.where.href} className="row-link">
              Go to: {i.where.label}
            </Link>
          ) : null}
        </span>,
        i.count > 0 ? (
          <Link key="p" href={`${EMAIL_LOG_PATH}/scheduled/${encodeURIComponent(i.key)}`} className="row-link" style={{ fontSize: 12 }}>
            Preview
          </Link>
        ) : (
          <span key="p" className="muted" style={{ fontSize: 12 }}>
            None
          </span>
        ),
      ])}
      empty={empty}
    />
  );

  return (
    <>
      {health ? <Banner kind="warning">{health}</Banner> : null}
      {!view.env.emailEnabled ? (
        <Banner kind="warning">
          Email is not switched on for the dashboard (RESEND_API_KEY is empty). Everything below would be
          logged as skipped rather than sent.
        </Banner>
      ) : null}
      {view.calls
        .filter((c) => c.missing.length)
        .map((c) => (
          <Banner key={c.id} kind="warning">
            {c.title}: {c.missing.join(' and ')} {c.missing.length === 1 ? 'is' : 'are'} empty, so{' '}
            {c.missing.length === 1 ? 'that email does' : 'those emails do'} not send. Set{' '}
            {c.missing.length === 1 ? 'it' : 'them'} on{' '}
            <Link href="/content/call-for-speakers-abstracts/rolling-review">Rolling review: dates and emails</Link>.
          </Banner>
        ))}

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Will send by itself
        </h2>
        <p className="body-2 muted">
          The call for speakers runs every hour and sends what is due then.
          {view.env.lastCronRunMs !== undefined
            ? ` Last run: ${formatWhen(view.env.lastCronRunMs, TIME_ZONE)}.`
            : ''}
        </p>
        {table(timed, 'Nothing is scheduled to send by itself right now.')}
      </Panel>

      <Panel>
        <h2 className="section-header" style={{ marginTop: 0 }}>
          Waiting for someone to send
        </h2>
        <p className="body-2 muted">These go only when somebody presses the button named in each row.</p>
        {table(waiting, 'Nothing is waiting on a button.')}
      </Panel>
    </>
  );
}

/**
 * Every email the system can send (T292), from `email-catalogue.ts`. Each one
 * is rendered by the same builder its sender uses, with sample data. Nothing
 * here reads or writes Firestore.
 */
function FormatsTab({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? '';
  const shown = searchFormats(EMAIL_FORMATS, q);
  const versions = EMAIL_FORMATS.reduce((n, f) => n + f.variants.length, 0);
  const groups = (Object.entries(GROUP_LABEL) as [EmailGroup, string][])
    .map(([g, label]) => ({ label, formats: shown.filter((f) => TEMPLATE_INFO[f.template].group === g) }))
    .filter((g) => g.formats.length);

  return (
    <Panel>
      <p className="body-2" style={{ marginTop: 0 }}>
        {EMAIL_FORMATS.length} emails, {versions} versions in all. Every one comes from Knowledge Graph Conference
        &lt;{CONTACT_ADDRESS}&gt;. Click one to see it as the recipient would, filled with sample details.
      </p>
      <form method="get" action={EMAIL_LOG_PATH} style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <input type="hidden" name="tab" value="formats" />
        <SearchInput name="q" defaultValue={q} placeholder="Search by name, when it is sent or subject" width={360} />
        <button type="submit" className="btn btn-default">
          Search
        </button>
        {q ? (
          <Link className="btn btn-default" href={`${EMAIL_LOG_PATH}?tab=formats`}>
            Clear
          </Link>
        ) : null}
      </form>

      {groups.length === 0 ? <EmptyState compact>No email matches “{q}”.</EmptyState> : null}
      {groups.map((g) => (
        <section key={g.label} style={{ marginBottom: 18 }}>
          <h2 className="section-header" style={{ marginTop: 8 }}>
            {g.label}
          </h2>
          <Table
            cols={[
              { key: 'what', label: 'Email', className: 'cell-md' },
              { key: 'when', label: 'When it is sent', className: 'cell-fill' },
              { key: 'to', label: 'Who gets it', className: 'cell-md' },
            ]}
            rows={g.formats.map((f) => {
              const href = `${EMAIL_LOG_PATH}/formats/${f.id}`;
              return [
                <span key="e" style={{ display: 'grid', gap: 2 }}>
                  <Link href={href} className="row-link" style={{ fontWeight: 600 }}>
                    {f.name}
                  </Link>
                  <span style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{renderFormat(f).email.subject}</span>
                  {f.variants.length > 1 ? (
                    <span className="muted" style={{ fontSize: 12 }}>
                      {f.variants.length} versions: {f.variants.map((v) => v.label).join(', ')}
                    </span>
                  ) : null}
                </span>,
                <span key="w" style={{ fontSize: 13 }}>
                  {f.when}
                </span>,
                <span key="t" style={{ fontSize: 13 }}>
                  {f.to}
                </span>,
              ];
            })}
          />
        </section>
      ))}
    </Panel>
  );
}
