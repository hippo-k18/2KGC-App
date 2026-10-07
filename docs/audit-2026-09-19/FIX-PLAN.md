# Fix plan, from the 19 September 2026 audit

Source: `results/gap-map.json` (91 organizer needs) and `ui-issues.md` (153 issues).
Sizes: S is under a day, M is one to three days, L is a week or more.

Order matters. Wave 0 is yours and unblocks the most. Waves 1 and 2 need nothing
from you and can start now.

## Wave 0. Owner actions (only you can do these)

| # | Action | Where | Unblocks |
|---|--------|-------|----------|
| 1 | Create a Stripe account, send me the test secret key, publishable key and webhook secret | stripe.com, then `OWNER-ACTIONS.md` §2 | Card payments, discount codes, refunds, invoices, tax, sponsor and exhibitor orders, group orders, payouts, sales reports. 12 blocked features. |
| 2 | Verify `knowledgegraph.tech` in Resend. François adds 3 DNS records | resend.com/domains | Every email: receipts, sign-in codes, campaigns, decision emails, speaker and sponsor messages |
| 3 | Set a budget alert and quota caps on the Google Cloud project | `OWNER-ACTIONS.md` §5 | Safe to deploy functions |
| 4 | Run `firebase login` as `hdeschuyt@gmail.com` on this Mac | Terminal | Function deploys: push notifications, exhibitor mirror, sign-in codes, account provisioning |
| 5 | Rotate the two live secrets and the shared password on the 50 demo accounts | `OWNER-ACTIONS.md` §4 | Removing demo mode |
| 6 | Send real contact emails for the 137 speakers, 18 sponsors and 5 exhibitors (a spreadsheet is fine) | Your records | Message Speakers, Sponsors, Exhibitors |
| 7 | Give me one attendee login for the app | Any message | Live screenshots of the signed-in app |
| 8 | Decide the five scope questions at the end of this file | Reply here | Waves 6 to 8 |

## Wave 1. Bugs and phone layout (no dependencies)

1. **Dashboard phone layout.** Collapse the side menu into a drawer under 768px, stack the header, let the event masthead wrap, make every table scroll sideways with a visible cue, cap form fields at 100% width. `apps/organizer/src/app/globals.css`, `(dash)/layout.tsx`, `dash-nav.tsx`. Fixes 20 of 31 high issues. M
2. **`listAttendees()` join bug.** Names, tickets and companies are blank. Fixes the attendee list, Categories, Segments, Ticket Session Mapping, Analytics & Exports, the attendee and catering CSVs and the Ticket type list in Add an attendee. S
3. **Check-in and Kiosk on a phone.** Code box, camera button, result panel and row buttons fit 375px. S
4. **Attendee app tab bar.** Reserve space for the fixed tab bar on the web build so the last row and the Reply box are reachable. S
5. **Website.** `/submit` stacks to one column, `/hcls` heading scales down, replace the red `STRIPE_SECRET_KEY` note on `/tickets`, `/tickets/exhibitor`, `/tickets/sponsor` and `/tickets/invoice` with "Ticket sales open soon." S
6. **Small ones.** Projects & Checklists row overlap, QR SVG printed as text on Downloadable Graphics, desk sign preview width, hidden replies still showing in the app, Ticket Add-ons empty state. S
7. Work through the 64 medium and 58 low issues in `ui-issues.md`, section by section. M

## Wave 2. Copy and navigation (no dependencies)

1. Remove developer notes from every organizer screen (env var names, function names, file paths, "why this is two collections"). Replace essay screens about missing features with one line and a status. M
2. Move features to where an organizer looks for them. Email Campaign, Contact List and Link Tracking to Marketing. Session caps and ticket-session mapping to Content > Agenda. Emergency broadcast to Engagement > Announcements. Q&A backlog beside the Q&A manager. Admin list to Tools. Rename Pay > Publish to Sales Tax. S
3. Run the no-em-dash, no-filler pass on all user-facing strings in the three apps. S

## Wave 3. Settings that save but do nothing

Each of these has a working form whose value nothing reads.

1. Brand colours, logo and banner apply to website, emails and app. Needs logo and banner upload. M
2. Event basics editable: name, dates, time zone, venue, event type. Site and app read them. M
3. Sponsor tiers editable instead of fixed in code. S
4. App access window closes the app after the chosen date. Join code is asked at sign-in. Messaging off switch is honoured by the app and the rules. S
5. Session capacity and ticket eligibility enforced, with sign-up and waitlist in the app. M
6. Consent forms: email the signing link, block check-in or app access when a required form is unsigned. S
7. Attendees: edit, cancel, transfer to another person, change ticket type. Added attendees get an email with a claim code. M
8. Attendee categories: create, assign by hand or by ticket type, show on the badge. M
9. Search the attendee list by name, company and ticket, not just email. S

