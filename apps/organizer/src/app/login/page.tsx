import { redirect } from 'next/navigation';
import { EVENT } from '@kgc/shared';
import { currentAccess } from '@/lib/auth';
import { homeFor } from '@/lib/team-core';
import { LoginForm } from './login-form';
import { targetLabel } from '@/lib/firestore';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
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

          <LoginForm />


        </div>
      </div>
    </div>
  );
}
