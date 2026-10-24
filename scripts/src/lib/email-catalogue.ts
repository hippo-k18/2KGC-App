import { EVENT, blogPublicOrigin, publicSiteOrigin, type EmailLogDoc } from '@kgc/shared';
import { blogSignInLink } from './blog-people.js';
import { sessionTypeLine } from './cfp-core.js';
import {
  accessCodeMessage,
  accessCodeTemplate,
  blogInvitationMessage,
  blogReviewDecisionMessage,
  blogReviewRequestMessage,
  bulkMessageMessage,
  cfpAcceptNoticeMessage,
  cfpAcceptedMessage,
  cfpCloseAcceptedMessage,
  cfpCloseDeclinedMessage,
  cfpNudgeMessage,
  cfpReceivedMessage,
  cfpStillOpenMessage,
  cfpWeeklyReminderMessage,
  consentRequestMessage,
  exhibitorLeadLinkMessage,
  extraAddedMessage,
  headerText,
  inviteForCode,
  invoiceRaisedMessage,
  postalAddress,
  purchaseConfirmationMessage,
  refundConfirmationMessage,
  reviewerInvitationMessage,
  seatPromotionCopy,
  senderIdentity,
  signInCodeMessage,
  speakerProfileRequestMessage,
  submissionDecisionMessage,
  submissionReceiptMessage,
  teamInvitationMessage,
  ticketWithdrawnMessage,
  type EmailMessage,
} from './email.js';
import { CODE_TTL_MINUTES } from './otp-core.js';

/**
 * Every email the system can send, with sample data (T292).
 *
 * The owner asked to see "every email format for emails that could be sent
 * out" on the dashboard. Each entry here renders through the same builder its
 * sender uses, so a preview cannot say something the real mail does not.
 *
 * ⚠️ Render only. Nothing here imports `send()` or touches a store, so a page
 * built on this cannot send mail or write `emailLog`, whatever is clicked.
 *
 * `email-catalogue.test.ts` fails when a sender or a log template is added to
 * `email.ts` without an entry here.
 */

/** The exported senders in `email.ts`, by name. The test checks this list is complete. */
export type SenderName =
  | 'sendPurchaseConfirmation'
  | 'sendInvoiceRaised'
  | 'sendRefundConfirmation'
  | 'sendTicketWithdrawn'
  | 'sendSignInCode'
  | 'sendBulkMessage'
  | 'sendSubmissionReceipt'
  | 'sendSubmissionDecision'
  | 'sendReviewerInvitation'
  | 'sendSpeakerProfileRequest'
  | 'sendTeamInvitation'
  | 'sendConsentRequest'
  | 'sendExhibitorLeadLink'
  | 'sendBlogSignInCode'
  | 'sendBlogInvitation'
  | 'sendBlogReviewRequest'
  | 'sendBlogReviewDecision'
  | 'sendCfpMessage';

export interface FormatVariant {
  /** Short and stable, for the address bar. */
  id: string;
  label: string;
  render: () => EmailMessage;
}

export interface EmailFormat {
  /** For the address bar. Unique. */
  id: string;
  /** What an organizer would call it. */
  name: string;
  /** The `emailLog` template it is logged under, which also gives its area. */
  template: EmailLogDoc['template'];
  sender: SenderName;
  /** When it goes, in plain words. */
  when: string;
  /** Who gets it. */
  to: string;
  variants: FormatVariant[];
}

/** The address every sample is shown going to. */
export const SAMPLE_TO = 'sample@example.com';
/** Sign-in codes in samples. Obviously not a real one. */
export const SAMPLE_CODE = '000000';

const SPEAKER = 'Sample Speaker';
const ATTENDEE = 'Sample Attendee';
const TITLE = 'A Sample Talk Title';
const COMPANY = 'Sample Company';
const DUE_DAY = 'Monday 2 November 2026';
const DECISION_DAY = 'Friday 15 January 2027';
const NOTICE_DAY = 'Monday 1 February 2027';

function site(path: string): string {
  return `${publicSiteOrigin()}${path}`;
}

function blog(path: string): string {
  return `${blogPublicOrigin()}${path}`;
}

