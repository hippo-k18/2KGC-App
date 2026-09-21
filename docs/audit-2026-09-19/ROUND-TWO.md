# Round two, 19 September 2026

What this round built, where an organizer finds it, and what has to reach the
live project before it works there.

Every feature below is built end to end: a screen that saves, a store that
keeps it, and a reader on the website, in the app or in `firestore.rules` that
acts on it. All of it runs against the emulator today. Nothing here has been
deployed.

Read the deploy lines as a checklist. Most of them are one line each, and four
features need nothing beyond the code itself.

---

## 1. Attendee admin

Edit an attendee's name, email, company and title. Change their ticket type.
Transfer a ticket to somebody else. Cancel a registration and give the seat back
to stock. Every change is written to the audit log with who made it.

Correcting a typo in an address keeps the same QR code, so a badge already
printed still scans. A transfer is a different person, so they get their own QR
code and claim code, and the old one stops working.

**Where:** Attendees > Manage Attendees > Attendees. The actions are on the row
and in the panel that opens when you click a name.

**To deploy:**
- Nothing beyond the code. It writes `registrations` and `users`, both of which
  already have rules and indexes.
- Email is off, so a transferred ticket is not yet mailed to its new holder.
  That starts working the day the domain is verified.

---

## 2. Editable event basics and sponsor tiers

The event name, short name, dates, time zone, venue and event type are typed on
a screen instead of being constants in code. The website header, the footer, the
agenda's day tabs and the app's home screen all read them. Changing the end date
also moves the app's access window, because "30 days after the event" has to
follow the event.

Sponsor tiers are the same change for the sponsor list: name, price, order,
what is included and how many passes come with it, editable instead of fixed.
The tier drives the website's sponsor page and the complimentary passes a
sponsor order issues.

**Where:** Content > Basics. Content > Sponsor Center > Sponsor Tiering.

**To deploy:**
- Nothing beyond the code. Both write `settings`, which already has a rules
  block and needs no index.
- Save Content > Basics once after the deploy. That write is what fills
  `settings/appAccess` for the first time, and feature 8 depends on it.

---

## 3. Attendee categories

Up to twenty named categories with a colour. Assign them by hand to one person
or to a selection, or set a rule so a ticket type assigns one automatically. A
category set by hand is never overwritten by a rule. Categories show on the
attendee list, on the name badge and in the exports.

The rule runs inside the one function every purchase, invoice, import and
hand-added attendee goes through, so it cannot be skipped by the way somebody
registered.

**Where:** Attendees > Categories for the list and hand assignment. Tickets >
Attendee Customization > Attendee Categories for the ticket rules. Attendees >
Name Badges shows the result.

**To deploy:**
- Nothing beyond the code.

---

## 4. Team members and roles

Invite somebody to the dashboard by email. They get a link, set their own
passphrase, and see only the areas their roles cover: Finance for Tickets and
Pay, Agenda for Content, Sponsors for the sponsor and exhibitor screens,
Check-in only for the door, Reviewer manager for the call for speakers. Owner
sees everything. A role decides which screens open, which buttons work and
which exports download, so a check-in volunteer cannot download the attendee
list.

**Where:** Attendees > Admin Settings.

**To deploy:**
- `CONSOLE_SESSION_SECRET` must be set on the dashboard. Invitation links are
  signed with it, and an unset value means no invitation can be minted.
- `ORGANIZER_PUBLIC_ORIGIN` must point at the live dashboard, or the invitation
  link will point somewhere else.
- Email, for the invitation to arrive. Until the domain is verified the screen
  shows the link so it can be sent by hand.
- `teamMembers` is written only by the dashboard server and has no rules block,
  which is what keeps it server-only. Nothing to add.

---

## 5. Reviewer scoring

Invite reviewers by email. They sign in with their own link, see the
submissions assigned to them, score each one against the criteria set for the
call, and leave comments. Submissions rank by average score within a track.
Conflicts of interest are declared and exclude a reviewer from that submission.
The call can be set to hide the author's name from reviewers. Organizers see the
ranking, the spread of scores and who has not finished.

