import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listTasks } from '@/lib/planning';
import { ROUTES } from '@/lib/nav';
import { Banner, GapPanel, PageHeader, Panel, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Project Management › Message Team Members.
 *
 * Two separate things are missing here and they have very different sizes, so
 * they are worth separating.
 *
 * The first is the same one Message Exhibitors hits: `AudienceId` in
 * `src/lib/messaging.ts` is `'speakers' | 'sponsors'`, and a third value would
 * be needed. That is small — **roughly a day once the audience is added.**
 *
 * The second is bigger and is the real blocker: **there is nobody to send to.**
 * `TaskDoc.assignee` is free text, deliberately — half the people on a
 * conference checklist are volunteers and suppliers who will never hold an
 * account, and requiring a uid would mean the tasks that matter most could not
 * be assigned to anybody. The cost of that choice lands exactly here: a name
 * with no address cannot be emailed. There is no team collection, no roles list
 * and no invitation flow anywhere in this dashboard.
 */
export default async function MessageTeamMembersPage() {
  await requireOrganizer();

  const tasks = await listTasks();

  // Free-text names, so the count is of distinct strings — which is the point.
  const assignees = [...new Set(tasks.map((t) => t.assignee).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  const unassigned = tasks.filter((t) => !t.assignee && t.status !== 'done').length;

  return (
    <>
      <PageHeader
        title="Message Team Members"
        tags={<Tag color="orange">not sending</Tag>}
        links={[
          <Link key="p" href="/content/project-management/projects-and-checklists">
            Projects &amp; Checklists
          </Link>,
          <Link key="s" href={ROUTES.messageSpeakers}>
            Message Speakers
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>There is no team to message.</strong> Task assignees are names typed into a
        checklist, not accounts — no email address is held for any of them, and nothing in this
        dashboard invites or lists a colleague. A compose box here would have an empty recipient
        list dressed up as a working screen.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Names on tasks', value: assignees.length, sub: 'free text, no addresses' },
          { label: 'Open tasks', value: tasks.filter((t) => t.status !== 'done').length, sub: `${unassigned} unassigned` },
          { label: 'Addresses on file', value: 0, sub: 'nothing holds one' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Who the checklist thinks the team is</h2>
        {assignees.length === 0 ? (
          <p className="body-2">No task has an assignee yet.</p>
        ) : (
          <Table
            cols={[
              { key: 'n', label: 'Name', className: 'cell-md' },
              { key: 'o', label: 'Open tasks', className: 'cell-xs' },
              { key: 'e', label: 'Contactable', className: 'cell-fill' },
            ]}
            rows={assignees.map((name) => [
              <span key="n">{name}</span>,
              <span key="o">{tasks.filter((t) => t.assignee === name && t.status !== 'done').length}</span>,
              <Tag key="e" color="red" fill="outline" small>
                no address held
              </Tag>,
            ])}
          />
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          These are distinct strings, not people. Two spellings of one name are two rows, which is
          the honest consequence of free-text assignees and is the first thing a real team model
          would fix.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What it would take</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>A team model — 2–3 days.</strong> A collection of organizers and helpers with a
            name, an address and a role, an invitation flow, and a migration that reconciles the
            free-text names already on tasks against it. The reconciliation is the awkward part and
            it does not get easier with time.
          </li>
          <li>
            <strong>The audience — about a day.</strong> A third value on <code>AudienceId</code>{' '}
            and a resolver, exactly as Message Exhibitors needs. The sender, the log and the screen
            already exist.
          </li>
        </ul>
        <p className="body-2">
          Worth noting the cheaper alternative: for six people running a conference, a group in
          somebody&rsquo;s mail client works and costs nothing. This screen earns its keep at
          twenty-plus volunteers, not at six.
        </p>
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Sending.</strong> No compose box, no send, no history.
          </li>
          <li>
            <strong>Team accounts.</strong> Dashboard access is a role claim checked by{' '}
            <code>requireOrganizer</code>; there is no screen that lists who holds it or grants it
            to somebody new.
          </li>
          <li>
            <strong>Per-role permissions.</strong> Whova has granular team roles. Ours is one role:
            organizer or not.
          </li>
          <li>
            <strong>Task notifications.</strong> An assignee is never told they were assigned
            anything.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