function dashboard(path: string): string {
  return `${(process.env.ORGANIZER_PUBLIC_ORIGIN ?? 'https://dashboard.knowledgegraph.tech').replace(/\/$/, '')}${path}`;
}

const v = (id: string, label: string, render: () => EmailMessage): FormatVariant => ({ id, label, render });

const ORDER_URL = () => site('/order/SAMPLE-TOKEN');
const purchase = () => ({
  to: SAMPLE_TO,
  name: ATTENDEE,
  ticketType: 'Main Conference',
  amountCents: 79900,
  currency: 'usd',
  orderUrl: ORDER_URL(),
});
const refund = { to: SAMPLE_TO, name: ATTENDEE, ticketType: 'Main Conference', amountCents: 79900, currency: 'usd' };
const talk = () => sessionTypeLine('talk', 25);
const workshop = () => sessionTypeLine('workshop');
const bulkBody =
  'This is a sample message. The organizer types the subject and this text on the dashboard.\n\nBlank lines become new paragraphs.';

export const EMAIL_FORMATS: EmailFormat[] = [
  // ── Call for speakers ────────────────────────────────────────────────────
  {
    id: 'cfp-received',
    name: 'E1 Submission received',
    template: 'cfp-received',
    sender: 'sendCfpMessage',
    when: 'When someone finishes a submission on the call for speakers form. Once per submission, not on later edits.',
    to: 'The person who submitted',
    variants: [
      v('talk', 'Talk', () => cfpReceivedMessage({ name: SPEAKER, title: TITLE, typeLine: talk(), link: site('/submit/token/SAMPLE') })),
    ],
  },
  {
    id: 'cfp-accepted',
    name: 'E2 Accepted, send your details',
    template: 'cfp-accepted',
    sender: 'sendCfpMessage',
    when:
      'When you press Accept on a submission while the call is open. After the close it follows E4 accepted. If it fails, the hourly run tries again.',
    to: 'The speaker',
    variants: [
      v('notice-set', 'Talk, session notice date set', () =>
        cfpAcceptedMessage({ name: SPEAKER, title: TITLE, typeLine: talk(), workshop: false, link: site('/speaker/SAMPLE'), dueDay: DUE_DAY, sessionNoticeDay: NOTICE_DAY }),
      ),
      v('notice-unset', 'Talk, session notice date not set', () =>
        cfpAcceptedMessage({ name: SPEAKER, title: TITLE, typeLine: talk(), workshop: false, link: site('/speaker/SAMPLE'), dueDay: DUE_DAY }),
      ),
      v('workshop', 'Workshop', () =>
        cfpAcceptedMessage({ name: SPEAKER, title: TITLE, typeLine: workshop(), workshop: true, link: site('/speaker/SAMPLE'), dueDay: DUE_DAY, sessionNoticeDay: NOTICE_DAY }),
      ),
    ],
  },
  {
    id: 'cfp-nudge',
    name: 'E3 Details reminder',
    template: 'cfp-nudge',
    sender: 'sendCfpMessage',
    when: 'By the hourly run, five days after E2, if the speaker has not sent their details yet. Once.',
    to: 'The speaker',
    variants: [
      v('talk', 'Talk', () => cfpNudgeMessage({ name: SPEAKER, title: TITLE, workshop: false, link: site('/speaker/SAMPLE'), dueDay: DUE_DAY })),
      v('workshop', 'Workshop', () => cfpNudgeMessage({ name: SPEAKER, title: TITLE, workshop: true, link: site('/speaker/SAMPLE'), dueDay: DUE_DAY })),
    ],
  },
  {
    id: 'cfp-decision-accepted',
    name: 'E4 Accepted after the close',
    template: 'cfp-decision-accepted',
    sender: 'sendCfpMessage',
    when: 'Never scheduled. Only when you press the send button for decisions on Dates and emails, for each accepted submission whose E2 was held. E2 follows straight after.',
    to: 'The speaker',
    variants: [v('default', 'Accepted', () => cfpCloseAcceptedMessage({ name: SPEAKER, title: TITLE }))],
  },
  {
    id: 'cfp-decision-declined',
    name: 'E4 Not accepted',
    template: 'cfp-decision-declined',
    sender: 'sendCfpMessage',
    when: 'Never scheduled. Only when you press the send button for decisions on Dates and emails, for each submission that was not accepted.',
    to: 'The person who submitted',
    variants: [
      v('reason', 'With a reason line', () =>
        cfpCloseDeclinedMessage({ name: SPEAKER, title: TITLE, reason: 'This is where the one editable reason line goes.' }),
      ),
      v('no-reason', 'Without a reason line', () => cfpCloseDeclinedMessage({ name: SPEAKER, title: TITLE })),
    ],
  },
  {
    id: 'cfp-still-open',
    name: 'E6 Still open',
    template: 'cfp-still-open',
    sender: 'sendCfpMessage',
    when: 'When you press Send E6 on Dates and emails. Goes to everyone still waiting for a decision.',
    to: 'Each person still waiting for a decision',
    variants: [
      v('date-set', 'Decision date set', () => cfpStillOpenMessage({ name: SPEAKER, title: TITLE, decisionDay: DECISION_DAY })),
      v('date-unset', 'Decision date not set', () => cfpStillOpenMessage({ name: SPEAKER, title: TITLE })),
    ],
  },
  {
    id: 'cfp-accept-notice',
    name: 'Acceptance notice to onboarding',
    template: 'cfp-accept-notice',
    sender: 'sendCfpMessage',
    when: 'Every time a submission is accepted, if an address is set in "Tell this address about every acceptance" on Dates and emails.',
    to: 'The onboarding address on Dates and emails (Min)',
    variants: (['sent', 'held', 'not sent'] as const).map((e2) =>
      v(
        e2.replace(' ', '-'),
        e2 === 'sent' ? 'E2 sent' : e2 === 'held' ? 'E2 held until the close' : 'E2 did not go out',
        () =>
          cfpAcceptNoticeMessage({
            speakerName: SPEAKER,
            organisation: COMPANY,
            title: TITLE,
            track: 'Sample Track',
            typeLine: talk(),
            acceptedDay: 'Tuesday 27 October 2026',
            link: dashboard('/content/call-for-speakers-abstracts/submissions/SAMPLE'),
            e2,
          }),
      ),
    ),
  },
  {
    id: 'cfp-weekly-reminder',
    name: 'Thursday review reminder',
    template: 'cfp-weekly-reminder',
    sender: 'sendCfpMessage',
    when: 'By the hourly run, on Thursdays from 9:00 New York time, while the call is open or submissions are still waiting.',
    to: 'The address in "Thursday reminder goes to" on Dates and emails',
    variants: [
      v('new', 'New submissions arrived', () =>
        cfpWeeklyReminderMessage({ name: 'Sample Reviewer', fresh: 4, open: 12, link: dashboard('/content/call-for-speakers-abstracts/review') }),
      ),
      v('nothing-new', 'Nothing new', () =>
        cfpWeeklyReminderMessage({ name: 'Sample Reviewer', fresh: 0, open: 12, link: dashboard('/content/call-for-speakers-abstracts/review') }),
      ),
    ],
  },
  {
    id: 'submission-receipt',
    name: 'Submission received (other calls)',
    template: 'submission-receipt',
    sender: 'sendSubmissionReceipt',
    when: 'When someone saves or submits on a call that does not use the E1 to E6 emails. At most one draft email an hour per address.',
    to: 'The person who submitted',
    variants: [
      v('submitted', 'Submitted', () =>
        submissionReceiptMessage({ to: SAMPLE_TO, name: SPEAKER, callTitle: 'Sample Call for Posters', title: TITLE, link: site('/submit/token/SAMPLE'), closesAtLabel: 'Friday 4 December 2026', draft: false }),
      ),
      v('draft', 'Saved as a draft', () =>
        submissionReceiptMessage({ to: SAMPLE_TO, name: SPEAKER, callTitle: 'Sample Call for Posters', title: TITLE, link: site('/submit/token/SAMPLE'), closesAtLabel: 'Friday 4 December 2026', draft: true }),
      ),
      v('draft-no-close', 'Draft, no close date', () =>
        submissionReceiptMessage({ to: SAMPLE_TO, name: SPEAKER, callTitle: 'Sample Call for Posters', title: TITLE, link: site('/submit/token/SAMPLE'), closesAtLabel: '', draft: true }),
      ),
    ],
  },
  {
    id: 'submission-decision',
    name: 'Submission decision (other calls)',
    template: 'submission-decision',
    sender: 'sendSubmissionDecision',
    when: 'When you press Notify the author on a submission for a call that does not use the E1 to E6 emails.',
    to: 'The person who submitted',
    variants: (
      [
        ['accepted', 'Accepted', { accepted: true }],
        ['declined', 'Not accepted', { accepted: false }],
        ['waitlisted', 'Waiting list', { accepted: false, waitlisted: true }],
        ['note', 'Not accepted, with a note', { accepted: false, note: 'A note from the committee goes here when one is typed.' }],
      ] as const
    ).map(([id, label, extra]) =>
      v(id, label, () =>
        submissionDecisionMessage({ name: SPEAKER, callTitle: 'Sample Call for Posters', title: TITLE, link: site('/submit/token/SAMPLE'), ...extra }),
      ),
    ),
  },
  {
    id: 'reviewer-invitation',
    name: 'Reviewer invitation',
    template: 'reviewer-invitation',
    sender: 'sendReviewerInvitation',
    when: 'When you press Send invitation on Reviewers. Pressing it again sends the same email with a new link, as a reminder.',
    to: 'The reviewer',
    variants: [
      v('assigned', 'Submissions assigned, due date set', () =>
        reviewerInvitationMessage({ name: 'Sample Reviewer', callTitle: 'Sample Call for Speakers', link: site('/review/SAMPLE'), assigned: 3, dueLabel: 'Friday 4 December 2026' }),
      ),
      v('none', 'Nothing assigned yet', () =>
        reviewerInvitationMessage({ name: 'Sample Reviewer', callTitle: 'Sample Call for Speakers', link: site('/review/SAMPLE'), assigned: 0 }),
      ),
    ],
  },

  // ── Tickets ──────────────────────────────────────────────────────────────
  {
    id: 'purchase-confirmation',
    name: 'Ticket confirmation',
    template: 'purchase-confirmation',
    sender: 'sendPurchaseConfirmation',
    when:
      'After a card payment on the website, when an invoice is marked paid, when you add an order or a comp pass, and when you press Resend confirmation on an attendee.',
    to: 'The ticket holder',
    variants: [
      v('default', 'With Bring your team', () =>
        purchaseConfirmationMessage(purchase(), inviteForCode('SAMPLE1', ORDER_URL(), ATTENDEE)),
      ),
      v('no-invite', 'Without Bring your team', () => purchaseConfirmationMessage(purchase(), null)),
    ],
  },
  {
    id: 'extra-added',
    name: 'Extra added to ticket',
    template: 'extra-added',
    sender: 'sendPurchaseConfirmation',
    when: 'After someone who already has a ticket pays for Workshops on top of it.',
    to: 'The ticket holder',
    variants: [
      v('workshops', 'Workshops', () =>
        extraAddedMessage({ ...purchase(), ticketType: 'Main Conference + Workshops', amountCents: 39900, addedExtra: 'Workshops' }),
      ),
    ],
  },
  {
    id: 'invoice-raised',
    name: 'Invoice raised',
    template: 'invoice-raised',
    sender: 'sendInvoiceRaised',
    when: 'When someone asks for an invoice on the tickets page. Stripe sends its own invoice email as well.',
    to: 'The person who asked for the invoice',
    variants: [
      v('po', 'With PO number and due date', () =>
        invoiceRaisedMessage({ to: SAMPLE_TO, companyName: COMPANY, seatCount: 3, totalCents: 239700, currency: 'usd', hostedInvoiceUrl: 'https://invoice.stripe.com/i/SAMPLE', poNumber: 'PO-0000', dueDate: 'Friday 4 December 2026' }),
      ),
      v('plain', 'One seat, no PO number', () =>
        invoiceRaisedMessage({ to: SAMPLE_TO, companyName: COMPANY, seatCount: 1, totalCents: 79900, currency: 'usd', hostedInvoiceUrl: 'https://invoice.stripe.com/i/SAMPLE' }),
      ),
    ],
  },
  {
    id: 'refund-confirmation',
    name: 'Refund confirmation',
    template: 'refund-confirmation',
    sender: 'sendRefundConfirmation',
    when: 'When Stripe reports a refund on a ticket order, whether it was made on the dashboard or in Stripe.',
    to: 'Whoever paid',
    variants: [
      v('cancelled', 'Ticket cancelled', () => refundConfirmationMessage(refund)),
      v('transferred', 'Ticket had been passed on', () => refundConfirmationMessage({ ...refund, transferred: true })),
      v('not-affected', 'Another order still covers the ticket', () => refundConfirmationMessage({ ...refund, ticketCancelled: false })),
      v('extra-removed', 'Workshops refunded, ticket kept', () =>
        refundConfirmationMessage({ ...refund, ticketType: 'Workshops', amountCents: 39900, extraRemoved: { name: 'Workshops', remaining: 'Main Conference' } }),
      ),
    ],
  },
  {
    id: 'ticket-cancelled',
    name: 'Ticket cancelled',
    template: 'ticket-cancelled',
    sender: 'sendTicketWithdrawn',
    when: 'When a ticket that was passed on to someone is refunded to the person who bought it.',
    to: 'The person holding the passed-on ticket',
    variants: [v('default', 'Cancelled', () => ticketWithdrawnMessage({ to: SAMPLE_TO, name: ATTENDEE, ticketType: 'Main Conference' }))],
  },

  // ── Sign-in codes ────────────────────────────────────────────────────────
  {
    id: 'sign-in-code',
    name: 'App sign-in code',
    template: 'sign-in-code',
    sender: 'sendSignInCode',
    when: 'When someone asks for a code on the sign-in screen of the KGC app.',
    to: 'Whoever typed their address',
    variants: [v('default', 'Code', () => signInCodeMessage({ code: SAMPLE_CODE, ttlMinutes: CODE_TTL_MINUTES }))],
  },
  {
    id: 'ticket-sign-in-code',
    name: 'Website sign-in code',
    template: accessCodeTemplate('ticket'),
    sender: 'sendBlogSignInCode',
    when: 'When a ticket holder asks for a code on the website to watch the sessions their ticket includes.',
    to: 'Whoever typed their address',
    variants: [v('default', 'Code', () => accessCodeMessage({ code: SAMPLE_CODE, expiresLabel: '10 minutes', surface: 'ticket' }))],
  },
  {
    id: 'dashboard-sign-in-code',
    name: 'Dashboard sign-in code',
    template: accessCodeTemplate('dashboard'),
    sender: 'sendBlogSignInCode',
    when: 'When someone on the access list signs in to this dashboard, and when a refund, an erasure or a mass send asks for a fresh code.',
    to: 'The team member',
    variants: [
      v('sign-in', 'Signing in', () => accessCodeMessage({ code: SAMPLE_CODE, expiresLabel: '10 minutes', surface: 'dashboard' })),
      v('confirm', 'Confirming an action', () => accessCodeMessage({ code: SAMPLE_CODE, expiresLabel: '10 minutes', surface: 'dashboard-confirm' })),
    ],
  },
  {
    id: 'blog-sign-in-code',
    name: 'Blog sign-in code',
    template: accessCodeTemplate('blog'),
    sender: 'sendBlogSignInCode',
    when: 'When a blog writer or editor signs in to the blog editor.',
    to: 'The writer or editor',
    variants: [v('default', 'Code', () => accessCodeMessage({ code: SAMPLE_CODE, expiresLabel: '10 minutes', surface: 'blog' }))],
  },

  // ── Campaigns and messages ───────────────────────────────────────────────
  {
    id: 'email-campaign',
    name: 'Email campaign',
    template: 'bulk-message',
    sender: 'sendBulkMessage',
    when: 'When you send an Email Campaign from Tickets. Only people on the contact list get it, and it carries an unsubscribe link.',
    to: 'Each contact in the audience you pick',
    variants: [
      v('default', 'Campaign', () =>
        bulkMessageMessage({ name: ATTENDEE, subject: 'Sample campaign subject', body: bulkBody }, site('/u/SAMPLE-TOKEN'), postalAddress()),
      ),
    ],
  },
  {
    id: 'message-speakers-sponsors',
    name: 'Message to speakers or sponsors',
    template: 'bulk-message',
    sender: 'sendBulkMessage',
    when: 'When you send from Message Speakers or Message Sponsors. There is an unsubscribe link only for someone who is also on the contact list.',
    to: 'Each speaker or sponsor contact in the group you pick',
    variants: [
      v('default', 'No unsubscribe link', () =>
        bulkMessageMessage({ name: SPEAKER, subject: 'Sample message subject', body: bulkBody }, null, postalAddress()),
      ),
      v('contact', 'Also on the contact list', () =>
        bulkMessageMessage({ name: SPEAKER, subject: 'Sample message subject', body: bulkBody }, site('/u/SAMPLE-TOKEN'), postalAddress()),
      ),
    ],
  },
  {
    id: 'seat-promotion',
    name: 'You have a seat',
    template: 'bulk-message',
    sender: 'sendBulkMessage',
    when: 'When a seat opens in a session with a seat limit and the first person on its waitlist gets it.',
    to: 'The attendee who got the seat',
    variants: [
      v('default', 'Seat', () => bulkMessageMessage({ name: ATTENDEE, ...seatPromotionCopy('Sample Workshop') }, null, postalAddress())),
    ],
  },
  {
    id: 'consent-request',
    name: 'Consent form request',
    template: 'consent-request',
    sender: 'sendConsentRequest',
    when: 'When you send signing links from Release and Consent Forms, and when someone is added to a form that is already published.',
    to: 'Each person asked to sign',
    variants: [
      v('first', 'First request', () =>
        consentRequestMessage({ name: SPEAKER, formTitle: 'Sample Photo and Video Release', version: 1, link: site('/consent/SAMPLE'), resigning: false }),
      ),
      v('resign', 'Wording changed, sign again', () =>
        consentRequestMessage({ name: SPEAKER, formTitle: 'Sample Photo and Video Release', version: 2, link: site('/consent/SAMPLE'), resigning: true }),
      ),
    ],
  },

  // ── Speakers, sponsors and exhibitors ────────────────────────────────────
  {
    id: 'speaker-profile-request',
    name: 'Speaker profile request',
    template: 'speaker-profile-request',
    sender: 'sendSpeakerProfileRequest',
    when: 'When you press Send link in Speaker Manager. Pressing it again sends the same email with a new link, as a reminder.',
    to: 'The speaker',
    variants: [
      v('missing', 'One session, details missing', () =>
        speakerProfileRequestMessage({ name: SPEAKER, link: site('/speaker/SAMPLE'), sessionTitles: [TITLE], missingLabel: 'a bio and a photo' }),
      ),
      v('complete', 'Several sessions, nothing missing', () =>
        speakerProfileRequestMessage({ name: SPEAKER, link: site('/speaker/SAMPLE'), sessionTitles: [TITLE, 'A Second Sample Talk'] }),
      ),
    ],
  },
  {
    id: 'exhibitor-lead-link',
    name: 'Exhibitor lead link',
    template: 'exhibitor-lead-link',
    sender: 'sendExhibitorLeadLink',
    when: 'When you press Send link in Exhibitor Manager. Pressing it again sends a new link.',
    to: 'The exhibitor contact',
    variants: [
      v('booth', 'With a stand number', () =>
        exhibitorLeadLinkMessage({ companyName: COMPANY, contactName: 'Sample Exhibitor', link: site('/exhibitor/SAMPLE'), boothNumber: '00' }),
      ),
      v('no-booth', 'No stand number yet', () =>
        exhibitorLeadLinkMessage({ companyName: COMPANY, contactName: 'Sample Exhibitor', link: site('/exhibitor/SAMPLE') }),
      ),
    ],
  },

  // ── Blog ─────────────────────────────────────────────────────────────────
  {
    id: 'blog-invitation',
    name: 'Blog invitation',
    template: 'blog-invitation',
    sender: 'sendBlogInvitation',
    when: 'When someone is added as a blog writer or editor, on Admin Settings here or in the blog editor.',
    to: 'The new writer or editor',
    variants: [
      v('writer', 'Writer', () =>
        blogInvitationMessage({ name: 'Sample Writer', invitedBy: 'The KGC team', roleLabel: 'a writer', link: blogSignInLink(SAMPLE_TO) }),
      ),
    ],
  },
  {
    id: 'blog-review-request',
    name: 'Blog review request',
    template: 'blog-review-request',
    sender: 'sendBlogReviewRequest',
    when: 'When a writer submits a post, or changes to a published post, for review.',
    to: 'Every blog editor',
    variants: [
      v('new', 'New post', () => blogReviewRequestMessage({ authorName: 'Sample Writer', title: 'A Sample Blog Post', link: blog('/write/SAMPLE'), isEdit: false })),
      v('edit', 'Changes to a published post', () =>
        blogReviewRequestMessage({ authorName: 'Sample Writer', title: 'A Sample Blog Post', link: blog('/write/SAMPLE'), isEdit: true }),
      ),
    ],
  },
  {
    id: 'blog-review-decision',
    name: 'Blog review decision',
    template: 'blog-review-decision',
    sender: 'sendBlogReviewDecision',
    when: 'When an editor publishes a submitted post or sends it back for changes.',
    to: 'The writer',
    variants: [
      v('published', 'Published', () =>
        blogReviewDecisionMessage({ name: 'Sample Writer', title: 'A Sample Blog Post', decision: 'published', link: blog('/a-sample-blog-post') }),
      ),
      v('changes', 'Changes requested', () =>
        blogReviewDecisionMessage({
          name: 'Sample Writer',
          title: 'A Sample Blog Post',
          decision: 'changes-requested',
          note: 'The editor\'s note goes here when one is left.',
          link: blog('/write/SAMPLE'),
        }),
      ),
    ],
  },

  // ── Dashboard team ───────────────────────────────────────────────────────
  {
    id: 'team-invitation',
    name: 'Team invitation',
    template: 'team-invitation',
    sender: 'sendTeamInvitation',
    when: 'When an owner adds someone to the dashboard team on Admin Settings.',
    to: 'The new team member',
    variants: [
      v('default', 'Invitation', () =>
        teamInvitationMessage({ name: 'Sample Teammate', rolesLabel: 'Finance, Check-in', link: dashboard(`/login?email=${encodeURIComponent(SAMPLE_TO)}`) }),
      ),
    ],
  },
];