**Where:** Content > Call For Speakers/Abstracts, and the Reviewers screen
inside it.

**To deploy:**
- `WEB_ORDER_SECRET` on both the website and the dashboard, with the same
  value. Reviewer links are signed with it.
- `WEB_PUBLIC_ORIGIN` pointing at the live website, so the link in the
  invitation resolves.
- Email, for invitations to arrive.
- `reviewers` and the reviews under each submission are server-only and have no
  rules block by design. Nothing to add.

---

## 6. Session capacity, RSVP and waitlist

Set a cap on a session and restrict it to certain ticket types. An attendee
signs up in the app, and when the room is full they join a waitlist and are
promoted automatically when somebody drops out. The count on the screen is the
real count: a seat is taken in a transaction, so two people pressing at once
cannot both get the last place.

Eligibility and the cap are enforced in `firestore.rules`, not only in the app,
so a seat cannot be taken by anything other than the sign-up path.

**Where:** Attendees > Session Cap for the caps. Tickets > Ticket Setup >
Session RSVP for who may sign up. Content > Agenda Center > Session Manager
shows the numbers per session.

**To deploy:**
- **`firestore.rules`.** New `sessionSeats/{sessionId}` and
  `sessionSeats/{sessionId}/seats/{uid}` blocks. Without them the app cannot
  take a seat at all.
- Nothing else. No index, no function.

---

## 7. Live views

Three screens meant to be left running.

A door dashboard on the check-in screen: how many people are in, split by
ticket type and by hour, updating as the desk scans.

A room sign for the corridor outside each room, on the website, showing what is
on now, what is next and when. It refreshes itself and says when it last
managed to, so a screen that has quietly stopped is visible as stopped.

Live poll results on their own screen, sized for a projector, with the bars
moving as votes arrive and no publish click needed.

**Where:** Attendees > Check-in & Checkout > Check-in for the door dashboard.
Content > Logistics Center has the link to each room's sign. Engagement > Live
Polling has the room-screen link per poll.

**To deploy:**
- Nothing beyond the code. All three read documents that already exist.

---

## 8. App access settings

Three switches that now take effect instead of only saving. The app closes a
chosen number of days after the event, and can go read-only for a period before
it closes. A join code can be required at sign-in. Attendee-to-attendee
messaging can be turned off event-wide.

The window is enforced in `firestore.rules`, so a closed app is closed to
anything holding a token, not only to our own screens. It fails open on
purpose: a missing setting means the app never closes, because an unwritten
setting must not lock a thousand people out of the schedule in a corridor.

**Where:** Tools > Admin Control > Code Access Control for the join code and the
messaging switch. Tools > Admin Control > Post Event Access Duration for the
window.

**To deploy:**
- **`firestore.rules`.** The access window and the messaging switch are read by
  the rules themselves. Deploying the screens without the rules gives you a
  setting that the app respects and a determined client can ignore.
- Save either of those two screens once after the deploy, or save Content >
  Basics. That write creates `settings/appAccess`, the document the app and the
  rules read. Until it exists the app stays open, which is the safe default but
  not the chosen one.

---

## 9. Custom content pages

Write pages for the app and the website: Wi-Fi, getting here, an FAQ, whatever
else the desk is asked. Each page has a title, a summary, a web address and a
body with headings, lists, links, bold and code. Publish or keep as a draft. The
page appears at its address on the website and in the app's home section the
moment it is published.

A privacy notice page ships with the site and is linked from the footer.

**Where:** Content > Branding Center > Customize Resources.

**To deploy:**
- **`firestore.rules`.** A new `pages/{pageId}` block: published pages readable,
  writes from the dashboard server only.
- **`firestore.indexes.json`.** One new index on `pages` by event and published
  flag. Without it the website's page list fails with a missing-index error the
  emulator never shows.
- Nothing to seed. The three example pages are demo copy and are written only
  against the emulator, on purpose: an invented Wi-Fi password at a live event
  is a queue at the registration desk.

---

## 10. Speaker self-service portal

