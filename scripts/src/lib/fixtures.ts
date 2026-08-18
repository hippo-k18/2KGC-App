/**
 * The demo programme.
 *
 * Tracks, rooms, ticket types and sponsor tiers here are the REAL KGC ones,
 * taken from the public conference site. Session titles and speaker names are
 * PLACEHOLDERS — plausible for the field, but invented.
 *
 * That split is deliberate. A demo dies on "Test Session 1", so the shape and
 * vocabulary have to be right; but inventing quotes and job titles for named
 * real people is worse than an obvious placeholder. Replace the whole lot with
 * `npm run import:whova` the moment the export exists — the ids are derived
 * from titles, so the real import overwrites cleanly.
 */

/** The real 11 tracks. */
export const TRACKS: { name: string; color: string }[] = [
  { name: 'Data Architecture', color: '#2563eb' },
  { name: 'Natural Language Processing', color: '#7c3aed' },
  { name: 'Graph Data Science', color: '#059669' },
  { name: 'Business Use Cases', color: '#d97706' },
  { name: 'Ontologies & Taxonomies', color: '#dc2626' },
  { name: 'Content Knowledge Graphs', color: '#0891b2' },
  { name: 'SEO', color: '#ca8a04' },
  { name: 'Health Care', color: '#db2777' },
  { name: 'Libraries', color: '#4f46e5' },
  { name: 'Open Knowledge Networks', color: '#16a34a' },
  { name: 'EU Projects', color: '#9333ea' },
];

/** Real Cornell Tech spaces. */
export const ROOMS: { name: string; building: string; capacity: number }[] = [
  { name: 'VEEC Banquet Hall', building: 'Verizon Executive Education Center', capacity: 400 },
  { name: 'VEEC Classroom 1', building: 'Verizon Executive Education Center', capacity: 80 },
  { name: 'VEEC Classroom 2', building: 'Verizon Executive Education Center', capacity: 80 },
  { name: 'VEEC Classroom 3', building: 'Verizon Executive Education Center', capacity: 60 },
  { name: 'VEEC Classroom 4', building: 'Verizon Executive Education Center', capacity: 60 },
  { name: 'Bloomberg 165', building: 'Bloomberg Center', capacity: 120 },
  { name: 'Bloomberg 271', building: 'Bloomberg Center', capacity: 90 },
  { name: 'Tata Innovation Center Auditorium', building: 'Tata Innovation Center', capacity: 200 },
];

/** Real ticket tiers. */
export const TICKET_TYPES = [
  { name: 'All Access', priceCents: 119900, includesVideoLibrary: true, includesWorkshops: true },
  { name: 'Main Conference', priceCents: 79900, includesVideoLibrary: true, includesWorkshops: false },
  { name: 'Workshops Only', priceCents: 69900, includesVideoLibrary: false, includesWorkshops: true },
  { name: 'Virtual', priceCents: 34900, includesVideoLibrary: true, includesWorkshops: false },
];

/**
 * Poll questions, one per session that has polls switched on.
 *
 * Rotated by index so fourteen sessions do not all ask the same thing. Four
 * options each, because the ballot rule validates a vote against `tallies`
 * keys and the poll component lays out four comfortably on a phone.
 */
