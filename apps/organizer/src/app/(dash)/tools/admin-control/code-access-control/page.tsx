import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { SETTINGS_KEYS, readSettings } from '@/lib/settings';
import { Banner, PageHeader, Panel } from '../../../ui';
import { CodeAccessForm } from '../access-form';

export const dynamic = 'force-dynamic';

/**
 * Tools › Admin Control › Code Access Control.
 *
 * ── Why KGC does not actually need this ─────────────────────────────────────
 *
 * Whova's event code is how an attendee proves they belong when the guest list
 * is loose. Ours is not loose: the gate is the `registered` custom claim, minted
 * only for people who hold a ticket, and `firestore.rules` reads it on every
 * request. A shared code would be *weaker* than what already runs — one string,
 * shared by a thousand people, that leaks the first time somebody photographs a
 * slide.
 *
 * So this screen stores the setting, explains that the real gate is elsewhere,
 * and does not pretend the code is doing security work.
 */
export default async function CodeAccessControlPage() {
  await requireOrganizer();
  const s = await readSettings(SETTINGS_KEYS.access, {
    eventCode: '',
    codeRequired: false,
  });

  return (
    <>
      <PageHeader
        title="Code Access Control"
        links={[
          <Link key="p" href="/tools/admin-control/post-event-access-duration">
            Post Event Access
          </Link>,
        ]}
      />

      <Banner kind="info">
        <strong>The real gate is not this code.</strong> Access is decided by the{' '}
        <code>registered</code> custom claim, minted only for ticket holders and checked by{' '}
        <code>firestore.rules</code> on every request. A shared code is one string a thousand
        people know — useful as a convenience on a slide, not as security, and it is not treated as
        security here.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Event code</h2>
        <CodeAccessForm
          eventCode={String(s.eventCode ?? '')}
          codeRequired={Boolean(s.codeRequired)}
        />
        {s.updatedBy && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Last changed by {s.updatedBy}
            {s.updatedAt ? ` on ${s.updatedAt.slice(0, 10)}` : ''}.
          </p>
        )}
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>How somebody actually gets in</h2>
        <ol className="muted" style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 18, marginBottom: 0 }}>
          <li>They buy a ticket, which writes a registration keyed by their email address.</li>
          <li>
            They sign in to the app with that same address and enter the <strong>claim code</strong>{' '}
            from their confirmation — which is per-person, not shared, and is the thing this screen
            is often confused with.
          </li>
          <li>
            The <code>registered</code> claim is minted for them, and{' '}
            <code>firestore.rules</code> starts allowing reads.
          </li>
        </ol>
        <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          ⚠️ Step 3 is currently a manual run of <code>scripts/set-claims.ts</code>. Automating it
          needs a Cloud Function, which needs the Blaze plan.
        </p>
      </Panel>
    </>
  );
}
