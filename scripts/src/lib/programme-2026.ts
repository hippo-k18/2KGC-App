/**
 * A programme for the 137 real KGC speakers.
 *
 * ══ WHAT IS REAL HERE AND WHAT IS NOT ═══════════════════════════════════════
 *
 * This file mixes scraped fact with invention, and the boundary matters enough
 * to state before anything else.
 *
 * **Real, scraped from knowledgegraph.tech on 2026-09-06:**
 *   • `KGC_TRACKS` — the eleven track names, lifted verbatim from the published
 *     `/session-by-track/` page.
 *   • `SLOTS` and `DAY_SHAPE` — the session times and the Monday-to-Friday
 *     rhythm, lifted from `/schedule-at-a-glance/`. Workshops and the HCLS
 *     symposium on the first two days, main conference on the middle two,
 *     virtual-only on the Friday; 90-minute blocks with a 30-minute break, an
 *     hour for lunch, and a longer final block. That is KGC's actual shape.
 *   • The speakers themselves — `speakers-2026.ts`, from Whova's public API.
 *   • The rooms — real Cornell Tech spaces, already in `fixtures.ts`.
 *
 * **Fabricated, by explicit instruction from the owner (2026-09-06):**
 *   • Every session title and abstract.
 *   • Which speaker presents which session, and in which room.
 *
 * ⚠️ **That last point is the one to understand before using this.** These are
 * 137 real, named, findable people, and this file puts each of them on a talk
 * they did not give. `import-speakers-2026.ts` refuses to do exactly this — its
 * docblock says attaching real speakers to invented sessions "would put a real
 * person's name on a talk they never gave, which is the exact harm the whole
 * `SPEAKERS_PAGE_SOURCE` switch was built to avoid." That objection has not
 * become wrong; it has been *overridden*, deliberately, because the owner
 * wanted a demo populated with real people rather than invented ones.
 *
 * Two consequences follow, and neither is optional:
 *
 *   1. Every session written from this file carries `provenance: 'fabricated'`.
 *      It is not rendered anywhere, so it costs the demo nothing, and it means
 *      the question "is this programme real?" is answerable with a query rather
 *      than with somebody's memory of a conversation.
 *   2. **This must not be published to the open web as a real programme.** A
 *      fabricated talk under a real researcher's name, on a site that looks
 *      like a conference, is a misrepresentation of that person — not of us.
 *      Behind the app's sign-in it is demo data; on the public marketing site
 *      it is a claim about what these people are doing next May.
 *
 * Why the titles are invented rather than scraped: KGC's published programme
 * pages carry real session titles, but they belong to the speakers who actually
 * gave them. Putting Vaishali Raghvani's talk under Jim Hendler's name would be
 * a worse falsehood than an invented title, not a lesser one — it would also
 * misrepresent a talk that exists. Invention is the honest half of a dishonest
 * job.
 *
 * ── Why the titles are generated rather than listed ─────────────────────────
 *
 * A hand-written list long enough for a five-day programme (~110 sessions)
 * either repeats itself or degrades into filler by the fortieth entry. The
 * combinator below pairs a subject drawn from the track's own vocabulary with
 * one of eleven shapes real conference talks take — a war story, a migration, a
 * comparison, a retraction — which keeps the hundredth title as specific as the
 * first. Determinism matters as much as variety: the same index always yields
 * the same title, so re-running the importer updates documents rather than
 * creating a second, differently-worded programme beside the first.
 */

/**
 * The eleven tracks KGC actually runs, in the order the site lists them.
 *
 * Scraped from `https://www.knowledgegraph.tech/session-by-track/`. These
 * replace the invented set in `fixtures.ts`, which was close but not right:
 * it had `SEO`, `Libraries` and `EU Projects`, and was missing `Semantic
 * Layer`, `Systems and Scale`, `Metadata` and `Environmental, Social and
 * Governance` — the last of which is a whole track at the real conference.
 *
 * Colours are ours. Whova's payload does not publish a per-track colour, and
 * the agenda card needs one, so these are chosen for separation on the list
 * rather than copied from anywhere.
 */
