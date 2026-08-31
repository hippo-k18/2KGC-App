import { redirect } from 'next/navigation';
import { EVENT } from '@kgc/shared';
import { currentSession, requirePassphrase } from '@/lib/auth';
import { targetDescription } from '@/lib/firestore';
import { LoginForm } from './login-form';
import { gapNotesVisible } from '@/lib/gap-notes';

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

          {/*
            Operator guidance, not a gap note — but it is written for whoever
            runs this, and a warning banner on the sign-in screen is the first
            thing a demo audience reads. Same flag as the "Not built here"
            panels: `SHOW_GAP_NOTES=1`.
          */}
          {gapNotesVisible() ? (
            <div className="whova-banner warning" style={{ marginTop: 24, marginBottom: 0 }}>
              <div>
                <strong>Email and passphrase.</strong> This is the sign-in design, not a
                placeholder: an allowlist in <code>CONSOLE_ALLOWLIST</code>, a shared secret in{' '}
                <code>CONSOLE_PASSPHRASE</code>, and an HMAC-signed 8-hour session. The allowlist is
                re-checked on every request, so removing an address ends that person&rsquo;s live
                session at the next deploy. What a shared secret cannot give you is an audit
                identity stronger than the address typed beside it — so keep the list short, rotate
                the passphrase after the event, and treat the dashboard URL as a secret. The Admin
                SDK behind this bypasses every security rule.
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
