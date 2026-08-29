import { redirect } from 'next/navigation';
import { EVENT } from '@kgc/shared';
import { currentSession, requirePassphrase } from '@/lib/auth';
import { targetDescription } from '@/lib/firestore';
import { LoginForm } from './login-form';
import { DemoPanel } from '@/components/demo-panel';
import { demoCredentials, demoMode } from '@/lib/demo-mode';
import { gapNotesVisible } from '@/lib/gap-notes';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentSession()) redirect('/content/basics');

  // Read here rather than inside the panel: `demo-mode.ts` is `server-only` and
  // the panel is a client component, so the values have to cross as props.
  const credentials = demoMode() ? demoCredentials() : null;

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
            The demo credentials sit inside the card, directly under the fields
            they belong to. They used to render in a panel fixed to the bottom
            of the viewport, which on a short window covered the sign-in button
            itself — a hint that hides the control it describes.
          */}
          {credentials ? (
            <DemoPanel
              title="Organizer sign-in"
              note="Click a value to copy it. Both fields are required."
              rows={[
                { label: 'Email', value: credentials.email },
                { label: 'Password', value: credentials.passphrase, mono: true },
              ]}
            />
          ) : null}

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
