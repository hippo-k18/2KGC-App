import Link from 'next/link';
import { EVENT, PAGE_CONTENT_KEYS } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { targetDescription } from '@/lib/firestore';
import {
  formatMilestones,
  readPageContent,
  readPageContentMeta,
  type PageContentMeta,
} from '@/lib/page-content';
import { publicUrl } from '@/lib/webpages';
import { Banner, GapPanel, PageHeader, Panel } from '../../../ui';
import { CallPageForm, CodeOfConductForm } from './copy-forms';

export const dynamic = 'force-dynamic';

/**
 * Content › Basics › Website Copy.
 *
 * The editor `pageContent` was written for and never got. `@kgc/shared` has
 * described a store of copy "edited without a deploy" since it was added, and
 * `apps/web` reads it from `/code-of-conduct`, `/call-for-posters` and
 * `/startup-pitch`; a repo-wide grep found no writer anywhere — not in this
 * dashboard, not in `functions/`, not in `scripts/`. Three fields on public
 * pages that go stale every edition were therefore deploy-only, and the
 * contract describing them was a promise nothing kept.
 *
 * ── Why it is here rather than under Marketing ──────────────────────────────
 *
 * A link to this screen also belongs under Marketing › Event Website. It hangs
 * off Basics because Basics is the other "what does the public see, and can we
 * change it" screen and is the one that has to explain that its own values are
 * compile-time constants — this is the half of that answer that is *not* a
 * constant. It is deliberately not a new node in `NAV`: that tree is a
 * transcription of a shipped product's own bundle and gains nothing from an
 * entry the original does not have.
 *
 * ── What an empty box means ─────────────────────────────────────────────────
 *
 * `values` is a partial bag. Every field left blank is a field the page renders
 * from the constant beside it in `apps/web`, and clearing a field really does
 * hand it back. That is why this screen cannot pre-fill anything it has not
 * itself stored: the fallback copy lives in the file that renders the page, on
 * purpose, and importing it here would put the same prose in two installs.
 *
 * ── What is deliberately not editable ───────────────────────────────────────
 *
 * The body of the code of conduct. It is the instrument attendees are told they
 * have agreed to; changing it is a legal act and belongs in git with a
 * reviewable history, not in a text box with no approval step. The reporting
 * route is the part that fails a person at the moment they need it, and it is
 * the part that is here.
 */

function Meta({ meta }: { meta: PageContentMeta }) {
  if (!meta.updatedAt) {
    return <span className="muted">Never edited: the page is on its own copy.</span>;
  }
  return (
    <span className="muted">
      Last saved {meta.updatedAt.slice(0, 10)}
      {meta.updatedBy ? ` by ${meta.updatedBy}` : ''}.
    </span>
  );
}

function PageLink({ path }: { path: string }) {
  return (
    <a href={publicUrl(path)} target="_blank" rel="noreferrer">
      {path} ↗
    </a>
  );
}