export const POLL_QUESTIONS: { question: string; options: { id: string; label: string }[] }[] = [
  {
    question: 'Where is your organisation with knowledge graphs?',
    options: [
      { id: 'opt-a', label: 'Already in production' },
      { id: 'opt-b', label: 'Piloting this year' },
      { id: 'opt-c', label: 'Still evaluating' },
      { id: 'opt-d', label: 'Not on the roadmap' },
    ],
  },
  {
    question: 'What is the hardest part of the work, honestly?',
    options: [
      { id: 'opt-a', label: 'Getting the model right' },
      { id: 'opt-b', label: 'Keeping it right afterwards' },
      { id: 'opt-c', label: 'Funding it' },
      { id: 'opt-d', label: 'Finding people who can do it' },
    ],
  },
  {
    question: 'Who owns the ontology where you work?',
    options: [
      { id: 'opt-a', label: 'A dedicated team' },
      { id: 'opt-b', label: 'One person, unofficially' },
      { id: 'opt-c', label: 'Whoever touched it last' },
      { id: 'opt-d', label: 'Nobody' },
    ],
  },
  {
    question: 'How are you using LLMs alongside your graph?',
    options: [
      { id: 'opt-a', label: 'Graph-grounded retrieval' },
      { id: 'opt-b', label: 'Extracting entities into the graph' },
      { id: 'opt-c', label: 'Experimenting, nothing shipped' },
      { id: 'opt-d', label: 'Not at all' },
    ],
  },
  {
    question: 'Which standard has earned its keep?',
    options: [
      { id: 'opt-a', label: 'SHACL' },
      { id: 'opt-b', label: 'SKOS' },
      { id: 'opt-c', label: 'OWL' },
      { id: 'opt-d', label: 'None of them, yet' },
    ],
  },
  {
    question: 'What triggered your first graph project?',
    options: [
      { id: 'opt-a', label: 'Search that would not improve' },
      { id: 'opt-b', label: 'A regulatory or provenance need' },
      { id: 'opt-c', label: 'A merger or migration' },
      { id: 'opt-d', label: 'An AI initiative' },
    ],
  },
  {
    question: 'How big is the graph you work with?',
    options: [
      { id: 'opt-a', label: 'Under 10 million triples' },
      { id: 'opt-b', label: '10–500 million' },
      { id: 'opt-c', label: 'Over half a billion' },
      { id: 'opt-d', label: 'We have stopped counting' },
    ],
  },
];

/**
 * Real companies from this field, arranged into a plausible tier structure.
 *
 * The names are real, the sponsorship is invented — none of these organisations
 * has agreed to anything, and the booth numbers are made up. That is the same
 * bargain the rest of this file strikes, and it is the right one here: a
 * sponsor list of invented vendor names would look wrong to anyone who works in
 * this field, and this list is shown to exactly those people.
 *
 * `description` and `website` used to be generated: every sponsor got
 * "<name> — placeholder description, replace before the demo." and every single
 * one linked to `knowledgegraph.tech`. Fifteen rows announcing themselves as
 * unfinished, in the app's Sponsors tab and across five tables in the console's
 * Sponsor Manager, and fifteen "Visit website" links that all went to the
 * conference's own homepage.
 *
 * One anachronism, left deliberately rather than fixed: Graphwise is the company
 * formed by the Ontotext / Semantic Web Company merger, so listing all three is
 * not a state of the world that ever existed. Untangling it would cost three
 * rows of demo data and buy nothing.
 */
