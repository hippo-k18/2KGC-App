import { redirect } from 'next/navigation';
import { isEditor } from '@/lib/blog/access';
import { envEditors, requireViewer } from '@/lib/blog/auth';
import { blogPath } from '@/lib/blog/paths';
import { allMembers, allStoredPosts } from '@/lib/blog/store';
import { PeopleManager, type PersonRow } from './people-manager';

export const metadata = { title: 'People' };

export default async function PeoplePage() {
  const viewer = await requireViewer();
  if (!isEditor(viewer)) redirect(await blogPath('/write'));
  const [members, posts] = await Promise.all([allMembers(), allStoredPosts()]);
  const fixed = new Set(envEditors());

  const rows: PersonRow[] = members
    .filter((m) => m.status !== 'removed')
    .map((m) => ({
      email: m.email,
      name: m.name,
      role: fixed.has(m.email) ? 'editor' : m.role,
      status: m.status,
      fixed: fixed.has(m.email),
      you: m.email === viewer.email,
      posts: posts.filter((p) => p.authorEmail === m.email).length,
      lastSignInAt: (m.lastSignInAt as unknown as { toMillis?: () => number })?.toMillis?.() ?? null,
    }));
  for (const email of fixed) {
    if (!rows.some((r) => r.email === email)) {
      rows.push({ email, name: email, role: 'editor', status: 'invited', fixed: true, you: false, posts: 0, lastSignInAt: null });
    }
  }
  rows.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'editor' ? -1 : 1));

  return (
    <div className="st-page">
      <div className="st-head">
        <div>
          <h1>People</h1>
          <p>Writers can draft and submit their own posts. Editors can publish anything and manage this list.</p>
        </div>
      </div>
      <PeopleManager rows={rows} />
    </div>
  );
}