export const KGC_TRACKS: { name: string; color: string }[] = [
  { name: 'Business Use Cases', color: '#d97706' },
  { name: 'Content Knowledge Graphs', color: '#0891b2' },
  { name: 'Data Architecture', color: '#2563eb' },
  { name: 'Deep Learning for and with Knowledge Graphs', color: '#7c3aed' },
  { name: 'Environmental, Social and Governance', color: '#16a34a' },
  { name: 'Metadata', color: '#ca8a04' },
  { name: 'Natural Language Processing (NLP)', color: '#9333ea' },
  { name: 'Ontologies, Taxonomies, Data Modeling', color: '#dc2626' },
  { name: 'Semantic Layer', color: '#0d9488' },
  { name: 'Systems and Scale', color: '#4f46e5' },
  { name: 'General Track', color: '#64748b' },
];

/**
 * The real block times, from `/schedule-at-a-glance/`.
 *
 * 90 minutes each, which is longer than the 45-minute slots `fixtures.ts`
 * invented and is what actually makes the agenda screen look like a
 * conference: four blocks a day, not six, with real gaps between them. The
 * 15:30 block runs two hours at the real event and does so here.
 */
const SLOTS: [string, string][] = [
  ['09:00', '10:30'],
  ['11:00', '12:30'],
  ['13:30', '15:00'],
  ['15:30', '17:30'],
];

/**
 * What each day of the week is for, scraped from the same page.
 *
 * KGC is not five identical days. The first two are workshops and masterclasses
 * running alongside the Healthcare and Life Sciences symposium; the middle two
 * are the main conference; the Friday is virtual-only and half a day. An agenda
 * that ignores this reads as generated the moment anybody who has been to the
 * conference looks at it.
 */
const DAY_SHAPE: {
  date: string;
  kind: 'workshops' | 'main' | 'virtual';
  /** How many run in parallel in each block. */
  width: number;
  /** Blocks used, as indexes into `SLOTS`. */
  slots: number[];
}[] = [
  { date: '2027-05-03', kind: 'workshops', width: 4, slots: [0, 1, 2, 3] },
  { date: '2027-05-04', kind: 'workshops', width: 4, slots: [0, 1, 2, 3] },
  { date: '2027-05-05', kind: 'main', width: 5, slots: [0, 1, 2, 3] },
  { date: '2027-05-06', kind: 'main', width: 5, slots: [0, 1, 2, 3] },
  { date: '2027-05-07', kind: 'virtual', width: 3, slots: [0, 1] },
];

/** Real Cornell Tech spaces, matched to how many run at once. */
const PARALLEL_ROOMS = [
  'VEEC Classroom 1',
  'VEEC Classroom 2',
  'VEEC Classroom 3',
  'VEEC Classroom 4',
  'Bloomberg 165',
];
const PLENARY_ROOM = 'VEEC Banquet Hall';
const SYMPOSIUM_ROOM = 'Tata Innovation Center Auditorium';

/**
 * Subject matter, grouped so a title lands in the track it is filed under.
 *
 * Written from the vocabulary of the field rather than from a thesaurus: these
 * are the things KGC talks are actually about — entity resolution, SHACL,
 * provenance, the join to the warehouse nobody may switch off — because a
 * generated title only survives contact with a domain audience if its nouns
 * are the ones they use.
 */
