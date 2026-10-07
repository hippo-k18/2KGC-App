import { redirect } from 'next/navigation';
import { acceptBlogInvitation, currentViewer } from '@/lib/blog/auth';
import { blogPath } from '@/lib/blog/paths';
import { SignInForm } from './sign-in-form';

export const metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; invite?: string }>;
}) {
  const { email, invite } = await searchParams;
  // Before the redirect below, so the link counts even in a browser that is
  // already signed in as somebody else.
  if (typeof email === 'string' && typeof invite === 'string') await acceptBlogInvitation(email, invite);
  if (await currentViewer()) redirect(await blogPath('/write'));
  return (
    <div className="st-signin">
      <SignInForm initialEmail={typeof email === 'string' ? email.slice(0, 254) : ''} />
    </div>
  );
}