export const SPONSORS: {
  name: string; tier: string; booth: string; website: string; description: string;
}[] = [
  { name: 'Graphwise', tier: 'diamond', booth: 'D1', website: 'https://graphwise.ai',
    description: 'Graph database and text analytics for organisations putting a semantic layer under their AI, from the team behind GraphDB.' },
  { name: 'Stardog', tier: 'diamond', booth: 'D2', website: 'https://www.stardog.com',
    description: 'An enterprise knowledge graph platform built on virtualisation — query the sources where they live rather than copying them first.' },
  { name: 'Neo4j', tier: 'platinum', booth: 'P1', website: 'https://neo4j.com',
    description: 'The property-graph database and Cypher, with a graph data science library for people who want algorithms rather than queries.' },
  { name: 'TigerGraph', tier: 'platinum', booth: 'P2', website: 'https://www.tigergraph.com',
    description: 'A distributed graph database aimed at deep multi-hop analytics on graphs too large to sit on one machine.' },
  { name: 'Metaphacts', tier: 'platinum', booth: 'P3', website: 'https://metaphacts.com',
    description: 'metaphactory: a knowledge-graph platform for building end-user applications on RDF without writing SPARQL by hand.' },
  { name: 'data.world', tier: 'gold', booth: 'G1', website: 'https://data.world',
    description: 'A data catalogue with a knowledge graph underneath it, focused on governance and on finding what your organisation already has.' },
  { name: 'Cambridge Semantics', tier: 'gold', booth: 'G2', website: 'https://cambridgesemantics.com',
    description: 'AnzoGraph and the Anzo data fabric — in-memory graph analytics for large-scale enterprise integration work.' },
  { name: 'Enterprise Knowledge', tier: 'gold', booth: 'G3', website: 'https://enterprise-knowledge.com',
    description: 'A consultancy specialising in taxonomy, ontology and knowledge-graph strategy — the people brought in when the model is the problem.' },
  { name: 'Semantic Web Company', tier: 'gold', booth: 'G4', website: 'https://semantic-web.com',
    description: 'PoolParty: taxonomy and ontology management for teams who have to keep a controlled vocabulary alive across many systems.' },
  { name: 'AllegroGraph', tier: 'silver', booth: 'S1', website: 'https://allegrograph.com',
    description: 'Franz Inc’s RDF store, with document and vector storage alongside the triples for retrieval-augmented work.' },
  { name: 'Ontotext', tier: 'silver', booth: 'S2', website: 'https://www.ontotext.com',
    description: 'GraphDB and the text-analytics tooling around it, long used in publishing and life sciences for linking documents to entities.' },
  { name: 'Diffbot', tier: 'silver', booth: 'S3', website: 'https://www.diffbot.com',
    description: 'A knowledge graph built by crawling and structuring the public web, offered as an API rather than as a database to run.' },
  { name: 'Kurrawong AI', tier: 'startup', booth: 'T1', website: 'https://kurrawong.ai',
    description: 'Australian consultancy and open-source tooling for linked data, vocabularies and catalogue infrastructure in the public sector.' },
  { name: 'Cognee', tier: 'startup', booth: 'T2', website: 'https://www.cognee.ai',
    description: 'Open-source memory for AI agents: builds a graph out of what an agent has seen so retrieval is structured rather than nearest-neighbour.' },
  { name: 'WhyHow.AI', tier: 'startup', booth: 'T3', website: 'https://www.whyhow.ai',
    description: 'Tooling for schema-constrained graph construction from unstructured text, aimed at making RAG answers traceable.' },
];

/** PLACEHOLDER names. Deliberately fictional — see the header comment. */
const FIRST = ['Amara', 'Devesh', 'Lena', 'Tomás', 'Ingrid', 'Kwame', 'Sofia', 'Rune', 'Priya', 'Mateo',
  'Yuki', 'Nadia', 'Oskar', 'Chiara', 'Emeka', 'Hana', 'Lucas', 'Mira', 'Anton', 'Zara',
  'Felix', 'Noor', 'Silas', 'Talia', 'Bram', 'Ines', 'Kai', 'Rosa', 'Levi', 'Ada'];
const LAST = ['Okonkwo', 'Lindqvist', 'Nakamura', 'Vasquez', 'Hartmann', 'Adeyemi', 'Moreau', 'Dahl',
  'Raghavan', 'Silva', 'Fontaine', 'Bergström', 'Kovač', 'Almeida', 'Novak', 'Haddad',
  'Weiss', 'Petrova', 'Lindgren', 'Osei'];
const ORGS = ['Cornell Tech', 'Elsevier', 'Springer Nature', 'AstraZeneca', 'Roche', 'Bloomberg',
  'The New York Times', 'Wikimedia Foundation', 'EMBL-EBI', 'JPMorgan Chase', 'Siemens',
  'Airbnb', 'Stanford University', 'TU Delft', 'Ordnance Survey', 'BBC', 'Mayo Clinic',
  'European Commission', 'Library of Congress', 'Uber'];
const TITLES = ['Principal Ontologist', 'Head of Knowledge Engineering', 'Staff Data Architect',
  'Director of Data Science', 'Semantic Technology Lead', 'Research Scientist',
  'VP of Data', 'Knowledge Graph Architect', 'Taxonomy Manager', 'Chief Data Officer'];