const SUBJECTS: Record<string, string[]> = {
  'Business Use Cases': [
    'a supply-chain graph', 'customer 360 without a golden record', 'a claims graph',
    'fraud rings', 'a talent and skills graph', 'product data at retail scale',
    'know-your-customer across twelve systems', 'a regulatory reporting graph',
  ],
  'Content Knowledge Graphs': [
    'an editorial knowledge graph', 'a media archive', 'schema.org at publication scale',
    'a headless CMS with a graph behind it', 'recommendation without collaborative filtering',
    'a rights and licensing graph', 'archive metadata nobody wrote down',
  ],
  'Data Architecture': [
    'the graph and the warehouse', 'a multi-model store', 'a graph adapter over legacy systems',
    'data products in a mesh', 'federation versus materialisation', 'a virtual graph layer',
    'the migration off a relational core',
  ],
  'Deep Learning for and with Knowledge Graphs': [
    'graph neural networks in production', 'link prediction that survives review',
    'embeddings that stay current', 'retrieval-augmented generation over a graph',
    'grounding an LLM in an ontology', 'graph features for a fraud model',
  ],
  'Environmental, Social and Governance': [
    'a scope-three emissions graph', 'supply-chain due diligence',
    'sustainability reporting under CSRD', 'a materiality assessment as a graph',
    'traceability from field to shelf',
  ],
  Metadata: [
    'a data catalogue that gets used', 'lineage across a hundred pipelines',
    'provenance after two rewrites', 'active metadata', 'a business glossary with teeth',
    'stewardship at organisational scale',
  ],
  'Natural Language Processing (NLP)': [
    'entity linking against a live graph', 'relation extraction from filings',
    'terminology extraction for a domain', 'query understanding over SPARQL',
    'named entities in clinical text', 'multilingual entity resolution',
  ],
  'Ontologies, Taxonomies, Data Modeling': [
    'an upper ontology nobody resents', 'SHACL that catches real errors',
    'ontology alignment with language models', 'a taxonomy that outlived its authors',
    'competency questions as a design tool', 'modelling time and change',
    'cardinality constraints that earn their keep',
  ],
  'Semantic Layer': [
    'a semantic layer over the lakehouse', 'metrics that mean one thing',
    'a business-meaning layer for AI', 'governed self-service analytics',
    'the semantic layer and the BI tool',
  ],
  'Systems and Scale': [
    'a graph served to ten thousand analysts', 'query shapes that stopped scaling',
    'a reasoner that would not terminate', 'ingest at a billion triples a day',
    'index choices under load', 'graph operations at 3am',
  ],
  'General Track': [
    'the first ninety days of a graph programme', 'ownership of the ontology',
    'what a graph team is for', 'buying versus building', 'the second knowledge graph',
  ],
};

/**
 * The shapes real conference talks take.
 *
 * `%s` is the subject. These are deliberately not all upbeat — a programme in
 * which nothing was abandoned, regretted or rolled back is the tell that gives
 * a generated agenda away, and the real KGC pages are full of talks about what
 * went wrong.
 */
const TITLE_PATTERNS = [
  'Lessons from %s',
  '%s: what we would not repeat',
  'Building %s that survives its second year',
  'Rethinking %s',
  '%s, three years on',
  'The case against %s',
  'Operating %s',
  'From pilot to production: %s',
  '%s at enterprise scale',
  'What nobody tells you about %s',
  'A post-mortem on %s',
];

/** Second sentences, so adjacent abstracts do not read identically. */
const ABSTRACT_BODIES = [
  'The material is drawn from a system that is live today, including the parts of the design that did not survive the first year of requests nobody anticipated.',
  'Less a methodology talk than a post-mortem: three approaches were tried, two abandoned, and the reasons had more to do with team size than with technology.',
  'Aimed at teams who already have a graph and are wondering why it is getting slower — query shapes, index choices, and the point at which denormalising stopped being a compromise.',
  'This is the uncomfortable version of the topic: where the published guidance breaks down at scale, and what has to be given up to get past it.',
  'A tour of the tooling, honestly assessed, including where the standards help, where they get in the way, and what still has to be written by hand.',
  'Two teams, the same problem, opposite conclusions. Both are set out here and the session is deliberately not neutral about which travelled better.',
  'Introductory in level but not in ambition: the question is what to build first when the eventual shape of the graph is not yet knowable.',
  'What happens after the pilot succeeds — governance, ownership, and the awkward conversation about who is on call for the ontology.',
  'The talk closes on the measurements that changed the team’s mind, and on the two that turned out to be measuring the wrong thing.',
  'Expect concrete numbers: ingest rates, query latencies, and the cost line that made the architecture negotiable again.',
];

