import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { listSessions, listSpeakers } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { Banner, PageHeader, Panel, StatTiles } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Call For Speakers/Abstracts.
 *
 * The biggest single unbuilt item in the Content tab, and the one most likely to
 * be underestimated, so the sizing below is deliberate rather than a shrug.
 *
 * It is not a screen. It is a **second public surface** with its own audience
 * (people who are not attendees and hold no ticket), its own auth model, its own
 * state machine (submitted → under review → accepted / rejected / withdrawn),
 * its own multi-reviewer scoring, and a path from an accepted abstract into a
 * `sessions` document without losing the authorship. Every one of those is a
 * week-shaped thing.
 *
 * The counts below are the *output* of a call for papers that already happened
 * somewhere else — currently a spreadsheet and an inbox — imported through
 * `npm run import:whova`. That is what this screen would replace.
 */
export default async function CallForSpeakersPage() {
  await requireOrganizer();

  const [sessions, speakers] = await Promise.all([listSessions(), listSpeakers()]);

  return (
    <>
      <PageHeader
        title="Call For Speakers/Abstracts"
        links={[
          <Link key="s" href={ROUTES.sessionManager}>
            Session Manager
          </Link>,
          <Link key="k" href={ROUTES.speakerManager}>
            Speaker Manager
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Not built, and it is the largest item in this tab.</strong> Nothing here accepts a
        submission. The agenda below was authored elsewhere and imported — which is exactly the
        workflow a call for papers would replace, and the reason it can wait.
      </Banner>

      <StatTiles
        tiles={[
          { label: 'Sessions', value: sessions.length, sub: 'authored elsewhere, imported' },
          { label: 'Speakers', value: speakers.length, sub: 'the accepted end of a real CFP' },
          { label: 'Submissions', value: '—', sub: 'no collection exists' },
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What Whova does</h2>
        <p className="body-2">
          A public submission portal with a configurable form, a submissions dashboard, reviewer
          assignment with scores and comments, accept/reject decisions with templated notification,
          and a one-click promotion of an accepted abstract into a session on the agenda. The
          submission form locks after the first submission arrives, because changing the questions
          under people who have already answered them makes the answers incomparable.
        </p>

        <h2 className="section-header">The four pieces, sized separately</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>The public portal — 4–5 days.</strong> A form in <code>apps/web</code>, a
            <code>submissions</code> collection, and an identity for someone who is not a registered attendee.
            The <code>registered</code> custom claim is the gate for everything in{' '}
            <code>firestore.rules</code>, and a prospective speaker does not have it, so this needs
            either a capability-token link (the pattern <code>/order/&#123;token&#125;</code>{' '}
            already proves) or an Admin-SDK write from a server route. It cannot be a normal client
            write.
          </li>
          <li>
            <strong>Reviewer assignment — 4–5 days.</strong> Reviewers are a third class of user,
            alongside organizers and attendees. Assignment, conflict-of-interest exclusion, a score
            per reviewer per submission, and a view that hides other reviewers&rsquo; scores until
            you have entered yours — which is a rule, not a UI preference.
          </li>
          <li>
            <strong>Decisions and notification — 3–4 days.</strong> The state machine, the
            accept/reject mail (the bulk sender exists, so this is the cheapest piece), and the
            promotion of an accepted abstract into a <code>sessions</code> document plus a <code>speakers</code> document
            without duplicating a speaker who already exists.
          </li>
          <li>
            <strong>The form builder — 3–5 days,</strong> and it is the same builder Question Forms
            needs. Building one of them makes the other much cheaper; building them separately is
            how a codebase ends up with two.
          </li>
        </ul>

        <p className="body-2">
          <strong>15–20 days all in</strong>, which matches the estimate in{' '}
          <code>whova-rebuild/research/02-organizer-backend.md</code> §34. For one conference a year
          whose programme committee already runs on a shared spreadsheet, this is the clearest case
          on the whole parity list for not building it.
        </p>
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Everything on this screen.</strong> No submissions collection, no reviewer role,
            no public form, no decision workflow.
          </li>
          <li>
            <strong>The import that stands in for it.</strong>{' '}
            <code>npm run import:whova</code> reads a CSV of accepted talks and writes sessions and
            speakers. It is real, it is used, and it starts after every decision has already been
            made in a spreadsheet.
          </li>
          <li>
            <strong>Anonymous review.</strong> Worth naming because it is the requirement that
            usually forces a rewrite: hiding author names during scoring changes what the
            submissions collection may contain and who may read which fields, and it is much cheaper
            designed in than added.
          </li>
        </ul>
      </Panel>
    </>
  );
}