/** PLACEHOLDER session titles, drawn from genuine topics in the field. */
const TOPICS = [
  'Modelling Provenance Without Drowning in Reification',
  'SHACL in Production: Three Years of Lessons',
  'From Relational to RDF Without a Big Bang Migration',
  'Entity Resolution at Enterprise Scale',
  'GraphRAG: What Actually Improved Retrieval',
  'Ontology Governance When Nobody Wants to Govern',
  'Property Graphs and RDF Can Be Friends',
  'Vector Search Meets SPARQL',
  'Building a Clinical Terminology Service',
  'Knowledge Graphs for Regulatory Reporting',
  'Federated Query Across Twelve Silos',
  'Teaching an LLM Your Taxonomy',
  'Schema.org at Newsroom Scale',
  'Measuring Knowledge Graph Quality',
  'The Cost of Getting URIs Wrong',
  'Incremental Reasoning for Streaming Data',
  'Mapping Legacy Codes to SNOMED CT',
  'A Product Graph That Survived Black Friday',
  'Semantic Layers for the Modern Data Stack',
  'Wikidata as Reference Infrastructure',
  'Explaining Recommendations With Graph Paths',
  'Versioning Ontologies in a Monorepo',
  'Text-to-SPARQL That Users Actually Trust',
  'Digital Twins and Their Ontologies',
  'Persistent Identifiers for Research Outputs',
  'Graph Embeddings for Drug Repurposing',
  'Data Contracts Backed by Shapes',
  'Knowledge Graphs Behind Search Ranking',
  'Curating a Materials Science Graph',
  'When Not to Use a Knowledge Graph',
  /*
   * Everything below extends the list from thirty to seventy-five.
   *
   * `makeSessions` generates seventy-two sessions and indexed into thirty
   * titles, so every title appeared two or three times across the week — "SHACL
   * in Production" ran three times on three different days, under three
   * different tracks, with three different speakers. On a scrolled agenda that
   * does not read as a busy programme, it reads as broken seed data, which is
   * the first thing a demo audience would notice.
   */
  'Reconciling Two Ontologies After a Merger',
  'What Breaks When the Graph Doubles',
  'Federated Queries Across Four Warehouses',
  'Naming Things: A Practitioner’s Postmortem',
  'Versioning an Ontology Without Breaking Consumers',
  'Graph Embeddings for Drug Repurposing',
  'The Case Against Reasoning at Query Time',
  'Provenance That Survives a Pipeline Rewrite',
  'Teaching a Team to Read SPARQL',
  'Schema Drift and How We Detected It',
  'Mapping Legacy Codes to a Shared Vocabulary',
  'A Knowledge Graph for Clinical Trial Matching',
  'When the Reasoner Stops Terminating',
  'Shapes as Documentation',
  'Bitemporal Modelling for Regulated Data',
  'Deduplicating a Supplier Master at Scale',
  'Graph Analytics for Fraud Rings',
  'Ontology Governance With Fifteen Stakeholders',
  'Retrieval Quality: Measuring What Users Actually Got',
  'From Spreadsheets to a Controlled Vocabulary',
  'Streaming Updates Into a Live Graph',
  'Access Control on a Shared Knowledge Graph',
  'The Cost Model Nobody Budgeted For',
  'Linking Publications to Datasets to People',
  'Query Patterns That Age Badly',
  'A Taxonomy the Editors Actually Use',
  'Entity Linking Against a Noisy Catalogue',
  'Explaining a Graph Answer to a Regulator',
  'Migrating Off a Triple Store',
  'Modelling Uncertainty Without Losing Your Nerve',
  'Building a Graph From Support Tickets',
  'Two Years of Continuous Ontology Integration',
  'Rules Engines and Where They Still Win',
  'Geospatial Joins in a Semantic Layer',
  'The Ontology Review Meeting, Improved',
  'Indexing Strategy for Multi-Hop Queries',
  'Curation at the Speed of the Newsroom',
  'A Graph Catalogue for Machine Learning Features',
  'Reference Data as a Product',
  'When Two Teams Disagree About a Class',
  'Testing a Knowledge Graph Like Software',
  'Ontology Alignment With Language Models',
  'Cardinality Constraints That Earn Their Keep',
  'Serving a Graph to Ten Thousand Analysts',
  'The Migration We Would Not Repeat',
];

const FORMATS = ['talk', 'talk', 'talk', 'panel', 'workshop', 'keynote'] as const;

export interface SeedSpeaker {
  name: string; title: string; company: string; bio: string;
}

/**
 * Second sentences for a speaker bio, picked by index.
 *
 * The bio used to be one template with `[Placeholder bio — replace via Whova
 * import.]` on the end, which meant all 45 speaker cards carried the same
 * sentence and announced themselves as unfinished. In a demo that is the most
 * visible thing on the screen, and it teaches the audience nothing true — the
 * operator already gets a loud warning from `seed-demo.ts` that every person here
 * is invented, which is where that warning belongs.
 *
 * Still obviously synthetic, and deliberately so: the names are generated from
 * two small lists, and nothing here should be mistaken for a real programme.
 */
