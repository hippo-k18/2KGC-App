import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listAnnouncements } from '@/lib/data';
import { AnnouncementForm } from './announcement-form';

export const dynamic = 'force-dynamic';

/**
 * Engagement > Announcements — §18.1.
 *
 * Whova fans one announcement out three ways: a push, an email, and a persisted
 * post in the "Organizer Announcements" thread on the Community Board with a
 * red badge, so that someone with notifications off still sees it. We do the
 * third — the one that always arrives — because it is a Firestore write the
 * app is already listening to. The push is a marked seam; the email needs an
 * ESP on the Blaze plan.
 */
export default async function AnnouncementsPage() {
  await requireOrganizer();
  const sent = await listAnnouncements();

  return (
    <>
      <p className="crumbs">
        <Link href="/engagement">Engagement</Link> {' › '}
      </p>
      <h1>Announcements</h1>

      <div className="banner">
        <strong>Push is not wired.</strong> Sending writes an <code>announcements</code> document,
        which the app&apos;s home screen is already listening to — so it appears in the app
        immediately. The FCM topic broadcast is a marked seam in{' '}
        <code>src/lib/push.ts</code> and belongs to WP-02. Ticking the push box sets{' '}
        <code>push: true</code> on the document and logs what would have been sent; no device is
        contacted.
      </div>

      <AnnouncementForm />

      <h2>Sent ({sent.length})</h2>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Title</th>
            <th>Body</th>
            <th>By</th>
            <th>Push</th>
          </tr>
        </thead>
        <tbody>
          {sent.map((a) => (
            <tr key={a.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{a.createdAt ?? '—'}</td>
              <td>{a.title}</td>
              <td>{a.body}</td>
              <td>{a.authorId}</td>
              <td>{a.push ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Not built here</h2>
      <ul className="muted" style={{ maxWidth: 780 }}>
        <li>
          <strong>Recipient targeting</strong> (§18.1) — all attendees, by category, or by segment,
          with a live count of who is selected shown before you send. The live count is the good
          part and it needs categories and segments, which need registration answers.
        </li>
        <li>
          <strong>Email delivery</strong>, with Whova&apos;s three-way setting: email everyone,
          skip people who have the app, or do not email at all. Needs an ESP with a verified
          sending domain — §18.5 notes that gets us better deliverability than the incumbent for
          about two days of work, because Whova has no bounce reporting, no suppression list and no
          domain authentication at all.
        </li>
        <li>
          <strong>Scheduled send, drafts and send-myself-a-test.</strong> The absence of scheduling
          is currently a feature: the research flags a 6am wrong-timezone blast as a common real
          failure, and requiring a human to press the button, awake, in the room, is the cheapest
          possible defence. A test send is the one of the three worth adding first.
        </li>
        <li>
          <strong>Sender identity</strong> — a custom from-name and reply-to (§18.1).
        </li>
      </ul>
    </>
  );
}
