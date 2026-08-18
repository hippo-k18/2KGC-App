/**
 * The Knowledge Graph Conference 2026 speaker roster — 137 people, checked in
 * as data rather than fetched at runtime.
 *
 * ## Where this came from
 *
 * Scraped 2026-08-18 from `https://www.knowledgegraph.tech/2026-speakers/`.
 *
 * That page is not really a WordPress page. Its content is a single embedded
 * Whova speaker widget, so the site's own `wp-json/wp/v2/speakers` custom post
 * type is *not* the source — that endpoint holds 348 historical speakers
 * tagged 2019 through 2024 and has no 2026 term at all. Reading it would have
 * given you the wrong conference.
 *
 * The real source is Whova's public speaker-webpage API, which the embedded
 * iframe calls on load:
 *
 *     GET https://whova.com/xems/apis/event_webpage/speaker/public/
 *         get_speaker_webpage_data/?event_id=<eid>
 *
 * The sibling `get_event_basics_public` call on the same `event_id` returns
 * `{"name": "Knowledge Graph Conference 2026"}`, which is how we know this is
 * the right event.
 *
 * ## Why the count looks wrong if you check the page
 *
 * The widget as embedded on knowledgegraph.tech is titled "Our First Speakers"
 * and renders only five highlighted people plus a "View All Speakers…" link.
 * The full 137 sit behind that link (`?view_all=true`) and in the API payload.
 * All 137 names below were confirmed present in the rendered View All page, in
 * this order. The order is Whova's own `display_dict` order, which the widget's
 * `design.orderby` reports as `last_name` — preserved verbatim here, quirks and
 * all. It is why `(Phil) (Meredith)` sorts first.
 *
 * ## Which five are the highlighted ones, and how that was established
 *
 * The same payload names them outright: `design.highlight_speakers` is an array
 * of exactly five Whova profile ids, which resolve against `speakers[].pid` to
 * Bertails, Khattar, Hendler, Ivie and Pakiman. They are `featured: true` below.
 *
 * Do **not** take the render order from that array — it is stored in whatever
 * order the organiser picked them (Khattar sits second in it). The widget sorts
 * the highlights with the same `design.orderby: last_name` it sorts everyone
 * else by, so the five render Bertails · Hendler · Ivie / Khattar · Pakiman.
 * Confirmed by loading the embed itself, `https://whova.com/embedded/speakers/
 * <event_id>/`, in headless Chrome and reading the five cards it paints. That is
 * also the order they fall in here, because this array is already `last_name`
 * ordered — so a straight `.filter()` reproduces the live page for free.
 *
 * Whova's `design.max_cols` is 3, which is why the fifth row wraps to two
 * centred cards rather than five across.
 *
 * ## This is 2026 data on a 2027 site — on purpose
 *
 * KGC 2027 has no published roster yet. The site owner chose to show the 2026
 * speakers in the meantime. If you are here because the year looks stale: it is
 * a deliberate decision, not a bug. Re-run the scrape against the 2027 event id
 * when that roster goes live.
 *
 * ## Field fidelity
 *
 * `company` and `role` are copied exactly as published, including Whova's own
 * typos (`Director of Product Mangemment`), lowercased company names
 * (`allegrograph`) and stray suffixes (`Knowledge Pixels · Full-time`). These
 * are real people; nothing here has been tidied, expanded or inferred. A field
 * absent upstream is simply absent below.
 *
 * `photo` points at a local file under `public/kgc/speakers/`. Nothing is
 * hotlinked — no third-party requests, and no upstream host needs adding to
 * `images.remotePatterns`. `width`/`height` are the real intrinsic pixel
 * dimensions of the checked-in file, read back from the bytes after encoding,
 * so `next/image` can reserve the box and avoid layout shift.
 *
 * 124 of the 137 have a portrait. The other 13 do not, and deliberately carry
 * no `photo`: 11 had only Whova's generated letter-tile placeholder
 * (`/static/image/default_pics/*.png`), which is not a likeness of anyone, and
 * 2 pointed at expired signed LinkedIn CDN URLs that already return 403 — they
 * would have been broken images even upstream. Render initials for these.
 *
 * No entry has an `href`: the Whova cards open an in-widget modal and do not
 * link out to knowledgegraph.tech. The field is kept optional on the interface
 * for whenever that changes.
 *
 * Portraits larger than 480px on the long edge were downscaled to 480px and
 * re-encoded as progressive JPEG (quality 82); 39 of the 124 were touched.
 * Total on disk is roughly 2.3 MB.
 *
 * Regenerate rather than hand-edit.
 */