const BIO_NOTES = [
  'Their work centres on making ontologies survive contact with the teams that have to maintain them.',
  'They have spent the last few years on entity resolution at a scale where every heuristic eventually embarrasses someone.',
  'Most of their time goes on the join between a graph and the relational systems nobody is allowed to switch off.',
  'They write and speak often about why schema decisions outlive the people who make them.',
  'Their focus is provenance: not modelling it, which is easy, but keeping it accurate once the pipeline has been rewritten twice.',
  'They came to knowledge graphs from search relevance, and still think about the problem in those terms.',
  'They maintain several open-source tools in this space and are candid about which of them were mistakes.',
  'Their interest is the operational side — migrations, monitoring, and what to do when a reasoner stops terminating.',
  'They work on the boundary between knowledge graphs and language models, mostly on the parts that do not work yet.',
  'They have led two large graph migrations, one of which they describe as a success.',
];

function speakerBio(name: string, title: string, company: string, i: number): string {
  const article = /^[aeiou]/i.test(title) ? 'an' : 'a';
  return `${name} is ${article} ${title} at ${company}. ${BIO_NOTES[i % BIO_NOTES.length]}`;
}

/**
 * Abstract bodies, picked by index so adjacent rooms do not read identically.
 *
 * Same reasoning as `BIO_NOTES`: 66 of the 72 sessions shared one string ending
 * in `[Placeholder abstract — replace via Whova import.]`, so the agenda looked
 * broken rather than unfinished, and a session detail screen — the busiest screen
 * in the app — had nothing on it worth reading.
 */
const ABSTRACT_BODIES = [
  'A walk through a system that is in production now: what the model looked like on the first day, what it looks like after two years of requests nobody anticipated, and which of those changes were cheap.',
  'Less a methodology talk than a post-mortem. Three approaches were tried, two were abandoned, and the reasons had more to do with team size than with technology.',
  'Practical material, aimed at people who already have a graph and are wondering why it is getting slower. Query shapes, index choices, and the point at which denormalising stopped being a compromise.',
  'The uncomfortable version of this topic: where the published guidance breaks down at scale, and what has to be given up to get past it.',
  'A tour of the tooling, honestly assessed — including where the standards help, where they get in the way, and what still has to be written by hand.',
  'Two teams, the same problem, opposite conclusions. This session sets out both and is deliberately not neutral about which travelled better.',
  'Aimed at newcomers, but not introductory. The question is what to build first when the eventual shape of the graph is not yet knowable.',
  'What happens after the pilot succeeds: governance, ownership, and the awkward conversation about who is on call for the ontology.',
];

/**
 * One-line attendee bios, in the register people actually write in — first
 * person, slightly under-punctuated, occasionally asking for something.
 */
export const ATTENDEE_BIOS = [
  'Ontology work at a mid-size insurer. Here mostly for the modelling track.',
  'Second KGC. Happy to talk about migrating off a relational warehouse.',
  'Data engineer, new to graphs — looking for people to ask stupid questions.',
  'Interested in provenance and in anything involving a reasoner that will not terminate.',
  'Currently deciding between two graph databases. Opinions welcome.',
  'Working on entity resolution across 40 source systems. It is going fine.',
  'Academic side — knowledge representation. Keen to hear what industry actually deploys.',
  'Product manager on a search team. I care about relevance, I tolerate SPARQL.',
  'Building an internal knowledge graph for a hospital network. Governance questions mostly.',
  'Here for the LLM-and-graphs sessions, sceptically.',
  'Consultant. Have seen a lot of half-finished ontologies and would like to see fewer.',
  'Platform engineer. My interest is how any of this is operated at 3am.',
];

