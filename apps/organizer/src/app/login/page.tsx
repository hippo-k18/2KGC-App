import { redirect } from 'next/navigation';
import { EVENT } from '@kgc/shared';
import { currentSession, requirePassphrase } from '@/lib/auth';
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

          <LoginForm needsPassphrase={requirePassphrase()} />

          <div className="whova-banner warning" style={{ marginTop: 24, marginBottom: 0 }}>
            <div>
              <strong>v0 sign-in.</strong> An email allowlist plus a shared passphrase — no SSO,
              no MFA, and no per-person revocation. Enough to put behind a URL; not the shipping
              design. Google SSO with enforced MFA (DECISIONS.md&nbsp;#5) is what replaces it,
              and it matters because the Admin SDK behind this bypasses every security rule.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