export default async function WebsiteCopyPage() {
  await requireOrganizer();

  const [conduct, conductMeta, posters, postersMeta, pitch, pitchMeta] = await Promise.all([
    readPageContent(PAGE_CONTENT_KEYS.codeOfConduct),
    readPageContentMeta(PAGE_CONTENT_KEYS.codeOfConduct),
    readPageContent(PAGE_CONTENT_KEYS.callForPosters),
    readPageContentMeta(PAGE_CONTENT_KEYS.callForPosters),
    readPageContent(PAGE_CONTENT_KEYS.startupPitch),
    readPageContentMeta(PAGE_CONTENT_KEYS.startupPitch),
  ]);

  return (
    <>
      <PageHeader
        title="Website Copy"
        info={
          <>
            <strong>Live without a deploy</strong>
            <p>
              All three pages read Firestore on every request, so a save is on the public site on
              the next page load. A box left blank hands the field back to the copy compiled beside
              the page. It does not empty the page.
            </p>
          </>
        }
        links={[
          <Link key="b" href="/content/basics">
            Basics
          </Link>,
          <Link key="w" href="/marketing/event-website">
            Event Website
          </Link>,
          <span key="t" className="muted">
            {targetDescription()}
          </span>,
        ]}
      />

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>
          Code of Conduct · <PageLink path="/code-of-conduct" />
        </h2>
        <p className="body-2">
          The reporting route only. The policy text is not editable from anywhere and should not
          be: it is what attendees are told they have agreed to, and changing it is a change that
          needs a reviewable history. <Meta meta={conductMeta} />
        </p>
        {/*
         * The one place on this screen that names a fallback, and the reason it
         * is a banner rather than a hint: an unset reporting address is not a
         * page rendering slightly generic copy, it is the number somebody is
         * told to call when something has gone wrong at the event. It has to be
         * possible to walk past this screen and see that nobody ever set it.
         *
         * It is keyed off the stored field rather than off `updatedAt`, because
         * saving the other box on this form stamps the document and would
         * otherwise make the page look confirmed while the address was still
         * the general mailbox.
         */}
        {conduct.reportEmail ? null : (
          <Banner kind="warning">
            No reporting address is set for {EVENT.name}, so <code>/code-of-conduct</code> is
            printing <strong>{EVENT.contactEmail}</strong>. The general KGC mailbox. It is a real
            address and a report sent to it will arrive, but whoever answers enquiries would read
            it. Type the address incident reports should go to below.
          </Banner>
        )}
        <CodeOfConductForm
          reportEmail={conduct.reportEmail ?? ''}
          fallbackEmail={EVENT.contactEmail}
          committee={(conduct.committee ?? []).join('\n')}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>
          Call for Posters · <PageLink path="/call-for-posters" />
        </h2>
        <p className="body-2">
          The submission link and the calendar. Both ship marked PLACEHOLDER in the source with a
          URL still carrying <code>2026</code>, which is the exact pair of mistakes a
          deploy-to-edit page accumulates. <Meta meta={postersMeta} />
        </p>
        <CallPageForm
          page={PAGE_CONTENT_KEYS.callForPosters}
          submitUrl={posters.submitUrl ?? ''}
          submitLabel={posters.submitLabel ?? ''}
          dates={formatMilestones(posters.dates)}
          datesConfirmed={posters.datesConfirmed ?? false}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>
          Startup Pitch — <PageLink path="/startup-pitch" />
        </h2>
        <p className="body-2">
          The same page with different words, and the same two fields that go stale.{' '}
          <Meta meta={pitchMeta} />
        </p>
        <CallPageForm
          page={PAGE_CONTENT_KEYS.startupPitch}
          submitUrl={pitch.submitUrl ?? ''}
          submitLabel={pitch.submitLabel ?? ''}
          dates={formatMilestones(pitch.dates)}
          datesConfirmed={pitch.datesConfirmed ?? false}
        />
      </Panel>

      <GapPanel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Not built here</h2>
        <ul className="muted" style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 0 }}>
          <li>
            <strong>A preview of the compiled-in copy.</strong> The screen can show what has been
            overridden and not what a page says when nothing has been. The fallback lives beside
            the page that renders it in <code>apps/web</code> — deliberately, so the prose is in
            one install — and the price of that is a blank box that means &ldquo;unchanged&rdquo;
            rather than &ldquo;empty&rdquo;. The hint under every field says so. The one
            exception is the reporting address, which is named in full above: it is declared in{' '}
            <code>@kgc/shared</code> as <code>EVENT.contactEmail</code> precisely so that both
            installs can print the same string, because on that field alone &ldquo;which address
            is the public page showing right now&rdquo; is a question worth a banner.
          </li>
          <li>
            <strong>The other eighteen pages.</strong> <code>PAGE_CONTENT_KEYS</code> names three,
            and that is the whole store: most of the site is layout rather than text, and a key
            with no reader is a promise that an editor is coming. Adding a page here means adding
            its fields to <code>packages/shared/src/page-content.ts</code> and a{' '}
            <code>pageContent()</code> call to the page first.
          </li>
          <li>
            <strong>Rich text.</strong> Every field is plain text and is rendered as text. Storing
            HTML would make an organizer&rsquo;s text box a script injection point on a public
            page, which is the reason the policy body is not here either.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
