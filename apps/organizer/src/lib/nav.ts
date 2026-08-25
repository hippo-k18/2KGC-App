/**
 * Whova's organizer-dashboard navigation, transcribed from the live product.
 *
 * Not reconstructed from help-centre article paths this time — lifted from
 * Whova's own shipped bundle. `https://whova.com/xems/` is a public SPA whose
 * webpack chunks contain the menu definition as data: an array of
 * `{name, title, widthClass, children}` objects that the sidebar and the top
 * tab bar both render. The `name` field below is Whova's internal feature key,
 * verbatim, and the `title` is the string an organizer actually reads. Both are
 * theirs. Only `slug` is ours — a URL-safe form of the title, because Whova
 * routes by opaque feature name (`/xems/view/agendamgm/{event_id}/`) and a
 * readable path costs nothing.
 *
 * Two consequences worth knowing before editing:
 *
 *   - The order here is Whova's render order, which is NOT the order in
 *     `whova-rebuild/research/02-organizer-backend.md` §1. The research
 *     reconstructed the IA from ~900 help-centre paths in 2026-08 and got the
 *     nesting right but the sequence wrong; the live tree puts Virtual & Hybrid
 *     second and Tickets fifth, and has a `Pay` tab the research folded into
 *     `Publish`. Trust this file over the research where they disagree.
 *   - `widthClass` is load-bearing. Whova sizes top-level tabs by class
 *     (`small` 10%, `medium` 12.5%, `large` 15%) and the nine of them sum to
 *     117.5%, so in their flex row the tabs shrink proportionally. Reproducing
 *     that ratio is why "Virtual & Hybrid" is visibly wider than "Content".
 *
 * A node is `implemented` when a real screen file exists under the same route
 * and reads real Firestore data; everything else renders the honest
 * placeholder. The catch-all at `src/app/(dash)/[...slug]/page.tsx` resolves any
 * path in this tree, so nothing in the nav 404s.
 */

export interface NavNode {
  /** Whova's internal feature key. Stable; used as the React key and for lookups. */
  name: string;
  /** The label an organizer reads. Whova's string, verbatim, ampersands and all. */
  title: string;
  /** URL segment. Ours — Whova routes by feature name, which makes for unreadable paths. */
  slug: string;
  /** Top-level tabs only. Whova's flex sizing: small 10%, medium 12.5%, large 15%. */
  widthClass?: 'small' | 'medium' | 'large';
  /**
   * The coloured pill Whova prints after a sidebar label. `step` is the dark-blue
   * "Step 1/2/3" rounded pill that sequences the Tickets tab; the rest are their
   * merchandising badges and are copied because their absence reads as a
   * different product, not as a tidier one.
   */
  tag?: 'new' | 'hot' | 'enhanced' | 'step';
  /** Text inside a `step` pill. Whova numbers only three of the Tickets groups. */
  tagLabel?: string;
  children?: NavNode[];
}

