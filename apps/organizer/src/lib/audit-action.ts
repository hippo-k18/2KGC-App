/**
 * Audit log actions in words, for Tools › Report. Pure, so it is tested
 * without the Admin SDK.
 */

/**
 * `attendee.reinstate` → "Reinstated an attendee".
 *
 * The log is written in the vocabulary the code uses, which is right for the
 * documents and wrong for the one screen a person reads them on: the column
 * said `questionForm.update` beside a Firestore path, and an organizer looking
 * for who cancelled somebody's ticket could not find it.
 *
 * Built from the two halves of the action rather than from a table of all
 * hundred-odd verbs, so an action added later reads sensibly without anybody
 * remembering to come back here. Only the verbs whose past tense is not "+d"
 * are listed.
 *
 * "+d" is right only for a verb ending in "e". Anything else not listed here
 * used to get it anyway, which is how the website's warnings came out as
 * "Undeliveredd confirmation" and "Oversoldd invoice" (T135B, TK-300); such
 * an action now reads as its two halves instead ("Order: seats").
 */
export const AUDIT_VERB: Record<string, string> = {
  acceptInvitation: 'Accepted the invitation for',
  add: 'Added',
  adjustSold: 'Corrected the sold count for',
  assign: 'Assigned',
  block: 'Blocked',
  cancel: 'Cancelled',
  category: 'Set the category on',
  complimentaryPasses: 'Set the complimentary passes on',
  confirmation: 'Resent the confirmation for',
  decide: 'Decided on',
  erase: 'Erased everything held about',
  exclude: 'Kept a reviewer away from',
  form: 'Changed the questions on',
  hold: 'Held',
  import: 'Imported',
  leadLinkRevoke: 'Revoked the lead link for',
  leadLinkSend: 'Sent the lead link for',
  invite: 'Invited',
  manual: 'Recorded a payment on',
  markPaid: 'Marked paid',
  newLink: 'Issued a new link for',
  portalApprove: 'Approved what a speaker sent for',
  portalReject: 'Rejected what a speaker sent for',
  portalRevoke: 'Revoked the portal link for',
  portalSend: 'Sent a portal link for',
  promote: 'Put on the agenda',
  qaSettings: 'Changed the Q&A settings on',
  publish: 'Published',
  publishTally: 'Published the tally for',
  reconcile: 'Rebuilt',
  refund: 'Refunded',
  release: 'Released',
  remove: 'Removed',
  rename: 'Renamed',
  resendInvitation: 'Resent the invitation for',
  role: 'Changed the role on',
  roles: 'Changed the roles on',
  rubric: 'Changed the scoring criteria on',
  send: 'Sent',
  sendInvitation: 'Sent an invitation for',
  setPassphrase: 'Set a passphrase for',
  setStatus: 'Changed the status of',
  setSold: 'Corrected the sold count for',
  ticketType: 'Changed the ticket on',
  transfer: 'Transferred',
  unblock: 'Unblocked',
  undo: 'Undid',
  undoDecision: 'Took back the decision on',
};

/** `questionForm` → `question form`, for the end of the sentence. */
function nounWords(part: string): string {
  return part
    .replace(/\./g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\bcheckin\b/gi, 'check-in')
    .toLowerCase();
}

/**
 * The website's own warnings and errors, which are not "a person did X to Y"
 * and read better whole.
 */
const WEBSITE_ACTION: Record<string, string> = {
  // Rows written before T142; new ones go to `stripeIgnored`, not the audit log.
  'checkout.notFromWebsite': 'Stripe payment not from ticketing (ignored)',
  'confirmation.undelivered': 'Confirmation email could not be delivered',
  'invoice.oversold': 'Invoice paid for more seats than were left',
  'invoice.seatWithoutTicket': 'Invoice seat with no ticket type',
  'refund.notFromWebsite': 'Stripe refund not from ticketing (ignored)',
};

export function describeAction(action: string): string {
  if (WEBSITE_ACTION[action]) return WEBSITE_ACTION[action];
  const parts = action.split('.');
  // The verb is the last segment, not the second: `desk.message.send` has three.
  const verb = parts.length > 1 ? parts[parts.length - 1] : '';
  if (!verb) return action;
  const noun = nounWords(parts.slice(0, -1).join(' '));
  const said = AUDIT_VERB[verb] ?? (verb.endsWith('e') ? `${verb.charAt(0).toUpperCase()}${verb.slice(1)}d` : null);
  if (said) return `${said} ${noun}`;
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)}: ${nounWords(verb)}`;
}
