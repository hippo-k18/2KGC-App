/**
 * Suppression, as a pure function over contact rows.
 *
 * Deliberately separate from `campaigns.ts`, which carries `server-only` and
 * does the Firestore work. `server-only` throws outside a React Server
 * Component, so a module that imports it cannot be loaded by Vitest at all —
 * and *this* is the part worth pinning with tests, because it is the code that
 * decides whether a bulk send reaches somebody who asked it to stop. The same
 * split `conflicts-core.ts` and `conflicts.ts` already use, for the same
 * reason.
 *
 * ── Why a reason and not just a boolean ─────────────────────────────────────
 *
 * `mailable()` used to be the whole story: a contact was in an audience or it
 * was not, and the only trace a suppression left was a number in the sentence
 * the screen printed after a send. That number answers "how many" and nothing
 * else. The question an organizer actually asks three weeks later is "did Ada
 * get the March campaign?", and for an unsubscribed Ada the honest answer is
 * "no, and here is the row that says why, dated" — which needs the reason to
 * survive the send as data rather than as prose.
 *
 * So the audience split now carries a reason per excluded contact, and
 * `campaigns.ts` turns each one into a `skipped` row in `emailLog`. That log
 * is what a deliverability investigation or a regulator asks for, and it is the
 * difference between asserting the suppression list works and being able to
 * show it.
 *
 * ── Both flags at once gets its own reason ──────────────────────────────────
 *
 * A contact can be unsubscribed *and* bounced, and picking a winner between
 * them would be an arbitrary rule that then has to be remembered in two places.
 * There is a third reason instead. It costs one union member and removes the
 * question.
 */

/**
 * The minimum shape suppression needs.
 *
 * Structural rather than `ContactRow`, so this module needs nothing from
 * `campaigns.ts` — the dependency runs one way only, and a test can build a
 * two-field object instead of a full row.
 */
export interface Suppressible {
  email: string;
  /** ISO timestamp. Present means the person asked to stop. */
  unsubscribedAt?: string;
  /** ISO timestamp. Present means the mailbox is dead. */
  bouncedAt?: string;
}

export type SuppressionReason = 'unsubscribed' | 'bounced' | 'unsubscribed and bounced';

/**
 * Why this contact may not be emailed, or null if they may be.
 *
 * The single place the suppression rule is expressed. `mailable()` in
 * `campaigns.ts` is defined in terms of this rather than repeating the two
 * field checks, so there is no way for a caller to implement half of it — which
 * was the failure the original comment on that function warned about.
 */
export function suppressionReasonFor(c: Suppressible): SuppressionReason | null {
  if (c.unsubscribedAt && c.bouncedAt) return 'unsubscribed and bounced';
  if (c.unsubscribedAt) return 'unsubscribed';
  if (c.bouncedAt) return 'bounced';
  return null;
}

/** One contact who will not be mailed, and why. */
export interface Excluded<T> {
  contact: T;
  reason: SuppressionReason;
}

/**
 * Split a list into who will be mailed and who will not.
 *
 * Generic over the row type so the caller keeps whatever it passed in —
 * `campaigns.ts` needs the full `ContactRow` back for the recipient table, and
 * a test needs only two fields.
 *
 * Input order is preserved in both halves. That is not cosmetic: the recipient
 * table on the Email Campaign screen shows the first 200 addresses so an
 * organizer can check the people they meant are in it, and a split that
 * reordered would make that check useless.
 */
export function partitionAudience<T extends Suppressible>(
  onList: T[],
): { recipients: T[]; excluded: Excluded<T>[] } {
  const recipients: T[] = [];
  const excluded: Excluded<T>[] = [];

  for (const contact of onList) {
    const reason = suppressionReasonFor(contact);
    if (reason) excluded.push({ contact, reason });
    else recipients.push(contact);
  }

  return { recipients, excluded };
}

/**
 * What the `emailLog` row says about a skipped recipient.
 *
 * `EmailLogDoc.reason` is documented as "why a send was skipped — usually 'no
 * RESEND_API_KEY configured'", so it is read by a human looking at a
 * transaction log and it should read as a sentence, not as an enum member.
 *
 * It names the consequence as well as the cause. "unsubscribed" alone invites
 * the reading that the mail failed and could be retried; the second clause says
 * the exclusion was the intended outcome, which is the thing somebody
 * investigating a gap in a campaign needs to know before they try to resend it
 * by hand.
 */
export function skipReasonText(reason: SuppressionReason): string {
  switch (reason) {
    case 'unsubscribed':
      return 'Excluded: this address unsubscribed. Campaign mail to it is suppressed.';
    case 'bounced':
      return 'Excluded: this address hard-bounced. Campaign mail to it is suppressed.';
    case 'unsubscribed and bounced':
      return 'Excluded: this address unsubscribed and has also hard-bounced. Campaign mail to it is suppressed.';
  }
}

/** One `emailLog` row's worth of skip, before any Firestore field is added. */
export interface SkipRow {
  to: string;
  reason: string;
}

/**
 * The skipped rows one send should write, one per excluded contact.
 *
 * Deliberately one row per person rather than a single "62 suppressed" summary,
 * for exactly the reason `EmailLogDoc.template` gives for `bulk-message`: "did
 * Ada get it?" is the question this log exists to answer, and a row saying
 * "sent to 938 of 1,000" cannot answer it for the other 62.
 *
 * Addresses are de-duplicated. A contact list is keyed by address so the same
 * one cannot appear twice in `contacts`, but `audienceFor('*')` unions every
 * named list and a future segment union could repeat somebody — and two skipped
 * rows for one person would double-count in `listCampaigns`, which is the
 * number the screen prints.
 */
export function campaignSkipRows<T extends Suppressible>(excluded: Excluded<T>[]): SkipRow[] {
  const seen = new Set<string>();
  const rows: SkipRow[] = [];

  for (const e of excluded) {
    const to = e.contact.email;
    if (!to || seen.has(to)) continue;
    seen.add(to);
    rows.push({ to, reason: skipReasonText(e.reason) });
  }

  return rows;
}