Send each speaker a link to their own page. Without an account, they fill in
their title, company, bio, photo, LinkedIn, X and website, and add a slides link
against each session they are on. What they submit is a draft: an organizer
approves or turns it down, and only an approved draft changes the speaker
record. A tracker shows who has not opened the link, who has submitted and who
is waiting on a decision.

Links can be revoked, which invalidates every link minted before that moment.

**Where:** Content > Speaker Center > Speaker Manager.

**To deploy:**
- `WEB_SPEAKER_SECRET`, or `WEB_ORDER_SECRET` as the fallback, on the dashboard
  and the website with the same value. Links are signed with it, and the screen
  says so plainly when it is missing rather than failing inside a button.
- `WEB_PUBLIC_ORIGIN` pointing at the live website.
- Email, to send the links. Until then the screen shows each link to copy.
- `speakerProfileEdits` is server-only and has no rules block by design.

---

## 11. One person's data: export and delete

Everything held about one person as a single file: their registration, profile,
saved sessions, messages, posts, survey answers and check-ins. And a delete that
removes them, with a plain summary of what will go and what has to stay (an
order that has been paid is a financial record).

The export is an owner's action, not a role's. A check-in volunteer can open the
door and cannot download somebody's conversations.

**Where:** Attendees > Manage Attendees > Attendees, in the panel for one
person.

**To deploy:**
- Nothing beyond the code.

---

## 12. Reports

Survey answers, session feedback and registration answers download as a
spreadsheet instead of stopping at a tally on the screen. Survey answers come
out one row per answer, so a survey with different questions is still one file.
Registration answers come out one row per person, because that is the file a
caterer or an accessibility coordinator reads.

A report per sponsor showing what is genuinely counted: the tracked links
credited to them, the clicks on each, the orders those links led to, and any
lead records that exist. It names the links it counted rather than only their
total, so a link that was filed under the wrong name is visible as missing. It
says in one line that profile views and document opens are not recorded,
because nothing in this project records them and a plausible invented number is
one somebody would quote in a renewal conversation.

**Where:** Engagement > Surveys and Engagement > Session Feedback for the answer
exports. Content > Sponsor Center > Sponsor Manager for the sponsor report.
Tools > Report for the event-wide numbers.

**To deploy:**
- Nothing beyond the code.

---

## Also in this round

**Consent forms.** A required form can now block check-in and app access, and
the signing link goes out by email. The desk sees an outstanding form on the
scan result rather than after the fact. Attendees > Release & Consent Forms.
Deploy: nothing beyond the code, plus email for the link to send itself.

**A session that moves tells the people who saved it.** Changing a room or a
time on Content > Agenda Center > Session Manager writes a notice to everybody
who has that session in their schedule, and they see it in the app. Deploy:
**the functions**. The notice is written by the `onSessionAgendaChange` trigger,
deliberately, so that a change made by an import or a script notifies people
too, not only a change made on that screen. Until the functions are deployed
the room changes and nobody is told.

**Conditional registration questions.** A question can be shown only when a
previous answer has a particular value. Tickets > Ticket Setup > 1.2 Question
Forms, and the same on the exhibitor and sponsor forms. Deploy: nothing beyond
the code.

---

## Everything to deploy, in one list

| What | Why |
|------|-----|
| `firestore.rules` | Session seats, the app access window, the messaging switch and the pages block. Three features are only half deployed without it. |
| `firestore.indexes.json` | One new index on `pages`. The website's page list fails without it. |
| Functions | The session-moved notice. Nothing else in this round needs them. |
| `CONSOLE_SESSION_SECRET`, `ORGANIZER_PUBLIC_ORIGIN` | Team invitations. |
| `WEB_ORDER_SECRET` (and `WEB_SPEAKER_SECRET` if you want them separate), `WEB_PUBLIC_ORIGIN` | Reviewer links and speaker portal links. The same value has to be on both the dashboard and the website. |
| A verified email domain | Team invitations, reviewer invitations, speaker links, consent links, transferred tickets. Each of those screens works without it and shows the link to send by hand. |
| One save on Content > Basics | Creates `settings/appAccess`. Until it exists the app never closes. |

No seed or migration is needed. Nothing in this round changes the shape of a
document that already exists; every new field is optional and every new
collection starts empty.
