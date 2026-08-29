import Link from 'next/link';
import type { ReactNode } from 'react';
import type { TicketAudience } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { listTicketTypes } from '@/lib/commerce';
import { answerSummary, getForm } from '@/lib/question-forms';
import { Banner, GapPanel, PageHeader, Panel, ProgressBar, StatTiles, Table, Tag } from '../ui';
import { deleteQuestionAction, moveQuestionAction, toggleFormAction } from './question-form-actions';
import { QuestionEditor } from './question-form-editor';
import { PUBLIC_PAGE } from './audience-catalogue';

/**
 * Question Forms, for one audience.
 *
 * Whova ships three — 1.2 for attendees, 2.2 for exhibitors, and an unnumbered
 * one for sponsors — and they are the same editor over
 * `questionForms/{audience}`.
 *
 * ── What this screen used to say, and why it is worth recording ────────────
 *
 * The attendee version was an honest gap note explaining that hosted Stripe
 * Checkout supports three custom fields, text and dropdown only, and that
 * asking anything real meant a form on our own page before the redirect. That
 * was correct, and it is what got built: the form renders on `/tickets`, the
 * answers go into `pendingAnswers` keyed by a reference the checkout carries,
 * and the webhook copies them onto the registration once the payment confirms.
 *
 * ── Answers live on the registration, never on the order ───────────────────
 *
 * A dietary requirement belongs to the person. It survives a transferred
 * ticket, it is still true if the order is refunded and re-bought, and it must
 * not be readable by anything querying orders — an `orders` list is the entire
 * buyer database in one query. Putting answers on the order because that is
 * where the form posted is the mistake the old gap note named, and it is not
 * made here.
 *
 * ── The distribution is the deliverable, not the count ─────────────────────
 *
 * "184 people answered" is not actionable. "23 vegetarian, 4 gluten-free, 2
 * kosher" is the number the caterer needs, and it is why this screen tallies
 * rather than offering an export button.
 */
