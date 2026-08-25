'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { TaskRow } from '@/lib/planning';
import { saveTaskAction, type TaskState } from './actions';

/**
 * Create or edit one checklist task.
 *
 * ── Project is a free-text field with suggestions, not a dropdown ───────────
 *
 * `TaskDoc.project` is a plain string and grouping is by exact match, so two
 * spellings make two columns. A `<datalist>` fixes the common case — the
 * existing names are one keystroke away — without the cost a real project
 * entity would carry: a second collection, a create-project screen, and a
 * migration for the tasks already filed under a name.
 *
 * ── Assignee has no picker on purpose ──────────────────────────────────────
 *
 * The model stores a name rather than a uid because the AV company, the venue
 * contact and the volunteer who owns the badge printer have no accounts here. A
 * dropdown of registered users would leave exactly those rows unassignable.
 */
export function TaskForm({ existing, projects }: { existing?: TaskRow; projects: string[] }) {
  const [state, action] = useActionState<TaskState, FormData>(saveTaskAction, {});

  return (
    <form action={action}>
      {existing && <input type="hidden" name="id" value={existing.id} />}

      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="ok">{state.message}</p>}

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="title">
          Task
        </label>
        <input
          id="title"
          name="title"
          required
          defaultValue={existing?.title}
          placeholder="Confirm AV company for the main hall"
          maxLength={140}
        />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="project">
          Project
        </label>
        <input
          id="project"
          name="project"
          required
          list="task-projects"
          defaultValue={existing?.project}
          placeholder="Venue &amp; AV"
          maxLength={60}
          style={{ maxWidth: 320 }}
        />
        <datalist id="task-projects">
          {projects.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <p className="muted" style={{ fontSize: 12 }}>
          The list groups by this exactly, so &ldquo;Venue&rdquo; and &ldquo;venue&rdquo; make two
          groups. Pick an existing name where one fits.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="assignee">
          Owner
        </label>
        <input
          id="assignee"
          name="assignee"
          defaultValue={existing?.assignee}
          placeholder="Priya (volunteer lead)"
          maxLength={80}
          style={{ maxWidth: 320 }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          A name, not an account. Suppliers and volunteers never sign in here and they own half the
          list. Blank means nobody has picked it up.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="dueOn">
          Due
        </label>
        <input
          id="dueOn"
          name="dueOn"
          type="date"
          defaultValue={existing?.dueOn}
          style={{ maxWidth: 200 }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          A calendar day, stored as one — not a timestamp, so it does not shift for whoever opens
          the screen. Blank for no deadline.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="status">
          Status
        </label>
        <select id="status" name="status" defaultValue={existing?.status ?? 'todo'} style={{ maxWidth: 200 }}>
          <option value="todo">To do</option>
          <option value="doing">In progress</option>
          <option value="done">Done</option>
          <option value="blocked">Blocked</option>
        </select>
        <p className="muted" style={{ fontSize: 12 }}>
          <strong>Blocked</strong> is not a slower <em>to do</em> — it means somebody outside this
          list has to act first, and it is counted separately per project so those rows do not sit
          in the queue looking like work nobody started.
        </p>
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={existing?.notes}
          placeholder="Quote is in; needs a PO number before they will hold the date."
        />
      </div>

      <div className="whova-form-row">
        <label className="whova-form-label" htmlFor="order">
          Sort order
        </label>
        <input
          id="order"
          name="order"
          type="number"
          defaultValue={existing?.order ?? 50}
          style={{ maxWidth: 120 }}
        />
        <p className="muted" style={{ fontSize: 12 }}>
          Lower sorts first within the project. There is no drag-and-drop here.
        </p>
      </div>

      <SaveButton editing={Boolean(existing)} />
    </form>
  );
}

function SaveButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="whova-btn-main" disabled={pending}>
      {pending ? 'Saving…' : editing ? 'Save changes' : 'Add task'}
    </button>
  );
}
