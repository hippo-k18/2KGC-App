import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BIO_MAX } from '@kgc/scripts/src/lib/speaker-portal-core';
import { SITE } from '@/lib/site';
import { loadPortal, markOpened } from '@/lib/speaker-portal';
import { saveSpeakerProfileAction } from './actions';

export const metadata: Metadata = {
  // Same treatment as `/order/{token}`, `/consent/{token}` and `/review/{token}`:
  // this URL is a capability, and a capability in a search index is a capability
  // anybody can exercise.
  title: 'Your speaker profile',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

/** Per-request, and it has to be. Reads a capability token. One speaker's draft profile must never be served to another from a cache. */
export const dynamic = 'force-dynamic';

/**
 * `/speaker/{token}` — a speaker filling in their own profile, with no account.
 *
 * ── Why this route exists ───────────────────────────────────────────────────
 *
 * Bios and headshots were collected by email, one thread per speaker, and the
 * dashboard could only ever count what was missing. The link is the same
 * mechanism `/consent/{token}` uses for the same people and for the same
 * reason: a speaker has no Firebase account, most never buy a ticket, and a URL
 * keyed by the speaker id would be forgeable because speaker ids are derived
 * from the name and company. `scripts/src/lib/speaker-token.ts` carries the
 * argument and the threat it accepts.
 *
 * ── Nothing here publishes ──────────────────────────────────────────────────
 *
 * Every field on this page is held as a draft until an organizer approves it on
 * Speaker Manager. The page says so twice — above the form and beside the
 * button — because a speaker who believes this goes straight to the website
 * writes differently, and because the first question after pressing the button
 * is "is it live yet".
 *
 * ── The photo is a link, not an upload ──────────────────────────────────────
 *
 * Files enter this project through one path, `apps/organizer/src/lib/uploads.ts`,
 * which holds the Admin SDK credential for the storage bucket and lives in the
 * dashboard. The public website has no writer for that bucket and should not
 * grow one for this form: it would be a second, weaker authority over the same
 * bytes, reachable by anybody holding a forwarded link. So a speaker sends a
 * link, and the page says what to do instead if all they have is a file.
 */
export default async function SpeakerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ r?: string; e?: string }>;
}) {
  const { token: raw } = await params;
  const { r, e } = await searchParams;
  const token = decodeURIComponent(raw);

  const ctx = await loadPortal(token);
  /*
   * One 404 for a forged token, an expired one, a revoked one and a speaker who
   * is no longer on the programme. Three of the four would otherwise answer "is
   * this person still speaking?" to whoever holds an old URL.
   */
  if (!ctx) notFound();

  await markOpened(ctx.speakerId);

  const justSaved = r === 'saved';
  const failed = r === 'error';
  const invalid = r === 'invalid';
  const problems = invalid && e ? e.split('|').filter(Boolean) : [];
  const waiting = ctx.state?.status === 'submitted';
  const approved = ctx.state?.status === 'approved';

  return (
    <section>
      <div className="wrap narrow" style={{ paddingBottom: 48 }}>
        <p className="eyebrow">
          {SITE.shortName} {SITE.year} speakers
        </p>
        <h1>Your speaker profile</h1>

        <p className="lede">
          {ctx.name}, this is what we hold for you. Change anything that is wrong and send it back.
        </p>

        {failed && (
          <p className="notice bad" role="alert">
            <strong>That did not save.</strong> Nothing has been recorded. Try again, and if it
            keeps failing email <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
          </p>
        )}

        {invalid && (
          <p className="notice warn" role="alert">
            <strong>Nothing was saved.</strong>{' '}
            {problems.length ? problems.join(' ') : 'Check the boxes below and send it again.'}
          </p>
        )}

        {justSaved && (
          <p className="notice" role="status">
            <strong>Thank you, that is with the organizers.</strong> Nothing has changed on the
            website yet. It appears once somebody has read it.
          </p>
        )}

        {waiting && !justSaved && (
          <p className="notice" role="status">
            You sent us a profile and it is waiting to be read. Sending again replaces it.
          </p>
        )}

        {approved && !justSaved && (
          <p className="notice" role="status">
            Your last profile was approved and is live. You can still change it.
          </p>
        )}

        {ctx.sessions.length > 0 && (
          <>
            <h2>Your sessions</h2>
            <ul style={{ listStyle: 'none', margin: '0 0 28px', padding: 0 }}>
              {ctx.sessions.map((s) => (
                <li key={s.id} style={{ borderTop: '1px solid rgba(0,0,0,.12)', padding: '10px 0' }}>
                  <strong>{s.title}</strong>
                  {s.startsAtLocal ? (
                    <div className="muted" style={{ fontSize: 14 }}>
                      {s.day} · {s.startsAtLocal.slice(11, 16)}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}

        <form action={saveSpeakerProfileAction}>
          <input type="hidden" name="token" value={token} />

          <div className="field">
            <label htmlFor="title">Job title</label>
            <input id="title" name="title" maxLength={200} defaultValue={ctx.title ?? ''} />
          </div>

          <div className="field">
            <label htmlFor="company">Company or university</label>
            <input id="company" name="company" maxLength={200} defaultValue={ctx.company ?? ''} />
          </div>

          <div className="field">
            <label htmlFor="bio">Bio</label>
            <textarea id="bio" name="bio" rows={8} maxLength={BIO_MAX} defaultValue={ctx.bio ?? ''} />
            <p className="hint">
              A short paragraph in the third person. This is what appears under your name on the
              agenda and in the app.
            </p>
          </div>

          <div className="field">
            <label htmlFor="photoURL">Photo</label>
            <input
              id="photoURL"
              name="photoURL"
              type="url"
              maxLength={500}
              placeholder="https://"
              defaultValue={ctx.photoURL ?? ''}
            />
            <p className="hint">
              A link to a headshot, square if you have one. The organizers save the picture
              themselves rather than linking to it, so the website never loads it from somewhere
              else. If all you have is a file, email it to{' '}
              <a href={`mailto:${SITE.contactEmail}?subject=Speaker photo`}>{SITE.contactEmail}</a>{' '}
              and we will add it for you.
            </p>
          </div>

          <div className="field">
            <label htmlFor="linkedin">LinkedIn</label>
            <input
              id="linkedin"
              name="linkedin"
              type="url"
              maxLength={500}
              placeholder="https://"
              defaultValue={ctx.social?.linkedin ?? ''}
            />
          </div>

          <div className="field">
            <label htmlFor="x">X</label>
            <input
              id="x"
              name="x"
              type="url"
              maxLength={500}
              placeholder="https://"
              defaultValue={ctx.social?.x ?? ''}
            />
          </div>

          <div className="field">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              name="website"
              type="url"
              maxLength={500}
              placeholder="https://"
              defaultValue={ctx.social?.website ?? ''}
            />
          </div>

          {ctx.sessions.map((s) => (
            <div className="field" key={s.id}>
              <label htmlFor={`slides-${s.id}`}>Slides for &ldquo;{s.title}&rdquo;</label>
              <input
                id={`slides-${s.id}`}
                name={`slides:${s.id}`}
                type="url"
                maxLength={500}
                placeholder="https://"
                defaultValue={s.slidesUrl ?? ''}
              />
            </div>
          ))}

          {ctx.sessions.length > 0 && (
            <p className="hint" style={{ marginTop: -8 }}>
              A link to your deck, wherever it lives. Attendees see it on the session.
            </p>
          )}

          <button type="submit" className="btn btn-primary">
            Send to the organizers
          </button>
          <p className="muted" style={{ marginTop: 16 }}>
            Nothing changes on the website or in the app until one of the organizers has read this.
            Clearing a box asks them to remove what is there now.
          </p>
        </form>

        <p className="muted" style={{ marginTop: 32 }}>
          This link is yours. Anybody who has it can change what we hold about you, so please do not
          forward it. Something wrong that is not on this page? Email{' '}
          <a href={`mailto:${SITE.contactEmail}?subject=Speaker profile`}>{SITE.contactEmail}</a>.
        </p>

        <p className="muted">
          <Link href="/">
            Back to {SITE.shortName} {SITE.year}
          </Link>
        </p>
      </div>
    </section>
  );
}
