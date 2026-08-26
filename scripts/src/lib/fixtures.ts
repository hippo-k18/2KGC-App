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
/**
 * The ticket catalogue, re-exported from its single definition.
 *
 * These four were invented here once, and the invented names ("All Access",
 * "Workshops Only") did not match the four the website actually sells ("All
 * Access (VIP)", "Workshops"). Since `RegistrationDoc.ticketType` stores the
 * *name* and the badge prints it, that mismatch put a tier on a badge that no
 * tier in the catalogue was called. One definition now, in `ticket-types.ts`.
 */
export { TICKET_TYPE_SEED as TICKET_TYPES } from './ticket-types.js';

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
 * The real KGC sponsor list, scraped from the live site on 2026-08-20.
 *
 * These are not arranged, invented or plausible — they are the 18 sponsors the
 * conference actually has, in the four tiers it actually sells. The live site
 * does not put them in its own HTML: the strip is an embedded Whova widget, and
 * the data comes from Whova's public endpoint
 * `xems/apis/event_webpage/sponsor/public/get_sponsors/?event_id=...`. That is
 * why the original scrape of the site came back with no logos at all and this
 * list had to be invented in the first place.
 *
 * Two logo fields, because two clients need different things from one asset.
 * `logo` is a path into the website's own `public/`, and `logoRemote` is the
 * original absolute URL. The seed writes `logoRemote` into `logoURL`, because a
 * root-relative path means nothing to React Native and the Expo app would
 * silently fall back to initials; the website then prefers its local copy, which
 * keeps a third-party request off a public page that already ships a consent
 * banner. The honest fix for both is Firebase Storage, so that neither client
 * depends on a CloudFront bucket we do not control — see `GAPS-WEB.md`.
 *
 * `description` is the sponsor's own copy, trimmed to its first sentences. Five
 * of them wrote nothing, so five are `undefined` — that is the honest state and
 * generating filler for them is what this file used to do wrong. Booth codes
 * are the one invented field, because the real feed leaves `location` empty and
 * the app's sponsor detail screen has a booth row to fill.
 */
