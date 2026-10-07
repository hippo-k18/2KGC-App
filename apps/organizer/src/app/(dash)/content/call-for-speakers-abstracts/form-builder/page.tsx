import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listCalls } from '@/lib/calls';
import { listSubmissions } from '@/lib/submissions';
import { Banner, NotInputted, PageHeader, Panel, Table, Tag } from '../../../ui';
import { ConfirmButton } from '../../../form';
import { CFA_BASE } from '../routes';
import { FieldForm } from './field-form';
import { deleteFieldAction, moveFieldAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Content › Call For Speakers/Abstracts › Submission form.
 *
 * ── Whova freezes this form. This one versions it ──────────────────────────
 *
 * *"If at least 1 submission has been made you cannot edit the submission form
 * anymore"* — Whova's own research notes call that a known pain point, and it is
 * brutal for a call that runs for months. `CFA-PLAN.md` §1.2 takes the other
 * road, which costs one field: every submission stores the `formVersion` its
 * answers were given against, so a question can be added at any time and a
 * question can be reworded, and the answers stay legible under whatever was
 * actually asked.
 *
 * Adding a question is not a breaking change — earlier submissions simply have
 * no answer for it, which is something to chase rather than something to
 * reject. Changing a question's type or options, or removing it, is, and mints a
 * new version with the old definition archived on the call.
 *
 * ── Field ids are assigned once ────────────────────────────────────────────
 *
 * ⚠️ Derived from the prompt on create and preserved exactly on every edit,
 * because the id is what an answer is stored under. `lib/question-forms.ts`
 * already does this for registration questions and this follows it rather than
 * inventing a second scheme — the builder and the validator are literally the
 * same module (`@kgc/scripts/src/lib/question-forms.ts`).
 */
export default async function FormBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ call?: string; edit?: string; new?: string }>;
}) {
  await requireOrganizer();
  const { call: callParam, edit, new: creating } = await searchParams;

  const calls = await listCalls();
  if (calls.length === 0) {
    return (
      <>
        <PageHeader
          title="Submission form"
          links={[
            <Link key="b" href={CFA_BASE}>
              Call setup
            </Link>,
          ]}
        />
        <Panel>
          <NotInputted
            what="call for abstracts"
            action={
              <Link className="whova-btn-main primary" href={`${CFA_BASE}?new=1`}>
                Create one
              </Link>
            }
          />
        </Panel>
      </>
    );
  }

  const callId = callParam && calls.some((c) => c.id === callParam) ? callParam : calls[0].id;
  const call = calls.find((c) => c.id === callId)!;
  const editing = edit ? call.form.find((f) => f.id === edit) : undefined;
  const showForm = Boolean(creating) || Boolean(editing);

  /*
   * How many submissions have answered each question. Real counts, read from
   * the submissions themselves — the warning above an edit is only worth
   * printing if the number in it is true.
   */
  const submissions = await listSubmissions(callId);
  const answeredCount = new Map<string, number>();
  for (const s of submissions) {
    for (const id of Object.keys(s.answers)) {
      answeredCount.set(id, (answeredCount.get(id) ?? 0) + 1);
    }
  }

  /*
   * Answers stored under an id no current question uses — a question that was
   * removed. Surfaced rather than hidden: they are somebody's data, and the
   * screen that removed the question is the screen that should admit they are
   * still there.
   */
  const known = new Set(call.form.map((f) => f.id));
  const orphaned = [...answeredCount.entries()]
    .filter(([id]) => !known.has(id))
    .sort((a, b) => b[1] - a[1]);

  const base = `${CFA_BASE}/form-builder?call=${callId}`;

  return (
    <>
      <PageHeader
        title="Submission form"
        info={
          <>
            <strong>The form is versioned, not frozen</strong>
            <p>
              Adding a question is always allowed. Changing or removing one starts a new version,
              and earlier submissions keep the version they answered.
            </p>
          </>
        }
        tags={
          <>
            <Tag color="blue">v{call.formVersion}</Tag>
            <Tag color="grey">
              {call.form.length} question{call.form.length === 1 ? '' : 's'}
            </Tag>
          </>
        }
        actions={
          showForm ? (
            <Link href={base} className="whova-btn-main secondary">
              Back
            </Link>
          ) : (
            <Link href={`${base}&new=1`} className="whova-btn-main primary">
              + Add question
            </Link>
          )
        }
        links={[
          <Link key="b" href={CFA_BASE}>
            Call setup
          </Link>,
          <Link key="s" href={`${CFA_BASE}/submissions?call=${callId}`}>
            Submissions
          </Link>,
        ]}
      />

      {calls.length > 1 && (
        <Panel>
          <form method="get" style={{ alignItems: 'flex-end', display: 'flex', gap: 12 }}>
            <div className="whova-form-group" style={{ margin: 0 }}>
              <label className="whova-form-label" htmlFor="call">
                Call
              </label>
              <select
                id="call"
                name="call"
                defaultValue={callId}
                className="whova-text-input whova-input-lg"
              >
                {calls.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="whova-btn-main secondary">
              Switch
            </button>
          </form>
        </Panel>
      )}

      {showForm ? (
        <Panel style={{ marginTop: calls.length > 1 ? 16 : 0 }}>
          <h2 className="section-header" style={{ marginTop: 0 }}>
            {editing ? `Edit “${editing.prompt}”` : 'New question'}
          </h2>
          <FieldForm
            callId={callId}
            existing={editing}
            answered={editing ? (answeredCount.get(editing.id) ?? 0) : 0}
          />
        </Panel>
      ) : (
        <>
          {submissions.length > 0 && (
            /*
             * Operational: it changes what the organizer does in the next
             * minute — whether they are willing to make this edit at all.
             */
            <Banner kind="warning">
              <strong>
                {submissions.length} submission{submissions.length === 1 ? '' : 's'} already
                answered this form.
              </strong>{' '}
              Adding a question is safe. Changing or removing one publishes version{' '}
              {call.formVersion + 1}, and every answer already given stays readable under the
              version it was given to. Nothing is deleted, and nobody has to resubmit.
            </Banner>
          )}

          <Panel style={{ marginTop: 16 }}>
            {call.form.length === 0 ? (
              <>
                <NotInputted
                  what="questions"
                  action={
                    <Link className="whova-btn-main secondary" href={`${base}&new=1`}>
                      Add the first one
                    </Link>
                  }
                />
                <p className="body-2" style={{ marginBottom: 0 }}>
                  A call with no questions still collects a title, an abstract, a track, a session
                  type and the author&rsquo;s details. Those are on every submission and are not
                  questions you write. Everything here is what you want to ask on top of that.
                </p>
              </>
            ) : (
              <Table
                cols={[
                  { key: 'q', label: 'Question' },
                  { key: 't', label: 'Type', className: 'cell-sm' },
                  { key: 'a', label: 'Answered', className: 'cell-sm' },
                  { key: 'x', label: '', className: 'cell-md' },
                ]}
                rows={call.form.map((f, i) => [
                  <span key="q">
                    <strong>{f.prompt}</strong>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                      <code>{f.id}</code>
                      {f.required ? ' · required' : ''}
                      {f.maxLength ? ` · max ${f.maxLength} characters` : ''}
                      {f.options?.length ? ` · ${f.options.join(' / ')}` : ''}
                    </span>
                  </span>,
                  <span key="t">{f.kind}</span>,
                  <span key="a">
                    {f.kind === 'description' ? (
                      <span className="muted">n/a</span>
                    ) : (
                      (answeredCount.get(f.id) ?? 0)
                    )}
                  </span>,
                  <span key="x" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    <Link href={`${base}&edit=${f.id}`}>Edit</Link>
                    {i > 0 && (
                      <form action={moveFieldAction}>
                        <input type="hidden" name="callId" value={callId} />
                        <input type="hidden" name="id" value={f.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button type="submit" className="linkish">
                          Up
                        </button>
                      </form>
                    )}
                    {i < call.form.length - 1 && (
                      <form action={moveFieldAction}>
                        <input type="hidden" name="callId" value={callId} />
                        <input type="hidden" name="id" value={f.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button type="submit" className="linkish">
                          Down
                        </button>
                      </form>
                    )}
                    <ConfirmButton
                      action={deleteFieldAction}
                      hidden={{ callId, id: f.id }}
                      label="Remove"
                      confirmLabel="Remove the question"
                    >
                      {(answeredCount.get(f.id) ?? 0) > 0 ? (
                        <>
                          {answeredCount.get(f.id)} answer
                          {answeredCount.get(f.id) === 1 ? '' : 's'} have been given to this. They
                          are <strong>not</strong> deleted and stay on the submissions. Nobody is
                          asked this question again.
                        </>
                      ) : (
                        <>Nobody has answered this yet.</>
                      )}
                    </ConfirmButton>
                  </span>,
                ])}
              />
            )}
          </Panel>

          {orphaned.length > 0 && (
            <Panel style={{ marginTop: 16 }}>
              <h2 className="section-header" style={{ marginTop: 0 }}>
                Answers to questions that are no longer asked
              </h2>
              <p className="body-2">
                These were given to questions that have since been removed. They stay on the
                submissions and in the export.
              </p>
              <Table
                cols={[
                  { key: 'i', label: 'Field id' },
                  { key: 'n', label: 'Answers', className: 'cell-sm' },
                ]}
                rows={orphaned.map(([id, n]) => [<code key="i">{id}</code>, <span key="n">{n}</span>])}
              />
            </Panel>
          )}
        </>
      )}
    </>
  );
}