export const NAV: NavNode[] = [
  { name: "content", title: "Content", slug: "content", widthClass: "small", children: [
    { name: "basics", title: "Basics", slug: "basics" },
    { name: "branding_center", title: "Branding Center", slug: "branding-center", children: [
      { name: "app_branding", title: "App Branding", slug: "app-branding" },
      { name: "customize_resources", title: "Customize Resources", slug: "customize-resources" },
      { name: "web_app_speaker_page", title: "Web App Speaker Page", slug: "web-app-speaker-page" },
      { name: "branded_event_url", title: "Branded Event URL", slug: "branded-event-url" }
    ] },
    { name: "agenda", title: "Agenda Center", slug: "agenda-center", children: [
      { name: "session_manager", title: "Session Manager", slug: "session-manager" },
      { name: "track_manager", title: "Track Manager", slug: "track-manager" },
      { name: "conflict_check", title: "Conflict Check", slug: "conflict-check" },
      { name: "session_qa_manager", title: "Session Q&A Manager", slug: "session-qanda-manager" }
    ] },
    { name: "speaker_center", title: "Speaker Center", slug: "speaker-center", children: [
      { name: "speaker_manager", title: "Speaker Manager", slug: "speaker-manager" },
      { name: "message_speakers", title: "Message Speakers", slug: "message-speakers" },
      { name: "speaker_release_consent", title: "Release & Consent Forms", slug: "release-and-consent-forms" }
    ] },
    { name: "call_for_speakers", title: "Call For Speakers/Abstracts", slug: "call-for-speakers-abstracts" },
    { name: "exhibitor_center", title: "Exhibitor Center", slug: "exhibitor-center", children: [
      { name: "exhibitor_manager", title: "Exhibitor Manager", slug: "exhibitor-manager" },
      { name: "exhibitor_messages", title: "Message Exhibitors", slug: "message-exhibitors" },
      { name: "exhibitor_passport_contest", title: "Passport Contest", slug: "passport-contest" },
      { name: "exhibitor_outreach", title: "Outreach Campaigns", slug: "outreach-campaigns" },
      { name: "compliance_documents", title: "Exhibitor Trivia", slug: "exhibitor-trivia", tag: "new" }
    ] },
    { name: "sponsor_center", title: "Sponsor Center", slug: "sponsor-center", children: [
      { name: "sponsor_manager", title: "Sponsor Manager", slug: "sponsor-manager" },
      { name: "sponsor_tiering", title: "Sponsor Tiering", slug: "sponsor-tiering" },
      { name: "message_sponsors", title: "Message Sponsors", slug: "message-sponsors" },
      { name: "advanced_banners", title: "Advanced Banners", slug: "advanced-banners" },
      { name: "sponsor_outreach", title: "Outreach Campaigns", slug: "outreach-campaigns" }
    ] },
    { name: "project_management", title: "Project Management", slug: "project-management", tag: "new", children: [
      { name: "projects_checklists", title: "Projects & Checklists", slug: "projects-and-checklists" },
      { name: "message_team_members", title: "Message Team Members", slug: "message-team-members" }
    ] },
    { name: "artifact_center", title: "Artifact Center (Poster/Pitch/Gallery)", slug: "artifact-center-poster-pitch-gallery", children: [
      { name: "artifact_manager", title: "Artifact Manager", slug: "artifact-manager" },
      { name: "message_presenters", title: "Message Presenters", slug: "message-presenters" },
      { name: "artifact_competition", title: "Competition", slug: "competition" },
      { name: "artifact_streaming", title: "Artifact Streaming", slug: "artifact-streaming" }
    ] },
    { name: "career_fair_center", title: "Fair Center", slug: "fair-center", children: [
      { name: "career_fair_manager", title: "Fair Manager", slug: "fair-manager" }
    ] },
    { name: "documents_videos", title: "Documents & Videos", slug: "documents-and-videos", children: [
      { name: "documents", title: "Documents", slug: "documents" },
      { name: "video_hosting", title: "Video Hosting", slug: "video-hosting" },
      { name: "video_access", title: "Attendee Video Access", slug: "attendee-video-access" }
    ] },
    { name: "logistics_center", title: "Logistics Center", slug: "logistics-center" }
  ] },
  { name: "virtual_hybrid", title: "Virtual & Hybrid", slug: "virtual-and-hybrid", widthClass: "large", children: [
    { name: "virtual_hybrid_setup", title: "Virtual & Hybrid Setup", slug: "virtual-and-hybrid-setup" },
    { name: "online_session_manager", title: "Online Session Manager", slug: "online-session-manager", children: [
      { name: "streaming_setup", title: "Streaming Setup", slug: "streaming-setup" },
      { name: "rehearsal_sessions", title: "Rehearsal Sessions", slug: "rehearsal-sessions" }
    ] },
    { name: "advanced_stream_integration", title: "Adv. Stream Integration", slug: "adv-stream-integration", children: [
      { name: "zoom_integration", title: "Zoom", slug: "zoom" },
      { name: "microsoft_teams_integration", title: "Microsoft Teams", slug: "microsoft-teams" }
    ] },
    { name: "session_gamification", title: "Attendance Gamification", slug: "attendance-gamification" },
    { name: "attendee_activity", title: "Attendee Activity", slug: "attendee-activity" },
    { name: "logistics_management", title: "Logistics Management", slug: "logistics-management", children: [
      { name: "event_checklist", title: "Event Checklist", slug: "event-checklist" },
      { name: "emergency_manager", title: "Emergency Manager", slug: "emergency-manager" }
    ] },
    { name: "other_tools", title: "Other Tools", slug: "other-tools" },
    { name: "tutorials_and_tips", title: "Tutorials and Tips", slug: "tutorials-and-tips" }
  ] },
  { name: "engagement", title: "Engagement", slug: "engagement", widthClass: "medium", children: [
    { name: "announcements", title: "Announcements", slug: "announcements" },
    { name: "community", title: "Community", slug: "community", tag: "hot", children: [
      { name: "meet_ups", title: "Meet-ups", slug: "meet-ups" },
      { name: "discussion_topics", title: "Discussion Topics", slug: "discussion-topics" },
      { name: "social_groups", title: "Social Groups", slug: "social-groups" },
      { name: "attendee_matchmaking", title: "Attendee Matchmaking", slug: "attendee-matchmaking" }
    ] },
    { name: "gamification", title: "Gamification", slug: "gamification", tag: "hot" },
    { name: "meetings", title: "1-1 Meeting Scheduler", slug: "1-1-meeting-scheduler" },
    { name: "speed_networking", title: "Speed Networking", slug: "speed-networking" },
    { name: "round_table", title: "Round Table", slug: "round-table" },
    { name: "session_feedback", title: "Session Feedback", slug: "session-feedback" },
    { name: "surveys", title: "Surveys", slug: "surveys", tag: "enhanced" },
    { name: "floormap", title: "Floormap", slug: "floormap" },
    { name: "announcement_wall", title: "Announcement Wall", slug: "announcement-wall", children: [
      { name: "announcement_wall_customization", title: "Activity Stream Webpage", slug: "activity-stream-webpage" }
    ] },
    { name: "live_polling", title: "Live Polling", slug: "live-polling" },
    { name: "photos", title: "Photos", slug: "photos", children: [
      { name: "photo_collection", title: "Photo Collection", slug: "photo-collection" },
      { name: "profile_photo_frames", title: "Profile Photo Frames", slug: "profile-photo-frames" },
      { name: "photo_booth", title: "Photo Booth", slug: "photo-booth" }
    ] }
  ] },
  { name: "event_marketing", title: "Marketing", slug: "marketing", widthClass: "medium", children: [
    { name: "event_webpages", title: "Event Webpages", slug: "event-webpages", children: [
      { name: "agenda_webpage", title: "Agenda Webpage", slug: "agenda-webpage", children: [
        { name: "primary_agenda", title: "General-Purpose", slug: "general-purpose" },
        { name: "secondary_agenda", title: "Special-Purpose", slug: "special-purpose" },
        { name: "agenda_analytics", title: "Analytics", slug: "analytics" }
      ] },
      { name: "speaker_webpage", title: "Speaker Webpage", slug: "speaker-webpage" },
      { name: "sponsor_webpage", title: "Sponsor Webpage", slug: "sponsor-webpage", children: [
        { name: "sponsor_list", title: "Sponsor List", slug: "sponsor-list" },
        { name: "sponsor_banner", title: "Sponsor Banner", slug: "sponsor-banner" }
      ] },
      { name: "exhibitor_webpage", title: "Exhibitor Webpage", slug: "exhibitor-webpage" },
      { name: "artifact_webpage", title: "Artifact Webpage", slug: "artifact-webpage" },
      { name: "logistics_webpage", title: "Logistics Webpage", slug: "logistics-webpage" },
      { name: "venue_map_webpage", title: "Venue Map Webpage", slug: "venue-map-webpage" }
    ] },
    { name: "event_website", title: "Event Website", slug: "event-website" },
    { name: "organizer_copromo", title: "Organizer Co-Promo", slug: "organizer-co-promo" },
    { name: "whova_listing", title: "Whova Listing", slug: "whova-listing", children: [
      { name: "event_listing", title: "My Event Listing", slug: "my-event-listing" },
      { name: "traffic_analytics", title: "Traffic Analytics", slug: "traffic-analytics" }
    ] },
    { name: "social_wall", title: "Social Wall", slug: "social-wall", children: [
      { name: "social_wall_customization", title: "Social Wall Customization", slug: "social-wall-customization" },
      { name: "activity_stream_webpage", title: "Activity Stream Webpage", slug: "activity-stream-webpage" }
    ] },
    { name: "social_media_center", title: "Social Media Center", slug: "social-media-center", children: [
      { name: "social_media_manager", title: "Social Media Manager", slug: "social-media-manager" },
      { name: "content_library", title: "Content Library", slug: "content-library" }
    ] }
  ] },
  { name: "tickets", title: "Tickets", slug: "tickets", widthClass: "large", children: [
    { name: "ticket_setup", title: "Ticket Setup", slug: "ticket-setup", tag: "step", tagLabel: "Step 1", children: [
      { name: "create_tickets_attendee", title: "1.1 Create Tickets", slug: "1-1-create-tickets" },
      { name: "group_tickets", title: "Create Group Tickets", slug: "create-group-tickets" },
      { name: "question_form", title: "1.2 Question Forms", slug: "1-2-question-forms" },
      { name: "event_reg_confirm", title: "1.3 Confirmation Emails", slug: "1-3-confirmation-emails" },
      { name: "ticket_addon", title: "Ticket Add-ons", slug: "ticket-add-ons" },
      { name: "discount_codes", title: "Discount Codes", slug: "discount-codes" },
      { name: "ticket_restriction", title: "Member & Invite-Only Ticketing", slug: "member-and-invite-only-ticketing", tag: "new" },
      { name: "memberclicks_guide", title: "MemberClicks connection guide", slug: "memberclicks-connection-guide" },
      { name: "imis_guide", title: "iMIS connection guide", slug: "imis-connection-guide" },
      { name: "ym_guide", title: "YourMembership connection guide", slug: "yourmembership-connection-guide" },
      { name: "neon_guide", title: "Neon CRM connection guide", slug: "neon-crm-connection-guide" },
      { name: "session_rsvp", title: "Session RSVP", slug: "session-rsvp" },
      { name: "event_reg_page_settings", title: "1.4 Registration Pages", slug: "1-4-registration-pages" },
      { name: "marketing_embed", title: "1.5 Registration Widgets", slug: "1-5-registration-widgets" },
      { name: "abandoned_registration", title: "1.6 Abandoned Registration", slug: "1-6-abandoned-registration" },
      { name: "registration_settings", title: "1.7 Registration Settings", slug: "1-7-registration-settings" }
    ] },
    { name: "exhibitor_reg", title: "Exhibitor Ticket Setup", slug: "exhibitor-ticket-setup", children: [
      { name: "create_ticket_exhibitor", title: "2.1 Exhibitor Tickets", slug: "2-1-exhibitor-tickets" },
      { name: "reg_form_exhibitor", title: "2.2 Question Forms", slug: "2-2-question-forms" },
      { name: "booth_selection_exhibitor", title: "2.3 Booth Selection", slug: "2-3-booth-selection" },
      { name: "reg_confirm_exhibitor", title: "2.4 Confirmation Emails", slug: "2-4-confirmation-emails" },
      { name: "reg_addon_exhibitor", title: "2.5 Ticket Add-ons", slug: "2-5-ticket-add-ons" },
      { name: "reg_discount_exhibitor", title: "Discount Codes", slug: "discount-codes" },
      { name: "exhibitor-offline-payments", title: "2.6 Offline Payment", slug: "2-6-offline-payment" },
      { name: "prepaid-exhibitors", title: "Pre-Paid Exhibitors", slug: "pre-paid-exhibitors" },
      { name: "reg_settings_exhibitor", title: "Registration Settings", slug: "registration-settings" },
      { name: "event_reg_page_settings_exhibitor", title: "2.7 Registration Page", slug: "2-7-registration-page" },
      { name: "marketing_embed_exhibitor", title: "2.8 Registration Widget", slug: "2-8-registration-widget" }
    ] },
    { name: "sponsor_reg", title: "Sponsor Ticket Setup", slug: "sponsor-ticket-setup", children: [
      { name: "create_ticket_sponsor", title: "Sponsor Tickets", slug: "sponsor-tickets" },
      { name: "reg_form_sponsor", title: "Question Forms", slug: "question-forms" },
      { name: "reg_confirm_sponsor", title: "Confirmation Emails", slug: "confirmation-emails" },
      { name: "reg_discount_sponsor", title: "Discount Codes", slug: "discount-codes" },
      { name: "reg_settings_sponsor", title: "Registration Settings", slug: "registration-settings" },
      { name: "event_reg_page_settings_sponsor", title: "Registration Page", slug: "registration-page" },
      { name: "marketing_embed_sponsor", title: "Registration Widget", slug: "registration-widget" }
    ] },
    { name: "payout", title: "Payout", slug: "payout", tag: "step", tagLabel: "Step 2" },
    { name: "publish_tickets", title: "Publish Tickets", slug: "publish-tickets", tag: "step", tagLabel: "Step 3" },
    { name: "ticket_marketing", title: "Ticket Marketing", slug: "ticket-marketing", children: [
      { name: "email_campaign", title: "Email Campaign", slug: "email-campaign" },
      { name: "campaign_contact_list", title: "Campaign Contact List", slug: "campaign-contact-list" },
      { name: "campaign_link_tracking", title: "Campaign Link Tracking", slug: "campaign-link-tracking" },
      { name: "referral_contest", title: "Referral Contest", slug: "referral-contest", tag: "new" },
      { name: "ticket_social_sharing", title: "Social Sharing", slug: "social-sharing" },
      { name: "ticket_event_listing", title: "Event Listing", slug: "event-listing" },
      { name: "event_website_reg", title: "Event Website", slug: "event-website" }
    ] },
    { name: "reg_orders", title: "Orders and Transactions", slug: "orders-and-transactions", children: [
      { name: "reg_all_orders", title: "Summary", slug: "summary" },
      { name: "reg_attendee_orders", title: "Attendee Orders", slug: "attendee-orders" },
      { name: "reg_exhibitor_orders", title: "Exhibitor Orders", slug: "exhibitor-orders" },
      { name: "reg_sponsor_orders", title: "Sponsor Orders", slug: "sponsor-orders" },
      { name: "reg_transaction_history", title: "Transaction History", slug: "transaction-history" }
    ] },
    { name: "attendee_customization", title: "Attendee Customization", slug: "attendee-customization", children: [
      { name: "ticket_tiering", title: "Ticket Tiering", slug: "ticket-tiering" },
      { name: "attendee_categories", title: "Attendee Categories", slug: "attendee-categories" }
    ] },
    { name: "hubspot_guide", title: "HubSpot connection guide", slug: "hubspot-connection-guide" },
    { name: "memberclicks_export_guide", title: "MemberClicks connection guide", slug: "memberclicks-connection-guide" },
    { name: "zapier_export_guide", title: "Export to AMS/CRM", slug: "export-to-ams-crm" }
  ] },
  { name: "attendees", title: "Attendees", slug: "attendees", widthClass: "medium", children: [
    { name: "manage_attendees", title: "Manage Attendees", slug: "manage-attendees", children: [
      { name: "attendees_list", title: "Attendees", slug: "attendees" },
      { name: "attendee_limit_upgrade", title: "Attendee Limit Upgrade", slug: "attendee-limit-upgrade" },
      { name: "attendee_hybrid_settings", title: "Hybrid Settings", slug: "hybrid-settings" },
      { name: "attendee_analytics", title: "Analytics & Exports", slug: "analytics-and-exports", tag: "new" },
      { name: "cross_event_analytics", title: "Cross-Event Report", slug: "cross-event-report", tag: "new" }
    ] },
    { name: "admin_settings", title: "Admin Settings", slug: "admin-settings" },
    { name: "call_for_volunteers", title: "Call For Volunteers", slug: "call-for-volunteers", children: [
      { name: "volunteer_manager", title: "Volunteer Manager", slug: "volunteer-manager" },
      { name: "volunteer_release_consent", title: "Release & Consent Forms", slug: "release-and-consent-forms" }
    ] },
    { name: "categories", title: "Categories", slug: "categories" },
    { name: "segments", title: "Segments", slug: "segments", tag: "new" },
    { name: "ticket_session_mapping", title: "Ticket Session Mapping", slug: "ticket-session-mapping" },
    { name: "session_cap", title: "Session Cap", slug: "session-cap" },
    { name: "release_consent_form", title: "Release & Consent Forms", slug: "release-and-consent-forms", tag: "new" },
    { name: "attendee_checkin", title: "Check-in & Checkout", slug: "check-in-and-checkout", tag: "hot", children: [
      { name: "checkin", title: "Check-in", slug: "check-in" },
      { name: "session_self_checkin", title: "Session Self Check-in", slug: "session-self-check-in" },
      { name: "kiosk_checkin", title: "Kiosk Check-in", slug: "kiosk-check-in", tag: "new" },
      { name: "self_checkin", title: "Self Check-in", slug: "self-check-in" },
      { name: "attendee_checkout", title: "Checkout", slug: "checkout" }
    ] },
    { name: "name_badges", title: "Name Badges", slug: "name-badges", tag: "hot" },
    { name: "certificates", title: "Certificates", slug: "certificates" },
    { name: "integrations", title: "Integrations", slug: "integrations", children: [
      { name: "mailchimp_integration", title: "Mailchimp", slug: "mailchimp" },
      { name: "constant_contact_integration", title: "Constant Contact", slug: "constant-contact" },
      { name: "crm_integration", title: "CRM Integration via Zapier", slug: "crm-integration-via-zapier" }
    ] }
  ] },
  { name: "pay", title: "Pay", slug: "pay", widthClass: "medium", children: [
    { name: "balance", title: "Balance", slug: "balance" },
    { name: "order_details", title: "Order Details", slug: "order-details" },
    { name: "billing", title: "Billing Information", slug: "billing-information" },
    { name: "sales_tax", title: "Publish", slug: "publish" }
  ] },
  { name: "publish", title: "Publish", slug: "publish", widthClass: "large" },
  { name: "tools", title: "Tools", slug: "tools", widthClass: "medium", children: [
    { name: "app_adoption", title: "App Adoption", slug: "app-adoption", children: [
      { name: "app_adoption_email", title: "App Adoption Email", slug: "app-adoption-email" },
      { name: "app_download_button", title: "App Download Button", slug: "app-download-button" },
      { name: "social_media", title: "Social Media", slug: "social-media" },
      { name: "web_app_link", title: "Web App Link", slug: "web-app-link" },
      { name: "downloadable_graphics", title: "Downloadable Graphics", slug: "downloadable-graphics" }
    ] },
    { name: "moderator_tools", title: "Moderator Tools", slug: "moderator-tools", children: [
      { name: "moderate_photos", title: "Photos", slug: "photos" },
      { name: "moderate_session_chats", title: "Session Chats", slug: "session-chats" },
      { name: "moderate_community_board", title: "Community Board", slug: "community-board" },
      { name: "moderate_session_qa", title: "Moderate Session Q&A", slug: "moderate-session-qanda" }
    ] },
    { name: "admin_control", title: "Admin Control", slug: "admin-control", children: [
      { name: "post_event_access_duration", title: "Post Event Access Duration", slug: "post-event-access-duration" },
      { name: "code_access_control", title: "Code Access Control", slug: "code-access-control" }
    ] },
    { name: "report", title: "Report", slug: "report" }
  ] }
];

