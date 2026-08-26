/**
 * Seeds a demo-ready event. Idempotent: every id is derived from its content,
 * so running this twenty times converges rather than accumulating duplicates.
 *
 *   npm run seed                    # against the emulator (safe)
 *   npm run seed -- --confirm-live  # against the real project
 *
 * Attendees are SYNTHETIC. Never import the real Whova attendee list into a
 * database whose rules have not been through a full review — the guest list is
 * the most sensitive asset here, and a prototype is exactly where it leaks.
 */
import { createHash } from 'node:crypto';
import { COLLECTIONS, EVENT_ID, SUBCOLLECTIONS, TIME_ZONE, threadIdFor } from '@kgc/shared';
import { Timestamp } from 'firebase-admin/firestore';

import {
  ANNOUNCEMENTS, ATTENDEE_BIOS, COMMUNITY_POSTS, FIRST, LAST, ORGS, POLL_QUESTIONS, ROOMS,
  SPONSORS, TICKET_TYPES, TITLES, TRACKS, makeSessions, makeSpeakers,
  CAMPAIGN_LINKS, CONTACTS, DOCUMENTS, BOOTHS,
  EXHIBITORS, FEEDBACK_COMMENTS, FEEDBACK_QUESTIONS, TASKS,
} from './lib/fixtures.js';
import { commitAll, db, pruneStale, targetDescription, type PendingWrite } from './lib/firestore.js';
import {
  claimCode, emailHash, normaliseEmail, qrSecret, registrationId,
  roomId, sessionId, speakerId, sponsorId, stableGuid, trackId as slugTrack,
} from './lib/ids.js';
import { deriveTimes } from './lib/time.js';

const SPEAKER_COUNT = 45;
const ATTENDEE_COUNT = 50;

const now = () => Timestamp.now();
const base = () => ({ eventId: EVENT_ID, createdAt: now(), updatedAt: now() });

