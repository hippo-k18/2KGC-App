import { forbidden } from 'next/navigation';
import { isEditor } from '@/lib/blog/access';
import { requireViewer } from '@/lib/blog/auth';
import { DASHBOARD_BLOG_SETTINGS, listPeople } from '@/lib/blog/people';
import { PeopleManager } from './people-manager';

export const metadata = { title: 'People' };

/**
 * Who can sign in to the blog editor. Editors only: a writer who opens the
 * address gets a 403, and every action behind the buttons checks again on the
 * server. The dashboard's Admin Settings manages the same list.
 */
export default async function PeoplePage() {
  const viewer = await requireViewer();
  if (!isEditor(viewer)) forbidden();
  const people = await listPeople(viewer);

  return (
    <div className="st-page">
      <div className="st-head">
        <div>
          <h1>People</h1>
          <p>Writers draft their own posts and send them to review. Editors publish any post and manage this list.</p>
        </div>
      </div>
      <PeopleManager people={people} me={viewer.email} />
      <p className="st-muted pp-also">
        Also managed in the dashboard: Attendees › Admin Settings › Blog.{' '}
        <a href={DASHBOARD_BLOG_SETTINGS} target="_blank" rel="noreferrer">
          Open Admin Settings
        </a>
      </p>
    </div>
  );
}
