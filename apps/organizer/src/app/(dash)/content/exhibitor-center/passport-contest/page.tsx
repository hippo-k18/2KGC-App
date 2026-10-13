import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { exhibitorSummary } from '@/lib/exhibitors';
import { NotInputted, PageHeader, Panel, StatTiles } from '../../../ui';

export const dynamic = 'force-dynamic';

/**
 * Content › Exhibitor Center › Passport Contest.
 *
 * Attendees collect a stamp at each booth and a full passport enters a prize
 * draw. It exists to push footfall into the quiet corners of the hall, which is
 * what the exhibitors on those stands are paying for.
 *
 * Three things are missing and only the third is cheap: a **scan path per
 * booth** (the check-in scanner reads `qrSecret` and writes an event-door
 * check-in — a booth stamp is a different scan, by a different person, in the
 * other direction); a **stamps subcollection** with a rule that lets a booth
 * write one without letting an attendee stamp their own passport, which is the
 * whole security question; and a prize somebody has to buy.
 *
 * It is downstream of lead scanning — the same scan pointed at a different
 * collection — so the honest order is that one first.
 */
export default async function PassportContestPage() {
  await requireOrganizer();
  const s = await exhibitorSummary();

  return (
    <>
      <PageHeader
        title="Passport Contest"
        info={
          <>
            <strong>Not available yet</strong>
            <p>
              Booths cannot scan attendees to give a stamp yet, so the contest cannot run.
            </p>
          </>
        }
        links={[
          <Link key="e" href="/content/exhibitor-center/exhibitor-manager">
            Exhibitor Manager
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Exhibitors', value: s.confirmed, sub: 'confirmed' },
          {
            label: 'Booths assigned',
            value: s.confirmed - s.withoutBooth,
            sub: `${s.withoutBooth} without`,
          },
          { label: 'Stamps collected', value: 0, sub: 'none yet' },
        ]}
      />

      <Panel>
        <NotInputted what="passport stamps" />
      </Panel>
    </>
  );
}
