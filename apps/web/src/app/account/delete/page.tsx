import type { Metadata } from 'next';
import Link from 'next/link';
import { readTicketPass } from '@/lib/ticket-pass';
import { SITE } from '@/lib/site';
import { DeleteAccountForm } from './delete-form';

/**
 * `/account/delete`: delete your KGC app account from the web.
 *
 * Google Play requires a web page where people can delete the account an app
 * created, without installing the app. The app has the same thing under
 * Me › Delete account; both end in `lib/account-deletion-core.ts`, so the list
 * below and what actually happens cannot drift apart.
 *
 * Someone already signed in on this site with their ticket (the cookie set by
 * the session pages) only has to confirm. Anyone else proves the address with
 * an emailed code first.
 */

export const metadata: Metadata = {
  title: 'Delete your app account',
  description: 'Delete your KGC app account: what is removed, what is kept, and how to do it.',
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function DeleteAccountPage() {
  const pass = await readTicketPass();

  return (
    <section>
      <div className="wrap narrow">
        <h1>Delete your app account</h1>
        <p className="lede">
          This removes your account in the KGC conference app. Your ticket is not affected.
        </p>

        <h2>What is deleted</h2>
        <ul>
          <li>Your app account and sign-in.</li>
          <li>Your profile and your entry in the attendee directory.</li>
          <li>Your saved sessions, saved contacts and notifications.</li>
          <li>Your reactions on community posts and your upvotes on session questions.</li>
        </ul>

        <h2>What is kept</h2>
        <ul>
          <li>
            Your community posts, replies, session questions and messages stay, so other people&apos;s
            conversations still make sense. They show as written by &ldquo;Deleted user&rdquo;.
          </li>
          <li>
            Your ticket and the record of your payment, which we must keep for accounting. You can still
            use your ticket at the door.
          </li>
        </ul>
        <p>
          If you buy a ticket again later with the same email address, a new, empty app account is
          created for you.
        </p>

        <h2>Delete it</h2>
        <DeleteAccountForm signedInAs={pass?.email ?? null} />

        <p className="muted" style={{ marginTop: 40 }}>
          To have everything we hold about you removed, including your ticket, see{' '}
          <Link href="/privacy">Privacy</Link> or write to{' '}
          <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
        </p>
      </div>
    </section>
  );
}