/**
 * Openers for the five plenaries, which are the only sessions an attendee is
 * guaranteed to see and so are the only ones worth writing individually.
 */
const KEYNOTES = [
  'Opening keynote: the decade the knowledge graph stopped being a research topic',
  'Keynote: what large language models still cannot do without a schema',
  'Keynote: the semantic layer as the interface between people and machines',
  'Keynote: governance is the hard part, and always was',
  'Closing keynote: what we got wrong about knowledge graphs, and what comes next',
];

export interface ProgrammeSession {
  title: string;
  description: string;
  format: 'keynote' | 'talk' | 'panel' | 'workshop' | 'social';
  startsAtLocal: string;
  endsAtLocal: string;
  room: string;
  tracks: string[];
  /** Indexes into the speaker list handed to `buildProgramme`. */
  speakers: number[];
  virtual: boolean;
}

const fill = (pattern: string, subject: string) => {
  const t = pattern.replace('%s', subject);
  return t[0].toUpperCase() + t.slice(1);
};

/**
 * Build the whole week for `speakerCount` speakers.
 *
 * ## Every speaker appears at least once, and that is a hard requirement
 *
 * The roster is the point of this exercise: a speakers page listing 137 people
 * of whom 60 appear nowhere in the agenda is worse than the invented programme
 * it replaced, because the gap is visible to anyone who taps a name. So the
 * grid is sized to the roster rather than the other way round — the fixed
 * five-day shape yields ~74 sessions, panels absorb three speakers each, and
 * any speaker still unplaced after one pass is added as a co-presenter rather
 * than dropped. `assertEveryoneScheduled` below is what stops that promise
 * quietly decaying the next time the shape changes.
 */