export const SPONSORS: {
  name: string; tier: string; booth: string; website: string;
  logo: string; logoRemote: string; description?: string;
}[] = [
  { name: 'Abbvie', tier: 'platinum', booth: 'P1', website: 'https://www.abbvie.com/',
    logo: '/kgc/sponsors/abbvie.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl_202605/38fc9096dd94bd8fcdd04a8fd30f4ed6796e8189e4e6ce3ec3fc0cd746a0c388_1/AbbVieLogo_AbbVie_dark_blue.png',
    description: 'AbbVie’s mission is to discover and deliver innovative medicines that solve serious health issues today and address the medical challenges of tomorrow.' },
  { name: 'Stardog', tier: 'platinum', booth: 'P2', website: 'https://www.stardog.com/',
    logo: '/kgc/sponsors/stardog.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl_202605/7e008a9cc85ec34ada23eafbd61c717998813aaeb52d5c1d64cd064c3d5e908d_1/6b8933f4_5c32_41b8_a830_48097d97f27b_1597932161144.png',
    description: 'Stardog is an enterprise knowledge graph platform that unifies data across warehouses, lakehouses, and other enterprise sources without requiring data movement, applying semantic context at query time.' },
  { name: 'Accenture', tier: 'gold', booth: 'G1', website: 'https://accenture.com',
    logo: '/kgc/sponsors/accenture.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/weste_202502/0a6a001ba2d1993c28b9c8ec2fa09c65441595527d95b79841edccb36d68be0c_1/cropped_img_weste_202502_1740522750550.png',
    description: undefined },
  { name: 'Amazon Web Services', tier: 'gold', booth: 'G2', website: 'https://aws.amazon.com/',
    logo: '/kgc/sponsors/amazon-web-services.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl_202605/a7ba7ae9810511fa0b94519f867984983bd814ea33e23c40bdb471213f353e65_1/Amazon_Web_Services_Logo.svg.png',
    description: undefined },
  { name: 'Graphwise', tier: 'gold', booth: 'G3', website: 'https://graphwise.ai/',
    logo: '/kgc/sponsors/graphwise.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl_202605/b09d1b97463dcc3284722dca2bdd7ac8dde04ce3e3bf26e9bd4c5b4c02135051_1/graphwise_vertical_1200.png',
    description: 'Graphwise empowers enterprises to make their data and content truly AI-ready. We provide the trusted semantic backbone that connects data silos and grounds search, analytics, and AI in a reliable, governed context.' },
  { name: 'Metaphacts', tier: 'gold', booth: 'G4', website: 'https://metaphacts.com',
    logo: '/kgc/sponsors/metaphacts.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl1_202409/41fdccc0709ebcf555a09b6bddcc5ebb5bd13c6a612b38f560943d81304f117b_1/cropped_img_knowl1_202409_1729558904164.png',
    description: 'metaphacts is an AI-first knowledge graph company helping global enterprises transform data into consumable, contextual and actionable knowledge.' },
  { name: 'Neo4j', tier: 'gold', booth: 'G5', website: 'https://neo4j.com',
    logo: '/kgc/sponsors/neo4j.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/Z2IidtUMQp3jEF2jOLcKEU1AWx0gKKJN7vjZGyKZQI8=/b4007344ea27412f1c224cd25288bf18d2fa017e078c4e13c67239cd5af92f75_1/logo_lockup_stacked_black.png',
    description: 'Neo4j is the graph intelligence platform that transforms data into knowledge to power the next generation of intelligent applications and AI systems.' },
  { name: 'Senzing', tier: 'gold', booth: 'G6', website: 'https://senzing.com/',
    logo: '/kgc/sponsors/senzing.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl_202605/e3802382e8048ab58144ee26cdfdcf2b854ad45dd7a0e8bf8b2f2e6edb2f7027_1/Senzing_Logo_b_r_.png',
    description: 'Senzing delivers the identity intelligence organizations need to achieve their agentic AI aspirations.' },
  { name: 'TopQuadrant', tier: 'gold', booth: 'G7', website: 'https://topquadrant.com',
    logo: '/kgc/sponsors/topquadrant.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl_202605/073d8b8c9f4006819913a327187f85734b5738e69909d44a2426f4b04718e269_1/7b2639b7_3393_4200_81a3_6188298cdbb1.png',
    description: 'TopQuadrant builds knowledge graph software for enterprise data governance and AI readiness, anchored by its flagship product TopBraid Enterprise Data Governance (EDG).' },
  { name: 'Bloomberg', tier: 'silver', booth: 'S1', website: 'https://www.bloomberg.com/',
    logo: '/kgc/sponsors/bloomberg.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl_202605/c60c60f666b1d42b7f301b36587ce18b322d677377f9c192cd90b268937d950f_1/BBGEngineering_black_2026.png',
    description: undefined },
  { name: 'DataHub', tier: 'silver', booth: 'S2', website: 'https://datahub.com/',
    logo: '/kgc/sponsors/datahub.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl_202605/96e20e447163f8675370cff22ec9c94fc19c7c9a5f81384c08ec3b65a8b86085_1/datahub_logo_color_black.png',
    description: undefined },
  { name: 'Fluree', tier: 'silver', booth: 'S3', website: 'https://flur.ee/',
    logo: '/kgc/sponsors/fluree.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl1_202409/44c20b8ed845eace2c089056a7ceab6b856896aa49b4cbe8df4bca65ff402628_1/stacked_safezone_deep_3x.png',
    description: 'Fluree enables you to integrate GenAI with live data sources, so every decision is informed and reliable.' },
  { name: 'Oracle', tier: 'silver', booth: 'S4', website: 'https://www.oracle.com',
    logo: '/kgc/sponsors/oracle.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl_202605/ec8185c9bcde3b7fd1ef3bb00aea650ff933c4a2b79ac5fb72d47c1b7d57b23d_1/Oracle_Database_rgb.png',
    description: undefined },
  { name: 'Oxford Semantic Technologies', tier: 'silver', booth: 'S5', website: 'https://www.oxfordsemantic.tech/',
    logo: '/kgc/sponsors/oxford-semantic-technologies.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl_202605/813df98f8f1b3df49b178d031dbbca95003f37825e177c911f9f580222e9c5ad_1/logo_1_.png',
    description: 'Oxford Semantic Technologies (OST) is a spin-out from the University of Oxford’s Computer Science Department, founded in 2016 and acquired by Samsung in 2024.' },
  { name: 'Progress Software', tier: 'silver', booth: 'S6', website: 'https://www.progress.com/',
    logo: '/kgc/sponsors/progress-software.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl_202605/dce849fb3915eb2bf34f3625a1e7a329726d1d386c27c68993e7d65ca8bb077f_1/Progress_Software_iddhatECy4_1.png',
    description: 'The Progress Data Platform turns fragmented enterprise information into a unified, governed knowledge layer, so AI responses are accurate and explainable.The Progress Data Platform combines knowledge ' },
  { name: 'Cloudera', tier: 'bronze', booth: 'B1', website: 'http://www.cloudera.com/',
    logo: '/kgc/sponsors/cloudera.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl_202605/1751314f37497d0c0d8e831fda64376026fd45cee0ec26c50001759cbb31ec72_1/cloudera.png',
    description: 'We empower the largest enterprises to transform any data anywhere into valuable insights they can trust.' },
  { name: 'gdotv', tier: 'bronze', booth: 'B2', website: 'https://gdotv.com/',
    logo: '/kgc/sponsors/gdotv.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/nqO7FnYJCiFWGmFcpWAJ@NQ5hKYbD9Z55ReHI5sX@qY=/e8fa4f6c2a2107cfb33a73518b8d22c03399fdb492027d6ac51a21d7c7d42ce1_1/gdotv_blue_lockup.png',
    description: 'gdotv – that’s “gee dot vee” – helps developers get more done with graph technology.' },
  { name: 'Process Tempo', tier: 'bronze', booth: 'B3', website: 'https://www.processtempo.com/',
    logo: '/kgc/sponsors/process-tempo.png',
    logoRemote: 'https://d1keuthy5s86c8.cloudfront.net/knowl_202605/ef99a7e16a680b8777043ada15188c9152aa887a119dc0d935dfcf65bf27cb03_1/6890c0cc31b7f97463a832cf_Process_Tempo_Logo_p_500.png',
    description: 'Process Tempo Inc. is a data and analytics company that focuses on enabling organizations to build data-driven, enterprise-ready applications.' },
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

// ---------------------------------------------------------------------------
// The collections the dashboard build-out added
//
// Exhibitors, the organizing team's checklist, attendee documents and a session
// feedback survey. All invented, like everything else here except the tracks,
// rooms, ticket tiers and sponsor tiers.
//
// Seeded because a screen that only ever renders its empty state is a screen
// nobody can evaluate — an organizer looking at the console cannot tell "built
// and waiting for data" from "not built". Every entity below is shaped to
// exercise the interesting branch of its screen rather than just to exist.
// ---------------------------------------------------------------------------

export const EXHIBITORS: {
  name: string; booth?: string; contactName: string; website?: string;
  description: string; passes?: number; used: number;
  status: 'confirmed' | 'provisional' | 'cancelled';
}[] = [
  { name: 'Graphwise', booth: 'E01', contactName: 'Priya Raman', website: 'https://example.invalid/graphwise',
    description: 'Graph database tooling and managed RDF hosting.', passes: 4, used: 4, status: 'confirmed' },
  { name: 'Ontotext Labs', booth: 'E02', contactName: 'Marek Novak', website: 'https://example.invalid/ontotext',
    description: 'Text analytics over enterprise knowledge graphs.', passes: 3, used: 2, status: 'confirmed' },
  { name: 'Cornell Tech Careers', booth: 'E03', contactName: 'Dana Whitfield',
    description: 'Graduate recruitment for the Jacobs Institute.', passes: 2, used: 2, status: 'confirmed' },
  // Over-allocated on purpose: this is the row that makes the warning banner
  // and the progress bar on Exhibitor Manager mean something.
  { name: 'Semantic Foundry', booth: 'E04', contactName: 'Luis Ferreira', website: 'https://example.invalid/foundry',
    description: 'Consulting for ontology-led data platforms.', passes: 2, used: 5, status: 'confirmed' },
  // No booth: exercises the "not on the floor plan" count.
  { name: 'Provenance.io', contactName: 'Aiko Tanaka',
    description: 'Lineage and provenance tracking for ML pipelines.', passes: 2, used: 0, status: 'provisional' },
  { name: 'Withdrawn Systems', booth: 'E06', contactName: 'Sam Oduya',
    description: 'Pulled out in March; kept so the booth history is explicable.',
    passes: 2, used: 0, status: 'cancelled' },
];

/**
 * The exhibition floor, as the venue confirmed it.
 *
 * Deliberately not one row per exhibitor: the point of a floor plan is that it
 * exists before the spaces are sold, so most of these are free. The numbers
 * match `EXHIBITORS[].booth` where an exhibitor has one, because a seeded
 * database in which the exhibitor list and the floor plan disagree is a
 * database that makes the reconciliation screen look broken rather than useful.
 *
 * Three deliberate awkward cases, so the screens have something to say:
 * `E05` is blocked by a pillar, `E07` is held but unpaid, and `E06`'s occupant
 * cancelled — which is why the number still exists and stands empty.
 */
export const BOOTHS: {
  number: string; size: string; zone: string;
  exhibitor?: string;
  status: 'available' | 'held' | 'assigned' | 'blocked';
  note?: string;
  ticketTypeId?: string;
}[] = [
  { number: 'E01', size: '6m × 2m', zone: 'Catering aisle', exhibitor: 'Graphwise', status: 'assigned', ticketTypeId: 'exhibitor-premium-booth' },
  { number: 'E02', size: '3m × 2m', zone: 'Catering aisle', exhibitor: 'Ontotext Labs', status: 'assigned', ticketTypeId: 'exhibitor-standard-booth' },
  { number: 'E03', size: '3m × 2m', zone: 'Main aisle', exhibitor: 'Cornell Tech Careers', status: 'assigned', ticketTypeId: 'exhibitor-standard-booth' },
  { number: 'E04', size: '3m × 2m', zone: 'Main aisle', exhibitor: 'Semantic Foundry', status: 'assigned', ticketTypeId: 'exhibitor-standard-booth' },
  { number: 'E05', size: '3m × 2m', zone: 'Main aisle', status: 'blocked', note: 'Structural pillar takes half the space — unsellable.' },
  { number: 'E06', size: '3m × 2m', zone: 'Main aisle', status: 'available', ticketTypeId: 'exhibitor-standard-booth' },
  { number: 'E07', size: '3m × 2m', zone: 'Main aisle', exhibitor: 'Provenance.io', status: 'held', ticketTypeId: 'exhibitor-standard-booth' },
  { number: 'E08', size: '3m × 2m', zone: 'Back wall', status: 'available', ticketTypeId: 'exhibitor-standard-booth' },
  { number: 'E09', size: '3m × 2m', zone: 'Back wall', status: 'available', ticketTypeId: 'exhibitor-standard-booth' },
  { number: 'E10', size: '3m × 2m', zone: 'Back wall', status: 'available', ticketTypeId: 'exhibitor-standard-booth' },
  { number: 'T01', size: 'Poseur table', zone: 'Startup row', status: 'available', ticketTypeId: 'exhibitor-startup-table' },
  { number: 'T02', size: 'Poseur table', zone: 'Startup row', status: 'available', ticketTypeId: 'exhibitor-startup-table' },
  { number: 'T03', size: 'Poseur table', zone: 'Startup row', status: 'available', ticketTypeId: 'exhibitor-startup-table' },
  { number: 'T04', size: 'Poseur table', zone: 'Startup row', status: 'available', ticketTypeId: 'exhibitor-startup-table' },
];

/**
 * A marketing contact list, and the tracked links that would carry a campaign.
 *
 * Seeded because a campaign screen that only ever renders its empty state
 * cannot be evaluated — an organizer cannot tell "built and waiting for data"
 * from "not built". Each row exercises a branch that matters:
 *
 *   One unsubscribed and one bounced, so the suppression count is not zero and
 *   the difference between "on this list" and "will receive this" is visible.
 *   Somebody on two lists, so the merge behaviour of a re-import is observable.
 *   One link with clicks and no orders, one with both, one retired.
 */
export const CONTACTS: {
  email: string; name?: string; company?: string; source?: string;
  lists: string[]; unsubscribed?: boolean; bounced?: boolean;
}[] = [
  { email: 'rowan.hale@example.invalid', name: 'Rowan Hale', company: 'Meridian Data',
    source: 'KGC 2026 delegate list', lists: ['KGC 2026 attendees'] },
  { email: 'sofia.marchetti@example.invalid', name: 'Sofia Marchetti', company: 'Northwind Health',
    source: 'KGC 2026 delegate list', lists: ['KGC 2026 attendees', 'Workshop waitlist'] },
  { email: 'j.okonkwo@example.invalid', name: 'Jide Okonkwo', company: 'Lagos Institute of Technology',
    source: 'Notify-me form', lists: ['Notify me'] },
  { email: 'hlin@example.invalid', name: 'Hana Lin', company: 'Cobalt Semantics',
    source: 'KGC 2026 delegate list', lists: ['KGC 2026 attendees'] },
  { email: 'p.desai@example.invalid', name: 'Priya Desai', company: 'Argo Pharma',
    source: 'Partner list — SemWeb Europe', lists: ['Partner: SemWeb Europe'] },
  // Unsubscribed on purpose: makes "938 of 1,000" mean something on screen, and
  // proves the re-import guard has something to guard.
  { email: 'no.thanks@example.invalid', name: 'Erik Sandberg', company: 'Vantage Logistics',
    source: 'KGC 2026 delegate list', lists: ['KGC 2026 attendees'], unsubscribed: true },
  // A dead mailbox rather than a decision. Counted separately because only one
  // of the two is the recipient's choice.
  { email: 'left.the.company@example.invalid', name: 'Marcus Webb', company: 'Halcyon Analytics',
    source: 'KGC 2026 delegate list', lists: ['KGC 2026 attendees'], bounced: true },
  { email: 'team@example.invalid', company: 'Ridgeline Consulting',
    source: 'Notify-me form', lists: ['Notify me'] },
];

export const CAMPAIGN_LINKS: {
  code: string; label: string; destination: string;
  owner?: string; channel?: string; clicks: number; active?: boolean;
}[] = [
  { code: 'spring-mail', label: 'February announcement email', destination: '/tickets', clicks: 214 },
  { code: 'li-feb', label: 'LinkedIn post, tickets open', destination: '/tickets', channel: 'linkedin', clicks: 88 },
  { code: 'semweb-eu', label: 'SemWeb Europe newsletter', destination: '/tickets', channel: 'partner', clicks: 47 },
  { code: 'ada-lovelace', label: 'Speaker referral — Ada Lovelace', destination: '/tickets', owner: 'Ada Lovelace', clicks: 63 },
  { code: 'marek-novak', label: 'Speaker referral — Marek Novak', destination: '/tickets', owner: 'Marek Novak', clicks: 19 },
  { code: 'exhibit-outreach', label: 'Exhibitor sales outreach', destination: '/tickets/exhibitor', channel: 'email', clicks: 31 },
  // Retired rather than deleted: the clicks are the only record of what the
  // January campaign achieved, and a retired link 404s.
  { code: 'jan-teaser', label: 'January teaser — superseded', destination: '/', clicks: 12, active: false },
];

/**
 * The attendee registration questions, seeded on but switched off.
 *
 * Switched off is the honest seed state: a demo database that silently asks
 * every buyer for their dietary requirements would change what the checkout
 * does without anybody choosing that. The organizer turns it on from 1.2
 * Question Forms, which is also the demo of that screen.
 *
 * The ids are the slugs `fieldId()` produces, spelled out rather than derived,
 * because they are what answers are stored under — a seed that generated them
 * differently from the editor would produce a form whose existing answers are
 * all orphaned.
 */
export const QUESTION_FIELDS: {
  id: string; prompt: string;
  kind: 'short-text' | 'long-text' | 'choice' | 'multi-choice' | 'checkbox' | 'consent';
  options?: string[]; required: boolean; helpText?: string;
  ticketTypeIds?: string[]; order: number;
}[] = [
  {
    id: 'dietary-requirements',
    prompt: 'Do you have any dietary requirements?',
    kind: 'choice',
    // "No requirements" is listed explicitly: a blank answer and a stated "no"
    // look identical in an export and mean different things to a caterer.
    options: ['No requirements', 'Vegetarian', 'Vegan', 'Gluten-free', 'Halal', 'Kosher', 'Other'],
    required: false,
    helpText: 'Anything else, tell us in the next box.',
    order: 0,
  },
  {
    id: 'accessibility-needs',
    prompt: 'Anything we should know to make the week work for you?',
    kind: 'long-text',
    required: false,
    helpText: 'Step-free access, a quiet space, captioning, a dietary detail the list above missed.',
    order: 10,
  },
  {
    id: 'job-function',
    prompt: 'What best describes your role?',
    kind: 'choice',
    options: ['Engineer', 'Data / ML scientist', 'Architect', 'Researcher', 'Product', 'Leadership', 'Student', 'Other'],
    required: false,
    order: 20,
  },
  // Tier-restricted on purpose: only workshop attendees need to say which
  // track, and asking everybody would collect an answer that means nothing
  // for three quarters of the buyers.
  {
    id: 'workshop-track',
    prompt: 'Which workshop track are you aiming for?',
    kind: 'choice',
    options: ['Beginner', 'Intermediate', 'Advanced', 'Not decided'],
    required: false,
    helpText: 'Not a booking — it tells us how many rooms each level needs.',
    ticketTypeIds: ['all-access', 'workshops'],
    order: 30,
  },
  // A plain checkbox rather than a consent box, and required: this is a
  // condition of attending, not something that can be withheld. The editor
  // refuses a required consent for exactly this reason.
  {
    id: 'code-of-conduct',
    prompt: 'I have read the code of conduct',
    kind: 'checkbox',
    required: true,
    helpText: 'knowledgegraph.tech/code-of-conduct',
    order: 40,
  },
  {
    id: 'photo-consent',
    prompt: 'You may use photographs of me in KGC marketing',
    kind: 'consent',
    required: false,
    order: 50,
  },
];

/**
 * Round tables and meeting-room bookings, so both planning screens render
 * against something.
 *
 * One deliberate clash: `Ontology governance` and the sponsor meeting slot are
 * both in Bloomberg 165 at 14:00 on Wednesday. The clash detector is the most
 * valuable thing on those screens and a seeded database where nothing clashes
 * cannot demonstrate it.
 */
export const GATHERINGS: {
  kind: 'round-table' | 'meeting-slot';
  title: string; host?: string; roomName?: string;
  day?: string; startsAtLocal?: string; endsAtLocal?: string;
  capacity: number; attendees: string[]; notes?: string;
  status: 'planned' | 'confirmed' | 'cancelled';
}[] = [
  {
    kind: 'round-table', title: 'Ontology governance in regulated industries',
    host: 'Priya Raman', roomName: 'Bloomberg 165',
    day: '2027-05-05', startsAtLocal: '14:00', endsAtLocal: '15:00',
    capacity: 8, attendees: ['Rowan Hale', 'Sofia Marchetti', 'Hana Lin'],
    status: 'confirmed',
  },
  {
    kind: 'round-table', title: 'LLMs and graphs: what actually works',
    host: 'Marek Novak', roomName: 'Bloomberg 271',
    day: '2027-05-05', startsAtLocal: '14:00', endsAtLocal: '15:00',
    capacity: 10, attendees: ['Jide Okonkwo', 'Priya Desai'],
    status: 'confirmed',
  },
  {
    kind: 'round-table', title: 'Getting a graph project funded',
    roomName: 'Bloomberg 165',
    day: '2027-05-06', startsAtLocal: '11:00', endsAtLocal: '12:00',
    capacity: 8, attendees: [],
    notes: 'No host yet — ask the programme committee.',
    status: 'planned',
  },
  {
    kind: 'meeting-slot', title: 'Graphwise — customer meetings',
    host: 'Graphwise', roomName: 'Bloomberg 165',
    day: '2027-05-05', startsAtLocal: '14:00', endsAtLocal: '16:00',
    capacity: 4, attendees: ['Priya Raman'],
    status: 'confirmed',
  },
  {
    kind: 'meeting-slot', title: 'Ontotext Labs — press briefing',
    host: 'Ontotext Labs', roomName: 'Bloomberg 271',
    day: '2027-05-06', startsAtLocal: '09:30', endsAtLocal: '10:30',
    capacity: 6, attendees: [],
    status: 'planned',
  },
];

export const TASKS: {
  project: string; title: string; assignee?: string; status: 'todo' | 'doing' | 'done' | 'blocked';
  dueOn?: string; notes?: string;
}[] = [
  { project: 'Venue', title: 'Confirm room layouts with Cornell Tech facilities', assignee: 'Ana', status: 'done', dueOn: '2027-03-01' },
  { project: 'Venue', title: 'Walk the building with the AV lead', assignee: 'Ana', status: 'doing', dueOn: '2027-04-10' },
  // Overdue on purpose: the red tag and the "overdue" tile need a row.
  { project: 'Venue', title: 'Confirm loading dock access for exhibitors', assignee: 'Ana', status: 'todo', dueOn: '2027-04-01',
    notes: 'Exhibitors set up Tuesday evening. Security needs names in advance.' },
  { project: 'AV', title: 'Book recording crew for the three keynotes', assignee: 'Tom', status: 'done', dueOn: '2027-02-15' },
  { project: 'AV', title: 'Test the stream for the Virtual ticket tier', assignee: 'Tom', status: 'blocked', dueOn: '2027-04-20',
    notes: 'Blocked: no streaming provider chosen. The Virtual tier is on sale and promises live streams.' },
  { project: 'AV', title: 'Collect speaker slides', assignee: 'Tom', status: 'todo', dueOn: '2027-04-20' },
  { project: 'Catering', title: 'Final headcount to the caterer', assignee: 'Ravi', status: 'todo', dueOn: '2027-04-25',
    notes: 'Use the badge and catering export, not the full attendee list.' },
  { project: 'Catering', title: 'Confirm dietary requirements process', assignee: 'Ravi', status: 'blocked',
    notes: 'Blocked: registration Question Forms is unbuilt, so nothing collects them.' },
  { project: 'Registration', title: 'Print badges', assignee: 'Ana', status: 'todo', dueOn: '2027-04-28' },
  { project: 'Registration', title: 'Brief the desk volunteers on the scanner', status: 'todo', dueOn: '2027-05-02' },
  { project: 'Registration', title: 'Run one live-mode Stripe transaction end to end', assignee: 'Tom', status: 'todo', dueOn: '2027-03-15',
    notes: 'The webhook has never received a real event. SETUP-PAYMENTS.md section 4.' },
];

export const DOCUMENTS: {
  title: string; description: string; url: string;
  kind: 'pdf' | 'slides' | 'video' | 'link'; restrictTo: string[];
  status: 'draft' | 'published';
}[] = [
  { title: 'Code of conduct', description: 'What we expect of everyone, and how to report a problem.',
    url: 'https://www.knowledgegraph.tech/code-of-conduct', kind: 'link', restrictTo: [], status: 'published' },
  { title: 'Venue map — Bloomberg Center', description: 'Rooms, the exhibition hall and the quiet room.',
    url: 'https://example.invalid/kgc-2027-venue-map.pdf', kind: 'pdf', restrictTo: [], status: 'published' },
  { title: 'Getting to Roosevelt Island', description: 'Tram, subway and where not to park.',
    url: 'https://example.invalid/kgc-2027-travel.pdf', kind: 'pdf', restrictTo: [], status: 'published' },
  // Restricted: exercises the "visible to" column and the honest note that the
  // link itself is still public.
  { title: 'Workshop datasets', description: 'The RDF dumps used in Monday and Tuesday labs.',
    url: 'https://example.invalid/kgc-2027-workshop-data.zip', kind: 'link',
    restrictTo: ['Workshops', 'All Access (VIP)'], status: 'published' },
  { title: 'Sponsor prospectus 2028', description: 'Not for attendees — draft for the sales conversation.',
    url: 'https://example.invalid/kgc-2028-prospectus.pdf', kind: 'pdf', restrictTo: [], status: 'draft' },
];

/** One published feedback survey, so the results view has something to render. */
export const FEEDBACK_QUESTIONS = [
  { id: 'q1', prompt: 'How useful was this session?', kind: 'rating' as const, required: false },
  { id: 'q2', prompt: 'How well did it match its description?', kind: 'rating' as const, required: false },
  {
    id: 'q3', prompt: 'Would you recommend it to a colleague?', kind: 'single' as const,
    options: ['Yes', 'Maybe', 'No'], required: false,
  },
  { id: 'q4', prompt: 'What would have made it better?', kind: 'text' as const, required: false },
];

export const FEEDBACK_COMMENTS = [
  'More time for questions — the last ten minutes were rushed.',
  'The worked example was the best part. More of that.',
  'Slides were dense. Happy to read them afterwards, but hard to follow live.',
  'Would have liked the dataset in advance.',
  'Good level. Assumed I knew SPARQL, which I did.',
];
