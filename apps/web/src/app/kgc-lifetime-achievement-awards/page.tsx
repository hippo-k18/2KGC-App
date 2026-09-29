import type { Metadata } from 'next';
import Link from 'next/link';
import { ticketSalesOpen } from '@/lib/data';

export const metadata: Metadata = {
  title: 'KGC Lifetime Achievement Awards',
  description:
    'The Knowledge Graph Conference Lifetime Achievement Award, and the people who have received it.',
};

/**
 * Built 2026-08-20 against the live /kgc-lifetime-achievement-awards page.
 *
 * The recipient list is the live page's own, checked against the archived
 * WordPress page on 2026-09-27: the 2026 recipients and every past year back to
 * 2020. That page has names only, no citations, and links each name to its
 * Wikipedia article, which this does too.
 *
 * The biographies are the recipients' own KGC speaker pages, verbatim, from the
 * WordPress export (2026-09-28). Only five recipients spoke at KGC and so have
 * one; the others have no KGC biography, and none is written for them here.
 */

type Recipient = { name: string; wikipedia: string };

const wiki = (article: string) => `https://en.wikipedia.org/wiki/${article}`;

const CURRENT = {
  year: 2026,
  recipients: [
    { name: 'James Hendler', wikipedia: wiki('James_Hendler') },
    { name: 'Ora Lassila', wikipedia: wiki('Ora_Lassila') },
    { name: 'Tim Berners-Lee', wikipedia: wiki('Tim_Berners-Lee') },
  ] as Recipient[],
};

const PAST: { year: number; recipients: Recipient[] }[] = [
  { year: 2025, recipients: [{ name: 'Mark Musen', wikipedia: wiki('Mark_Musen') }] },
  { year: 2024, recipients: [{ name: 'Doug Lenat', wikipedia: wiki('Douglas_Lenat') }] },
  { year: 2023, recipients: [{ name: 'Denny Vrandečić', wikipedia: wiki('Denny_Vrande%C4%8Di%C4%87') }] },
  { year: 2022, recipients: [{ name: 'Deborah McGuinness', wikipedia: wiki('Deborah_McGuinness') }] },
  {
    year: 2021,
    recipients: [{ name: 'Albert-László Barabási', wikipedia: wiki('Albert-L%C3%A1szl%C3%B3_Barab%C3%A1si') }],
  },
  { year: 2020, recipients: [{ name: 'John F. Sowa', wikipedia: wiki('John_F._Sowa') }] },
];

/**
 * Verbatim from each recipient's KGC speaker page, typos included. `slug` is
 * that page's address under /past-speakers, where it now lives on this site.
 */
const BIOS: { name: string; year: number; slug: string; paragraphs: string[] }[] = [
  {
    "name": "Ora Lassila",
    "slug": "ora-lassila",
    "year": 2026,
    "paragraphs": [
      "Ora Lassila is a Principal Graph Technologist in the Amazon Neptune graph database group. He has a long experience with graphs, graph databases, ontologies, and knowledge representation, and was a co-author of the original RDF specification as well as a co-author of the seminal article on the Semantic Web. He holds a Ph.D in Computer Science, but actually aspires to be a professional aviation photographer.."
    ]
  },
  {
    "name": "Denny Vrandečić",
    "slug": "denny-vrandecic-2",
    "year": 2023,
    "paragraphs": [
      "Denny Vrandečić is Head of Special Projects at the Wikimedia Foundation, leading the development of Wikifunctions and Abstract Wikipedia. He is the founder of Wikidata, co-creator of Semantic MediaWiki, and former elected member of the Wikimedia Foundation Board of Trustees. He worked for Google on the Google Knowledge Graph. He has a PhD in Semantic Web and Knowledge Representation from the Karlsruhe Institute of Technology."
    ]
  },
  {
    "name": "Deborah McGuinness",
    "slug": "deborah-mcguinness",
    "year": 2022,
    "paragraphs": [
      "Deborah McGuinness has been recognized with awards from the American Association for the Advancement of Science (AAAS) and the Association for the Advancement of Artificial Intelligence (AAAI ) for leadership in Semantic Web research and in bridging Artificial Intelligence (AI) and eScience, significant contributions to deployed AI applications, and extensive service to the AI community. She is a leading authority on the semantic web and has been working in knowledge representation and reasoning environments for over 35 years. Deborah’s primary research thrusts include ontologies, provenance, escience, open data, and semantically-enabled schema and data integration for a wide range of informatics , recommender, and configuration applications.",
      "Deborah is also widely known for her leading role in the development of the W3C Recommended Web Ontology Language (OWL), her work on earlier description logic languages and environments, and work on provenance languages and environments, including InferenceWeb, PML, and PROV. She has built and deployed numerous ontology environments and ontology-enhanced applications, including some that have been in continuous use for over a decade, and two that have won deployment awards for variation reduction on plant floors and interdisciplinary virtual observatories. Recent application thrusts include health informatics and smart environmental monitoring. She has published over 400 peer-reviewed papers and has authored granted patents in knowledge based systems, ontology environments, configuration, and search technology.",
      "Deborah also in intellectual property expert witness work and has deposition and trial experience. She also consults with clients wishing to plan, develop, deploy, and maintain semantic web and/or AI applications. Some areas of recent work include: data science, next generation health advisors, ontology design and evolution environments, semantically-enabled virtual observatories, semantic integration of scientific data, context-aware mobile applications, search, eCommerce, configuration, and supply chain management."
    ]
  },
  {
    "name": "Albert-László Barabási",
    "slug": "albert-laszlo-barabasi",
    "year": 2021,
    "paragraphs": [
      "Albert-László Barabási is both the Robert Gray Dodge Professor of Network Science and a Distinguished University Professor at Northeastern University, where he directs the Center for Complex Network Research, and holds appointments in the Departments of Physics and Computer Science, as well as in the Department of Medicine, Harvard Medical School and Brigham and Women Hospital, and is a member of the Center for Cancer Systems Biology at Dana Farber Cancer Institute. A Hungarian born native of Transylvania, Romania, he received his Masters in Theoretical Physics at the Eotvos University in Budapest, Hungary and was awarded a Ph.D. three years later at Boston University. Barabási is the author of the forthcoming book “The Formula: The Science of Success,” and his last book was “Bursts: The Hidden Pattern Behind Everything We Do” (Dutton, 2010) available in five languages. He has also authored “Linked: The New Science of Networks” (Perseus, 2002), currently available in eleven languages, and is the co-editor of “The Structure and Dynamics of Networks” (Princeton, 2005). His work lead to the discovery of scale-free networks in 1999, and proposed the Barabási-Albert model to explain their widespread emergence in natural, technological and social systems, from the cellular telephone to the WWW or online communities. Barabási is a Fellow of the American Physical Society. In 2005 he was awarded the FEBS Anniversary Prize for Systems Biology and in 2006 the John von Neumann Medal by the John von Neumann Computer Society from Hungary, for outstanding achievements in computer-related science and technology. In 2004 he was elected into the Hungarian Academy of Sciences and in 2007 into the Academia Europaea. He received the C&C Prize from the NEC C&C Foundation in 2008. In 2009 APS chose him Outstanding Referee and the US National Academies of Sciences awarded him the 2009 Cozzarelli Prize. In 2011 Barabási was awarded the Lagrange Prize-CRT Foundation for his contributions to complex systems, awarded Doctor Honoris Causa from Universidad Politécnica de Madrid, became an elected Fellow in AAAS (Physics) and is an 2013 Fellow of the Massachusetts Academy of Sciences."
    ]
  },
  {
    "name": "John F. Sowa",
    "slug": "john-f-sowa",
    "year": 2020,
    "paragraphs": [
      "John F. Sowa spent 30 years on R & D projects at IBM and is a co-founder of VivoMind Research LLC. He is a fellow of the AAAI, and he has published several books and many articles on logic, AI, and computational linguistics."
    ]
  }
];

