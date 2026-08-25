import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { Banner, PageHeader, Panel } from '../../../ui';
import { PostEventForm } from '../access-form';

export const dynamic = 'force-dynamic';

/**
 * Tools › Admin Control › Post Event Access Duration.
 *
 * ── ⚠️ This setting is stored and not yet enforced ──────────────────────────
 *
 * Saving it writes a real document that a real screen reads back. What it does
 * **not** do is close the app: `firestore.rules` gates on the `registered`
 * custom claim and knows nothing about a date, and no client checks one.
 *
 * That is said in the banner rather than left for somebody to discover. An
 * access control that looks configured and is not is worse than one that is
 * plainly absent — the organizer stops thinking about it, and the data stays
 * open. This is exactly the defect class AGENTS.md names as this codebase's
 * recurring one.
 */
export default async function PostEventAccessPage() {
  await requireOrganizer();
  const s = await readSettings(SETTINGS_KEYS.access, {
    postEventDays: 30,
    postEventReadOnly: false,
  });

  return (
    <>
      <PageHeader
        title="Post Event Access Duration"
        links={[
          <Link key="c" href="/tools/admin-control/code-access-control">
            Code Access Control
          </Link>,
        ]}
      />

      <Banner kind="warning">
        <strong>Saved, but not yet enforced.</strong> This records the intent and nothing acts on
        it — <code>firestore.rules</code> gates on the <code>registered</code> claim and knows
        nothing about a date. Closing access for real means either expiring that claim or adding a
        date check to the rules, and until one of those exists the app stays open indefinitely
        after the event.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>How long attendees keep the app</h2>
        <PostEventForm
          postEventDays={Number(s.postEventDays ?? 30)}
          postEventReadOnly={Boolean(s.postEventReadOnly)}
        />
        {s.updatedBy && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Last changed by {s.updatedBy}
            {s.updatedAt ? ` on ${s.updatedAt.slice(0, 10)}` : ''}.
          </p>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>What it would take to enforce</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>Expiring the claim.</strong> `registered` is minted by{' '}
            <code>scripts/set-claims.ts</code> and never expires. Firebase custom claims have no
            TTL, so this means a scheduled job that re-mints or strips them — which needs a
            trusted server, and the project already has two.
          </li>
          <li>
            <strong>Or a date in the rules.</strong> Cheaper: compare{' '}
            <code>request.time</code> against a published cutoff. It costs a rule and a test, and
            it cannot be changed from this screen without a deploy — which is arguably the right
            trade for an access control.
          </li>
          <li>
            <strong>Read-only mode</strong> is the same problem, one layer down: every write rule
            would need the same date check.
          </li>
        </ul>
      </Panel>
    </>
  );
}
