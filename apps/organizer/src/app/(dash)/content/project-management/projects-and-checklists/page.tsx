import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { getTask, listProjects, nextStatus, projectNames, type TaskRow } from '@/lib/planning';
import { ROUTES } from '@/lib/nav';
import { EmptyState, PageHeader, Panel, ProgressBar, StatTiles, Tag } from '../../../ui';
import { advanceTaskAction } from './actions';
import { TaskForm } from './task-form';

export const dynamic = 'force-dynamic';

/**
 * Content › Project Management › Projects & Checklists.
 *
 * The one screen in this console that is not about attendees at all. It is
 * about the six people running the event remembering to book the AV company.
 *
 * ── Grouped by project, not sorted into a table ─────────────────────────────
 *
 * Every other list screen here is a `whova-table`. A checklist is not a list of
 * records to search — it is a set of small lists you work through, and the
 * useful signal is "how far through is Venue?" rather than "show me every task
 * due Tuesday". So: a bar per project, tasks underneath.
 *
 * ── `assignee` is free text ─────────────────────────────────────────────────
 *
 * Half the people on a conference checklist are volunteers and suppliers who
 * will never hold an account. Requiring a uid would mean the tasks that most
 * need an owner are the ones that cannot have one.
 */

const STATUS_COLOR: Record<TaskRow['status'], 'grey' | 'blue' | 'green' | 'red'> = {
  todo: 'grey',
  doing: 'blue',
  done: 'green',
  blocked: 'red',
};

function TaskLine({ task }: { task: TaskRow }) {
  return (
    <div
      style={{
        alignItems: 'flex-start',
        borderBottom: '1px solid var(--hairline)',
        display: 'flex',
        gap: 12,
        opacity: task.status === 'done' ? 0.6 : 1,
        padding: '9px 0',
      }}
    >
      {/*
        A form, not a link. Advancing a task is a write, and a GET that changes
        state is one link prefetch away from marking a whole checklist done.
      */}
      <form action={advanceTaskAction}>
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="next" value={nextStatus(task.status)} />
        <button
          type="submit"
          title={`Mark ${nextStatus(task.status)}`}
          style={{
            background: 'none',
            border: 0,
            cursor: 'pointer',
            fontSize: 12,
            padding: 0,
            width: 62,
            textAlign: 'left',
          }}
        >
          <Tag color={STATUS_COLOR[task.status]} fill="outline" small>
            {task.status}
          </Tag>
        </button>
      </form>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            textDecoration: task.status === 'done' ? 'line-through' : undefined,
          }}
        >
          {task.title}
        </div>
        {task.notes && (
          <div className="muted" style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
            {task.notes}
          </div>
        )}
      </div>

      <div className="muted" style={{ fontSize: 11, width: 130 }}>
        {task.assignee || <em>unassigned</em>}
      </div>

      <div style={{ fontSize: 11, width: 110 }}>
        {task.dueOn ? (
          task.overdue ? (
            <Tag color="red" fill="outline" small>
              overdue {task.dueOn}
            </Tag>
          ) : (
            <span className="muted">due {task.dueOn}</span>
          )
        ) : (
          <span className="muted">—</span>
        )}
      </div>

      <Link href={`?edit=${task.id}`} style={{ fontSize: 12 }}>
        Edit
      </Link>
    </div>
  );
}

export default async function ProjectsAndChecklistsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>;
}) {
  await requireOrganizer();
  const { edit, new: creating } = await searchParams;

  const [projects, names] = await Promise.all([listProjects(), projectNames()]);
  const editing = edit ? await getTask(edit) : null;
  const showForm = Boolean(creating) || Boolean(editing);

  const all = projects.flatMap((p) => p.tasks);
  const overdue = all.filter((t) => t.overdue).length;
  const blocked = all.filter((t) => t.status === 'blocked').length;
  const done = all.filter((t) => t.status === 'done').length;

  const editingRow = editing
    ? projects.flatMap((p) => p.tasks).find((t) => t.id === editing.id)
    : undefined;

  return (
    <>
      <PageHeader
        title="Projects &amp; Checklists"
        tags={
          overdue > 0 ? (
            <Tag color="red" fill="solid">
              {overdue} overdue
            </Tag>
          ) : blocked > 0 ? (
            <Tag color="orange" fill="outline">
              {blocked} blocked
            </Tag>
          ) : (
            <Tag color="green" fill="outline">
              on track
            </Tag>
          )
        }
        actions={
          !showForm ? (
            <Link href="?new=1" className="whova-btn-main">
              + Add task
            </Link>
          ) : (
            <Link href="/content/project-management/projects-and-checklists" className="whova-btn-main secondary">
              Back to list
            </Link>
          )
        }
        links={[
          <Link key="c" href={ROUTES.conflictCheck}>
            Conflict Check
          </Link>,
          <Link key="p" href="/publish">
            Publish checks
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Tasks', value: all.length, sub: `${done} done` },
          { label: 'Overdue', value: overdue, sub: overdue === 0 ? 'nothing late' : 'past their due date' },
          { label: 'Blocked', value: blocked, sub: 'waiting on something' },
          { label: 'Projects', value: projects.length, sub: 'free-text buckets' },
        ]}
      />

      {showForm ? (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>
            {editingRow ? `Edit “${editingRow.title}”` : 'New task'}
          </h2>
          <TaskForm existing={editingRow} projects={names} />
        </Panel>
      ) : projects.length === 0 ? (
        <Panel>
          <EmptyState
            icon="☑"
            action={
              <Link href="?new=1" className="whova-btn-main">
                Add the first task
              </Link>
            }
          >
            <strong>No checklist yet.</strong>
            <p className="muted" style={{ marginTop: 6 }}>
              This is the organizing team&rsquo;s own list — venue, AV, catering, signage,
              volunteers. Nothing here is visible to attendees.
            </p>
          </EmptyState>
        </Panel>
      ) : (
        projects.map((p) => (
          <Panel key={p.name} style={{ marginBottom: 14 }}>
            <div style={{ alignItems: 'center', display: 'flex', gap: 12, marginBottom: 6 }}>
              <h2 style={{ fontSize: 15, margin: 0 }}>{p.name}</h2>
              <span className="muted" style={{ fontSize: 12 }}>
                {p.done} of {p.total} done
              </span>
              {p.blocked > 0 && (
                <Tag color="red" fill="outline" small>
                  {p.blocked} blocked
                </Tag>
              )}
            </div>
            <ProgressBar pct={p.pct} />
            <div style={{ marginTop: 8 }}>
              {p.tasks.map((t) => (
                <TaskLine key={t.id} task={t} />
              ))}
            </div>
          </Panel>
        ))
      )}

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Templates.</strong> Whova ships a starter checklist for a first-time organizer,
            which is genuinely the most valuable part of their version — and it is content, not
            code. Worth writing once KGC&rsquo;s own list has settled.
          </li>
          <li>
            <strong>Reminders.</strong> An overdue task shows here and nowhere else. Emailing an
            assignee needs the address, and assignees are free text precisely because half of them
            have no account.
          </li>
          <li>
            <strong>Dependencies between tasks.</strong> <code>blocked</code> is a status, not a
            link to what is blocking it.
          </li>
        </ul>
      </Panel>
    </>
  );
}
