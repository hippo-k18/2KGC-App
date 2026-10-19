import { redirect } from 'next/navigation';
import { EVENT } from '@kgc/shared';
import { currentAccess } from '@/lib/auth';
import { acceptInvitation } from '@/lib/team';
import { homeFor } from '@/lib/team-core';
import { LoginForm } from './login-form';
import { targetLabel } from '@/lib/firestore';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; invite?: string }>;
}) {
  const { email, invite } = await searchParams;
  const initialEmail = typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
  // Before the redirect below, so the link counts even in a browser that is
  // already signed in as somebody else.
  if (initialEmail && typeof invite === 'string') await acceptInvitation(initialEmail, invite);

  const access = await currentAccess();
  if (access) redirect(homeFor(access.roles));

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="whova-header__blue-bar" />
        <div className="login-body">
          <h1 className="whova-header__feature" style={{ marginTop: 0 }}>
            {EVENT.shortName} EMS
          </h1>
          <p className="body-2" style={{ marginTop: 4, marginBottom: 20 }}>
            {EVENT.name}. {targetLabel()}.
          </p>

          <LoginForm initialEmail={initialEmail} />


        </div>
      </div>
    </div>
  );
}
