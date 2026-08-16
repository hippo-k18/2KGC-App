import { requireOrganizer } from '@/lib/auth';
import { listAnnouncements } from '@/lib/data';
import { AnnouncementForm } from './announcement-form';

export const dynamic = 'force-dynamic';

export default async function AnnouncementsPage() {
  await requireOrganizer();
  const sent = await listAnnouncements();

  return (
    <>
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
    </>
  );
}