export function makeSpeakers(n: number): SeedSpeaker[] {
  const out: SeedSpeaker[] = [];
  for (let i = 0; i < n; i++) {
    /*
     * Stride 7 through the surnames, because 7 and 20 are coprime and so visit
     * all twenty before repeating.
     *
     * This was `LAST[Math.floor(i / FIRST.length) % LAST.length + (i % 3)]`,
     * which for every one of the first thirty speakers evaluates to `0 + (i % 3)`
     * — three surnames, total. Forty-five speakers shared four between them, and
     * because the speakers page sorts by surname the result was eight
     * consecutive cards reading "Lindqvist". The pair repeats every 60, so all
     * forty-five names here are distinct.
     */
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    const company = ORGS[i % ORGS.length];
    const title = TITLES[i % TITLES.length];
    out.push({
      name,
      title,
      company,
      bio: speakerBio(name, title, company, i),
    });
  }
  return out;
}

export interface SeedSession {
  title: string; format: string; startsAtLocal: string; endsAtLocal: string;
  room: string; tracks: string[]; speakers: number[]; description: string;
}

/**
 * Five days, May 3–7 2027, shaped like the real thing: workshops on the
 * bookends, a plenary keynote each morning with nothing opposite it, and three
 * parallel tracks through the middle of the day.
 */
export function makeSessions(speakerCount: number): SeedSession[] {
  const days = ['2027-05-03', '2027-05-04', '2027-05-05', '2027-05-06', '2027-05-07'];
  const slots = [
    ['09:00', '09:45'], ['10:00', '10:45'], ['11:00', '11:45'],
    ['13:00', '13:45'], ['14:00', '14:45'], ['15:15', '16:00'],
  ];
  const parallelRooms = ['VEEC Classroom 1', 'VEEC Classroom 2', 'Bloomberg 165'];

  const sessions: SeedSession[] = [];
  let topic = 0;
  let speaker = 0;
  const nextSpeaker = () => speaker++ % speakerCount;

  days.forEach((day, d) => {
    // One plenary keynote each morning, alone in the schedule.
    sessions.push({
      title: `Keynote: ${TOPICS[topic++ % TOPICS.length]}`,
      format: 'keynote',
      startsAtLocal: `${day}T08:30`,
      endsAtLocal: `${day}T09:00`,
      room: 'VEEC Banquet Hall',
      tracks: [TRACKS[d % TRACKS.length].name],
      speakers: [nextSpeaker()],
      description: 'Opening plenary. No parallel sessions.',
    });

    slots.forEach(([from, to], s) => {
      /*
       * Workshops open the week: Monday and Tuesday.
       *
       * This was `d === 0 || d === 4` — Monday and *Friday* — while `SITE.
       * workshopDays`, the ticker, `/learn` and the $699 Workshops ticket all
       * said Monday and Tuesday. The data was the only thing telling the truth
       * about itself and it disagreed with every page that described it, so a
       * Workshops buyer was sold Monday and Tuesday, given Monday's six
       * workshops plus twelve parallel talks on Tuesday they had not bought, and
       * missed Friday's six entirely.
       */
      const isWorkshopDay = d === 0 || d === 1;
      const width = isWorkshopDay ? 1 : parallelRooms.length;
      for (let p = 0; p < width; p++) {
        const format = isWorkshopDay ? 'workshop' : FORMATS[(topic + p) % FORMATS.length];
        const title = TOPICS[topic++ % TOPICS.length];
        const track = TRACKS[(d * 3 + p + s) % TRACKS.length];
        const secondTrack = TRACKS[(d + s + 5) % TRACKS.length];
        sessions.push({
          title,
          format: format === 'keynote' ? 'talk' : format,
          startsAtLocal: `${day}T${from}`,
          endsAtLocal: `${day}T${to}`,
          room: isWorkshopDay ? 'VEEC Classroom 3' : parallelRooms[p],
          // Some sessions are cross-listed, which is why trackIds is a list.
          tracks: s % 4 === 0 ? [track.name, secondTrack.name] : [track.name],
          speakers: format === 'panel'
            ? [nextSpeaker(), nextSpeaker(), nextSpeaker()]
            : [nextSpeaker()],
          description: ABSTRACT_BODIES[(topic + p + s + d) % ABSTRACT_BODIES.length],
        });
      }
    });

    /*
     * The Monday reception: 21:00 local is 01:00 UTC the next day. If this ends
     * up on the wrong day tab, the `day` derivation is broken — which is the
     * whole reason this session exists, so do not move it out of the evening.
     *
     * It was on `d === 1`, i.e. Tuesday, directly contradicting the comment
     * above it and putting a *welcome* reception on the second evening of a
     * five-day event.
     */
    if (d === 0) {
      sessions.push({
        title: 'Welcome Reception',
        format: 'social',
        startsAtLocal: `${day}T21:00`,
        endsAtLocal: `${day}T23:00`,
        room: 'VEEC Banquet Hall',
        tracks: [],
        speakers: [],
        description: 'Drinks and networking. Deliberately late, to exercise the timezone logic.',
      });
    }
  });

  return sessions;
}

