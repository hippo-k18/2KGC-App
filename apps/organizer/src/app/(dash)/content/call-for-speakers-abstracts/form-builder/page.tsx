import Link from 'next/link';
import type { ReactNode } from 'react';
import { publicSiteOrigin, type CallFormFieldDef } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { getCallDoc, listCalls } from '@/lib/calls';
import { listTracks } from '@/lib/data';
import { listSubmissions } from '@/lib/submissions';
import { Banner, NotInputted, PageHeader, Panel, Table, Tabs, Tag } from '../../../ui';
import { ConfirmButton } from '../../../form';
import {
  abstractWordLimits,
  cfpWithClose,
  formatDay,
  joinWords,
  talkMinutesOf,
  typeLabel,
} from '@kgc/scripts/src/lib/cfp-core';
import {
  builtInFields,
  duplicateWarnings,
  type BuiltInField,
} from '@kgc/scripts/src/lib/cfp-form-layout';
import { CFA_BASE } from '../routes';
import { FieldForm } from './field-form';
import { FormPreview } from './form-preview';
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
 *
 * ── The fields the website always draws are shown too (T301) ──────────────
 *
 * Title, description, a resource link and the author's details are on every
 * submission and are not questions anybody writes. The builder used to list
 * only the questions, so nothing on this screen said a link was already asked
 * for, and the live call ended up asking twice. They are now rows in the
 * list, greyed and locked, in the place the website draws them, and a
 * question that looks like one of them carries a warning. The Preview tab
 * draws the whole form.
 */
export default async function FormBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ call?: string; edit?: string; new?: string; view?: string }>;
}) {
  await requireOrganizer();
  const { call: callParam, edit, new: creating, view } = await searchParams;

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
  const previewing = !showForm && view === 'preview';

  /*
   * How many submissions have answered each question. Real counts, read from
   * the submissions themselves — the warning above an edit is only worth
   * printing if the number in it is true.
   */
  const [submissions, doc, tracks] = await Promise.all([
    listSubmissions(callId),
    getCallDoc(callId),
    call.askTrack ? listTracks() : Promise.resolve([]),
  ]);
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

  /* What the website draws around the questions, worked out from the same settings it reads. */
  const trackName = new Map(tracks.map((t) => [t.id, t.name]));
  const layout = builtInFields({
    cfp: call.isCfp,
    sessionTypes: call.sessionTypes,
    askTrack: call.askTrack,
    askTalkLength: call.askTalkLength,
    allowOtherTrack: call.allowOtherTrack,
    trackNames: call.trackIds.map((id) => trackName.get(id)).filter((n): n is string => Boolean(n)),
    abstractMaxWords: abstractWordLimits(doc?.cfp).max,
    talkMinutes: talkMinutesOf(doc?.cfp),
  });
  const warnings = duplicateWarnings(call.form, layout);
  const warned = Object.keys(warnings).length;
  const closeDay = call.isCfp
    ? formatDay(cfpWithClose(doc?.cfp, call.closesAtLocal).closeDate)
    : formatDay(call.closesAtLocal.slice(0, 10));

  const base = `${CFA_BASE}/form-builder?call=${callId}`;
  const publicUrl = `${publicSiteOrigin()}/submit/${callId}`;

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
              {call.form.length} question{call.form.length === 1 ? '' : 's'} of your own
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
          <a key="p" href={publicUrl} target="_blank" rel="noreferrer">
            Public page
          </a>,
        ]}
      />

      {calls.length > 1 && (
        <Panel>
          <form method="get" style={{ alignItems: 'flex-end', display: 'flex', gap: 12 }}>
            {previewing && <input type="hidden" name="view" value="preview" />}
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
            sessionTypes={call.sessionTypes}
            layout={layout}
            questions={call.form.map((f) => ({ id: f.id, prompt: f.prompt, kind: f.kind }))}
          />
        </Panel>
      ) : (
        <>
          <div style={{ marginTop: calls.length > 1 ? 16 : 0 }}>
            <Tabs
              tabs={[
                { label: 'Questions', href: base, active: !previewing },
                { label: 'Preview', href: `${base}&view=preview`, active: previewing },
              ]}
            />
          </div>

          {previewing ? (
            <Panel style={{ marginTop: 16 }}>
              <h2 className="section-header" style={{ marginTop: 0 }}>
                What applicants see
              </h2>
              <FormPreview
                layout={layout}
                fields={call.form}
                sessionTypes={call.sessionTypes}
                closeDay={closeDay}
                publicUrl={publicUrl}
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

              {warned > 0 && (
                <Banner kind="warning">
                  <strong>
                    {warned === 1
                      ? '1 question may ask for something the form already asks for.'
                      : `${warned} questions may ask for something the form already asks for.`}
                  </strong>{' '}
                  Look for the yellow notes below. If it is a different question, you can leave it.
                </Banner>
              )}

              <Panel style={{ marginTop: 16 }}>
                <h2 className="section-header" style={{ marginTop: 0 }}>
                  The form, from top to bottom
                </h2>
                <p className="body-2">
                  Applicants see these in this order. Grey rows are built in: they are on every
                  call&rsquo;s form and can&rsquo;t be changed here. Your questions go between them.{' '}
                  <Link href={`${base}&view=preview`}>See the preview</Link>.
                </p>
                <Table
                  cols={[
                    { key: 'n', label: '#', className: 'cell-xs' },
                    { key: 'q', label: 'Question' },
                    { key: 't', label: 'Answer type', className: 'cell-sm' },
                    { key: 'a', label: 'Answered', className: 'cell-sm' },
                    { key: 'x', label: '', className: 'cell-md' },
                  ]}
                  rowClassName={(i) =>
                    i < layout.before.length || i >= layout.before.length + Math.max(call.form.length, 1)
                      ? 'form-row-builtin'
                      : call.form.length === 0
                        ? 'form-row-empty'
                        : undefined
                  }
                  rows={[
                    ...layout.before.map((f, i) => builtInRow(f, i + 1)),
                    ...(call.form.length === 0
                      ? [
                          [
                            <span key="n" />,
                            <span key="q" className="muted">
                              No questions of your own yet.{' '}
                              <Link href={`${base}&new=1`}>Add the first one</Link>
                            </span>,
                            <span key="t" />,
                            <span key="a" />,
                            <span key="x" />,
                          ],
                        ]
                      : call.form.map((f, i) => [
                          <span key="n" className="muted">
                            {layout.before.length + i + 1}
                          </span>,
                          <QuestionCell key="q" field={f} warnings={warnings[f.id]} />,
                          <span key="t">{KIND_LABEL[f.kind]}</span>,
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
                                  {answeredCount.get(f.id) === 1 ? '' : 's'} have been given to
                                  this. They are <strong>not</strong> deleted and stay on the
                                  submissions. Nobody is asked this question again.
                                </>
                              ) : (
                                <>Nobody has answered this yet.</>
                              )}
                            </ConfirmButton>
                          </span>,
                        ])),
                    ...layout.after.map((f, i) =>
                      builtInRow(f, layout.before.length + call.form.length + i + 1),
                    ),
                  ]}
                />
                <p style={{ margin: '16px 0 0' }}>
                  <Link href={`${base}&new=1`} className="whova-btn-main secondary">
                    + Add question
                  </Link>
                </p>
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
      )}
    </>
  );
}