export function findFormat(id: string): EmailFormat | undefined {
  return EMAIL_FORMATS.find((f) => f.id === id);
}

/** One sample, with the headers it would be sent with. The subject is cleaned as `send()` cleans it. */
export interface RenderedFormat extends EmailMessage {
  from: string;
  replyTo: string;
  to: string;
}

export function renderFormat(format: EmailFormat, variantId?: string): { variant: FormatVariant; email: RenderedFormat } {
  const variant = format.variants.find((x) => x.id === variantId) ?? format.variants[0];
  const message = variant.render();
  const { from, replyTo } = senderIdentity();
  return { variant, email: { ...message, subject: headerText(message.subject), from, replyTo, to: SAMPLE_TO } };
}

/**
 * The formats a search keeps. Matches the name, when it is sent, who gets
 * it, the template id and every variant's label and subject, ignoring case.
 */
export function searchFormats(formats: readonly EmailFormat[], query: string | undefined): EmailFormat[] {
  const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...formats];
  return formats.filter((f) => {
    const hay = [
      f.name,
      f.when,
      f.to,
      f.template,
      ...f.variants.flatMap((x) => [x.label, headerText(x.render().subject)]),
    ]
      .join(' ')
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The address all mail comes from, for the screen's header line. */
export const CONTACT_ADDRESS = EVENT.contactEmail;
