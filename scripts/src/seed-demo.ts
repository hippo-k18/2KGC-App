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
import { COLLECTIONS, EVENT_ID, SUBCOLLECTIONS, TIME_ZONE } from '@kgc/shared';
import { Timestamp } from 'firebase-admin/firestore';

import {
  ANNOUNCEMENTS, COMMUNITY_POSTS, FIRST, LAST, ORGS, ROOMS, SPONSORS,
  TICKET_TYPES, TITLES, TRACKS, makeSessions, makeSpeakers,
} from './lib/fixtures.js';
import { commitAll, targetDescription, type PendingWrite } from './lib/firestore.js';
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
      description: `${s.name} — placeholder description, replace before the demo.`,
      website: 'https://www.knowledgegraph.tech/',
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
      bio: `Placeholder profile for demo purposes.`,
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

  // --- community, announcements ------------------------------------------
  COMMUNITY_POSTS.forEach((p, i) => {
    push(COLLECTIONS.communityPosts, `seed-post-${i}`, {
      ...base(), authorId: `demo_${String((i * 5) % ATTENDEE_COUNT).padStart(3, '0')}`,
      category: p.category, title: p.title, body: p.body,
      status: 'visible', replyCount: 0, reactionCount: 0,
    });
  });

  ANNOUNCEMENTS.forEach((a, i) => {
    push(COLLECTIONS.announcements, `seed-ann-${i}`, {
      ...base(), title: a.title, body: a.body, authorId: 'demo_000', push: false,
    });
  });

  const count = await commitAll(writes);

  console.log(`  ${TRACKS.length} tracks, ${ROOMS.length} rooms, ${TICKET_TYPES.length} ticket types`);
  console.log(`  ${speakers.length} speakers`);
  console.log(`  ${sessions.length} sessions across 5 days (${sessions[0].startsAtLocal.slice(0, 10)} → 2027-05-07)`);
  console.log(`  ${SPONSORS.length} sponsors`);
  console.log(`  ${ATTENDEE_COUNT} synthetic attendees (${ATTENDEE_COUNT - Math.ceil(ATTENDEE_COUNT / 7)} in directory, rest opted out)`);
  console.log(`  ${COMMUNITY_POSTS.length} community posts, ${ANNOUNCEMENTS.length} announcements`);
  console.log(`\n  ${count} documents written.\n`);
  console.log('  Tracks, rooms, ticket tiers and sponsor tiers are REAL.');
  console.log('  Session titles, abstracts and all people are PLACEHOLDERS.');
  console.log('  Replace with: npm run import:whova -- --agenda <file.csv> --speakers <file.csv>');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
