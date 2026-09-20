import Link from 'next/link';
import { EVENT } from '@kgc/shared';
import { memberForLink } from '@/lib/team';
import { MIN_MEMBER_PASSPHRASE, ROLE_LABELS } from '@/lib/team-core';
import { SetPassphraseForm } from './set-form';

export const dynamic = 'force-dynamic';

/**
 * Where a team member's emailed link lands: choose a passphrase, once.
 *
 * Outside the `(dash)` group and behind no session, because the person opening
 * it cannot have one yet. The link is the credential — signed, three days long
 * and spent on first use (`lib/team.ts`). Opening the page spends nothing; only
 * a saved passphrase does, so a mail scanner that fetches the URL ahead of the
 * reader does not burn it.
 */
export default async function SetPassphrasePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const member = await memberForLink(token);

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="whova-header__blue-bar" />
        <div className="login-body">
          <h1 className="whova-header__feature" style={{ marginTop: 0 }}>
            {EVENT.shortName} EMS
          </h1>

          {member ? (
            <>
              <p className="body-2" style={{ marginTop: 4, marginBottom: 20 }}>
                Choose a passphrase for <strong>{member.email}</strong>. Your access:{' '}
                {member.roles.map((r) => ROLE_LABELS[r].label).join(', ')}.
              </p>
              <SetPassphraseForm token={token} email={member.email} minLength={MIN_MEMBER_PASSPHRASE} />
            </>
          ) : (
            <>
              <p className="body-2" style={{ marginTop: 4, marginBottom: 20 }}>
                This link has been used or has expired. Ask an owner for a new one.
              </p>
              <Link className="whova-btn-main primary" href="/login">
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