export async function QuestionFormScreen({
  audience,
  title,
  links,
  intro,
  searchParams,
}: {
  audience: TicketAudience;
  title: string;
  links?: ReactNode[];
  /** Audience-specific paragraph above the editor. */
  intro?: ReactNode;
  searchParams: Promise<{ edit?: string }>;
}) {
  await requireOrganizer();

  const { edit } = await searchParams;
  const [form, allTiers] = await Promise.all([getForm(audience), listTicketTypes()]);
  const editing = edit ? form.fields.find((f) => f.id === edit) : undefined;
  const tiers = allTiers.filter((t) => t.audience === audience);
  const tierName = new Map(allTiers.map((t) => [t.id, t.name]));

  const summary = await answerSummary(form.fields);

  return (
    <>
      <PageHeader
        title={title}
        tags={
          form.active ? (
            <Tag color="green" fill="outline">
              asked at checkout
            </Tag>
          ) : (
            <Tag color="grey">not asked</Tag>
          )
        }
        links={[
          <Link key="a" href="/attendees/manage-attendees/analytics-and-exports">
            Analytics &amp; Exports
          </Link>,
          <Link key="t" href="/tickets/ticket-setup/1-1-create-tickets">
            Create Tickets
          </Link>,
          ...(links ?? []),
        ]}
      />

      {form.fields.length === 0 ? (
        <Banner kind="info">
          <strong>No questions yet.</strong> Add one below and switch the form on, and every{' '}
          {audience} buyer is asked before they reach Stripe. Answers land on the registration, not
          on the order — they belong to the person and survive a transferred ticket.
        </Banner>
      ) : form.active ? (
        <Banner kind="info">
          <strong>
            These {form.fields.length} questions are asked on{' '}
            <code>{PUBLIC_PAGE[audience]}</code> before checkout.
          </strong>{' '}
          The buyer answers on our page and then goes to Stripe — hosted Checkout takes at most
          three custom fields and only text or dropdown, which is enough for a t-shirt size and not
          for a consent flow.
        </Banner>
      ) : (
        <Banner kind="warning">
          <strong>The form is written but switched off, so nobody is asked anything.</strong> That
          is the honest default for a half-written question set — turn it on below when the
          questions are the ones you want, because editing a live form is not a draft.
        </Banner>
      )}

      <StatTiles
        tiles={[
          { label: 'Questions', value: form.fields.length, sub: form.active ? 'live' : 'not asked' },
          {
            label: 'Registrations answered',
            value: summary.answered,
            sub: `of ${summary.total}`,
          },
          { label: 'Tiers', value: tiers.length, sub: `${audience} catalogue` },
          {
            label: 'Orphaned answers',
            value: summary.orphaned.reduce((n, o) => n + o.count, 0),
            sub: summary.orphaned.length ? 'questions since removed' : 'none',
          },
        ]}
      />

      <Panel>
        <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>The form</h2>
          {/*
            A POST, not a link. Switching the form on changes what every buyer
            is asked from the next request onward, and a GET that does that is
            one prefetch away from happening by accident.
          */}
          <form action={toggleFormAction}>
            <input type="hidden" name="audience" value={audience} />
            <input type="hidden" name="active" value={form.active ? '0' : '1'} />
            <button
              type="submit"
              className={form.active ? 'whova-btn-main secondary' : 'whova-btn-main'}
              disabled={form.fields.length === 0}
            >
              {form.active ? 'Stop asking' : 'Start asking'}
            </button>
          </form>
        </div>

        <Table
          cols={[
            { key: 'q', label: 'Question', className: 'cell-fill' },
            { key: 'k', label: 'Type', className: 'cell-sm' },
            { key: 't', label: 'Asked of', className: 'cell-md' },
            { key: 'a', label: 'Answers', className: 'cell-md' },
            { key: 'x', label: '', className: 'cell-sm' },
          ]}
          rows={form.fields.map((f, i) => {
            const stats = summary.perField[f.id];
            return [
              <div key="q">
                <div>
                  {f.prompt}
                  {f.required ? (
                    <>
                      {' '}
                      <Tag color="orange" small>
                        required
                      </Tag>
                    </>
                  ) : null}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  <code>{f.id}</code>
                  {f.helpText ? ` · ${f.helpText}` : ''}
                </div>
              </div>,

              <span key="k" style={{ fontSize: 12 }}>
                {f.kind}
                {f.options?.length ? (
                  <div className="muted" style={{ fontSize: 11 }}>
                    {f.options.length} options
                  </div>
                ) : null}
              </span>,

              <span key="t" style={{ fontSize: 12 }}>
                {f.ticketTypeIds?.length ? (
                  f.ticketTypeIds.map((id) => tierName.get(id) ?? id).join(', ')
                ) : (
                  <span className="muted">everybody</span>
                )}
              </span>,

              <div key="a">
                {stats ? (
                  <>
                    <div style={{ fontSize: 13 }}>{stats.count}</div>
                    {stats.values.length > 0 ? (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {stats.values
                          .slice(0, 4)
                          .map((v) => `${v.value} ${v.count}`)
                          .join(' · ')}
                        {stats.values.length > 4 ? ` · +${stats.values.length - 4} more` : ''}
                      </div>
                    ) : (
                      <div className="muted" style={{ fontSize: 11 }}>
                        free text — not tallied
                      </div>
                    )}
                    {summary.answered > 0 && (
                      <ProgressBar pct={Math.min(100, (stats.count / summary.answered) * 100)} />
                    )}
                  </>
                ) : (
                  <span className="muted" style={{ fontSize: 12 }}>
                    none yet
                  </span>
                )}
              </div>,

              <div key="x" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Link href={`?edit=${f.id}`} style={{ fontSize: 12 }}>
                  Edit
                </Link>
                {i > 0 && (
                  <form action={moveQuestionAction}>
                    <input type="hidden" name="audience" value={audience} />
                    <input type="hidden" name="id" value={f.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button type="submit" className="linkish">
                      Move up
                    </button>
                  </form>
                )}
                <form action={deleteQuestionAction}>
                  <input type="hidden" name="audience" value={audience} />
                  <input type="hidden" name="id" value={f.id} />
                  <button type="submit" className="linkish">
                    Remove
                  </button>
                </form>
              </div>,
            ];
          })}
          empty="No questions. Checkout collects a name, an email address and a card, and nothing else."
        />

        {form.updatedAt && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0, marginTop: 10 }}>
            Last changed {form.updatedAt.slice(0, 10)}
            {form.updatedBy ? ` by ${form.updatedBy}` : ''}.
          </p>
        )}
      </Panel>

      {summary.orphaned.length > 0 && (
        <Panel style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Answers to questions you removed</h2>
          <p className="body-2" style={{ marginTop: 0 }}>
            Removing a question does <strong>not</strong> delete the answers already given to it.
            That is deliberate: an organizer removing a question mid-sale is usually fixing the
            form, and silently destroying two hundred people&rsquo;s dietary requirements as a side
            effect of that is not recoverable. They are still on the registrations, under these ids.
          </p>
          <Table
            cols={[
              { key: 'i', label: 'Field id', className: 'cell-md' },
              { key: 'c', label: 'Registrations', className: 'cell-sm' },
              { key: 'n', label: '', className: 'cell-fill' },
            ]}
            rows={summary.orphaned.map((o) => [
              <code key="i">{o.id}</code>,
              o.count,
              <span key="n" className="muted" style={{ fontSize: 12 }}>
                Re-adding a question with this exact id would reconnect them.
              </span>,
            ])}
          />
        </Panel>
      )}

      <Panel style={{ marginTop: 16 }}>
        <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>
            {editing ? `Edit “${editing.prompt}”` : 'Add a question'}
          </h2>
          {editing && (
            <Link href="?" style={{ fontSize: 12 }}>
              Cancel
            </Link>
          )}
        </div>
        {!editing && intro}
        {/*
          Keyed by the field being edited, so React rebuilds the form rather than
          reusing the previous one's state. Without this, clicking Edit on a
          second question leaves the first one's answer type and options in the
          controlled inputs — and saving would write them.
        */}
        <QuestionEditor
          key={editing?.id ?? 'new'}
          audience={audience}
          editing={editing}
          tiers={tiers.map((t) => ({ id: t.id, name: t.name }))}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>No conditional logic.</strong> &ldquo;If vegetarian, ask which kind&rdquo;
            needs a dependency graph, and an open builder with one is the project Whova has been
            iterating on for years. The closed set of types here covers what a conference actually
            asks.
          </li>
          <li>
            <strong>No file-upload question.</strong> An exhibitor logo is the one people always
            want to send. That needs Storage, a size and type check, and a rule letting an
            unauthenticated buyer write exactly once — it is blocker 3 in{' '}
            <code>ROADMAP.md</code>.
          </li>
          <li>
            <strong>Answers are not editable after purchase.</strong> Whova&rsquo;s organizers use
            that constantly, to fix a misspelled company name before the badge prints. The data is
            on the registration and nothing on the attendee screen edits it yet.
          </li>
          <li>
            <strong>Answers are not in the CSV exports.</strong> The exports emit fixed columns;
            arbitrary answers need a dynamic header. The counts above are what this screen gives
            instead, and for a catering headcount they are the more useful shape.
          </li>
          <li>
            <strong>Nothing prunes <code>pendingAnswers</code>.</strong> An abandoned checkout
            leaves a row holding somebody&rsquo;s dietary note. It carries an{' '}
            <code>expiresAt</code> and no scheduled job reads it, because deleting on a schedule
            needs Cloud Functions and the project is on Spark.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
