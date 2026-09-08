import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { exhibitorSummary } from '@/lib/exhibitors';
import { NotInputted, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Exhibitor Center › Exhibitor Trivia.
 *
 * A question per booth that an attendee can only answer by visiting it, with
 * correct answers feeding a leaderboard. Nothing stores one.
 *
 * The blocker is not the question bank, which is a subcollection and an editor.
 * It is that each exhibitor authors their own, and exhibitors have a contact
 * email and no account — so this needs an exhibitor-facing login, which is a
 * second auth surface with its own rules, recovery flow and attack surface.
 * That is a product decision rather than a screen, and it is why the counts
 * below are of booths rather than of questions.
 */
export default async function ExhibitorTriviaPage() {
  await requireOrganizer();
  const summary = await exhibitorSummary();

  return (
    <>
      <PageHeader
        title="Exhibitor Trivia"
        info={
          <>
            <strong>Needs an exhibitor login</strong>
            <p>
              Each question is written by the company on the stand, and exhibitors hold a contact
              email rather than an account. A second sign-in surface has to exist before there is
              anywhere for the questions to come from.
            </p>
          </>
        }
        links={[
          <Link key="e" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
          <Link key="p" href="/content/exhibitor-center/passport-contest">
            Passport Contest
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Booths', value: summary.confirmed, sub: 'confirmed, each would set a question' },
          { label: 'Questions', value: '—', sub: 'not inputted yet' },
        ]}
      />

      <Panel>
        <NotInputted what="trivia questions" />
      </Panel>
    </>
  );
}
