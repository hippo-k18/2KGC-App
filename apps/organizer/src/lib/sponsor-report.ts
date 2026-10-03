import 'server-only';

import { COLLECTIONS, SUBCOLLECTIONS, type SponsorLeadDoc } from '@kgc/shared';
import { listLinks, type LinkRow } from './campaigns';
import { listSponsors, type SponsorRow } from './data';
import { db } from './firestore';
import { recordError } from './errors';
import { linksForSponsor, totalsForSponsor, unmatchedLinks } from './sponsor-report-core';

/**
 * What a sponsor gets back at the end of the conference.
 *
 * ── The honest version of this report is a short one ───────────────────────
 *
 * Whova's sponsor ROI report counts profile views, document downloads, booth
 * visits and lead scans. This project records none of those: the app opens a
 * sponsor's card and writes nothing, `sponsors/{id}/leads` is modelled and has
 * no writer, and a sponsor's `downloads` are links to other people's servers
 * that nothing here sits in front of.
 *
 * So this report shows what is genuinely counted — tracked link clicks, the
 * purchases those links led to, and any lead documents that exist — and says in
 * one line that views and document opens are not recorded. That refusal is the
 * feature. A sponsor report with a plausible "1,240 profile views" in it is a
 * number somebody quotes in a renewal conversation, and inventing it would be a
 * worse failure than the gap it papered over.
 *
 * What would close it: a counted redirect for a sponsor's links and downloads,
 * the same `/r/{code}` mechanism `campaignLinks` already uses, plus a write
 * from the app when a sponsor card is opened. Both are real work on screens
 * this file does not own.
 */

export interface SponsorReportRow {
  id: string;
  name: string;
  tier: string;
  boothLocation?: string;
  /** Tracked links credited to them by name. See `sponsor-report-core.ts`. */
  links: LinkRow[];
  clicks: number;
  /** Purchases attributed to those links, already net of demo and cancelled. */
  orders: number;
  lastClickAt?: string;
  /** Documents under `sponsors/{id}/leads`. Nothing writes them yet. */
  leads: number;
}

/**
 * How many leads each sponsor holds.
 *
 * One subcollection read per sponsor, which is affordable at eighteen sponsors
 * and would not be at a thousand — the same trade `listConsentForms` makes, and
 * for the same reason: a denormalised counter needs a trigger, and triggers
 * need a plan this project is not on.
 */
async function leadCounts(sponsorIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  await Promise.all(
    sponsorIds.map(async (id) => {
      try {
        const snap = await db()
          .collection(COLLECTIONS.sponsors)
          .doc(id)
          .collection(SUBCOLLECTIONS.leads)
          .get();
        // Read as documents rather than trusting a field: the count is the
        // subcollection, and there is no counter to disagree with it.
        const rows = snap.docs.map((d) => d.data() as SponsorLeadDoc);
        if (rows.length > 0) counts.set(id, rows.length);
      } catch (err) {
        recordError(`sponsorReport.leads:${id}`, err);
      }
    }),
  );

  return counts;
}

/** Every sponsor, with their recorded numbers. Sorted by clicks, then by name. */
export async function sponsorReports(): Promise<SponsorReportRow[]> {
  const [sponsors, links] = await Promise.all([listSponsors(), listLinks()]);
  const leads = await leadCounts(sponsors.map((s) => s.id));

  return sponsors
    .map((s) => toRow(s, links, leads.get(s.id) ?? 0))
    .sort((a, b) => b.clicks - a.clicks || a.name.localeCompare(b.name));
}

/** One sponsor's report, for the per-sponsor view. */
export async function sponsorReport(sponsorId: string): Promise<SponsorReportRow | null> {
  const [sponsors, links] = await Promise.all([listSponsors(), listLinks()]);
  const sponsor = sponsors.find((s) => s.id === sponsorId);
  if (!sponsor) return null;

  const leads = await leadCounts([sponsor.id]);
  return toRow(sponsor, links, leads.get(sponsor.id) ?? 0);
}

function toRow(sponsor: SponsorRow, links: LinkRow[], leads: number): SponsorReportRow {
  const mine = linksForSponsor(sponsor, links);
  const totals = totalsForSponsor(mine);
  return {
    id: sponsor.id,
    name: sponsor.name,
    tier: sponsor.tier,
    boothLocation: sponsor.boothLocation,
    links: mine,
    clicks: totals.clicks,
    orders: totals.orders,
    lastClickAt: totals.lastClickAt,
    leads,
  };
}

/**
 * Tracked links whose owner is not a sponsor.
 *
 * Offered to the screen so an organizer who cannot find their link on a
 * sponsor's report can see where it went instead — nearly always a speaker
 * referral, occasionally a name spelled two ways.
 */
export async function linksWithoutASponsor(): Promise<LinkRow[]> {
  const [sponsors, links] = await Promise.all([listSponsors(), listLinks()]);
  return unmatchedLinks(sponsors, links);
}