/** Re-read every 30 seconds, so the ticket-sales switch reaches this page. */
export const revalidate = 30;

export default async function AwardsPage() {
  const salesOpen = await ticketSalesOpen();
  return (
    <>
      {/*
        `about-hero-plain`, not `about-hero`. This page borrowed /about's hero,
        which sets its `h1` to 70.4px — but the live awards page uses the theme's
        ordinary 32px/48 heading, so ours was more than twice the size. Only
        /about and /team carry the oversized hero on the live site.
      */}
      <section className="about-hero about-hero-plain">
        <div className="wrap-kgc">
          <h1>KGC Lifetime Achievement Awards</h1>
        </div>
      </section>

      <section className="band band-centred" style={{ padding: '84px 0 76px' }}>
        <div className="wrap-kgc about-prose" style={{ maxWidth: 900, margin: '0 auto' }}>
          <h2 style={{ marginBottom: 28 }}>
            The Knowledge Graph Conference Lifetime Achievement Award
          </h2>
          <p style={{ textAlign: 'center' }}>
            A primary goal of KGC is to increase awareness of the exciting world of knowledge graphs,
            semantic technologies and AI. One of the ways we do that is by highlighting the leading
            contributors to the field.
          </p>
        </div>
      </section>

      <section className="band band-sky band-centred">
        <div className="wrap-kgc">
          <h2 className="kgc-h2-sm" style={{ marginBottom: 34 }}>
            {CURRENT.year} recipients
          </h2>
          <div className="laureates">
            {CURRENT.recipients.map((r) => (
              <a key={r.name} className="laureate" href={r.wikipedia} target="_blank" rel="noreferrer">
                {r.name}
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-centred" style={{ padding: '76px 0 84px' }}>
        <div className="wrap-kgc">
          <h2 className="kgc-h2-sm" style={{ marginBottom: 26 }}>
            Past recipients
          </h2>
          {PAST.map((p) => (
            <p key={p.year} className="learn-intro" style={{ marginBottom: 14 }}>
              <strong>{p.year}:</strong>{' '}
              {p.recipients.map((r, i) => (
                <span key={r.name}>
                  {i > 0 ? ', ' : ''}
                  <a href={r.wikipedia} target="_blank" rel="noreferrer">
                    {r.name}
                  </a>
                </span>
              ))}
            </p>
          ))}

          {salesOpen && (
            <div style={{ marginTop: 40 }}>
              <Link className="btn btn-accent btn-kgc" href="/tickets">
                Join us in May
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* One disclosure per recipient who has a KGC speaker biography. */}
      <section className="band-wash">
        <div className="kgc-faq">
          <h2>Biographies</h2>
          {BIOS.map((b) => (
            <details key={b.name}>
              <summary>
                {b.name}, {b.year}
              </summary>
              <div className="answer">
                {b.paragraphs.map((para) => (
                  <p key={para.slice(0, 40)}>{para}</p>
                ))}
                <p>
                  <Link href={`/past-speakers/${b.slug}`}>{b.name}’s KGC speaker page</Link>
                </p>
              </div>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
