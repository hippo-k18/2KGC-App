/**
 * Matching what is measured to the sponsor it belongs to.
 *
 * Split from `sponsor-report.ts` for the reason every `*-core.ts` in this
 * directory is: that file carries `server-only` and Vitest cannot load it at
 * all, and the matching below is the part worth pinning.
 *
 * ── A tracked link belongs to a sponsor by its owner, and by nothing else ──
 *
 * `CampaignLinkDoc.owner` is free text — "who gets credit", typed by an
 * organizer on the Link Tracking screen, used today for speaker referrals. A
 * link owned by "Acme Corp" is Acme's link, and the match is on the trimmed,
 * case-folded name because somebody typing a sponsor's name into a text box
 * will not reproduce the capitalisation in the sponsor record.
 *
 * ⚠️ It is not a foreign key and must not be treated as one. Two sponsors with
 * the same name would share a link's clicks, and a typo in the owner field
 * silently credits nobody — which is why the report names the links it counted
 * rather than only their total, so an organizer can see that the link they
 * expected is missing. A real relation would be a `sponsorId` on the link, and
 * that is a change to a screen this feature does not own.
 */

export interface SponsorLike {
  id: string;
  name: string;
}

/** The parts of a tracked link this report uses. */
export interface TrackedLink {
  code: string;
  label: string;
  owner: string;
  clicks: number;
  orders: number;
  lastClickedAt?: string;
}

export const ownerKey = (name: string | undefined) => (name ?? '').trim().toLowerCase();

/** Links credited to one sponsor, busiest first. */
export function linksForSponsor<L extends TrackedLink>(sponsor: SponsorLike, links: L[]): L[] {
  const key = ownerKey(sponsor.name);
  if (!key) return [];
  return links
    .filter((l) => ownerKey(l.owner) === key)
    .sort((a, b) => b.clicks - a.clicks || a.code.localeCompare(b.code));
}

export interface SponsorTotals {
  clicks: number;
  orders: number;
  /** ISO 8601. Absent when no link of theirs has ever been clicked. */
  lastClickAt?: string;
}

/**
 * The sponsor's numbers, added up from their links.
 *
 * `lastClickAt` is the newest across every link they own, compared as strings —
 * which is safe because they are ISO 8601 instants and not display dates.
 */
export function totalsForSponsor(links: TrackedLink[]): SponsorTotals {
  return {
    clicks: links.reduce((n, l) => n + l.clicks, 0),
    orders: links.reduce((n, l) => n + l.orders, 0),
    lastClickAt: links
      .map((l) => l.lastClickedAt)
      .filter((t): t is string => Boolean(t))
      .sort()
      .at(-1),
  };
}

/**
 * Links owned by somebody who is not a sponsor.
 *
 * Mostly speaker referrals, which is what the owner field was built for, and
 * occasionally a sponsor's name spelled differently from their record. Reported
 * rather than dropped: "the link I made is not on their report" is a question
 * with an answer, and the answer is usually in this list.
 */
export function unmatchedLinks<L extends TrackedLink>(sponsors: SponsorLike[], links: L[]): L[] {
  const known = new Set(sponsors.map((s) => ownerKey(s.name)).filter(Boolean));
  return links.filter((l) => ownerKey(l.owner) && !known.has(ownerKey(l.owner)));
}