export function buildProgramme(speakerCount: number): ProgrammeSession[] {
  const sessions: ProgrammeSession[] = [];
  let subjectCursor = 0;
  let patternCursor = 0;

  const trackNames = KGC_TRACKS.map((t) => t.name);

  DAY_SHAPE.forEach((day, d) => {
    const virtual = day.kind === 'virtual';

    /*
     * One plenary each morning, before the first block, alone in the schedule —
     * as at the real conference, where the keynote does not compete with a
     * track. The Friday is virtual and gets one too, which is why this is not
     * conditioned on `kind`.
     */
    sessions.push({
      title: KEYNOTES[d],
      description:
        'Plenary session. Nothing is scheduled opposite this block, and it is streamed to virtual attendees.',
      format: 'keynote',
      startsAtLocal: `${day.date}T08:30`,
      endsAtLocal: `${day.date}T09:00`,
      room: virtual ? SYMPOSIUM_ROOM : PLENARY_ROOM,
      tracks: [trackNames[d % trackNames.length]],
      speakers: [],
      virtual,
    });

    day.slots.forEach((slotIndex, s) => {
      const [from, to] = SLOTS[slotIndex];

      for (let p = 0; p < day.width; p++) {
        const track = trackNames[(d * 3 + s * 2 + p) % trackNames.length];
        const pool = SUBJECTS[track];
        const subject = pool[subjectCursor++ % pool.length];
        const pattern = TITLE_PATTERNS[patternCursor++ % TITLE_PATTERNS.length];

        /*
         * Format follows the day, not a rotation. Workshop days run workshops;
         * the main conference runs talks with a panel in the last block, which
         * is where a real programme puts them because a panel needs an audience
         * that has already been in the room all day.
         */
        const format: ProgrammeSession['format'] =
          day.kind === 'workshops' ? 'workshop' : s === day.slots.length - 1 && p === 0 ? 'panel' : 'talk';

        /*
         * The first parallel room on the workshop days is the Healthcare and
         * Life Sciences symposium, which at the real conference runs all day in
         * its own auditorium rather than as one of the rotating rooms.
         */
        const room =
          day.kind === 'workshops' && p === 0 ? SYMPOSIUM_ROOM : PARALLEL_ROOMS[p % PARALLEL_ROOMS.length];

        // Cross-listing: a quarter of sessions sit in two tracks, which is why
        // `trackIds` is a list on the document.
        const second = trackNames[(d + s + p + 5) % trackNames.length];
        const tracks = (s + p) % 4 === 0 && second !== track ? [track, second] : [track];

        sessions.push({
          title: fill(pattern, subject),
          description: `${ABSTRACT_BODIES[(d * 7 + s * 3 + p) % ABSTRACT_BODIES.length]}`,
          format,
          startsAtLocal: `${day.date}T${from}`,
          endsAtLocal: `${day.date}T${to}`,
          room,
          tracks,
          speakers: [],
          virtual,
        });
      }
    });

    /*
     * The Monday welcome reception. 21:00 local is 01:00 UTC the next day, and
     * this session exists partly to keep exercising that — if it lands on the
     * wrong day tab, the `day` derivation is broken.
     */
    if (d === 0) {
      sessions.push({
        title: 'Welcome reception',
        description: 'Drinks and networking on the first evening. No talks, no track.',
        format: 'social',
        startsAtLocal: `${day.date}T21:00`,
        endsAtLocal: `${day.date}T23:00`,
        room: PLENARY_ROOM,
        tracks: [],
        speakers: [],
        virtual: false,
      });
    }
  });

  assignSpeakers(sessions, speakerCount);
  return sessions;
}

/**
 * Place all `speakerCount` speakers across the sessions that take one.
 *
 * Two passes. The first walks the sessions in order and gives each the number
 * of speakers its format implies — three for a panel, one for anything that is
 * not a reception. The second exists because the first can run out of sessions
 * before it runs out of people: whatever is left over is added to the sessions
 * that can most plausibly absorb a second name, largest formats first, rather
 * than being silently dropped.
 */
function assignSpeakers(sessions: ProgrammeSession[], speakerCount: number): void {
  const takesSpeakers = sessions.filter((s) => s.format !== 'social');
  let next = 0;

  for (const session of takesSpeakers) {
    if (next >= speakerCount) break;
    const want = session.format === 'panel' ? 3 : 1;
    for (let i = 0; i < want && next < speakerCount; i++) session.speakers.push(next++);
  }

  // Anyone still unplaced joins an existing session as a co-presenter.
  let cursor = 0;
  while (next < speakerCount) {
    const session = takesSpeakers[cursor++ % takesSpeakers.length];
    if (session.format === 'keynote') continue; // a keynote is one person
    session.speakers.push(next++);
  }
}

/**
 * Throw if any speaker was left off the programme.
 *
 * Called by the importer before it writes anything. The failure this guards
 * against is not a crash — it is a demo that looks finished and has 40 speakers
 * whose profile says they are speaking at nothing, which is exactly the kind of
 * gap this repo has a documented history of shipping.
 */
export function assertEveryoneScheduled(sessions: ProgrammeSession[], speakerCount: number): void {
  const seen = new Set<number>();
  for (const s of sessions) for (const i of s.speakers) seen.add(i);
  const missing = [...Array(speakerCount).keys()].filter((i) => !seen.has(i));
  if (missing.length) {
    throw new Error(
      `${missing.length} of ${speakerCount} speakers were not scheduled (first few: ${missing
        .slice(0, 5)
        .join(', ')}). The programme grid is too small for the roster.`,
    );
  }
}
