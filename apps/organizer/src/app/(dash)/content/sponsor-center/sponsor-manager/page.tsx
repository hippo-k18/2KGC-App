/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import type { SponsorTier } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { getSponsor, listSponsors, TIER_ORDER, type SponsorRow } from '@/lib/data';
import { isUploadedImageUrl } from '@/lib/uploads';
import { ROUTES } from '@/lib/nav';
import { Banner, EmptyState, GapPanel, PageHeader, Panel, Tabs, Tag } from '../../../ui';
import { SponsorForm } from './sponsor-form';
import { SponsorImportForm } from './import-form';

export const dynamic = 'force-dynamic';

/**
 * Content > Sponsor Center > Sponsor Manager.
 *
 * Whova does not render sponsors as a table. It renders tier group bars — a
 * grey band with the tier name — with ~80px sponsor rows beneath: a 72×72 logo,
 * then captioned fields ("Sponsor", "Main Contact") whose labels sit inside the
 * row rather than in a header. That is copied here, because the grouping *is*
 * the information: tier order drives three surfaces at once — this screen, the
 * public sponsor page and the app's People tab — and a flat sortable table hides
 * the thing you came to check.
 *
 * `<img>` rather than `next/image` on purpose: sponsor logos are remote files on
 * hosts we do not control and cannot enumerate in `next.config.ts`, and the
 * optimiser would either need a wildcard remote pattern (which is a fetch-any
 * proxy) or fail closed on the first new sponsor. The eslint rule is disabled
 * for that reason and no other.
 *
 * ── This screen used to be read-only, and said so ───────────────────────────
 *
 * Every one of `SponsorDoc`'s thirteen fields was written by `seed-demo.ts` and
 * by nothing else, on a screen that rendered a danger banner counting sponsors
 * with no logo and offered no way to set one. Both halves of that are now real:
 * the form below writes every field the app or the website reads, and the logo
 * goes to Firebase Storage through the shared upload path.
 */