/**
 * Paths (slug arrays joined by `/`) that have a real screen behind them.
 *
 * Kept as an explicit list rather than inferred from the filesystem because the
 * sidebar renders on the server for every request and globbing routes per
 * render is the wrong trade. Add the route file, then add the path here.
 */
export const IMPLEMENTED = new Set<string>([
  'content/basics',
  'content/agenda-center/session-manager',
  'content/agenda-center/track-manager',
  'content/speaker-center/speaker-manager',
  'content/sponsor-center/sponsor-manager',
  'engagement/announcements',
  'attendees/manage-attendees/attendees',
  'attendees/check-in-and-checkout/check-in',
  'tools/report',
  'tickets/ticket-setup/1-1-create-tickets',
  'tickets/orders-and-transactions/summary',
  'tickets/orders-and-transactions/attendee-orders',
  'tickets/orders-and-transactions/transaction-history',
  'content/agenda-center/conflict-check',
  'content/speaker-center/message-speakers',
  'content/sponsor-center/message-sponsors',
  'tickets/ticket-setup/discount-codes',
  'attendees/manage-attendees/analytics-and-exports',
  'tools/moderator-tools/community-board',
  'content/agenda-center/session-qanda-manager',
  'content/project-management/projects-and-checklists',
  'content/documents-and-videos/documents',
  'content/documents-and-videos/video-hosting',
  'content/documents-and-videos/attendee-video-access',
  'engagement/community/meet-ups',
  'engagement/community/discussion-topics',
  'engagement/community/social-groups',
  'engagement/community/attendee-matchmaking',
  'marketing/event-webpages/agenda-webpage/general-purpose',
  'marketing/event-webpages/speaker-webpage',
  'marketing/event-webpages/sponsor-webpage/sponsor-list',
  'marketing/event-website',
  'pay/balance',
  'pay/order-details',
  'pay/billing-information',
  'publish',
]);