/**
 * `replies` seeds the subcollection under each post.
 *
 * They are not decoration. The board renders a reply count, and with every post
 * at zero there was nothing to distinguish a working count from a broken one —
 * the count *was* broken, and it looked exactly like a quiet board. The
 * distribution is deliberately uneven so the "Most Replies" sort visibly reorders
 * something, and one post is left empty so the genuine "No replies yet" state is
 * still reachable.
 */
export const COMMUNITY_POSTS = [
  {
    category: 'ride-share',
    title: 'Tram from Manhattan around 08:00?',
    body: 'Happy to coordinate — the F train gets busy. Anyone heading over from midtown Tuesday morning?',
    replies: [
      'I am on the 08:05 from 59th most mornings, happy to have company.',
      'Tram is fine but the queue at 08:30 is twenty minutes. Go early.',
      'Taking the ferry instead — slower, but you get a seat and a view.',
    ],
  },
  {
    category: 'meetup',
    title: 'SHACL users, informal lunch Wednesday',
    body: 'Grabbing lunch outside VEEC at 12:15 if anyone wants to compare validation war stories.',
    replies: [
      'Count me in. Bringing a horror story about recursive shapes.',
      'Is this still on if it rains?',
      'There is covered seating on the north side, so yes.',
      'Joining late, will find you around 12:40.',
      'We ended up with eleven people last year — worth booking ahead.',
    ],
  },
  {
    category: 'jobs',
    title: 'Hiring: knowledge engineer, remote EU',
    body: 'Small team, ontology-heavy, permanent. Find me at the Ontotext booth or message here.',
    replies: ['Messaged you.', 'Is there a junior version of this role?'],
  },
  {
    category: 'questions',
    title: 'Is the Wednesday workshop laptop-required?',
    body: 'Travelling light — can I follow along without a machine?',
    replies: [
      'Hands-on for the second half, so bring one if you can.',
      'Organizer here — you can pair with someone, nobody gets stuck.',
    ],
  },
  {
    category: 'ice-breakers',
    title: 'First KGC — what should I not miss?',
    body: 'Coming from a pure relational background. What would you tell a first-timer?',
    replies: [
      'The Tuesday keynote, then talk to people in the hallway instead of filling every slot.',
      'Came from SQL myself two years ago — the modelling track is where it clicked.',
      'Do not skip the lightning talks. Best signal-to-noise of the week.',
      'Say hello to the sponsors on day one, they are far less busy then.',
    ],
  },
  // Deliberately left with no replies: the empty state has to stay reachable.
  {
    category: 'lost-and-found',
    title: 'Found: black laptop charger, Bloomberg 165',
    body: 'Handed it to the registration desk on the ground floor.',
    replies: [],
  },
];

export const ANNOUNCEMENTS = [
  { title: 'Welcome to KGC 2027', body: 'Registration opens at 07:30 in the VEEC lobby. The tram runs every 7 minutes from 59th & 2nd.' },
  { title: 'Room change: SHACL in Production', body: 'Moved to Bloomberg 165 — bigger room, we underestimated demand.' },
  // Do not restore the "the agenda works offline" clause this used to end with.
  // It does not work offline: the Firebase JS SDK has no disk persistence on
  // React Native, so the cache is memory-only and a cold start with no network
  // renders nothing. Promising a room full of attendees that their app works
  // offline, on the one day the venue wifi is saturated, is how this turns into
  // a queue at the registration desk.
  { title: 'Wifi', body: 'Network: CornellTech-Guest. No password required. It saturates around the keynotes, so room numbers are on the printed programme too.' },
];

export { FIRST, LAST, ORGS, TITLES };
