import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSpeakers } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import {
  PER_PAGE,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  StatTiles,
  Table,
  Tag,
  listParams,
  paginate,
  sortRows,
} from '../../../ui';
import { Dropdown, RowActions } from '../../../menu';

export const dynamic = 'force-dynamic';

/**
 * Content > Speaker Center > Speaker Manager.
 *
 * Whova's three stat tiles across the top are TOTAL SPEAKERS / NUMBER OF EDITED
 * PROFILES / SPEAKERS WHO RECEIVED LINK. The third counts emails we cannot send
 * yet, so it is replaced with the number that actually drives work here —
 * profiles missing a bio or a photo — and the substitution is called out on the
 * tile rather than left to look like the Whova metric.
 *
 * The research is explicit about what earns this screen its place at 150
 * speakers: the completeness column and the bulk reminder. The reminder needs
 * an ESP and the Blaze plan; the completeness column needs nothing, so it is
 * here. Filtering to the incomplete ones is the one thing an organizer does
 * with this list in the fortnight before an event.
 */
export default async function SpeakerManagerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();

  const sp = await searchParams;
  const filter = typeof sp.filter === 'string' ? sp.filter : undefined;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const { page, sort, baseParams } = listParams(sp);
  const all = await listSpeakers();

  const noBio = all.filter((s) => !s.hasBio);
  const noPhoto = all.filter((s) => !s.hasPhoto);
  const noSession = all.filter((s) => s.sessionCount === 0);
  const complete = all.filter((s) => s.hasBio && s.hasPhoto);

  const base =
    filter === 'no-bio'
      ? noBio
      : filter === 'no-photo'
        ? noPhoto
        : filter === 'no-session'
          ? noSession
          : all;

  const needle = (q ?? '').trim().toLowerCase();
  const matched = needle
    ? base.filter((s) =>
        [s.name, s.title ?? '', s.company ?? ''].join(' ').toLowerCase().includes(needle),
      )
    : base;

  const rows = sortRows(matched, sort.by, sort.dir, {
    speaker: (s) => s.name,
    affiliation: (s) => s.company ?? '',
    sessions: (s) => s.sessionCount,
    profile: (s) => Number(s.hasBio) + Number(s.hasPhoto),
  });
  const pageRows = paginate(rows, page, PER_PAGE);

  const href = (f?: string) => {
    const p = new URLSearchParams();
    if (f) p.set('filter', f);
    if (q) p.set('q', q);
    const s = p.toString();
    return s ? `?${s}` : ROUTES.speakerManager;
  };

  const chips: [string, string, number][] = [
    ['All Speakers', '', all.length],
    ['No bio', 'no-bio', noBio.length],
    ['No photo', 'no-photo', noPhoto.length],
    ['No session', 'no-session', noSession.length],
  ];

  return (
    <>
      <PageHeader
        title="Speaker Manager"
        tags={
          <Tag color="green" fill="outline">
            ✓ Enabled
          </Tag>
        }
        links={[
          <Link key="sc" href="/content/speaker-center">
            Speaker Center
          </Link>,
          <Link key="ms" href="/content/speaker-center/message-speakers">
            Message Speakers
          </Link>,
        ]}
      />

      <Panel>
        <StatTiles
          tiles={[
            { label: 'Total speakers', value: all.length },
            {
              label: 'Complete profiles',
              value: complete.length,
              sub: `${all.length - complete.length} missing a bio or a photo`,
            },
            {
              label: 'Speakers who received link',
              value: '—',
              sub: 'Whova counts sent invite links; we cannot send email yet',
            },
          ]}
        />

        <h2 className="section-header">Speaker list</h2>

        <div className="toolbar">
          <Dropdown
            label="Add speaker(s)"
            className="btn btn-primary"
            items={[
              { label: 'Add speaker', disabled: true },
              { label: 'Upload Excel list', disabled: true },
            ]}
          />
          <button type="button" className="btn btn-default" disabled title="Not built — see below">
            Settings
          </button>
          <button type="button" className="btn btn-default" disabled title="Not built — see below">
            Export speakers
          </button>
          <span className="spacer" />
          <Dropdown
            label="Email reminder"
            className="btn btn-primary"
            align="end"
            items={[
              { label: 'Remind speakers with no bio', disabled: true },
              { label: 'Remind speakers with no photo', disabled: true },
              { label: 'Remind all speakers', disabled: true },
            ]}
          />
        </div>

        <form method="get" className="toolbar">
          {filter ? <input type="hidden" name="filter" value={filter} /> : null}
          <SearchInput defaultValue={q} placeholder="Search by speaker name, title or affiliation" />
          <button type="submit" className="btn btn-default">
            Search
          </button>
          {q ? (
            <Link className="btn btn-default" href={filter ? `?filter=${filter}` : ROUTES.speakerManager}>
              Clear
            </Link>
          ) : null}
        </form>

        <div className="toolbar">
          {chips.map(([label, f, n]) => (
            <Link
              key={label}
              className={`whova-tag-main ${(filter ?? '') === f ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`}
              href={href(f || undefined)}
              style={{ textDecoration: 'none' }}
            >
              {label} ({n})
            </Link>
          ))}
        </div>

        <Table
          cols={[
            { key: 's', label: 'Speaker', className: 'cell-md', sortKey: 'speaker' },
            { key: 'a', label: 'Affiliation', className: 'cell-mdsm', sortKey: 'affiliation' },
            { key: 'p', label: 'Profile', className: 'cell-sm', sortKey: 'profile' },
            { key: 'x', label: 'Session(s)', className: 'cell-fill', sortKey: 'sessions' },
            { key: 'act', label: '', className: 'cell-xs cell-end-align' },
          ]}
          sort={sort}
          empty="Your event has no speakers"
          rows={pageRows.map((s) => [
            <span key="s">
              <strong>{s.name}</strong>
              {s.title ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  {s.title}
                </div>
              ) : null}
            </span>,
            s.company ?? <span className="muted">—</span>,
            <span key="p" style={{ display: 'flex', gap: 4 }}>
              <Tag color={s.hasBio ? 'green' : 'red'} small>
                bio
              </Tag>
              <Tag color={s.hasPhoto ? 'green' : 'red'} small>
                photo
              </Tag>
            </span>,
            s.sessionCount === 0 ? (
              <Tag key="x" color="red">
                no session
              </Tag>
            ) : (
              <span style={{ fontSize: 13 }}>{s.sessionTitles.join(' · ')}</span>
            ),
            <RowActions
              key="act"
              items={[
                { label: 'Edit speaker', disabled: true },
                { label: 'Email speaker', disabled: true },
                { label: 'Remove speaker', danger: true, disabled: true },
              ]}
            />,
          ])}
        />
        <Pagination total={rows.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
      </Panel>

      <Panel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>The speaker self-service form.</strong> Whova&apos;s whole design here is that
            organizers never collect bios by email — each speaker gets a personal link and fills
            their own profile in, and the reminder schedule chases the ones who have not. That
            personal-link pattern is Whova&apos;s real permission model and it is worth copying;
            it needs an email sender first.
          </li>
          <li>
            <strong>Add and edit a speaker.</strong> Speakers are created by the importer today.
            Note that a speaker who also holds a ticket has both a <code>speakers</code> document
            and a <code>users</code> document, joined by <code>userId</code> — an editor has to not
            break that join.
          </li>
          <li>
            <strong>Release &amp; consent forms.</strong> One per event in Whova, and it locks at
            publish; deleting it requires emailing their support.
          </li>
        </ul>
      </Panel>
    </>
  );
}
