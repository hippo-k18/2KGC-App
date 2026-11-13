import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BIO_MAX } from '@kgc/scripts/src/lib/speaker-portal-core';
import { SITE } from '@/lib/site';
import { loadPortal, markOpened } from '@/lib/speaker-portal';
import { KeepTypedForm } from '@/components/keep-typed-form';
import { FocusOnMount } from '@/components/focus-on-mount';
import { SendButton } from '@/components/send-button';
import { saveSpeakerProfileAction } from './actions';
import { PhotoField } from './photo-field';

/**
 * The dashboard's upload endpoint, which the speaker's browser posts the file
 * to. `DASHBOARD_PUBLIC_ORIGIN` points a local check or staging elsewhere.
 */
function photoUploadUrl(): string {
  const origin = (process.env.DASHBOARD_PUBLIC_ORIGIN ?? 'https://dashboard.knowledgegraph.tech').replace(/\/$/, '');
  return `${origin}/api/speaker-photo`;
}

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
 * ── The photo is uploaded to the dashboard, not to this site ────────────────
 *
 * Files enter this project through one path, `apps/organizer/src/lib/uploads.ts`,
 * which holds the Admin SDK credential for the storage bucket and lives in the
 * dashboard. The public website has no writer for that bucket and should not
 * grow one for this form: it would be a second, weaker authority over the same
 * bytes. Until T379 that meant a link only, and a speaker with a file emailed
 * it. Now the speaker's browser posts the file straight to the dashboard's
 * `/api/speaker-photo` with this page's token, which checks the token the way
 * `openPortal` does, and the URL it returns goes in the photo box. It is still
 * a draft: it reaches the website when an organizer approves the profile.
 *
 * ── A deploy while the page is open ─────────────────────────────────────────
 *
 * Every build changes the server action's id, so a page opened before a deploy
 * posts an id the new server does not know. `KeepTypedForm` catches that,
 * keeps what was typed, reloads once and fills it back in (T379).
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
  const result = failed || invalid;
  const renderedAt = Date.now();

  /*
   * A send that saved replaces the form with a confirmation (T405, owner). A
   * notice on a long form was missed: the browser keeps its scroll position
   * after the action redirects, and a speaker pressed Send a dozen times
   * without seeing anything change.
   */
  if (justSaved) {
    const sessionTitles = [
      ...ctx.submissions.map((sub) => sub.details?.title || sub.title),
      ...ctx.sessions.map((sess) => sess.title),
    ].filter(Boolean);
    return (
      <section>
        <div className="wrap narrow cfp-page" style={{ paddingBottom: 48 }}>
          <Sent
            key={renderedAt}
            token={token}
            name={ctx.name}
            title={ctx.sent?.title ?? ctx.title}
            company={ctx.sent?.company ?? ctx.company}
            sessions={[...new Set(sessionTitles)]}
          />
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="wrap narrow cfp-page" style={{ paddingBottom: 48 }}>
        <p className="eyebrow">
          {SITE.shortName} {SITE.year} speakers
        </p>
        <h1>Your speaker profile</h1>

        <p className="lede">
          {ctx.name}, this is what we hold for you. Change anything that is wrong and send it back.
        </p>

        {/*
          A refused or failed send, here and again above the button (T405).
          The button is at the bottom of a long page and the browser stays
          there after the redirect. This one is scrolled to and focused; the
          copy by the button is for whoever is still looking there, and for
          a browser without JavaScript.
        */}
        {result && (
          <div id="send-result" tabIndex={-1} style={{ outline: 'none' }}>
            <SendResult failed={failed} invalid={invalid} problems={problems} live />
            {/* A fresh key per render, so the next result focuses again even when the URL is the same. */}
            <FocusOnMount key={renderedAt} id="send-result" />
          </div>
        )}

        {waiting && (
          <p className="notice" role="status">
            You sent us a profile and it is waiting to be read. Sending again replaces it.
          </p>
        )}

        {approved && (
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

        {/* Keeps what was typed when a save is refused (T280 B#2). */}
        <KeepTypedForm action={saveSpeakerProfileAction}>
          <input type="hidden" name="token" value={token} />

          {ctx.submissions.map((sub) => (
            /*
             * What E2 asks for beyond the profile (T249): the final title and
             * description, and for a workshop the outline and install list.
             * Prefilled from what they submitted, or from what they sent last.
             */
            <fieldset key={sub.id} style={{ border: 0, margin: '0 0 28px', padding: 0 }}>
              <h2>Your session</h2>
              {sub.receivedAtMs ? (
                <p className="notice" role="status">
                  We have your session details. Sending again replaces them.
                </p>
              ) : null}
              <div className="field">
                <label htmlFor={`d-title-${sub.id}`}>Final title *</label>
                <input
                  id={`d-title-${sub.id}`}
                  name={`detail:${sub.id}:title`}
                  maxLength={200}
                  defaultValue={sub.details?.title ?? sub.title}
                />
              </div>
              <div className="field">
                <label htmlFor={`d-desc-${sub.id}`}>Session description *</label>
                <textarea
                  id={`d-desc-${sub.id}`}
                  name={`detail:${sub.id}:description`}
                  rows={8}
                  maxLength={5000}
                  defaultValue={sub.details?.description ?? sub.abstract}
                />
                <p className="hint">What attendees read on the agenda. Your abstract is here to start from.</p>
              </div>
              {sub.workshop && (
                <>
                  <div className="field">
                    <label htmlFor={`d-outline-${sub.id}`}>Workshop outline *</label>
                    <textarea
                      id={`d-outline-${sub.id}`}
                      name={`detail:${sub.id}:outline`}
                      rows={6}
                      maxLength={5000}
                      defaultValue={sub.details?.outline ?? ''}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`d-install-${sub.id}`}>What attendees must install or bring *</label>
                    <textarea
                      id={`d-install-${sub.id}`}
                      name={`detail:${sub.id}:install`}
                      rows={4}
                      maxLength={5000}
                      defaultValue={sub.details?.install ?? ''}
                    />
                    <p className="hint">Write &ldquo;nothing&rdquo; if they need nothing.</p>
                  </div>
                </>
              )}
            </fieldset>
          ))}

          {ctx.submissions.length > 0 && <h2>About you</h2>}

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

          <PhotoField
            token={token}
            uploadUrl={photoUploadUrl()}
            initialUrl={ctx.photoURL ?? ''}
            contactEmail={SITE.contactEmail}
          />

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

          {result && <SendResult failed={failed} invalid={invalid} problems={problems} />}
          <SendButton>Send to the organizers</SendButton>
          <p className="muted" style={{ marginTop: 16 }}>
            Nothing changes on the website or in the app until one of the organizers has read this.
            Clearing a box asks them to remove what is there now.
          </p>
        </KeepTypedForm>

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

/**
 * The page after a send that saved (T405). The form is not rendered: a
 * heading that takes focus, what they sent read back, and a way back to the
 * form. "Make another change" is a plain link to the page without `?r=`.
 */
function Sent({
  token,
  name,
  title,
  company,
  sessions,
}: {
  token: string;
  name: string;
  title?: string;
  company?: string;
  sessions: string[];
}) {
  const rows: [string, string][] = [
    ['Name', name],
    ['Job title', title || 'Not given'],
    ['Company or university', company || 'Not given'],
    ...sessions.map((t, i): [string, string] => [sessions.length > 1 ? `Session ${i + 1}` : 'Session', t]),
  ];
  return (
    <div style={{ paddingTop: 8 }}>
      <p className="eyebrow">
        {SITE.shortName} {SITE.year} speakers
      </p>
      <div
        aria-hidden="true"
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: '#1f8a4c',
          color: '#fff',
          display: 'grid',
          placeItems: 'center',
          fontSize: 32,
          fontWeight: 700,
          margin: '8px 0 16px',
        }}
      >
        ✓
      </div>
      <h1 id="send-result" tabIndex={-1} style={{ outline: 'none' }}>
        Thank you, we have your profile
      </h1>
      <p className="lede" role="status">
        The organizers will read it before anything changes on the website. You can close this page.
      </p>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)',
          gap: '10px 24px',
          margin: '28px 0 32px',
          padding: '20px 0',
          borderTop: '1px solid rgba(0,0,0,.12)',
          borderBottom: '1px solid rgba(0,0,0,.12)',
        }}
      >
        {rows.map(([k, v]) => (
          <div key={k + v} style={{ display: 'contents' }}>
            <dt className="muted">{k}</dt>
            <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{v}</dd>
          </div>
        ))}
      </dl>
      <Link href={`/speaker/${encodeURIComponent(token)}`} className="btn btn-outline">
        Make another change
      </Link>
      <FocusOnMount id="send-result" top />
    </div>
  );
}

/**
 * A refused or failed send. Twice on the page (T405); only the copy at the
 * top is a live region, so a screen reader hears it once.
 */
function SendResult({
  failed,
  invalid,
  problems,
  live = false,
}: {
  failed: boolean;
  invalid: boolean;
  problems: string[];
  live?: boolean;
}) {
  if (failed) {
    return (
      <p className="notice bad" role={live ? 'alert' : undefined}>
        <strong>That did not save.</strong> Nothing has been recorded. Try again, and if it
        keeps failing email <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
      </p>
    );
  }
  if (invalid) {
    return (
      <div className="notice warn" role={live ? 'alert' : undefined}>
        <strong>Nothing was saved.</strong>{' '}
        {problems.length > 1 ? (
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : problems.length ? (
          problems[0]
        ) : (
          'Check the boxes and send it again.'
        )}
      </div>
    );
  }
  return null;
}
