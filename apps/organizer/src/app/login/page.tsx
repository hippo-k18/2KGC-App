import { redirect } from 'next/navigation';
import { EVENT } from '@kgc/shared';
import { currentSession } from '@/lib/auth';
import { targetDescription } from '@/lib/firestore';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentSession()) redirect('/content/basics');

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="whova-header__blue-bar" />
        <div className="login-body">
          <h1 className="whova-header__feature" style={{ marginTop: 0 }}>
            {EVENT.shortName} EMS
          </h1>
          <p className="body-2" style={{ marginTop: 4, marginBottom: 20 }}>
            {EVENT.name}. Writing to {targetDescription()}.
          </p>

          <LoginForm />

          <div className="whova-banner danger" style={{ marginTop: 24, marginBottom: 0 }}>
            <div>
              <strong>v0 sign-in.</strong> Email allowlist only — no password, no SSO, no MFA.
              Adequate for a tool bound to localhost during Phase&nbsp;0 and for nothing else.
              Google SSO with enforced MFA (DECISIONS.md&nbsp;#5) must land before this is
              reachable over a network, because the Admin SDK behind it bypasses every security
              rule.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
