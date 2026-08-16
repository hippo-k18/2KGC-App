import { redirect } from 'next/navigation';
import { EVENT } from '@kgc/shared';
import { currentSession } from '@/lib/auth';
import { targetDescription } from '@/lib/firestore';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentSession()) redirect('/sessions');

  return (
    <main>
      <h1>{EVENT.name} — organizer console</h1>
      <p className="muted">Writing to {targetDescription()}.</p>

      <LoginForm />

      <div className="banner">
        <strong>v0 sign-in.</strong> Email allowlist only — no password, no SSO, no MFA. This is
        adequate for a tool bound to localhost during Phase 0 and for nothing else.{' '}
        <strong>Google SSO with enforced MFA (DECISIONS.md #5) must land before this is reachable
        over a network</strong>, because the Admin SDK behind it bypasses every security rule.
      </div>
    </main>
  );
}
