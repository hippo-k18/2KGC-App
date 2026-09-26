import { redirect } from 'next/navigation';
import { currentViewer } from '@/lib/blog/auth';
import { blogPath } from '@/lib/blog/paths';
import { SignInForm } from './sign-in-form';

export const metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  if (await currentViewer()) redirect(await blogPath('/write'));
  const { email } = await searchParams;
  return (
    <div className="st-signin">
      <SignInForm initialEmail={typeof email === 'string' ? email.slice(0, 254) : ''} />
    </div>
  );
}