## Wave 4. After Stripe (needs owner action 1)

1. Move account provisioning onto the Stripe webhook, then remove demo mode. M
2. Turn on discount codes, add a limit by ticket type, add access codes for hidden tickets. S
3. Partial refunds, capacity returned to stock. S
4. Invoices with VAT number field and reissue after edits. Mark an offline order paid without a Stripe invoice. Offline payment for attendee tickets, not just exhibitors. M
5. Sponsor and exhibitor checkout on, complimentary passes issued per sponsor package. S
6. Group orders: assign names after purchase. M
7. Add-ons at checkout (workshops, dinner, merchandise). M
8. Sales report split by discount code, reconciled against Stripe payouts. S
9. Walk-in card payment at the desk with a Stripe payment link and QR. S
10. Abandoned checkout reminder email. S

## Wave 5. After email and functions (needs owner actions 2, 3, 4)

1. Deploy all 14 functions. Confirms push, exhibitor mirror, sign-in codes. S
2. Announcements: push, email, segments, schedule, drafts. Emergency broadcast sends push and email to everyone checked in. M
3. Notify attendees when a session they saved moves. S
4. Confirmation email: editable template, QR code, calendar file, resend button. M
5. Email campaigns: send to attendee segments, merge fields, HTML, saved templates, scheduled send, opens and clicks from Resend webhooks. Sender name and reply-to screen. M
6. Call for papers: bulk decisions, waitlist decision, decision email templates, reviewer invitations. M
7. Post-event: thank-you and survey emails, certificates emailed as PDF. S
8. Replace the hand-run script that provisions each new attendee with a trigger. S

## Wave 6. Missing builds

1. **Reviewer scoring.** Reviewer sign-in, scoring criteria, scores and comments, ranking by track, conflict-of-interest exclusions. L
2. **File uploads everywhere.** Deploy Storage rules. Session slides and papers, file field on the call for papers, custom pages, venue maps and floor plan with pins, the 61 hotlinked images moved into our bucket. M
3. **Custom content pages** for the app and site (Wi-Fi, travel, FAQ). Privacy policy page. M
4. **Speaker self-service link** for bio, photo, slides, with a completion tracker. M
5. **Roles.** Invite team members, roles by area, check-in-only accounts for volunteers. M
6. **GDPR.** Export one person's data, delete one person. S
7. **Badges.** Badge designer with category styles, PDF export for a print shop, print on check-in. M
8. **Offline check-in.** Queue scans locally and sync. M
9. **Live door dashboard.** Check-ins by ticket type and by hour. S
10. **Reports.** Survey and feedback answer exports, sponsor ROI report. S
11. **App menu control.** Show, hide and order app sections from the dashboard. M
12. **Event draft and preview switch**, clone last year's event. M

## Wave 7. Engagement builds

1. Polls: live results without the publish click, a room-screen view. S
2. Q&A vote counts update live. S
3. Attendee-to-attendee meeting requests with slots, shown in the app. M
4. People recommendations in the app. S
5. Group chat and session chat, with moderation of messages, a report queue and bans. M
6. Photo gallery: attendee uploads, organizer moderation. M
7. Gamification: points, leaderboard, booth passport. L
8. Room signage page showing current and next session, auto-refreshing. S
9. Conditional registration questions based on a previous answer. Visa letter PDF. S

## Wave 8. Large scope, decide before building

1. **Streaming and recordings.** Stream link per session (YouTube, Vimeo, Zoom embed), player in the app, gated by ticket type, on-demand library with expiry, viewer and watch-time reports. Two ticket tiers already sell a video library, so either build this or change those tiers. L
2. **Sponsor and exhibitor portal** with their own login, plus lead retrieval by badge scan and lead export. L
3. **Sponsored placements**: app banner slot, sponsored sessions, sponsored push. M
4. **Virtual sponsor booths.** L
5. **Integrations**: webhooks and a read API first, then Zapier, CRM, SSO. L
6. **App store release** of the attendee app (Apple and Google developer accounts are yours to create). M

## Decisions I need from you

1. Is KGC 2027 hybrid? If it is in-person only, drop Wave 8 items 1 and 4 and change the two ticket tiers that promise video.
2. Do exhibitors need lead scanning this year?
3. Will the app ship to the app stores, or stay a web app?
4. Do you want gamification and the photo gallery, or are they Whova parity for its own sake?
5. Which integrations does KGC use today (CRM, mailing list)?

## How I will run it

One wave at a time, several agents in parallel inside a wave, `npm run smoke` and a re-run of `shot.mjs` on the touched routes after each item, deploy to the `kgc27-*` sites at the end of each wave. The field guide gets regenerated after each wave so you can watch the counts move.