/** The question types in plain words. */
const KIND_LABEL: Record<CallFormFieldDef['kind'], string> = {
  'short-text': 'Short answer',
  'long-text': 'Paragraph',
  choice: 'Dropdown, pick one',
  'multi-choice': 'Checkboxes, pick any',
  checkbox: 'Single checkbox',
  consent: 'Consent box',
  description: 'Text only, no answer',
};

const BUILT_IN_KIND: Record<BuiltInField['input'], string> = {
  select: 'Dropdown, pick one',
  text: 'Short answer',
  'long-text': 'Paragraph',
  email: 'Email address',
  tel: 'Phone number',
};

/** "Workshops only", "Talks and Panels only". */
function onlyFor(types: readonly string[] | undefined): string | null {
  if (!types?.length) return null;
  return `${joinWords(types.map(typeLabel), 'and')} only`;
}

function builtInRow(f: BuiltInField, n: number): ReactNode[] {
  const only = onlyFor(f.sessionTypes);
  return [
    <span key="n" className="muted">
      {n}
    </span>,
    <span key="q" className="form-row-question">
      <strong>{f.label}</strong>
      <span className="form-row-tags">
        <Tag color="grey" small>
          Built in
        </Tag>
        {f.required && (
          <Tag color="orange" small>
            Required
          </Tag>
        )}
        {only && (
          <Tag color="purple" small>
            {only}
          </Tag>
        )}
      </span>
    </span>,
    <span key="t">{BUILT_IN_KIND[f.input]}</span>,
    <span key="a" className="muted">
      Every submission
    </span>,
    <span key="x" className="muted">
      Always on the form
    </span>,
  ];
}

function QuestionCell({ field: f, warnings }: { field: CallFormFieldDef; warnings?: string[] }) {
  const only = onlyFor(f.sessionTypes);
  return (
    <span className="form-row-question">
      <strong>{f.prompt}</strong>
      <span className="form-row-tags">
        {f.required && (
          <Tag color="orange" small>
            Required
          </Tag>
        )}
        {only && (
          <Tag color="purple" small>
            {only}
          </Tag>
        )}
      </span>
      {f.helpText && <span className="form-row-help">{f.helpText}</span>}
      {(f.options?.length || f.maxLength) && (
        <span className="form-row-help">
          {f.options?.length ? `Options: ${f.options.join(' / ')}` : ''}
          {f.options?.length && f.maxLength ? '. ' : ''}
          {f.maxLength ? `Up to ${f.maxLength} characters` : ''}
        </span>
      )}
      {warnings?.map((w) => (
        <span key={w} className="form-row-warning" role="note">
          ⚠️ {w}
        </span>
      ))}
    </span>
  );
}