/** Nodes we added that Whova has no equivalent for. Rendered with an `ours` tag. */
export const OURS = new Set<string>([]);

export interface Resolved {
  node: NavNode;
  /** Ancestors, outermost first, not including `node`. */
  trail: NavNode[];
  path: string;
  implemented: boolean;
}

export function resolve(segments: string[]): Resolved | null {
  const trail: NavNode[] = [];
  let level = NAV;
  let node: NavNode | undefined;

  for (const seg of segments) {
    node = level.find((n) => n.slug === seg);
    if (!node) return null;
    level = node.children ?? [];
    trail.push(node);
  }
  if (!node) return null;

  const path = segments.join('/');
  return { node, trail: trail.slice(0, -1), path, implemented: IMPLEMENTED.has(path) };
}

/** Every leaf-or-branch path in the tree, for counting and for the sitemap. */
export function allPaths(nodes: NavNode[] = NAV, prefix = ''): string[] {
  return nodes.flatMap((n) => {
    const p = prefix ? `${prefix}/${n.slug}` : n.slug;
    return [p, ...allPaths(n.children ?? [], p)];
  });
}

export function counts(): { total: number; implemented: number } {
  const all = allPaths();
  return { total: all.length, implemented: all.filter((p) => IMPLEMENTED.has(p)).length };
}

