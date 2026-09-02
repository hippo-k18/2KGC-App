import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { readConsentToken } from '@kgc/scripts/src/lib/consent-token';
import { SITE } from '@/lib/site';
import { loadSigningContext } from '../store';
import { signConsentAction } from './actions';

export const metadata: Metadata = {
  // Same treatment as `/order/{token}` and `/u/{token}`: this URL is a
  // capability, and a capability in a search index is a capability anybody can
  // exercise. `noarchive` keeps it out of the caches too.
  title: 'Consent form',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export const dynamic = 'force-dynamic';

/**
 * `/consent/{token}` — signing a release without an account.
 *
 * ── Why this route exists ───────────────────────────────────────────────────
 *
 * An attendee signs in the app, where `firestore.rules` can prove who they are
 * from their uid. A speaker cannot: `SpeakerDoc` is authored from the programme
 * committee's CSV, most speakers never buy a ticket, and there is no account
 * anywhere for the rules to check. The choice was an account nobody wants for
 * one signature, or a link — and a link keyed by the speaker id would be
 * forgeable, because speaker ids are derived from the name and company (see
 * `scripts/src/lib/ids.ts`), so anybody holding the public speaker list could
 * compute one and sign in somebody else's name.
 *
 * So it is the mechanism `/order/{token}` already uses, third time out:
 * HMAC-SHA256 over a base64url body, minted by the dashboard, verified here.
 * `scripts/src/lib/consent-token.ts` carries the argument; there is deliberately
 * no second scheme.
 *
 * ── What this page will not do ──────────────────────────────────────────────
 *
 * It does not pre-tick anything. It does not carry a "sign for a colleague"
 * field. It does not accept the version or the wording from the browser — both
 * are read from Firestore at the moment of writing, so a stale tab cannot
 * record agreement to text that was replaced. And it does not offer a way to
 * withdraw, because withdrawal is not built: a signature is append-only in
 * `firestore.rules` and there is no revocation flow anywhere in this project.
 * Saying so on the page is the alternative to implying one exists.
 */
export default async function ConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { token } = await params;
  const { r } = await searchParams;

  const payload = readConsentToken(decodeURIComponent(token));
  if (!payload) notFound();

  const ctx = await loadSigningContext(payload.fid, payload.sub);
  /*
   * A 404 covers three genuinely different situations — no such form, the form
   * is still a draft, or the person named by the token is no longer in the
   * programme — and deliberately does not distinguish them. Two of the three
   * would otherwise answer "is this speaker still on the bill?" to anybody
   * holding an old link.
   */
  if (!ctx) notFound();

  const justSigned = r === 'signed';
  const alreadySigned = r === 'already-signed' || Boolean(ctx.existing);
  const failed = r === 'error' || r === 'gone';
  const nameMissing = r === 'name-required';

  return (
    <section>
      <div className="wrap narrow" style={{ paddingBottom: 48 }}>
        <p className="eyebrow">{SITE.shortName} {SITE.year}</p>
        <h1>{ctx.title}</h1>

        <p className="lede">
          For <strong>{ctx.subject.name}</strong>
          {ctx.subject.email ? <> ({ctx.subject.email})</> : null}.
        </p>

        {failed && (
          <p className="notice bad" role="alert">
            <strong>That did not save.</strong> Nothing has been recorded — this page is not
            telling you it worked when it did not. Try again, and if it keeps failing email{' '}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> and a human will record
            it by hand.
          </p>
        )}

        {nameMissing && (
          <p className="notice warn" role="alert">
            Type your full name in the box to sign. Nothing has been recorded yet.
          </p>
        )}

        {justSigned && (
          <p className="notice" role="status">
            <strong>Recorded.</strong> Thank you — your agreement to version {ctx.version} of the
            wording below was saved just now.
          </p>
        )}

        {alreadySigned && !justSigned && (
          <p className="notice" role="status">
            <strong>You have already signed this.</strong>
            {ctx.existing?.signedAt ? (
              <> Recorded on {new Date(ctx.existing.signedAt).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}, as <strong>{ctx.existing.signedName}</strong>.</>
            ) : null}{' '}
            There is nothing else to do.
          </p>
        )}

        {/*
          The one case where somebody is asked to sign a second time, and the
          reason it has to be said out loud rather than silently re-offering the
          form: they did sign, their signature stands, and it is a signature to
          words that have since been replaced. Presenting that as "unsigned"
          would be untrue about them; presenting it as "signed" would be untrue
          about the current release.
        */}
        {ctx.supersededVersion !== undefined && (
          <p className="notice warn">
            <strong>The wording has changed since you last signed.</strong> You agreed to version{' '}
            {ctx.supersededVersion}; this is version {ctx.version}. Your earlier agreement stands
            for what it said, and it does not cover the text below — so if you still agree, please
            sign again.
          </p>
        )}

        {/*
          The agreement itself, rendered as plain text split on blank lines.
          `ConsentFormDoc.body` is deliberately not HTML: markup from a textarea
          rendered into a page people are asked to trust is an injection into
          exactly the wrong page.
        */}
        <div
          style={{
            border: '1px solid rgba(0,0,0,.12)',
            borderRadius: 8,
            margin: '28px 0',
            padding: '20px 22px',
          }}
        >
          {ctx.body
            .split(/\n\s*\n/)
            .map((para) => para.trim())
            .filter(Boolean)
            .map((para, i) => (
              <p key={i} style={{ whiteSpace: 'pre-wrap' }}>
                {para}
              </p>
            ))}
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            Version {ctx.version}
            {ctx.required ? ' · required' : ' · optional'}
          </p>
        </div>

        {!alreadySigned && (
          <form action={signConsentAction}>
            <input type="hidden" name="token" value={token} />
            <div className="field">
              <label htmlFor="signedName">Type your full name to agree</label>
              <input
                id="signedName"
                name="signedName"
                required
                minLength={2}
                maxLength={120}
                autoComplete="name"
                defaultValue=""
                placeholder={ctx.subject.name}
              />
              {/*
                Not pre-filled with their name. A box already containing the
                answer is a box somebody clicks past, and the typed name is the
                only deliberate act on this page — it is the signature. The name
                we hold is the placeholder instead, so it is still obvious who
                the form is addressed to.
              */}
              <p className="hint">
                Typing your name here records that you agree to the text above. We store what you
                type, which version you agreed to, and when.
              </p>
            </div>
            <button type="submit" className="btn btn-primary">
              I agree
            </button>
            <p className="muted" style={{ marginTop: 16 }}>
              Nothing is recorded until you press the button.
            </p>
          </form>
        )}

        {/*
          Both of these are true and neither is comfortable, which is why they
          are on the page rather than in a policy nobody opens. There is no
          withdrawal flow in this project — the record is append-only in
          `firestore.rules` — so the honest instruction is to email a person.
        */}
        <p className="muted" style={{ marginTop: 32 }}>
          Changed your mind, or need this withdrawn? There is no button for it here on purpose: a
          consent record that could be edited afterwards would not be worth keeping. Email{' '}
          <a href={`mailto:${SITE.contactEmail}?subject=Consent`}>{SITE.contactEmail}</a> and a
          person will deal with it.
        </p>

        <p className="muted">
          <Link href="/">Back to {SITE.shortName} {SITE.year}</Link>
        </p>
      </div>
    </section>
  );
}
