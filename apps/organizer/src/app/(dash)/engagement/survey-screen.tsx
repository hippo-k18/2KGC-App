import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { feedbackTargets, listSurveys, summarise, type SurveyRow } from '@/lib/surveys';
import { Banner, EmptyState, PageHeader, Panel, ProgressBar, StatTiles, Table, Tag } from '../ui';
import { setSurveyStatusAction } from './survey-actions';
import { SurveyForm } from './survey-form';

/**
 * One screen, rendered twice: Surveys and Session Feedback.
 *
 * They differ only in whether the surveys they list carry a `sessionId`. Whova
 * has two products; we have one shape and a filter, which is why the results
 * view below is identical for both.
 *
 * ── Results are never attributed ────────────────────────────────────────────
 *
 * A response is keyed by uid so nobody can answer twice, which means the server
 * *could* say who wrote a comment. Nothing here does, and `surveys.ts` has no
 * function that would let it. Feedback a speaker can trace back to a named
 * attendee is feedback nobody gives honestly, and candour is the entire value
 * of a session survey.
 */
export async function SurveyScreen({
  mode,
  title,
  intro,
  searchParams,
}: {
  mode: 'event' | 'session';
  title: string;
  intro: string;
  searchParams: Promise<{ edit?: string; new?: string; results?: string }>;
}) {
  await requireOrganizer();
  const { edit, new: creating, results } = await searchParams;

  const [all, sessions] = await Promise.all([listSurveys(), feedbackTargets()]);
  const scoped = all.filter((s) => (mode === 'session' ? Boolean(s.sessionId) : !s.sessionId));

  const editing = edit ? scoped.find((s) => s.id === edit) : undefined;
  const showForm = Boolean(creating) || Boolean(editing);
  const summary = results ? await summarise(results) : null;

  const base = mode === 'session' ? '/engagement/session-feedback' : '/engagement/surveys';
  const live = scoped.filter((s) => s.open).length;
  const responses = scoped.reduce((n, s) => n + s.responseCount, 0);

  return (
    <>
      <PageHeader
        title={title}
        tags={<Tag color="blue">{scoped.length} total</Tag>}
        actions={
          showForm || summary ? (
            <Link href={base} className="whova-btn-main secondary">
              Back to list
            </Link>
          ) : (
            <Link href="?new=1" className="whova-btn-main">
              + New survey
            </Link>
          )
        }
        links={[
          <Link key="o" href={mode === 'session' ? '/engagement/surveys' : '/engagement/session-feedback'}>
            {mode === 'session' ? 'Event surveys' : 'Session feedback'}
          </Link>,
        ]}
      />

      <Banner kind="info">{intro}</Banner>

      <StatTiles
        tiles={[
          { label: 'Surveys', value: scoped.length, sub: `${live} collecting now` },
          { label: 'Responses', value: responses, sub: 'across all of them' },
          {
            label: 'Drafts',
            value: scoped.filter((s) => s.status === 'draft').length,
            sub: 'not visible to attendees',
          },
        ]}
      />

      {summary ? (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>
            {summary.survey.title} — {summary.responses}{' '}
            {summary.responses === 1 ? 'response' : 'responses'}
          </h2>
          {summary.responses === 0 ? (
            <p className="muted">Nobody has answered yet.</p>
          ) : (
            summary.questions.map((q) => (
              <div key={q.id} style={{ borderTop: '1px solid var(--hairline)', paddingTop: 12, marginTop: 12 }}>
                <strong style={{ fontSize: 13 }}>{q.prompt}</strong>
                <span className="muted" style={{ fontSize: 11 }}>
                  {' '}
                  · {q.answered} answered
                </span>

                {q.kind === 'rating' && q.average !== undefined && (
                  <div style={{ marginTop: 6 }}>
                    <strong style={{ fontSize: 22 }}>{q.average.toFixed(1)}</strong>
                    <span className="muted" style={{ fontSize: 12 }}> out of 5</span>
                    <ProgressBar pct={(q.average / 5) * 100} />
                  </div>
                )}

                {q.distribution && (
                  <Table
                    cols={[
                      { key: 'o', label: 'Option', className: 'cell-fill' },
                      { key: 'n', label: 'Chose it', className: 'cell-sm' },
                    ]}
                    rows={q.distribution.map((d) => [d.label, d.count])}
                  />
                )}

                {q.comments && (
                  <ul style={{ fontSize: 13, lineHeight: 1.6, paddingLeft: 18 }}>
                    {q.comments.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
            No answer here is attributed to anyone. Responses are keyed by uid so nobody can answer
            twice, and this screen deliberately cannot join the two — feedback a speaker can trace
            back to a name is feedback nobody gives honestly.
          </p>
        </Panel>
      ) : showForm ? (
        <Panel>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>
            {editing ? `Edit “${editing.title}”` : 'New survey'}
          </h2>
          <SurveyForm existing={editing} sessions={sessions} fixedSession={mode === 'session'} />
        </Panel>
      ) : (
        <Panel>
          {scoped.length === 0 ? (
            <EmptyState
              icon="◔"
              action={
                <Link href="?new=1" className="whova-btn-main">
                  Create the first one
                </Link>
              }
            >
              <strong>Nothing yet.</strong>
              <p className="muted" style={{ marginTop: 6 }}>
                {mode === 'session'
                  ? 'Session feedback is the single most useful thing to collect — it decides next year’s programme.'
                  : 'An event survey goes out after the conference and asks about the whole thing.'}
              </p>
            </EmptyState>
          ) : (
            <Table
              cols={[
                { key: 't', label: 'Survey', className: 'cell-fill' },
                { key: 'q', label: 'Questions', className: 'cell-xs' },
                { key: 'r', label: 'Responses', className: 'cell-sm' },
                { key: 's', label: 'Status', className: 'cell-sm' },
                { key: 'a', label: '', className: 'cell-md' },
              ]}
              rows={scoped.map((s: SurveyRow) => [
                <span key="t">
                  <strong>{s.title}</strong>
                  {s.sessionTitle && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      {s.sessionTitle}
                    </div>
                  )}
                </span>,
                s.questionCount,
                s.responseCount === 0 ? (
                  <span key="r" className="muted">
                    none
                  </span>
                ) : (
                  <Link key="r" href={`?results=${s.id}`}>
                    {s.responseCount}
                  </Link>
                ),
                <Tag
                  key="s"
                  color={s.open ? 'green' : s.status === 'draft' ? 'grey' : 'orange'}
                  fill="outline"
                  small
                >
                  {s.open ? 'collecting' : s.status}
                </Tag>,
                <div key="a" style={{ display: 'flex', gap: 10 }}>
                  <Link href={`?results=${s.id}`} style={{ fontSize: 12 }}>
                    Results
                  </Link>
                  <Link href={`?edit=${s.id}`} style={{ fontSize: 12 }}>
                    Edit
                  </Link>
                  <form action={setSurveyStatusAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={s.status === 'published' ? 'draft' : 'published'}
                    />
                    <button
                      type="submit"
                      style={{
                        background: 'none',
                        border: 0,
                        color: 'var(--link)',
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: 0,
                      }}
                    >
                      {s.status === 'published' ? 'Unpublish' : 'Publish'}
                    </button>
                  </form>
                </div>,
              ])}
            />
          )}
        </Panel>
      )}

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>The attendee side.</strong> Nothing in the app renders a survey yet, so nothing
            can answer one. The shape and the results view are ready for it.
          </li>
          <li>
            <strong>Prompting after a session.</strong> The moment feedback actually gets given is a
            push notification as somebody walks out of the room. Push exists in the dashboard
            (Admin SDK) and the app cannot receive it — Expo Go has no push.
          </li>
          <li>
            <strong>Required questions.</strong> The field is on the model and the parser always
            writes <code>false</code>, because a required question on a voluntary survey mostly
            produces abandoned ones.
          </li>
        </ul>
      </Panel>
    </>
  );
}