export interface Speaker2026 {
  name: string;
  company?: string;
  role?: string;
  /** Local path under `/kgc/speakers/`, already downloaded. */
  photo?: string;
  /** Intrinsic width of the downloaded file, in pixels. */
  width?: number;
  /** Intrinsic height of the downloaded file, in pixels. */
  height?: number;
  /** The speaker's page on knowledgegraph.tech, if the card links to one. */
  href?: string;
  /** In Whova's `design.highlight_speakers` — the "Our First Speakers" five. */
  featured?: boolean;
}

/** Source order preserved: Whova's `display_dict`, ordered by last name. */
export const SPEAKERS_2026: Speaker2026[] = [
  {
    name: '(Phil) (Meredith)',
    company: 'Process Tempo Inc.',
    role: 'Chief Executive Officer',
    photo: '/kgc/speakers/phil-meredith.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Jans Aasman',
    company: 'allegrograph',
    role: 'CEO',
    photo: '/kgc/speakers/jans-aasman.jpg',
    width: 480,
    height: 480,
  },
  {
    name: 'Jeremy Adams',
    company: 'Neo4j',
    role: 'Sr. Developer Advocate',
    photo: '/kgc/speakers/jeremy-adams.jpg',
    width: 480,
    height: 480,
  },
  {
    name: 'Melli Annamalai',
    company: 'Oracle',
    role: 'Distinguished Product Manager',
    photo: '/kgc/speakers/melli-annamalai.jpg',
    width: 457,
    height: 348,
  },
  {
    name: 'Nishtha Arora',
    company: 'Axtria',
    role: 'Director of Product Mangemment',
    photo: '/kgc/speakers/nishtha-arora.jpg',
    width: 100,
    height: 100,
  },
  {
    name: 'Virginia Balseiro',
  },
  {
    name: 'Jesús Barrasa',
    company: 'Neo4j',
    role: 'Field CTO for AI',
    photo: '/kgc/speakers/jesus-barrasa.jpg',
    width: 427,
    height: 480,
  },
  {
    name: 'Jon-Michael Beasley',
    company: 'AbbVie',
    role: 'Knowledge Graph Engineer',
    photo: '/kgc/speakers/jon-michael-beasley.jpg',
    width: 374,
    height: 480,
  },
  {
    name: 'Tim Berners-Lee',
    company: 'Inrupt',
    role: 'Co-founder & CTO',
    photo: '/kgc/speakers/tim-berners-lee.jpg',
    width: 396,
    height: 479,
  },
  {
    name: 'Alexandre Bertails',
    company: 'Netflix',
    role: 'Software Engineer',
    photo: '/kgc/speakers/alexandre-bertails.jpg',
    width: 280,
    height: 280,
    featured: true,
  },
  {
    name: 'Rashmi Bhat',
  },
  {
    name: 'Edgardo Carlos',
    company: 'JP Morgan Chase',
    photo: '/kgc/speakers/edgardo-carlos.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Ashley Caselli',
    company: 'Knowledge Pixels · Full-time',
    role: 'Knowledge/Software Engineer',
    photo: '/kgc/speakers/ashley-caselli.jpg',
    width: 100,
    height: 100,
  },
  {
    name: 'Eric Chacon',
    company: 'Hometap',
    role: 'Chief Information Officer',
    photo: '/kgc/speakers/eric-chacon.jpg',
    width: 480,
    height: 480,
  },
  {
    name: 'Ryan Chandler',
    company: 'AbbVie',
    role: 'Knowledge Graph Engineer',
    photo: '/kgc/speakers/ryan-chandler.jpg',
    width: 411,
    height: 480,
  },
  {
    name: 'Phanidhar Chilakapati',
    photo: '/kgc/speakers/phanidhar-chilakapati.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Stephen Chin',
    company: 'Neo4j',
    role: 'VP of Developer Relations',
    photo: '/kgc/speakers/stephen-chin.jpg',
    width: 480,
    height: 480,
  },
  {
    name: 'Bruce Chorpita',
  },
  {
    name: 'Michael Clow',
    company: 'T. Rowe Price',
    role: 'Director, Data Governance Solutions & Enablement',
    photo: '/kgc/speakers/michael-clow.jpg',
    width: 254,
    height: 332,
  },
  {
    name: 'Hal Cooper',
    company: 'Amazon Web Services',
    role: 'Software Development Engineer III',
    photo: '/kgc/speakers/hal-cooper.jpg',
    width: 320,
    height: 480,
  },
  {
    name: 'Peter Crocker',
    company: 'Oxford Semantic Technologies',
    role: 'Chief Executive Officer and Co-Founder',
    photo: '/kgc/speakers/peter-crocker.jpg',
    width: 480,
    height: 478,
  },
  {
    name: 'Jon Curtis',
    company: 'Cyberhill Partners',
    role: 'VP, Ontology & Knowledge Systems',
    photo: '/kgc/speakers/jon-curtis.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Gurshish Dang',
    company: 'Verisk',
    role: 'Seasoned Data and Technology Leader',
    photo: '/kgc/speakers/gurshish-dang.jpg',
    width: 320,
    height: 320,
  },
  {
    name: 'Ananya Dass',
    company: 'Bloomberg LP',
    role: 'Senior Data Management Professional',
    photo: '/kgc/speakers/ananya-dass.jpg',
    width: 469,
    height: 480,
  },
  {
    name: 'Ben DeLisle',
    company: 'Profound Networks',
    role: 'Senior Vice President of Strategic Insight, Partner',
    photo: '/kgc/speakers/ben-delisle.jpg',
    width: 395,
    height: 427,
  },
  {
    name: 'Helena Deus',
    company: 'Bristol Myers Squibb',
    role: 'Director Translational Medicine and Semantic Data Products',
    photo: '/kgc/speakers/helena-deus.jpg',
    width: 480,
    height: 480,
  },
  {
    name: 'Amar Doshi',
    company: 'TopQuadrant',
    role: 'Head of Product',
    photo: '/kgc/speakers/amar-doshi.jpg',
    width: 258,
    height: 228,
  },
  {
    name: 'Jinhua Du',
    company: 'Balyasny Asset Management',
    role: 'Senior AI Engineer',
    photo: '/kgc/speakers/jinhua-du.jpg',
    width: 480,
    height: 480,
  },
  {
    name: 'Cheryl Dunn',
    company: 'Semantic Arts, Inc. and Grand Valley State University',
    role: 'Entry Ontologist and Professor of Accounting',
    photo: '/kgc/speakers/cheryl-dunn.jpg',
    width: 360,
    height: 480,
  },
  {
    name: 'Davide D’Amico',
    company: 'Bloomberg',
    role: 'Software Engineer',
    photo: '/kgc/speakers/davide-damico.jpg',
    width: 400,
    height: 400,
  },
  {
    name: 'Stephane Fellah',
    company: 'Geoknoesis LLC',
    role: 'CEO & Founder',
    photo: '/kgc/speakers/stephane-fellah.jpg',
    width: 480,
    height: 480,
  },
  {
    name: 'Max Fink',
    company: 'Boehringer Ingelheim GmbH',
    role: 'Senior Data Engineer',
    photo: '/kgc/speakers/max-fink.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Philip Foster',
    company: 'Oxford Semantic Technologies',
    role: 'Chief Operating Officer',
    photo: '/kgc/speakers/philip-foster.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Giuseppe Futia',
    company: 'CSI Piemonte (Italy)',
    role: 'Data Engineer',
    photo: '/kgc/speakers/giuseppe-futia.jpg',
    width: 221,
    height: 221,
  },
  {
    name: 'Vivek Ghatala',
    company: 'Amazon Web Services',
    role: 'Senior Software Development Engineer',
    photo: '/kgc/speakers/vivek-ghatala.jpg',
    width: 280,
    height: 338,
  },
  {
    name: 'Stephen Goldbaum',
    company: 'DataHub',
    role: 'Field CTO for Financial Services, DataHub.',
    photo: '/kgc/speakers/stephen-goldbaum.jpg',
    width: 480,
    height: 367,
  },
  {
    name: 'Michael Grove',
    company: 'Stardog',
    role: 'Co-Founder and SVP Engineering',
    photo: '/kgc/speakers/michael-grove.jpg',
    width: 320,
    height: 320,
  },
  {
    name: 'Adrian Gschwend',
    company: 'Qlevia AI',
    role: 'CEO',
    photo: '/kgc/speakers/adrian-gschwend.jpg',
    width: 280,
    height: 224,
  },
  {
    name: 'Casey Hart',
    company: 'Casey Hart Consulting',
    role: 'Ontologist',
    photo: '/kgc/speakers/casey-hart.jpg',
    width: 387,
    height: 387,
  },
  {
    name: 'Heather Hedden',
    company: 'Hedden Information Management',
    role: 'Taxonomy Consultant',
    photo: '/kgc/speakers/heather-hedden.jpg',
    width: 279,
    height: 270,
  },
  {
    name: 'Steve Hedden',
    company: 'TopQuadrant',
    role: 'Product Manager',
    photo: '/kgc/speakers/steve-hedden.jpg',
    width: 100,
    height: 100,
  },
  {
    name: 'Veronika Heimsbakk',
    company: 'Data Treehouse',
    role: 'Knowledge Graph Specialist',
    photo: '/kgc/speakers/veronika-heimsbakk.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Wilmer Henao',
    company: 'invesco',
    role: 'data scientist',
    photo: '/kgc/speakers/wilmer-henao.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Jim Hendler',
    company: 'RPI',
    role: 'Tetherless World Chair of Computer, Web and Cognitive Sciences.',
    photo: '/kgc/speakers/jim-hendler.jpg',
    width: 280,
    height: 280,
    featured: true,
  },
  {
    name: 'Florence Hudson',
    company: 'Columbia University',
    role: 'Executive Director, Northeast Big Data Innovation Hub',
    photo: '/kgc/speakers/florence-hudson.jpg',
    width: 280,
    height: 381,
  },
  {
    name: 'David Hughes',
    company: 'Independent',
    role: 'AI and Graph Solution Architect',
    photo: '/kgc/speakers/david-hughes.jpg',
    width: 360,
    height: 480,
  },
  {
    name: 'Charles Ivie',
    company: 'Ortecha',
    role: 'Partner & Head of Data & AI Engineering',
    photo: '/kgc/speakers/charles-ivie.jpg',
    width: 279,
    height: 262,
    featured: true,
  },
  {
    name: 'Jared Jacobovitz',
    company: 'Stardog',
    role: 'Head of Pharma and Life Sciences',
    photo: '/kgc/speakers/jared-jacobovitz.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Muhammad Javed',
    company: 'Morgan Stanley',
    role: 'Head of Ontology and Semantic Modeling',
    photo: '/kgc/speakers/muhammad-javed.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Yitae Jeong',
    company: 'MetisX',
    role: 'Product management',
    photo: '/kgc/speakers/yitae-jeong.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Ademar Crotti Junior',
    company: 'metaphacts',
    role: 'Principal Technical Consultant',
    photo: '/kgc/speakers/ademar-crotti-junior.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Madeline ⁠ Jürgensen',
    company: 'CentralReach',
    role: 'Instructional Designer & Research Associae',
    photo: '/kgc/speakers/madeline-jurgensen.jpg',
    width: 280,
    height: 210,
  },
  {
    name: 'Thomas Kaminski',
    company: 'Metaphacts',
    role: 'Solutions Engineer',
    photo: '/kgc/speakers/thomas-kaminski.jpg',
    width: 332,
    height: 480,
  },
  {
    name: 'Mengjia Kang',
    company: 'JPMorganChase',
    role: 'Senior Software Engineer - Graph Engineer',
    photo: '/kgc/speakers/mengjia-kang.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Nikolaos Karalis',
    company: 'Tentris',
    role: 'Co-Founder',
    photo: '/kgc/speakers/nikolaos-karalis.jpg',
    width: 463,
    height: 480,
  },
  {
    name: 'Ezat Karimi',
    company: 'Amazon',
    role: 'Senior Solutions Architect',
    photo: '/kgc/speakers/ezat-karimi.jpg',
    width: 350,
    height: 431,
  },
  {
    name: 'Bob Kasenchak',
    company: 'Factor',
    role: 'Lead Information Architect',
    photo: '/kgc/speakers/bob-kasenchak.jpg',
    width: 320,
    height: 320,
  },
  {
    name: 'Harmandeep Kaur',
    company: 'University of Connecticut',
    role: 'Graduate Student',
  },
  {
    name: 'Neha Keshan',
    company: 'Keshan2@rpi.edu',
    role: 'Faculty',
  },
  {
    name: 'Agrita Khattar',
    company: 'Paypal',
    role: 'Senior Software Engineer',
    photo: '/kgc/speakers/agrita-khattar.jpg',
    width: 280,
    height: 280,
    featured: true,
  },
  {
    name: 'Atanas Kiryakov',
    company: 'Graphwise',
    role: 'President',
    photo: '/kgc/speakers/atanas-kiryakov.jpg',
    width: 479,
    height: 480,
  },
  {
    name: 'Sanjaya Krishna',
    company: 'Rockefeller Archive Center',
    role: 'External Project Lead - RAC-KG Knowledge Graph',
    photo: '/kgc/speakers/sanjaya-krishna.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Rick Kubina',
    company: 'CentralReach',
    role: 'Director of Research',
    photo: '/kgc/speakers/rick-kubina.jpg',
    width: 280,
    height: 210,
  },
  {
    name: 'Tobias Kuhn',
  },
  {
    name: 'Bobby Kuzma',
    company: 'Artificer Health',
    role: 'Founder',
    photo: '/kgc/speakers/bobby-kuzma.jpg',
    width: 343,
    height: 480,
  },
  {
    name: 'Ora Lassila',
    company: 'Accenture',
    role: 'Assoc. Dir. of Data Eng. & Governance',
    photo: '/kgc/speakers/ora-lassila.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Amber Lennox',
    company: 'gdotv',
    role: 'Developer Relations Engineer',
    photo: '/kgc/speakers/amber-lennox.jpg',
    width: 458,
    height: 458,
  },
  {
    name: 'Helen Lightner',
    company: 'Stardog',
    role: 'VP, Training & Enablement',
    photo: '/kgc/speakers/helen-lightner.jpg',
    width: 84,
    height: 84,
  },
  {
    name: 'Eric Little',
    company: 'Accenture',
    role: 'Principal Director Head of Strategy & AI for Global Products',
    photo: '/kgc/speakers/eric-little.jpg',
    width: 370,
    height: 480,
  },
  {
    name: 'Janak Manek',
    company: 'Morgan Stanley',
    role: 'Executive Director',
    photo: '/kgc/speakers/janak-manek.jpg',
    width: 382,
    height: 480,
  },
  {
    name: 'Radu Marian',
    company: 'Capco',
    role: 'AI and Knowledge Graph Solution Architect',
    photo: '/kgc/speakers/radu-marian.jpg',
    width: 480,
    height: 477,
  },
  {
    name: 'Diana Marks',
    company: 'Oxford Semantic Technologies',
    role: 'Senior Knowledge Engineer',
    photo: '/kgc/speakers/diana-marks.jpg',
    width: 444,
    height: 480,
  },
  {
    name: 'Brian Martin',
    company: 'AbbVie',
    role: 'Chief AI Product Owner, Senior Research Fellow',
    photo: '/kgc/speakers/brian-martin.jpg',
    width: 400,
    height: 400,
  },
  {
    name: 'Bill Mayo',
    company: 'Wellfleet Advisors Ltd',
    role: 'Founder',
    photo: '/kgc/speakers/bill-mayo.jpg',
    width: 480,
    height: 412,
  },
  {
    name: 'Dave McComb',
    company: 'Semantic Arts',
    role: 'CEO and Co-Founder',
    photo: '/kgc/speakers/dave-mccomb.jpg',
    width: 280,
    height: 285,
  },
  {
    name: 'Jamie McCusker',
    company: 'Genpact',
    role: 'Senior Manager | Practice Lead, Knowledge Engineering',
    photo: '/kgc/speakers/jamie-mccusker.jpg',
    width: 480,
    height: 480,
  },
  {
    name: 'Deborah McGuinness',
    company: 'RPI (Rensselaer Polytechnic University)',
    role: 'Tetherless World Senior Constellation Chair, Professor of Computer, Web, and Cognitive Sciences',
    photo: '/kgc/speakers/deborah-mcguinness.jpg',
    width: 200,
    height: 200,
  },
  {
    name: 'Christian Miles',
    company: 'gdotv',
    role: 'Head of Sales',
    photo: '/kgc/speakers/christian-miles.jpg',
    width: 409,
    height: 409,
  },
  {
    name: 'Nicole Moldovan',
    company: 'Amazon Web Services',
    role: 'Principal, Amazon Neptune',
    photo: '/kgc/speakers/nicole-moldovan.jpg',
    width: 480,
    height: 480,
  },
  {
    name: 'Laura Monroe',
    company: 'Stardog',
    role: 'Sr. Product Manager',
    photo: '/kgc/speakers/laura-monroe.jpg',
    width: 386,
    height: 480,
  },
  {
    name: 'Jim Morris',
    company: 'Progress Software',
    photo: '/kgc/speakers/jim-morris.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Fabian Muttach',
    company: 'Boehringer Ingelheim International GmbH',
    role: 'Senior Regulatory Information Manager',
    photo: '/kgc/speakers/fabian-muttach.jpg',
    width: 480,
    height: 360,
  },
  {
    name: 'Denise Myrick',
    company: 'Oracle',
    role: 'Senior Product Manager',
    photo: '/kgc/speakers/denise-myrick.jpg',
    width: 160,
    height: 160,
  },
  {
    name: 'Suyash Nagumalli',
    company: 'AbbVie',
    role: 'AI Software Engineer',
    photo: '/kgc/speakers/suyash-nagumalli.jpg',
    width: 480,
    height: 411,
  },
  {
    name: 'Suresh Nair',
    company: 'Mphasis',
    role: 'Partner, Consumer Banking/Chief Architect - BFS',
    photo: '/kgc/speakers/suresh-nair.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Sara Nash',
    company: 'Enterprise Knowledge',
    role: 'Practice Lead of Semantic Engineering and AI',
    photo: '/kgc/speakers/sara-nash.jpg',
    width: 279,
    height: 362,
  },
  {
    name: 'Paco Nathan',
    company: 'Senzing',
    role: 'Principal DevRel Engineer',
    photo: '/kgc/speakers/paco-nathan.jpg',
    width: 279,
    height: 378,
  },
  {
    name: 'Nathaniel Navarro',
    company: 'Netflix',
    role: 'Software Engineer',
    photo: '/kgc/speakers/nathaniel-navarro.jpg',
    width: 444,
    height: 474,
  },
  {
    name: 'Suhas Nikam',
    company: 'JNJ',
    role: 'Director',
    photo: '/kgc/speakers/suhas-nikam.jpg',
    width: 480,
    height: 480,
  },
  {
    name: 'Brian O\'Keefe',
    company: 'Neo4j',
    role: 'Manager, Solutions Architecture (Startup Program)',
    photo: '/kgc/speakers/brian-o-keefe.jpg',
    width: 200,
    height: 200,
  },
  {
    name: 'Brandon Obenauf',
    company: 'Equifax',
    role: 'Head of Payments and Platforms',
    photo: '/kgc/speakers/brandon-obenauf.jpg',
    width: 280,
    height: 279,
  },
  {
    name: 'Anahita Pakiman',
    company: 'Amazon',
    role: 'Senior Knowledge Graph Engineer & Semantic Architect',
    photo: '/kgc/speakers/anahita-pakiman.jpg',
    width: 280,
    height: 280,
    featured: true,
  },
  {
    name: 'Shreya Pandey',
    company: 'Oracle',
    role: 'Software Engineer',
    photo: '/kgc/speakers/shreya-pandey.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Matthew Perry',
    company: 'Oracle',
    role: 'Consultant Member of Technical Staff',
    photo: '/kgc/speakers/matthew-perry.jpg',
    width: 320,
    height: 320,
  },
  {
    name: 'Hotragn Pettugani',
    company: 'Northeastern University',
    role: 'Graduated Student',
    photo: '/kgc/speakers/hotragn-pettugani.jpg',
    width: 128,
    height: 128,
  },
  {
    name: 'Tirdesh Pettugani',
    photo: '/kgc/speakers/tirdesh-pettugani.jpg',
    width: 159,
    height: 159,
  },
  {
    name: 'Tom Plasterer',
    company: 'Knowledge3 LLC',
    role: 'CEO & Co-Founder',
    photo: '/kgc/speakers/tom-plasterer.jpg',
    width: 320,
    height: 320,
  },
  {
    name: 'Brian Platz',
    company: 'Fluree',
    role: 'CEO & Co-Founder Fluree',
    photo: '/kgc/speakers/brian-platz.jpg',
    width: 480,
    height: 419,
  },
  {
    name: 'Ziroli Plutschow',
  },
  {
    name: 'Michael Pool',
    company: 'Bloomberg',
    role: 'Senior Product Manager',
    photo: '/kgc/speakers/michael-pool.jpg',
    width: 394,
    height: 397,
  },
  {
    name: 'Peio Popov',
    company: 'Graphwise',
    role: 'FSI Lead',
    photo: '/kgc/speakers/peio-popov.jpg',
    width: 198,
    height: 199,
  },
  {
    name: 'Jesse Qin',
    company: 'Kamiwaza AI',
    role: 'Senior Member of Technical Staff',
    photo: '/kgc/speakers/jesse-qin.jpg',
    width: 387,
    height: 387,
  },
  {
    name: 'Tara Raafat',
    company: 'Bloomberg LP',
    role: 'Head of Metadata Strategy- CTO Office',
    photo: '/kgc/speakers/tara-raafat.jpg',
    width: 320,
    height: 320,
  },
  {
    name: 'Shambhavi Raikar',
  },
  {
    name: 'Prashanth Rao',
    company: 'LanceDB',
    role: 'AI Engineer',
    photo: '/kgc/speakers/prashanth-rao.jpg',
    width: 280,
    height: 302,
  },
  {
    name: 'Adam Rendek',
    company: 'Amazon',
    role: 'Data Center - Global Constructability Optimization Manger',
    photo: '/kgc/speakers/adam-rendek.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Taylor Riggan',
    company: 'AWS',
    role: 'Principal Graph Architect, Amazon Neptune',
    photo: '/kgc/speakers/taylor-riggan.jpg',
    width: 414,
    height: 406,
  },
  {
    name: 'Elliott Risch',
    company: 'Enterprise Knowledge LLC',
    role: 'Semantic AI Solution Consultant',
    photo: '/kgc/speakers/elliott-risch.jpg',
    width: 480,
    height: 466,
  },
  {
    name: 'Prukalpa Sankar',
    company: 'Atlan',
    role: 'Founder & Co-CEO',
    photo: '/kgc/speakers/prukalpa-sankar.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Henrique Santos',
    company: 'Rensselaer Polytechnic Institute',
    role: 'Director, Semantic Applications Research',
    photo: '/kgc/speakers/henrique-santos.jpg',
    width: 480,
    height: 480,
  },
  {
    name: 'Cruce Saunders',
    company: 'ARAMAI',
    role: 'Founder & CEO',
    photo: '/kgc/speakers/cruce-saunders.jpg',
    width: 480,
    height: 480,
  },
  {
    name: 'Chun Schiros',
    company: 'amazon',
    role: 'Enterprise Technologist',
    photo: '/kgc/speakers/chun-schiros.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Tony Seale',
    company: 'The Knowledge Graph Guys',
    role: 'Founder',
    photo: '/kgc/speakers/tony-seale.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Monil Shah',
    company: 'Amazon',
    role: 'SDE-III',
    photo: '/kgc/speakers/monil-shah.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Barbara Shubinski',
    company: 'Rockefeller Archive Center',
    role: 'Director of Research',
    photo: '/kgc/speakers/barbara-shubinski.jpg',
    width: 300,
    height: 300,
  },
  {
    name: 'Don Simpson',
    company: 'AWS',
    role: 'Principal Technologist',
    photo: '/kgc/speakers/don-simpson.jpg',
    width: 280,
    height: 224,
  },
  {
    name: 'Ankit Singh',
    company: 'AbbVie',
    role: 'Sr. Scientist',
    photo: '/kgc/speakers/ankit-singh.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Divya Singh',
    company: 'Dell Technologies',
    role: 'Data Engineering Consultant',
  },
  {
    name: 'Evren Sirin',
    company: 'Stardog',
    role: 'CTO & Co-Founder',
    photo: '/kgc/speakers/evren-sirin.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Ted Slater',
    company: 'EPAM Systems',
    role: 'Global Head, Knowledge Engineering & Data Advisory',
    photo: '/kgc/speakers/ted-slater.jpg',
    width: 200,
    height: 200,
  },
  {
    name: 'Brian Stein',
    company: 'Valley Bank',
    role: 'Head of Enterprise Data, Analytics, and Governance',
  },
  {
    name: 'Eliza Swindell',
    company: 'UCLA',
    role: 'Project Director',
    photo: '/kgc/speakers/eliza-swindell.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Krisztián Szabó',
    company: 'Marketer.com',
    role: 'Founding Engineer',
    photo: '/kgc/speakers/krisztian-szabo.jpg',
    width: 280,
    height: 230,
  },
  {
    name: 'Jessica Talisman',
    company: 'Contextually LLC',
    role: 'Principal',
    photo: '/kgc/speakers/jessica-talisman.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Randy Taylor',
  },
  {
    name: 'Anu Tennyson',
  },
  {
    name: 'Nikos Trokanas',
    company: 'Scania',
    role: 'Ontology Architect',
    photo: '/kgc/speakers/nikos-trokanas.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'John Tulinsky',
    company: 'Factor',
    role: 'Information Architect',
    photo: '/kgc/speakers/john-tulinsky.jpg',
    width: 320,
    height: 320,
  },
  {
    name: 'Danielle Villa',
  },
  {
    name: 'Drew Wanczowski',
    company: 'Progress Software',
    role: 'Solutions Engineer, Senior Principal',
    photo: '/kgc/speakers/drew-wanczowski.jpg',
    width: 160,
    height: 160,
  },
  {
    name: 'Claire Wang',
    company: 'Netflix',
    role: 'Software Engineer',
    photo: '/kgc/speakers/claire-wang.jpg',
    width: 480,
    height: 444,
  },
  {
    name: 'Dougal Watt',
    company: 'Graph Reseach Labs',
    role: 'Co-founder & CEO',
    photo: '/kgc/speakers/dougal-watt.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Richard Weng',
    company: 'Accenture',
    role: 'Managing Director',
    photo: '/kgc/speakers/richard-weng.jpg',
    width: 280,
    height: 231,
  },
  {
    name: 'Bram Wessel',
    company: 'Factor',
    role: 'Principal',
    photo: '/kgc/speakers/bram-wessel.jpg',
    width: 480,
    height: 438,
  },
  {
    name: 'Maru Willson',
    company: 'The Knowledge Graph Learning Program',
    role: 'Chief Learning Officer',
    photo: '/kgc/speakers/maru-willson.jpg',
    width: 280,
    height: 280,
  },
  {
    name: 'Mike Xu',
    company: 'Moody\'s',
    role: 'Head of Analytics - Data Estate',
    photo: '/kgc/speakers/mike-xu.jpg',
    width: 474,
    height: 480,
  },
  {
    name: 'Weidong Yang',
    company: 'Kineviz, Inc.',
    role: 'CEO',
    photo: '/kgc/speakers/weidong-yang.jpg',
    width: 476,
    height: 480,
  },
];

/**
 * The five Whova highlights, in the order the live widget paints them — which
 * needs no sorting here, because `SPEAKERS_2026` is already in Whova's
 * `last_name` order and the widget sorts its highlights the same way.
 */
export const FEATURED_2026: Speaker2026[] = SPEAKERS_2026.filter((s) => s.featured);

/**
 * Everyone else. Derived rather than listed so the two sections cannot drift
 * into showing the same person twice.
 */
export const REST_2026: Speaker2026[] = SPEAKERS_2026.filter((s) => !s.featured);