async function main() {
  const live = process.argv.includes('--confirm-live');
  if (!process.env.FIRESTORE_EMULATOR_HOST && !live) {
    console.error(
      `Refusing to seed ${targetDescription()} without --confirm-live.\n` +
        'For local work: export FIRESTORE_EMULATOR_HOST=localhost:8080',
    );
    process.exit(1);
  }
  console.log(`Seeding ${targetDescription()}\n`);

  const writes: PendingWrite[] = [];
  const push = (collection: string, id: string, data: any) =>
    writes.push({ collection, id, data });

  // --- tracks, rooms, ticket types ---------------------------------------
  const trackIdByName = new Map<string, string>();
  for (const t of TRACKS) {
    const id = slugTrack(t.name);
    trackIdByName.set(t.name, id);
    push(COLLECTIONS.tracks, id, { ...base(), name: t.name, color: t.color });
  }

  const roomIdByName = new Map<string, string>();
  for (const r of ROOMS) {
    const id = roomId(r.name);
    roomIdByName.set(r.name, id);
    push(COLLECTIONS.rooms, id, { ...base(), name: r.name, building: r.building, capacity: r.capacity });
  }

  /**
   * Ticket types are the live catalogue, not demo furniture — the website reads
   * these documents to decide what to sell and Checkout reads them to decide
   * what to charge. Three details matter.
   *
   * **The document id is the tier slug**, not `roomId(name)`. It travels in
   * `/tickets?tier=all-access`, in Stripe metadata and in `OrderLine`, so it has
   * to be stable and readable. Deriving it from the name meant renaming a tier
   * silently orphaned every order that pointed at it.
   *
   * **`quantitySold` is carried forward, never reset.** It counts real
   * purchases. `commitAll` merges, so simply omitting the field would preserve
   * it — but a *new* document would then have no counter at all, and
   * `quantitySold ?? 0` at every read site is a default waiting to be forgotten.
   * Reading first costs one query and makes the field always present.
   *
   * **Currency is lower-case.** Stripe rejects `USD`.
   */
  const soldByTier = new Map<string, number>();
  {
    const existing = await db()
      .collection(COLLECTIONS.ticketTypes)
      .where('eventId', '==', EVENT_ID)
      .get();
    for (const d of existing.docs) {
      const sold = (d.data() as { quantitySold?: number }).quantitySold;
      if (typeof sold === 'number') soldByTier.set(d.id, sold);
    }
  }

  for (const t of TICKET_TYPES) {
    const { id, ...fields } = t;
    push(COLLECTIONS.ticketTypes, id, {
      ...base(),
      ...fields,
      quantitySold: soldByTier.get(id) ?? 0,
    });
  }

  // --- speakers -----------------------------------------------------------
  const speakers = makeSpeakers(SPEAKER_COUNT);
  const speakerIds = speakers.map((s) => speakerId(s.name, s.company));
  speakers.forEach((s, i) => {
    /**
     * A contact address for every speaker.
     *
     * `SpeakerDoc.contactEmail` is what Message Speakers mails, and it exists
     * precisely because a speaker has an address from the call for papers long
     * before they ever claim a ticket. Seeding it makes the messaging screen
     * demonstrable; without it the screen correctly but uselessly reports that
     * all forty-five speakers are unreachable.
     *
     * `@example.invalid` is reserved by RFC 2606 and can never be delivered to,
     * which is the point: a demo send must be impossible to accidentally
     * deliver to a real mailbox.
     */
    const speakerEmail = `${s.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.invalid`;

    push(COLLECTIONS.speakers, speakerIds[i], {
      ...base(), name: s.name, title: s.title, company: s.company, bio: s.bio, sessionIds: [],
      contactEmail: speakerEmail,
    });
  });

  // --- sessions -----------------------------------------------------------
  const sessions = makeSessions(SPEAKER_COUNT);
  const sessionsBySpeaker = new Map<string, string[]>();

  for (const s of sessions) {
    const times = deriveTimes(s.startsAtLocal, s.endsAtLocal, TIME_ZONE);
    const id = sessionId(s.title, s.startsAtLocal);
    const sids = s.speakers.map((i) => speakerIds[i]);
    for (const sid of sids) sessionsBySpeaker.set(sid, [...(sessionsBySpeaker.get(sid) ?? []), id]);

    const tracks = s.tracks.map((n) => trackIdByName.get(n)!).filter(Boolean);
    const primary = TRACKS.find((t) => t.name === s.tracks[0]);

    push(COLLECTIONS.sessions, id, {
      ...base(), ...times,
      title: s.title,
      description: s.description,
      format: s.format,
      status: 'published',
      roomId: roomIdByName.get(s.room),
      roomName: s.room,
      trackIds: tracks,
      primaryTrackName: primary?.name,
      primaryTrackColor: primary?.color,
      speakerIds: sids,
      speakerNames: sids.map((sid) => speakers[speakerIds.indexOf(sid)]?.name).filter(Boolean),
      tags: s.tracks,
      sequence: 0,
      stableGuid: stableGuid(id),
      qaEnabled: s.format !== 'social',
      pollsEnabled: s.format === 'keynote' || s.format === 'panel',
      ...(s.format === 'workshop' ? { capacity: 60 } : {}),
    });
  }

  // Back-fill each speaker's session list now that ids are known.
  for (const [sid, ids] of sessionsBySpeaker) {
    writes.push({ collection: COLLECTIONS.speakers, id: sid, data: { sessionIds: ids } });
  }

  // --- sponsors -----------------------------------------------------------
  for (const s of SPONSORS) {
    /**
     * A main contact per sponsor, for the same reason as speakers above — and
     * likewise on the undeliverable `@example.invalid` domain. Chasing a
     * missing logo is the commonest reason to email a sponsor, which is why
     * `SponsorDoc` grew `contactEmail` at all.
     */
    const sponsorSlug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '');

    push(COLLECTIONS.sponsors, sponsorId(s.name), {
      ...base(), name: s.name, tier: s.tier, boothLocation: s.booth,
      contactName: `${s.name} events team`,
      contactEmail: `events@${sponsorSlug}.example.invalid`,
      // Five sponsors published no copy of their own. Firestore rejects an
      // explicit `undefined`, so the key is omitted rather than written empty.
      ...(s.description ? { description: s.description } : {}),
      website: s.website,
      // The absolute URL, not the website's local path. Firestore is read by the
      // Expo app and the console as well, and a root-relative `/kgc/...` resolves
      // to nothing outside the website — the app would fall back to initials and
      // look like it simply had no logos. The website overrides this with its own
      // self-hosted copy in `listSponsors()`.
      logoURL: s.logoRemote,
    });
  }

  // --- synthetic attendees, registrations and directory -------------------
  //
  // The directory projection is normally written by the `mirrorDirectory`
  // trigger. That trigger needs Cloud Functions, which needs Blaze, so while we
  // are on Spark the seed writes it directly — same shape, same rules, just a
  // different writer. The opt-out case is honoured here too: a hidden attendee
  // gets no directory document at all.
  for (let i = 0; i < ATTENDEE_COUNT; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`;
    const email = normaliseEmail(`${name.replace(/\s+/g, '.').toLowerCase()}@example.test`);
    const uid = `demo_${String(i).padStart(3, '0')}`;
    const company = ORGS[i % ORGS.length];
    const title = TITLES[i % TITLES.length];
    const interests = [TRACKS[i % TRACKS.length].name, TRACKS[(i + 4) % TRACKS.length].name];
    // Every seventh attendee has opted out, so the demo has genuinely hidden
    // profiles and the privacy control can be shown to be real. Index 0 is the
    // account the demo signs in as, so it stays visible — a demo that opens on
    // "you are hidden" invites the wrong question.
    const visible = i === 0 ? true : i % 7 !== 0;

    push(COLLECTIONS.registrations, registrationId(email), {
      ...base(), email, emailHash: emailHash(email), altEmails: [], name,
      ticketType: TICKET_TYPES[i % TICKET_TYPES.length].name,
      status: 'active', claimCode: claimCode(), qrSecret: qrSecret(),
    });

    push(COLLECTIONS.users, uid, {
      ...base(), email, name, title, company, interests,
      // Attendee bios, not speaker bios: one line, in the register people
      // actually write in. "Placeholder profile for demo purposes." sat on all 50
      // profile cards and on every People row that showed a bio.
      bio: ATTENDEE_BIOS[i % ATTENDEE_BIOS.length],
      onboarded: true, visibleInDirectory: visible, messagingEnabled: true,
      notificationPrefs: { announcements: true, messages: true, sessionReminders: true },
      roles: i === 0 ? ['attendee', 'organizer'] : i < 6 ? ['attendee', 'speaker'] : ['attendee'],
    });

    if (visible) {
      push(COLLECTIONS.directory, uid, {
        eventId: EVENT_ID, uid, name, title, company, interests, updatedAt: now(),
      });
    }
  }

  // --- live Q&A and polls on the keynotes ---------------------------------
  //
  // Shapes matter here. A question is created `state: 'pending'` — the rules
  // reject anything pre-approved, because otherwise an attendee puts their own
  // question straight onto the keynote screen with no moderator. And a poll
  // seeds `tallies` with one zeroed key per option: the rules validate a ballot
  // by checking its choices against `tallies.keys()`, since the rules language
  // has no way to project `id` out of an array of option objects.
  const keynotes = sessions.filter((s) => s.format === 'keynote').slice(0, 3);
  const QUESTIONS = [
    'How do you keep the ontology from drifting once three teams depend on it?',
    'What did you try before SHACL, and why did it not work?',
    'Is any of this worth it below about a million triples?',
    'How do you convince a CFO to fund a taxonomy?',
    'What would you do differently if you started again tomorrow?',
  ];

  keynotes.forEach((k, ki) => {
    const sid = sessionId(k.title, k.startsAtLocal);

    QUESTIONS.slice(0, 3 + ki).forEach((body, qi) => {
      const asker = `demo_${String((qi * 7 + ki * 3) % ATTENDEE_COUNT).padStart(3, '0')}`;
      writes.push({
        collection: `${COLLECTIONS.sessions}/${sid}/${SUBCOLLECTIONS.questions}`,
        id: `seed-q-${ki}-${qi}`,
        data: {
          eventId: EVENT_ID,
          authorId: asker,
          body,
          // Seeded already-approved so the board has something on it; a client
          // may not do this, which is the point of the rule.
          state: qi === 0 ? 'answered' : 'approved',
          answered: qi === 0,
          upvoteCount: 0, // owned by a trigger; seeded at rest
          createdAt: now(),
        },
      });
    });

  });

  // A poll on every session that advertises one.
  //
  // `pollsEnabled` is set on all fourteen keynotes and panels above, but polls
  // were seeded onto three of them — so the app's Polls index, which correctly
  // lists every session with the flag, offered fourteen rows of which eleven
  // opened onto nothing. The flag is what the index can see; the subcollection is
  // what the session screen renders; they have to agree or the index is a list of
  // disappointments.
  const pollable = sessions.filter((s) => s.format === 'keynote' || s.format === 'panel');
  pollable.forEach((s, pi) => {
    const q = POLL_QUESTIONS[pi % POLL_QUESTIONS.length];
    writes.push({
      collection: `${COLLECTIONS.sessions}/${sessionId(s.title, s.startsAtLocal)}/${SUBCOLLECTIONS.polls}`,
      id: `seed-poll-${pi}`,
      data: {
        eventId: EVENT_ID,
        question: q.question,
        options: q.options,
        // One key per option, zeroed. This is what the ballot rule checks against.
        tallies: Object.fromEntries(q.options.map((o) => [o.id, 0])),
        totalVotes: 0,
        // Only the first is taking votes. A room full of open polls on sessions
        // that have not started would be the wrong picture of a live conference.
        open: pi === 0,
        createdAt: now(),
      },
    });
  });

  // --- conversations -------------------------------------------------------
  //
  // The inbox demos terribly empty, and "no messages" is also the one state that
  // cannot show whether the unread badge, the read/unread weighting or the date
  // formatting work. Thread ids are the two uids sorted and joined with `_`,
  // which is what lets the security rules prove membership from the path.
  const ME = 'demo_000';
  const CONVERSATIONS = [
    { with: 'demo_003', unread: 2, lines: [
      [1, 'Enjoyed your talk on provenance — do you have the slides?'],
      [0, 'Thanks! I will put them in the session materials tonight.'],
      [1, 'Perfect. Are you around for the reception on Tuesday?'],
    ]},
    { with: 'demo_011', unread: 0, lines: [
      [0, 'We are doing an informal SHACL lunch on Wednesday if you fancy it.'],
      [1, 'Count me in. Outside VEEC?'],
    ]},
    { with: 'demo_025', unread: 1, lines: [
      [1, 'Are you taking the tram over on Monday morning?'],
    ]},
  ] as const;

  CONVERSATIONS.forEach((c, ci) => {
    const threadId = threadIdFor(ME, c.with);
    const last = c.lines[c.lines.length - 1];
    // Spread the threads across recent days so the inbox exercises every branch
    // of the date formatter — a time today, a weekday, and a full date.
    const daysAgo = ci * 3;
    const when = Timestamp.fromMillis(Date.now() - daysAgo * 86_400_000);

    push(COLLECTIONS.threads, threadId, {
      eventId: EVENT_ID,
      participantIds: [ME, c.with].sort(),
      lastMessage: last[1],
      lastMessageAt: when,
      lastSenderId: last[0] === 0 ? ME : c.with,
      unread: { [ME]: c.unread, [c.with]: 0 },
    });

    c.lines.forEach((line, li) => {
      writes.push({
        collection: `${COLLECTIONS.threads}/${threadId}/${SUBCOLLECTIONS.messages}`,
        id: `seed-msg-${ci}-${li}`,
        data: {
          senderId: line[0] === 0 ? ME : c.with,
          body: line[1],
          sentAt: Timestamp.fromMillis(when.toMillis() - (c.lines.length - li) * 600_000),
        },
      });
    });
  });

  // --- community, announcements ------------------------------------------
  let replyTotal = 0;
  COMMUNITY_POSTS.forEach((p, i) => {
    push(COLLECTIONS.communityPosts, `seed-post-${i}`, {
      ...base(), authorId: `demo_${String((i * 5) % ATTENDEE_COUNT).padStart(3, '0')}`,
      category: p.category, title: p.title, body: p.body,
      // `replyCount` stays at zero on purpose even though replies are seeded
      // below. The field is function-owned and the rules forbid a client from
      // writing it; seeding it to the real number would paper over the fact that
      // nothing maintains it, and the next person to add a reply through the app
      // would silently drift. The board counts the subcollection instead.
      status: 'visible', replyCount: 0, reactionCount: 0,
    });

    p.replies.forEach((body, r) => {
      push(
        `${COLLECTIONS.communityPosts}/seed-post-${i}/${SUBCOLLECTIONS.replies}`,
        `seed-reply-${r}`,
        {
          // Spread the authors around the attendee pool so a thread does not look
          // like one person talking to themselves.
          authorId: `demo_${String((i * 7 + r * 3 + 1) % ATTENDEE_COUNT).padStart(3, '0')}`,
          body,
          // Explicit ascending times, not `serverTimestamp()`: the thread reads
          // `orderBy('createdAt')`, and a batch of server timestamps can resolve
          // close enough together to shuffle a conversation into nonsense.
          createdAt: Timestamp.fromMillis(Date.now() - (p.replies.length - r) * 1_800_000),
        },
      );
      replyTotal += 1;
    });
  });

  ANNOUNCEMENTS.forEach((a, i) => {
    push(COLLECTIONS.announcements, `seed-ann-${i}`, {
      ...base(), title: a.title, body: a.body, authorId: 'demo_000', push: false,
    });
  });

  // --- the collections the dashboard build-out added ----------------------
  //
  // Seeded because a screen that only ever renders its empty state cannot be
  // evaluated — an organizer cannot tell "built and waiting for data" from
  // "not built". Each entity below exercises the interesting branch of its
  // screen: an over-allocated exhibitor, an overdue task, a restricted
  // document, a survey with real answers.

  EXHIBITORS.forEach((e, i) => {
    push(COLLECTIONS.exhibitors, `seed-exhibitor-${i}`, {
      ...base(),
      name: e.name,
      boothNumber: e.booth,
      contactName: e.contactName,
      contactEmail: `${e.contactName.split(' ')[0].toLowerCase()}@${e.name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.example.invalid`,
      website: e.website,
      description: e.description,
      passesAllocated: e.passes,
      passesUsed: e.used,
      status: e.status,
    });
  });

  /**
   * The floor plan, keyed by booth number rather than a generated id — that is
   * what makes re-seeding idempotent and makes a double-assignment a failed
   * `create` rather than a race. The exhibitor id is looked up by name from the
   * documents written immediately above, so the plan and the exhibitor list
   * cannot disagree in a freshly seeded database.
   */
  const exhibitorIdByName = new Map(EXHIBITORS.map((e, i) => [e.name, `seed-exhibitor-${i}`]));

  BOOTHS.forEach((b) => {
    const exhibitorId = b.exhibitor ? exhibitorIdByName.get(b.exhibitor) : undefined;
    push(COLLECTIONS.booths, b.number, {
      ...base(),
      number: b.number,
      size: b.size,
      zone: b.zone,
      status: b.status,
      ...(b.ticketTypeId ? { ticketTypeId: b.ticketTypeId } : {}),
      ...(b.note ? { note: b.note } : {}),
      ...(exhibitorId
        ? {
            exhibitorId,
            exhibitorName: b.exhibitor,
            assignedAt: new Date(),
            assignedBy: 'seed',
          }
        : {}),
    });
  });

  /**
   * Contacts, keyed by a hash of the address exactly as `campaigns.ts` derives
   * it — so re-seeding converges on one document per person, and so a CSV
   * import of the same people updates these rather than doubling the list.
   *
   * The hash is recomputed here rather than imported: `@kgc/scripts` must not
   * depend on `apps/organizer`, which is not a workspace member. If the two
   * derivations ever disagree the symptom is a duplicated contact list, which
   * is why both spell out the same 32 hex characters of sha256.
   */
  CONTACTS.forEach((c) => {
    const id = `contact_${createHash('sha256').update(c.email.toLowerCase()).digest('hex').slice(0, 32)}`;
    push(COLLECTIONS.contacts, id, {
      ...base(),
      email: c.email,
      ...(c.name ? { name: c.name } : {}),
      ...(c.company ? { company: c.company } : {}),
      ...(c.source ? { source: c.source } : {}),
      lists: c.lists,
      ...(c.unsubscribed ? { unsubscribedAt: new Date('2026-11-14T09:12:00Z') } : {}),
      ...(c.bounced ? { bouncedAt: new Date('2026-12-02T17:40:00Z') } : {}),
    });
  });

  CAMPAIGN_LINKS.forEach((l) => {
    push(COLLECTIONS.campaignLinks, l.code, {
      ...base(),
      code: l.code,
      label: l.label,
      destination: l.destination,
      ...(l.owner ? { owner: l.owner } : {}),
      ...(l.channel ? { channel: l.channel } : {}),
      clicks: l.clicks,
      active: l.active !== false,
      ...(l.clicks > 0 ? { lastClickedAt: new Date('2027-02-18T11:03:00Z') } : {}),
    });
  });

  TASKS.forEach((t, i) => {
    push(COLLECTIONS.tasks, `seed-task-${i}`, {
      ...base(),
      project: t.project,
      title: t.title,
      notes: t.notes,
      assignee: t.assignee,
      dueOn: t.dueOn,
      status: t.status,
      order: i,
      ...(t.status === 'done' ? { completedAt: now(), completedBy: t.assignee ?? 'seed' } : {}),
    });
  });

  DOCUMENTS.forEach((d, i) => {
    push(COLLECTIONS.documents, `seed-document-${i}`, {
      ...base(),
      title: d.title,
      description: d.description,
      url: d.url,
      kind: d.kind,
      visibleToTicketTypes: d.restrictTo,
      status: d.status,
      order: i,
    });
  });

  /**
   * One feedback survey against the opening session, with real answers.
   *
   * `responseCount` is written to the true number here, unlike `replyCount`
   * above which stays at zero. The difference is deliberate: the survey screen
   * counts the subcollection itself and only falls back to this field, so a
   * correct value cannot paper over a missing trigger the way a reply count
   * would.
   */
  // Derived the same way every other session reference here is, so the survey
  // attaches to a session that actually exists rather than to a guessed id.
  const feedbackSessionId = sessions[0]
    ? sessionId(sessions[0].title, sessions[0].startsAtLocal)
    : undefined;
  if (feedbackSessionId) {
    const RATINGS_1 = [5, 4, 5, 3, 4, 5, 4, 4, 5, 2, 4, 5];
    const RATINGS_2 = [4, 4, 5, 3, 4, 4, 3, 5, 4, 3, 4, 5];
    const RECOMMEND = ['Yes', 'Yes', 'Yes', 'Maybe', 'Yes', 'Yes', 'Maybe', 'Yes', 'Yes', 'No', 'Yes', 'Yes'];

    push(COLLECTIONS.surveys, 'seed-survey-keynote', {
      ...base(),
      title: 'Opening session — your feedback',
      description: 'Two minutes. It decides what we programme next year.',
      sessionId: feedbackSessionId,
      questions: FEEDBACK_QUESTIONS,
      status: 'published',
      responseCount: RATINGS_1.length,
    });

    RATINGS_1.forEach((r1, i) => {
      const uid = `demo_${String(i).padStart(3, '0')}`;
      push(`${COLLECTIONS.surveys}/seed-survey-keynote/${SUBCOLLECTIONS.responses}`, uid, {
        uid,
        answers: {
          q1: r1,
          q2: RATINGS_2[i],
          q3: RECOMMEND[i],
          // Only five of the twelve left a comment, which is the realistic rate
          // and makes the answered count differ per question.
          ...(i < FEEDBACK_COMMENTS.length ? { q4: FEEDBACK_COMMENTS[i] } : {}),
        },
        submittedAt: now(),
      });
    });
  }

  const count = await commitAll(writes);

  // Remove anything a previous run wrote that this one did not. Derived ids mean
  // an edited fixture produces a new document rather than updating the old one.
  let pruned = 0;
  for (const c of [
    COLLECTIONS.speakers, COLLECTIONS.sessions, COLLECTIONS.tracks,
    COLLECTIONS.rooms, COLLECTIONS.sponsors, COLLECTIONS.ticketTypes, COLLECTIONS.booths,
    COLLECTIONS.contacts, COLLECTIONS.campaignLinks,
  ]) {
    const keep = new Set(writes.filter((w) => w.collection === c).map((w) => w.id));
    pruned += await pruneStale(c, EVENT_ID, keep);
  }

  console.log(`  ${TRACKS.length} tracks, ${ROOMS.length} rooms, ${TICKET_TYPES.length} ticket types`);
  console.log(`  ${speakers.length} speakers`);
  console.log(`  ${sessions.length} sessions across 5 days (${sessions[0].startsAtLocal.slice(0, 10)} → 2027-05-07)`);
  console.log(`  ${SPONSORS.length} sponsors, ${EXHIBITORS.length} exhibitors`);
  console.log(`  ${TASKS.length} team tasks, ${DOCUMENTS.length} documents, 1 feedback survey`);
  console.log(`  ${ATTENDEE_COUNT} synthetic attendees (${ATTENDEE_COUNT - Math.ceil(ATTENDEE_COUNT / 7)} in directory, rest opted out)`);
  console.log(`  ${COMMUNITY_POSTS.length} community posts with ${replyTotal} replies, ${ANNOUNCEMENTS.length} announcements`);
  console.log(`  Q&A on ${keynotes.length} keynotes, a poll on all ${pollable.length} pollable sessions`);
  console.log(`  ${CONVERSATIONS.length} conversations in the inbox`);
  console.log(`\n  ${count} documents written${pruned ? `, ${pruned} stale removed` : ''}.\n`);
  console.log('  Tracks, rooms, ticket tiers and sponsor tiers are REAL.');
  // Worth keeping loud, and worth keeping accurate. The abstracts and bios now
  // read as finished prose rather than announcing themselves with "[Placeholder]"
  // — which is right for a demo and wrong to be vague about here, because the
  // operator is the one person who has to know none of these people exist.
  console.log('  Every session, abstract, speaker and attendee is INVENTED.');
  console.log('  They read as real prose on purpose; none of them are real.');
  console.log('  Replace with: npm run import:whova -- --agenda <file.csv> --speakers <file.csv>');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