function TierGroup({
  tier,
  rows,
  editing,
}: {
  tier: SponsorTier;
  rows: SponsorRow[];
  editing?: string;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--hairline)',
        borderRadius: 4,
        marginBottom: 14,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          alignItems: 'center',
          background: 'var(--surface-alt)',
          borderBottom: '1px solid var(--hairline)',
          display: 'flex',
          gap: 10,
          padding: '8px 12px',
        }}
      >
        <strong style={{ textTransform: 'capitalize' }}>{tier}</strong>
        <Tag color="blue">{rows.length}</Tag>
        <span style={{ flex: 1 }} />
        {/*
          Whova puts Edit / Delete tier links on this bar. There are none here
          and there is no greyed-out pair either: `SponsorTier` is a four-value
          union in `@kgc/shared`, so a fifth tier is a code change in three
          consumers rather than a row somebody types. A disabled button would
          imply the opposite. Moving a sponsor *between* tiers is the edit people
          actually want, and that is the select on the form.
        */}
        <span className="muted" style={{ fontSize: 11 }}>
          set on each sponsor
        </span>
      </div>

      {rows.map((s) => (
        <div
          key={s.id}
          style={{
            alignItems: 'center',
            background: editing === s.id ? 'var(--surface-alt)' : undefined,
            borderBottom: '1px solid var(--hairline)',
            display: 'flex',
            gap: 16,
            minHeight: 80,
            padding: '10px 12px',
          }}
        >
          <div
            style={{
              alignItems: 'center',
              background: '#fff',
              border: '1px solid var(--hairline)',
              borderRadius: 3,
              display: 'flex',
              flex: 'none',
              height: 72,
              justifyContent: 'center',
              overflow: 'hidden',
              width: 72,
            }}
          >
            {s.logoURL ? (
              <img
                src={s.logoURL}
                alt=""
                style={{ maxHeight: 64, maxWidth: 64, objectFit: 'contain' }}
              />
            ) : (
              <span className="muted" style={{ fontSize: 11, textAlign: 'center' }}>
                no logo
              </span>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="muted" style={{ fontSize: 11 }}>
              Sponsor
            </div>
            {s.website ? (
              <a href={s.website} target="_blank" rel="noreferrer" style={{ fontSize: 15 }}>
                {s.name}
              </a>
            ) : (
              <span style={{ fontSize: 15 }}>{s.name}</span>
            )}
            {/*
              Where the logo comes from, said on the row.

              Eighteen of these are still hotlinked to Whova's own CDN, which
              this project neither controls nor pays for. The distinction is
              invisible in the thumbnail and is the single most useful thing
              this screen can tell an organizer, because the remedy — replace
              it with an upload — is now one click away on the same row.
            */}
            {s.logoURL && !isSelfHosted(s.logoURL) ? (
              <div className="muted" style={{ fontSize: 11 }}>
                linked from {hostOf(s.logoURL)}
              </div>
            ) : null}
          </div>

          <div style={{ width: 170 }}>
            <div className="muted" style={{ fontSize: 11 }}>
              Main contact
            </div>
            <div style={{ fontSize: 13 }}>
              {s.contactEmail ? (
                <>
                  {s.contactName || s.contactEmail}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {s.contactEmail}
                  </div>
                </>
              ) : (
                <Tag color="orange" fill="outline" small>
                  none — cannot be messaged
                </Tag>
              )}
            </div>
          </div>

          <div style={{ width: 90 }}>
            <div className="muted" style={{ fontSize: 11 }}>
              Booth
            </div>
            <div style={{ fontSize: 14 }}>{s.boothLocation ?? '—'}</div>
          </div>

          <div style={{ width: 80 }}>
            <div className="muted" style={{ fontSize: 11 }}>
              Offers
            </div>
            <div style={{ fontSize: 14 }}>{s.offerCount}</div>
          </div>

          <div style={{ width: 44 }}>
            <Link href={`?edit=${s.id}`} style={{ fontSize: 12 }}>
              Edit
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

/** `https://cdn.example.com/a.png` → `cdn.example.com`. Never throws. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'an unknown host';
  }
}

/**
 * Is this logo stored by us, rather than borrowed from someone else's CDN?
 *
 * `isUploadedImageUrl()` answers that for the deployed bucket and only for the
 * deployed bucket — it matches on `firebasestorage.googleapis.com` exactly,
 * because that host is what `firestore.rules` and `mirror-directory.ts` both
 * require. Against the Storage emulator an upload comes back on `127.0.0.1`,
 * which is equally ours; without this the screen would greet a freshly uploaded
 * logo with a warning banner about third-party hotlinking on every local run.
 */
function isSelfHosted(url: string): boolean {
  if (isUploadedImageUrl(url)) return true;
  const host = hostOf(url);
  return host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0';
}

export default async function SponsorManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; edit?: string; new?: string }>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const editId = typeof sp.edit === 'string' ? sp.edit : undefined;
  const creating = typeof sp.new === 'string';
  const importing = sp.tab === 'import';

  const sponsors = await listSponsors();
  const editing = editId ? await getSponsor(editId) : null;
  const showForm = creating || Boolean(editing);

  const byTier = TIER_ORDER.map((tier) => ({
    tier,
    rows: sponsors.filter((s) => s.tier === tier),
  })).filter((g) => g.rows.length > 0);

  const missingLogo = sponsors.filter((s) => !s.hasLogo).length;
  const hotlinked = sponsors.filter((s) => s.logoURL && !isSelfHosted(s.logoURL)).length;
  const unreachable = sponsors.filter((s) => !s.contactEmail).length;

  return (
    <>
      <PageHeader
        title="Sponsor Manager"
        tags={<Tag color="blue">{sponsors.length} sponsors</Tag>}
        actions={
          showForm || importing ? (
            <Link href={ROUTES.sponsorManager} className="whova-btn-main secondary">
              Back to list
            </Link>
          ) : (
            <Link href="?new=1" className="whova-btn-main">
              + Add sponsor
            </Link>
          )
        }
        links={[
          <Link key="sc" href="/content/sponsor-center">
            Sponsor Center
          </Link>,
          <Link key="st" href="/content/sponsor-center/sponsor-tiering">
            Sponsor Tiering
          </Link>,
        ]}
      />

      <Panel>
        <Tabs
          tabs={[
            { label: '☰ Sponsors List', href: '?', active: !importing && sp.tab !== 'reminder' },
            { label: '⇪ Import from a spreadsheet', href: '?tab=import', active: importing },
            {
              label: '✉ Sponsor Profile Reminder',
              href: '?tab=reminder',
              active: sp.tab === 'reminder',
            },
          ]}
        />

        {sp.tab === 'reminder' ? (
          <EmptyState icon="✉">
            Sponsor profile reminders need an email sender
          </EmptyState>
        ) : importing ? (
          <SponsorImportForm />
        ) : showForm ? (
          <>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>
              {editing ? `Edit ${editing.name}` : 'New sponsor'}
            </h2>
            <SponsorForm existing={editing ?? undefined} tiers={TIER_ORDER} />
          </>
        ) : (
          <>
            <p className="body-2" style={{ marginTop: 0 }}>
              {sponsors.length} sponsors across {byTier.length}{' '}
              {byTier.length === 1 ? 'tier' : 'tiers'}. Whova&apos;s own distinction: sponsors buy
              brand visibility, exhibitors buy direct engagement and booth staff —{' '}
              <Link href="/content/exhibitor-center/exhibitor-manager">Exhibitor Manager</Link> is
              the other one.
            </p>

            <div className="toolbar">
              <Link href="?tab=import" className="btn btn-primary">
                Import from a spreadsheet
              </Link>
              <Link href="?new=1" className="btn btn-primary">
                Add sponsor
              </Link>
              <span className="spacer" />
              {/*
                A plain anchor with `download`, not a `Link` and not a menu.

                `/export/sponsors` is a route handler that answers with a CSV and
                a `Content-Disposition` header; `next/link` would try to treat it
                as a page. The export itself already existed — `lib/exports.ts`
                registers it and serves name, tier, booth, website and contact —
                behind a disabled button, which is the failure mode this
                dashboard's own gap-note flag was invented to prevent.

                There is no "Export lead lists" entry beside it, greyed out or
                otherwise: `sponsors/{id}/leads` is modelled and ruled and has
                never had a writer, so that file would always be empty, and an
                empty download reads as "we lost your leads" rather than "there
                are none". The gap note below says so in words instead.
              */}
              <a href="/export/sponsors" className="btn btn-default" download>
                Export sponsors to CSV
              </a>
            </div>

            {missingLogo > 0 ? (
              <Banner kind="danger">
                <strong>
                  {missingLogo} of {sponsors.length} sponsors have no logo.
                </strong>{' '}
                The app&rsquo;s People tab renders a name where a logo should be, and the public
                sponsor page does the same — which is the one thing a sponsor notices. Open one and
                upload it.
              </Banner>
            ) : null}

            {hotlinked > 0 ? (
              <Banner kind="warning">
                <strong>{hotlinked} logos are hotlinked to a third-party CDN</strong> rather than
                stored here. They came in with the seed data and are served from Whova&rsquo;s own
                asset host; if that host rotates its keys they vanish from the app and from this
                screen at once. Uploading a replacement on the sponsor&rsquo;s own form fixes one
                permanently.
              </Banner>
            ) : null}

            {byTier.length === 0 ? (
              <EmptyState
                icon="🏛"
                action={
                  <Link href="?new=1" className="whova-btn-main">
                    Add the first sponsor
                  </Link>
                }
              >
                <strong>Your event has no sponsors.</strong>
                <p className="muted" style={{ marginTop: 6 }}>
                  Whatever you add here appears on the public sponsor page and in the app&rsquo;s
                  People tab immediately — both read Firestore live.
                </p>
              </EmptyState>
            ) : (
              byTier.map(({ tier, rows }) => (
                <TierGroup key={tier} tier={tier} rows={rows} editing={editId} />
              ))
            )}

            {unreachable > 0 ? (
              <p className="muted" style={{ fontSize: 12 }}>
                {unreachable} {unreachable === 1 ? 'sponsor has' : 'sponsors have'} no contact
                email, so <Link href={ROUTES.messageSponsors}>Message Sponsors</Link> cannot reach
                them.
              </p>
            ) : null}
          </>
        )}
      </Panel>

      <GapPanel>
        <h2 className="section-header">Not built here</h2>
        <ul className="body-2" style={{ paddingLeft: 18 }}>
          <li>
            <strong>Removing a sponsor.</strong> There is no delete and no retire, and the second
            one is the interesting half. <code>SponsorDoc</code> has no <code>status</code> field,
            and neither the website&rsquo;s <code>listSponsors()</code> nor the app&rsquo;s{' '}
            <code>useSponsors()</code> filters on one — so a &ldquo;Retire&rdquo; button here would
            set a field nobody reads and leave the sponsor on the public page and in the app while
            telling you they were gone. Three edits close it: add the field to{' '}
            <code>@kgc/shared</code>, filter it in both readers, then the control. Until then a
            sponsor who pulls out is edited, not removed.
          </li>
          <li>
            <strong>Downloads.</strong> <code>SponsorDoc.downloads</code> is modelled and no
            surface renders it — not the app&rsquo;s sponsor screen, not the website. It has no
            control here for that reason: it would write data nobody could ever see. The app screen
            already has an offers section to copy, so this is a small app change first and a
            textarea second.
          </li>
          <li>
            <strong>Lead retrieval.</strong> <code>sponsors/&#123;id&#125;/leads</code> is modelled,
            ruled and empty — the rules permit an attendee to create one and nothing in the app
            does. The badge QR that would feed it already works: a booth scan is the same write the
            check-in desk does, against a different list. Until a scanner exists the export would
            be an empty file, so there is no export.
          </li>
          <li>
            <strong>The website can shadow an uploaded logo.</strong>{' '}
            <code>apps/web/src/lib/data.ts</code> keeps a hand-written list of eighteen slugs it
            self-hosts under <code>public/kgc/sponsors/</code>, and it prefers that file over
            whatever Firestore holds. So uploading a new logo for one of those eighteen changes the
            app and this screen and <em>not</em> the public page. Removing a slug from that list is
            what hands control back to this form.
          </li>
          <li>
            <strong>Creating a tier.</strong> <code>SponsorTier</code> is a hard-coded union of the
            four values the conference sells — <code>platinum</code>, <code>gold</code>,{' '}
            <code>silver</code>, <code>bronze</code> — so a fifth tier is a code change in{' '}
            <code>models.ts</code> and three consumers, not a form. That is the right trade at one
            event a year and the wrong one at ten.
          </li>
          <li>
            <strong>The sponsor self-service portal.</strong> Whova hands each sponsor a personal
            link to fill in their own logo, description, offers and documents. Same pattern as
            speakers, same blocker: an email sender.
          </li>
          <li>
            <strong>Banners and sponsored sessions.</strong> Tiering decides placement in Whova and
            there are no banner surfaces in the app to place anything on yet.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
