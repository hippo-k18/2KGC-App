import Link from 'next/link';
import { PAGE_CONTENT_KEYS } from '@kgc/shared';
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
 * Whova's own tree would put website copy under Marketing › Event Website, and
 * that is where a link to this screen belongs. It hangs off Basics because
 * Basics is the other "what does the public see, and can we change it" screen
 * and is the one that has to explain that its own values are compile-time
 * constants — this is the half of that answer that is *not* a constant. It is
 * deliberately not a new node in `NAV`: the tree is a transcription of Whova's
 * shipped bundle and gains nothing from an entry Whova does not have.
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
    return <span className="muted">Never edited — the page is on its own copy.</span>;
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

      <Banner kind="info">
        <strong>These fields are live without a deploy.</strong> All three pages read Firestore on
        every request, so a save here is on the public site on the next page load. A field left
        blank is a field the page renders from the copy compiled beside it — clearing a box hands
        it back rather than emptying the page.
      </Banner>

      <Panel>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>
          Code of Conduct — <PageLink path="/code-of-conduct" />
        </h2>
        <p className="body-2">
          The reporting route only. The policy text is not editable from anywhere and should not
          be: it is what attendees are told they have agreed to, and changing it is a change that
          needs a reviewable history. <Meta meta={conductMeta} />
        </p>
        <CodeOfConductForm
          reportEmail={conduct.reportEmail ?? ''}
          committee={(conduct.committee ?? []).join('\n')}
        />
      </Panel>

      <Panel style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>
          Call for Posters — <PageLink path="/call-for-posters" />
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
            rather than &ldquo;empty&rdquo;. The hint under every field says so.
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
