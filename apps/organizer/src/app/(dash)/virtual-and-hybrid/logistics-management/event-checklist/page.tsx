import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listProjects } from '@/lib/planning';
import { EmptyState, PageHeader, Panel, ProgressBar, StatTiles, Table, Tag } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Virtual & Hybrid › Logistics Management › Event Checklist.
 *
 * The one screen in this cluster that is neither streaming nor a cut: an
 * event checklist is just as useful for an in-person conference, and this
 * project already has one. `tasks` is a real collection with a real editor at
 * Content › Project Management › Projects & Checklists.
 *
 * So this reads that same data and links to it rather than growing a second
 * checklist. Two task lists in one dashboard is how a venue booking ends up
 * ticked in one place and outstanding in the other — and Whova's own nav has
 * this problem, which is why the summary here is explicitly read-only.
 */
export default async function EventChecklistPage() {
  await requireOrganizer();
  const projects = await listProjects();

  const total = projects.reduce((n, p) => n + p.total, 0);
  const done = projects.reduce((n, p) => n + p.done, 0);
  const blocked = projects.reduce((n, p) => n + p.blocked, 0);
  const overdue = projects.reduce((n, p) => n + p.tasks.filter((t) => t.overdue).length, 0);

  return (
    <>
      <PageHeader
        title="Event Checklist"
        tags={overdue > 0 ? <Tag color="red" fill="solid">{overdue} overdue</Tag> : undefined}
        actions={
          <Link href="/content/project-management/projects-and-checklists" className="whova-btn-main">
            Open Projects &amp; Checklists
          </Link>
        }
        links={[
          <Link key="e" href="/virtual-and-hybrid/logistics-management/emergency-manager">
            Emergency Manager
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Tasks', value: total, sub: `${projects.length} projects` },
          { label: 'Done', value: done, sub: total === 0 ? '—' : `${Math.round((done / total) * 100)}%` },
          { label: 'Blocked', value: blocked, sub: 'need somebody else' },
          { label: 'Overdue', value: overdue, sub: 'due date passed' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Progress by project</h2>
        {projects.length === 0 ? (
          <EmptyState
            action={
              <Link href="/content/project-management/projects-and-checklists" className="whova-btn-main">
                Add the first task
              </Link>
            }
          >
            No tasks yet. The checklist lives in Projects &amp; Checklists — this screen only
            reports on it.
          </EmptyState>
        ) : (
          <Table
            cols={[
              { key: 'p', label: 'Project', className: 'cell-md' },
              { key: 'b', label: 'Progress', className: 'cell-fill' },
              { key: 'n', label: 'Done', className: 'cell-sm' },
            ]}
            rows={projects.map((p) => [
              <span key="p">
                {p.name}
                {p.blocked > 0 ? (
                  <>
                    {' '}
                    <Tag color="red" small>
                      {p.blocked} blocked
                    </Tag>
                  </>
                ) : null}
              </span>,
              <ProgressBar key="b" pct={p.pct} />,
              `${p.done} / ${p.total}`,
            ])}
          />
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Editing, deliberately.</strong> Every add, tick and reassignment happens in{' '}
            <Link href="/content/project-management/projects-and-checklists">
              Projects &amp; Checklists
            </Link>
            . A second editor over the same <code>tasks</code> collection would be a second place
            for the same job to be half-finished.
          </li>
          <li>
            <strong>Whova&rsquo;s starter checklist.</strong> Their version seeds forty generic
            tasks (&ldquo;upload your logo&rdquo;, &ldquo;invite speakers&rdquo;) on event creation.
            Ours starts empty because a list of tasks nobody chose is a list nobody reads.
          </li>
          <li>
            <strong>Reminders.</strong> Overdue is computed and shown; nothing emails the assignee
            about it. The sender exists, so this is a scheduled job — which needs somewhere to run
            on a schedule, and that is the Blaze plan.
          </li>
        </ul>
      </Panel>
    </>
  );
}
