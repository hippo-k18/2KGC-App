/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { groupSponsorsByTier } from '@kgc/shared';
import { requireOrganizer } from '@/lib/auth';
import { getSponsor, listSponsors, type SponsorRow } from '@/lib/data';
import { sponsorTiers } from '@/lib/event';
import { isUploadedImageUrl } from '@/lib/uploads';
import { ROUTES } from '@/lib/nav';
import { linksWithoutASponsor, sponsorReport } from '@/lib/sponsor-report';
import { Banner, GapPanel, NotInputted, PageHeader, Panel, Tabs, Tag } from '../../../ui';
import { SponsorForm } from './sponsor-form';
import { SponsorImportForm } from './import-form';
import { SponsorReportView } from './report-view';

export const dynamic = 'force-dynamic';

/**
 * Content > Sponsor Center > Sponsor Manager.
 *
 * Not a table: tier group bars A grey band with the tier name… with ~80px
 * sponsor rows beneath, a 72×72 logo, then captioned fields whose labels sit
 * inside the row rather than in a header. The grouping *is* the information:
 * tier order drives three surfaces at once — this screen, the public sponsor
 * page and the app's People tab — and a flat sortable table hides the thing you
 * came to check.
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
  /** The tier's display name. */
  tier: string;
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
        <strong>{tier}</strong>
        <Tag color="blue">{rows.length}</Tag>
        <span style={{ flex: 1 }} />
        {/* Tiers are added, renamed and reordered on Sponsor Tiering. */}
        <Link
          className="row-link"
          href="/content/sponsor-center/sponsor-tiering"
          style={{ fontSize: 11 }}
        >
          Edit tiers
        </Link>
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

          {/* A 180px basis so the contact, booth and offers wrap under the name on a phone. */}
          <div style={{ flex: '1 1 180px', minWidth: 0 }}>
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

              A number of these are still hotlinked to a third-party CDN, which
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
                  none. Cannot be messaged
                </Tag>
              )}
            </div>
          </div>

          <div style={{ width: 90 }}>
            <div className="muted" style={{ fontSize: 11 }}>
              Booth
            </div>
            <div style={{ fontSize: 14 }}>
              {s.boothLocation ?? <span className="muted" style={{ fontSize: 12 }}>not set</span>}
            </div>
          </div>

          <div style={{ width: 80 }}>
            <div className="muted" style={{ fontSize: 11 }}>
              Offers
            </div>
            <div style={{ fontSize: 14 }}>{s.offerCount}</div>
          </div>

          <div
            className="row-actions-col"
            style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 60 }}
          >
            <Link href={`?edit=${s.id}`} style={{ fontSize: 12 }}>
              Edit
            </Link>
            <Link href={`?report=${s.id}`} style={{ fontSize: 12 }}>
              Report
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
  searchParams: Promise<{ tab?: string; edit?: string; new?: string; report?: string }>;
}) {
  await requireOrganizer();
  const sp = await searchParams;
  const editId = typeof sp.edit === 'string' ? sp.edit : undefined;
  const reportId = typeof sp.report === 'string' ? sp.report : undefined;
  const creating = typeof sp.new === 'string';
  const importing = sp.tab === 'import';

  const report = reportId ? await sponsorReport(reportId) : null;
  const strayLinks = report ? await linksWithoutASponsor() : [];

  const sponsors = await listSponsors();
  const editing = editId ? await getSponsor(editId) : null;
  const showForm = creating || Boolean(editing);
  /*
   * The form is a client component and `createdAt` / `updatedAt` are Firestore
   * `Timestamp` instances, which React refuses to serialise. The form reads
   * neither, so they are left behind here.
   */
  let formValues: Omit<NonNullable<typeof editing>, 'createdAt' | 'updatedAt'> | undefined;
  if (editing) {
    formValues = { ...editing };
    delete (formValues as { createdAt?: unknown }).createdAt;
    delete (formValues as { updatedAt?: unknown }).updatedAt;
  }

  const tiers = await sponsorTiers();
  const byTier = groupSponsorsByTier(tiers, sponsors).map((g) => ({
    id: g.tier.id,
    tier: g.tier.name,
    rows: g.sponsors,
  }));

  const missingLogo = sponsors.filter((s) => !s.hasLogo).length;
  const hotlinked = sponsors.filter((s) => s.logoURL && !isSelfHosted(s.logoURL)).length;
  const unreachable = sponsors.filter((s) => !s.contactEmail).length;
  const missingBooth = sponsors.filter((s) => !s.boothLocation).length;

  return (
    <>
      <PageHeader
        title="Sponsor Manager"
        tags={<Tag color="blue">{sponsors.length} sponsors</Tag>}
        actions={
          showForm || importing || reportId ? (
            <Link href={ROUTES.sponsorManager} className="whova-btn-main secondary">
              Back to list
            </Link>
          ) : (
            <Link href="?new=1" className="whova-btn-main primary">
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

        {report ? (
          <SponsorReportView report={report} strays={strayLinks} />
        ) : reportId ? (
          <p className="body-2" style={{ marginTop: 12 }}>
            That sponsor is no longer on the list. <Link href={ROUTES.sponsorManager}>Back to the list</Link>.
          </p>
        ) : sp.tab === 'reminder' ? (
          /*
            The reminder *is* a send, and the send exists: Message Sponsors
            resolves the two segments this tab would chase — a missing logo and
            an unassigned booth — over the same sender and the same per-recipient
            `emailLog`. A second compose box here would be a second place to fix
            the day the send guards change, so this tab routes to the one that
            works rather than reimplementing it.
          */
          <div style={{ marginTop: 12 }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>Chase a sponsor profile</h2>
            <p className="body-2">
              A reminder is an email to the sponsors missing something. Both segments are on{' '}
              <Link href={ROUTES.messageSponsors}>Message Sponsors</Link>, which shows every address
              before it sends.
            </p>
            <div className="toolbar">
              <Link className="btn btn-primary" href={`${ROUTES.messageSponsors}?segment=no-logo`}>
                Chase a missing logo ({missingLogo})
              </Link>
              <Link className="btn btn-default" href={`${ROUTES.messageSponsors}?segment=no-booth`}>
                Chase an unassigned booth ({missingBooth})
              </Link>
            </div>
          </div>
        ) : importing ? (
          <SponsorImportForm />
        ) : showForm ? (
          <>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>
              {editing ? `Edit ${editing.name}` : 'New sponsor'}
            </h2>
            <SponsorForm existing={formValues} tiers={tiers} />
          </>
        ) : (
          <>
            <p className="body-2" style={{ marginTop: 0 }}>
              {sponsors.length} sponsors across {byTier.length}{' '}
              {byTier.length === 1 ? 'tier' : 'tiers'}. Exhibitors are managed in{' '}
              <Link href="/content/exhibitor-center/exhibitor-manager">Exhibitor Manager</Link>.
            </p>

            {/*
              No Import and no Add sponsor here. Both were a second copy of a
              control already on screen: the tab strip directly above carries
              "Import from a spreadsheet", about sixty pixels up, and the page
              header carries "+ Add sponsor". Two ways to reach one screen,
              side by side, read as two different screens.
            */}
            <div className="toolbar">
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
                The app and the public sponsor page show their name instead. Open one and upload
                it.
              </Banner>
            ) : null}

            {hotlinked > 0 ? (
              <Banner kind="warning">
                <strong>{hotlinked} logos are linked from another website</strong> and not stored
                here. If that site removes them they disappear from the app and this screen. Upload
                a copy on the sponsor&rsquo;s form to fix it.
              </Banner>
            ) : null}

            {byTier.length === 0 ? (
              <NotInputted
                what="sponsors"
                action={
                  <Link href="?new=1" className="whova-btn-main secondary">
                    Add the first one
                  </Link>
                }
              />
            ) : (
              byTier.map(({ id, tier, rows }) => (
                <TierGroup key={id} tier={tier} rows={rows} editing={editId} />
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
            <strong>The sponsor self-service portal.</strong> A personal link letting each sponsor
            fill in their own logo, description, offers and documents. Same capability-link pattern
            as the consent register, and nothing mints one for a sponsor.
          </li>
          <li>
            <strong>Banners and sponsored sessions.</strong> Tiering decides placement, and there
            are no banner surfaces in the app to place anything on yet.
          </li>
        </ul>
      </GapPanel>
    </>
  );
}
