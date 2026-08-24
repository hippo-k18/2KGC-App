import Link from 'next/link';
import { COLLECTIONS } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { countWhereEvent, listAnnouncements } from '@/lib/data';
import {
  PER_PAGE,
  Banner,
  PageHeader,
  Pagination,
  Panel,
  Table,
  Tag,
  listParams,
  paginate,
  sortRows,
} from '../../ui';
import { Dropdown, RowActions } from '../../menu';
import { AnnouncementForm } from './announcement-form';

export const dynamic = 'force-dynamic';

/**
 * Engagement > Announcements.
 *
 * Whova fans one announcement out three ways: a push, an email, and a persisted
 * post in the "Organizer Announcements" thread on the Community Board with a
 * red badge, so that someone with notifications off still sees it. We do the
 * third — the one that always arrives — because it is a Firestore write the app
 * is already listening to. The push is a marked seam; the email needs a
 * provider on the Blaze plan.
 *
 * Whova's page is four buttons over a Drafts table and a Sent table, with
 * compose in a modal. Compose is inline here instead: with one live path and no
 * drafts, a modal would be a click in front of the only thing the page does.
 * The Drafts table is still shown, empty, because its absence would read as
 * "we forgot drafts" rather than "drafts need somewhere to save to".
 */
export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const { page, sort, baseParams } = listParams(sp);

  const [all, attendees] = await Promise.all([
    listAnnouncements(),
    countWhereEvent(COLLECTIONS.users),
  ]);

  const sent = sortRows(all, sort.by, sort.dir, {
    subject: (a) => a.title,
    when: (a) => a.createdAt ?? '',
  });
  const pageRows = paginate(sent, page, PER_PAGE);

  return (
    <>
      <PageHeader
        title="Announcements"
        links={[
          <Link key="e" href="/engagement">
            Engagement
          </Link>,
          <span key="n" className="muted">
            {all.length} sent
          </span>,
        ]}
      />

      <Panel>
        <p className="body-2" style={{ marginTop: 0 }}>
          Conveniently use templates and customise your announcement with images, links and
          highlights.
        </p>

        <div className="toolbar">
          <button type="button" className="btn btn-primary">
            Start from scratch
          </button>
          <button type="button" className="btn btn-primary" disabled title="Needs templates">
            Quick reminder
          </button>
          <Dropdown
            label="Reuse past announcement"
            className="btn btn-default"
            items={[{ label: 'No past event to reuse from', disabled: true }]}
          />
          <button type="button" className="btn btn-default" disabled title="Whova-network feature">
            From other organizers
          </button>
        </div>

        <Banner kind="warning">
          <strong>Push is not wired.</strong> Sending writes an <code>announcements</code> document,
          which the app&apos;s home screen is already listening to, so it appears in the app within
          about a second. Nothing is emailed and no device is contacted.
        </Banner>

        <AnnouncementForm recipientCount={attendees} />
      </Panel>

      <Panel>
        <h2 className="section-header">Drafts</h2>
        <Table
          cols={[
            { key: 's', label: 'Subject', className: 'cell-lg' },
            { key: 't', label: 'Send to', className: 'cell-mdsm' },
            { key: 'c', label: 'Time created', className: 'cell-mdsm' },
            { key: 'a', label: 'Actions', className: 'cell-sm' },
          ]}
          rows={[]}
          empty="No drafts — there is nowhere to save one yet"
        />
      </Panel>

      <Panel>
        <h2 className="section-header">Sent</h2>
        <Table
          cols={[
            { key: 's', label: 'Subject', className: 'cell-lg', sortKey: 'subject' },
            { key: 'b', label: 'Body', className: 'cell-fill' },
            { key: 't', label: 'Sent to', className: 'cell-sm' },
            { key: 'c', label: 'Time sent', className: 'cell-mdsm', sortKey: 'when' },
            { key: 'p', label: 'Push', className: 'cell-xs' },
            { key: 'act', label: '', className: 'cell-xs cell-end-align' },
          ]}
          sort={sort}
          empty="Nothing sent yet"
          rows={pageRows.map((a) => [
            <strong key="s">{a.title}</strong>,
            <span key="b" style={{ fontSize: 13 }}>
              {a.body}
            </span>,
            'All attendees',
            <span key="c" style={{ whiteSpace: 'nowrap' }}>
              {a.createdAt ?? '—'}
            </span>,
            a.push ? (
              <Tag key="p" color="green" small>
                yes
              </Tag>
            ) : (
              <span className="muted">no</span>
            ),
            <RowActions
              key="act"
              items={[
                { label: 'View recipients', disabled: true },
                { label: 'Resend', disabled: true },
              ]}
            />,
          ])}
        />
        <Pagination total={sent.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
      </Panel>

      <Panel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Recipient targeting</strong> — all attendees, by ticket type, by category or by
            segment, with a live count of who is selected shown before you send. The live count is
            the good part, and it needs categories and segments, which need registration answers.
          </li>
          <li>
            <strong>Email delivery</strong>, with Whova&apos;s three-way setting: email everyone,
            skip people who have the app, or do not email at all. Needs a provider with a verified
            sending domain — about two days of work that would give us better deliverability than
            the incumbent, because Whova has no bounce reporting, no suppression list and no domain
            authentication at all.
          </li>
          <li>
            <strong>Drafts, scheduled send, and send-myself-a-test.</strong> The test send is the
            one of the three worth adding first. The absence of scheduling is currently a feature —
            see the note on the form.
          </li>
          <li>
            <strong>Sender identity</strong> — a custom from-name and reply-to.
          </li>
        </ul>
      </Panel>
    </>
  );
}
