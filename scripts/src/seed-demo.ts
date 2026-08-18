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
import { COLLECTIONS, EVENT_ID, SUBCOLLECTIONS, TIME_ZONE, threadIdFor } from '@kgc/shared';
import { Timestamp } from 'firebase-admin/firestore';

import {
  ANNOUNCEMENTS, ATTENDEE_BIOS, COMMUNITY_POSTS, FIRST, LAST, ORGS, ROOMS, SPONSORS,
  TICKET_TYPES, TITLES, TRACKS, makeSessions, makeSpeakers,
} from './lib/fixtures.js';
import { commitAll, pruneStale, targetDescription, type PendingWrite } from './lib/firestore.js';
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

  for (const t of TICKET_TYPES) {
    push(COLLECTIONS.ticketTypes, roomId(t.name), {
      ...base(), name: t.name, priceCents: t.priceCents, currency: 'USD',
      includesVideoLibrary: t.includesVideoLibrary, includesWorkshops: t.includesWorkshops,
    });
  }

  // --- speakers -----------------------------------------------------------
  const speakers = makeSpeakers(SPEAKER_COUNT);
  const speakerIds = speakers.map((s) => speakerId(s.name, s.company));
  speakers.forEach((s, i) => {
    push(COLLECTIONS.speakers, speakerIds[i], {
      ...base(), name: s.name, title: s.title, company: s.company, bio: s.bio, sessionIds: [],
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
    push(COLLECTIONS.sponsors, sponsorId(s.name), {
      ...base(), name: s.name, tier: s.tier, boothLocation: s.booth,
      description: s.description,
      website: s.website,
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

    const options = [
      { id: 'opt-a', label: 'Already in production' },
      { id: 'opt-b', label: 'Piloting this year' },
      { id: 'opt-c', label: 'Still evaluating' },
      { id: 'opt-d', label: 'Not on the roadmap' },
    ];
    writes.push({
      collection: `${COLLECTIONS.sessions}/${sid}/${SUBCOLLECTIONS.polls}`,
      id: `seed-poll-${ki}`,
      data: {
        eventId: EVENT_ID,
        question: 'Where is your organisation with knowledge graphs?',
        options,
        // One key per option, zeroed. This is what the ballot rule checks against.
        tallies: Object.fromEntries(options.map((o) => [o.id, 0])),
        totalVotes: 0,
        open: ki === 0,
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

  const count = await commitAll(writes);

  // Remove anything a previous run wrote that this one did not. Derived ids mean
  // an edited fixture produces a new document rather than updating the old one.
  let pruned = 0;
  for (const c of [
    COLLECTIONS.speakers, COLLECTIONS.sessions, COLLECTIONS.tracks,
    COLLECTIONS.rooms, COLLECTIONS.sponsors, COLLECTIONS.ticketTypes,
  ]) {
    const keep = new Set(writes.filter((w) => w.collection === c).map((w) => w.id));
    pruned += await pruneStale(c, EVENT_ID, keep);
  }

  console.log(`  ${TRACKS.length} tracks, ${ROOMS.length} rooms, ${TICKET_TYPES.length} ticket types`);
  console.log(`  ${speakers.length} speakers`);
  console.log(`  ${sessions.length} sessions across 5 days (${sessions[0].startsAtLocal.slice(0, 10)} → 2027-05-07)`);
  console.log(`  ${SPONSORS.length} sponsors`);
  console.log(`  ${ATTENDEE_COUNT} synthetic attendees (${ATTENDEE_COUNT - Math.ceil(ATTENDEE_COUNT / 7)} in directory, rest opted out)`);
  console.log(`  ${COMMUNITY_POSTS.length} community posts with ${replyTotal} replies, ${ANNOUNCEMENTS.length} announcements`);
  console.log(`  Q&A and a poll on ${keynotes.length} keynotes`);
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
