/**
 * The words organizers use for screens, where they differ from Whova's label.
 *
 * The nav tree is Whova's vocabulary, not an organizer's. Nothing in it is
 * called "refund", "promo code", "roster" or "name tag", so the search returned
 * nothing for all four while the screen the person wanted sat two clicks away.
 * This is the gap between a search box that indexes titles and one that answers
 * questions, and it is filled by a list rather than a model — 215 screens is
 * small enough that a hand-written mapping beats anything cleverer, and it is
 * the only form of it that can be read, reviewed and corrected by whoever
 * notices the miss.
 *
 * Rules for editing:
 *
 *   - Keys are paths from `nav.ts`. `tests/programme/feature-search.test.ts`
 *     asserts every one of them still exists, so a renamed slug fails the suite
 *     instead of silently dropping the alias.
 *   - Add the word an organizer would type, not a synonym of the title. "Name
 *     Badges" does not need the alias "badges" — the title already matches.
 *     It needs "name tag" and "lanyard".
 *   - Aliases rank below every title match, so a broad word here cannot push a
 *     directly-named screen down the list.
 *   - British and American spellings both, when they differ. An organizer who
 *     types "colours" is not helped by a note that the file says "colors".
 */

export const ALIASES: Record<string, string[]> = {
  // ── Money in ───────────────────────────────────────────────────────────
  'tickets/orders-and-transactions/attendee-orders': [
    'refund', 'refunds', 'chargeback', 'cancel order', 'buyer', 'purchases', 'who bought',
  ],
  'tickets/orders-and-transactions/transaction-history': [
    'invoice', 'invoices', 'receipt', 'receipts', 'payments', 'stripe', 'charges',
  ],
  'tickets/orders-and-transactions/summary': [
    'revenue', 'sales', 'income', 'earnings', 'takings', 'how much have we sold',
  ],
  'tickets/payout': ['bank account', 'get paid', 'deposit', 'money out', 'withdraw'],
  'tickets/ticket-setup/discount-codes': [
    'discount', 'promo', 'promo code', 'coupon', 'voucher', 'comp code', 'free code',
  ],
  'tickets/ticket-setup/1-1-create-tickets': [
    'price', 'pricing', 'cost', 'ticket price', 'tiers', 'early bird', 'new ticket',
  ],
  'tickets/ticket-setup/1-2-question-forms': [
    'registration questions', 'custom questions', 'dietary', 'accessibility', 'form',
  ],
  'tickets/ticket-setup/1-3-confirmation-emails': ['confirmation email', 'order email', 'receipt email'],
  'tickets/ticket-setup/1-6-abandoned-registration': ['abandoned cart', 'incomplete registration', 'dropped off'],
  'tickets/ticket-setup/1-4-registration-pages': ['registration page', 'signup page', 'sign up page'],
  'tickets/publish-tickets': ['go live', 'open sales', 'start selling', 'on sale'],
  'tickets/ticket-marketing/email-campaign': [
    'email blast', 'newsletter', 'mass email', 'marketing email', 'campaign',
  ],
  'tickets/ticket-marketing/campaign-link-tracking': ['utm', 'tracking link', 'short link'],

  // ── Money out ──────────────────────────────────────────────────────────
  'pay/balance': ['bill', 'amount due', 'what do we owe', 'account balance'],
  'pay/billing-information': ['billing', 'vat', 'tax id', 'company address', 'purchase order'],

  // ── The door ───────────────────────────────────────────────────────────
  'attendees/check-in-and-checkout/check-in': [
    'checkin', 'scan', 'scanning', 'scanner', 'door', 'desk', 'entry', 'arrival', 'registration desk',
  ],
  'attendees/check-in-and-checkout/kiosk-check-in': ['kiosk', 'ipad', 'unattended'],
  'attendees/check-in-and-checkout/self-check-in': ['self serve', 'attendee scans'],
  'attendees/name-badges': ['name tag', 'name tags', 'lanyard', 'print badges', 'badge printing'],
  'attendees/certificates': ['certificate', 'cpe', 'ceu', 'proof of attendance'],

  // ── People ─────────────────────────────────────────────────────────────
  'attendees/manage-attendees/attendees': [
    'roster', 'registrants', 'participants', 'guest list', 'delegates', 'who is coming', 'people',
  ],
  'attendees/manage-attendees/analytics-and-exports': [
    'export', 'csv', 'download', 'spreadsheet', 'excel', 'data dump',
  ],
  'attendees/segments': ['segment', 'cohort', 'filter attendees'],
  'attendees/call-for-volunteers/volunteer-manager': ['volunteer', 'volunteers', 'helpers', 'crew'],
  'attendees/manage-attendees/hybrid-settings': ['hybrid', 'remote attendees', 'online attendees'],

  // ── Programme ──────────────────────────────────────────────────────────
  'content/agenda-center/session-manager': [
    'agenda', 'schedule', 'programme', 'program', 'timetable', 'sessions', 'talks', 'workshops', 'add session',
  ],
  'content/agenda-center/track-manager': ['track', 'tracks', 'theme', 'themes', 'streams'],
  'content/agenda-center/conflict-check': ['clash', 'clashes', 'double booked', 'overlap', 'collision'],
  'content/agenda-center/session-qanda-manager': ['audience questions', 'ask a question'],
  'content/speaker-center/speaker-manager': ['presenters', 'bios', 'headshots', 'add speaker'],
  'content/speaker-center/message-speakers': ['email speakers', 'contact speakers'],
  'content/call-for-speakers-abstracts': ['cfp', 'call for papers', 'submissions', 'proposals'],
  'content/documents-and-videos/documents': ['handout', 'handouts', 'slides', 'pdf', 'materials', 'upload files'],
  'content/documents-and-videos/video-hosting': ['recording', 'recordings', 'videos'],
  'content/logistics-center': ['logistics', 'shuttle', 'hotel', 'travel', 'parking', 'directions'],

  // ── Partners ───────────────────────────────────────────────────────────
  'content/exhibitor-center/exhibitor-manager': ['vendor', 'vendors', 'booth', 'booths', 'stand', 'stands'],
  'content/sponsor-center/sponsor-manager': ['partners', 'sponsor logos'],
  'content/sponsor-center/sponsor-tiering': ['gold', 'silver', 'bronze', 'sponsor levels', 'packages'],

  // ── The event brand ────────────────────────────────────────────────────
  'content/basics': ['event name', 'dates', 'venue', 'timezone', 'time zone', 'location'],
  'content/branding-center/app-branding': ['logo', 'colours', 'colors', 'brand', 'theme', 'banner'],
  'marketing/event-website': ['website', 'landing page', 'event site'],

  // ── In the room ────────────────────────────────────────────────────────
  'engagement/announcements': [
    'push', 'push notification', 'notify', 'alert', 'broadcast', 'message attendees', 'tell everyone',
  ],
  'engagement/live-polling': ['poll', 'polls', 'vote', 'voting'],
  'engagement/surveys': ['survey', 'questionnaire', 'nps', 'feedback form'],
  'engagement/session-feedback': ['ratings', 'rate session', 'reviews'],
  'engagement/1-1-meeting-scheduler': ['meeting', 'meetings', 'one on one', 'appointments'],
  'engagement/round-table': ['round table', 'tables', 'discussion tables'],
  'engagement/speed-networking': ['networking', 'matchmaking'],
  'engagement/floormap': ['floor plan', 'floorplan', 'map', 'exhibition hall', 'venue map'],
  'engagement/gamification': ['game', 'points', 'leaderboard', 'challenge', 'passport'],
  'engagement/community/meet-ups': ['meetup', 'meetups', 'socials'],

  // ── Streaming ──────────────────────────────────────────────────────────
  'virtual-and-hybrid/online-session-manager/streaming-setup': [
    'stream', 'streaming', 'livestream', 'live stream', 'broadcast', 'youtube', 'vimeo', 'virtual',
  ],
  'virtual-and-hybrid/adv-stream-integration/zoom': ['zoom'],
  'virtual-and-hybrid/adv-stream-integration/microsoft-teams': ['teams', 'microsoft teams'],
  'virtual-and-hybrid/logistics-management/emergency-manager': ['emergency', 'incident', 'safety', 'evacuation'],
  'virtual-and-hybrid/logistics-management/event-checklist': ['checklist', 'todo', 'to do', 'tasks'],

  // ── Running it ─────────────────────────────────────────────────────────
  'tools/report': ['report', 'reports', 'stats', 'statistics', 'analytics', 'metrics', 'numbers'],
  'tools/moderator-tools/community-board': ['moderate', 'moderation', 'flagged', 'abuse', 'spam'],
  'tools/admin-control/code-access-control': ['access code', 'invite code', 'join code', 'private event'],
  'tools/app-adoption/app-download-button': ['download app', 'app link', 'get the app'],
  'content/project-management/projects-and-checklists': ['project', 'tasks', 'planning'],

  // ── Plumbing ───────────────────────────────────────────────────────────
  'attendees/integrations/mailchimp': ['mailchimp'],
  'attendees/integrations/constant-contact': ['constant contact'],
  'attendees/integrations/crm-integration-via-zapier': ['zapier', 'crm', 'salesforce'],
  'tickets/hubspot-connection-guide': ['hubspot'],
  'tickets/export-to-ams-crm': ['ams', 'export to crm'],
};