/**
 * The built screens, by name.
 *
 * A four-segment path spelled as a literal in six files is a rename waiting to
 * go wrong, and these paths are four segments deep because Whova's nesting is.
 * Server actions revalidate by path, so they need these too.
 */
export const ROUTES = {
  basics: '/content/basics',
  sessionManager: '/content/agenda-center/session-manager',
  trackManager: '/content/agenda-center/track-manager',
  speakerManager: '/content/speaker-center/speaker-manager',
  sponsorManager: '/content/sponsor-center/sponsor-manager',
  announcements: '/engagement/announcements',
  attendees: '/attendees/manage-attendees/attendees',
  checkIn: '/attendees/check-in-and-checkout/check-in',
  report: '/tools/report',
  /** Kept under its Whova-era name so copied server actions revalidate correctly. */
  warRoom: '/tools/report',
  createTickets: '/tickets/ticket-setup/1-1-create-tickets',
  ordersSummary: '/tickets/orders-and-transactions/summary',
  attendeeOrders: '/tickets/orders-and-transactions/attendee-orders',
  transactionHistory: '/tickets/orders-and-transactions/transaction-history',
  conflictCheck: '/content/agenda-center/conflict-check',
  messageSpeakers: '/content/speaker-center/message-speakers',
  messageSponsors: '/content/sponsor-center/message-sponsors',
  discountCodes: '/tickets/ticket-setup/discount-codes',
  analyticsExports: '/attendees/manage-attendees/analytics-and-exports',
  moderateBoard: '/tools/moderator-tools/community-board',
  qaManager: '/content/agenda-center/session-qanda-manager',
} as const;

/**
 * Flattened index for the header's feature search: every node with the path to
 * it and the ancestor trail an organizer would recognise.
 */
export interface SearchEntry {
  title: string;
  path: string;
  trail: string;
  built: boolean;
}

export function searchIndex(nodes: NavNode[] = NAV, prefix = '', trail: string[] = []): SearchEntry[] {
  return nodes.flatMap((n) => {
    const path = prefix ? `${prefix}/${n.slug}` : n.slug;
    const here: SearchEntry = {
      title: n.title,
      path,
      trail: trail.join(' › '),
      built: IMPLEMENTED.has(path),
    };
    return [here, ...searchIndex(n.children ?? [], path, [...trail, n.title])];
  });
}
