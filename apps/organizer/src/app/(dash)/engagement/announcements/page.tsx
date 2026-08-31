import Link from 'next/link';
import { COLLECTIONS } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { countWhereEvent, listAnnouncements } from '@/lib/data';
import { Banner, GapPanel, PER_PAGE, PageHeader, Pagination, Panel, Table, Tag, listParams, paginate, sortRows } from '../../ui';
import { AnnouncementForm } from './announcement-form';

export const dynamic = 'force-dynamic';

/**
 * Engagement > Announcements.
 *
 * Whova fans one announcement out three ways: a push, an email, and a persisted
 * post in the "Organizer Announcements" thread on the Community Board with a
 * red badge, so that someone with notifications off still sees it. We do the
 * third — the one that always arrives — because it is a Firestore write the app
 * is already listening to, and the first, because FCM's send API is in the
 * Admin SDK and this is a trusted server. Email is the one still missing, and
 * it needs a provider rather than a plan upgrade.
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

        {/*
          Whova's four compose buttons — Start from scratch, Quick reminder,
          Reuse past announcement, From other organizers — are gone rather than
          greyed out. Three had nothing behind them and one opened the form that
          is already on this page, so the row was four controls of which zero
          did anything an organizer could not do by scrolling. What each of them
          would need is in the gap panel at the foot.
        */}

        <Banner kind="info">
          <strong>Push sends from this server, not a Cloud Function.</strong> FCM&apos;s send API is
          part of the Admin SDK, so the free plan is no obstacle — Blaze is only required to
          <em> deploy a Cloud Function</em>. Sending also writes an <code>announcements</code>{' '}
          document, which the app&apos;s home screen is already listening to, so it appears in the
          app within about a second even for someone with notifications off. Email is still
          unbuilt.
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
          ])}
        />
        <Pagination total={sent.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Recipient targeting</strong> — Whova offers four narrower audiences and this
            form used to show all four greyed out. By ticket type, by category and by segment all
            derive from registration question answers, which nothing collects; &ldquo;attendees who
            added a specific session&rdquo; reads <code>savedSessions</code>, which is a private
            per-attendee subcollection an organizer cannot enumerate. And underneath all four:{' '}
            <code>AnnouncementDoc</code> has no audience field and the push is an FCM{' '}
            <em>topic</em> send, so even a computed audience has nowhere to be expressed. The live
            count before sending is the part worth having.
          </li>
          <li>
            <strong>Templates, reuse and the Whova network.</strong> The three other compose buttons
            on Whova&apos;s toolbar. Quick reminder needs a template store, which is content rather
            than code; reuse needs a previous event, and <code>EVENT_ID</code> is a compile-time
            constant; &ldquo;from other organizers&rdquo; is a marketplace inside Whova&apos;s own
            network and has no analogue here at all.
          </li>
          <li>
            <strong>Per-announcement recipients and resend.</strong> The Sent table had both as
            greyed-out row actions. Neither can be honest today: nothing records who an
            announcement reached — a topic send has no recipient list, and the document is read by
            whoever opens the app — so &ldquo;view recipients&rdquo; would show an audience computed
            now rather than the one it went to. Resend would be a second document on the wall,
            which is a duplicate rather than a resend.
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
      </GapPanel>
    </>
  );
}
