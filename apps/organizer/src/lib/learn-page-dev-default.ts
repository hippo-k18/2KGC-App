import type { LearnPageContent } from '@kgc/shared';

/**
 * ⚠️ A stand-in for T311's `LEARN_PAGE_DEFAULT` (today's /learn page as
 * blocks), which in this branch is still a `declare const` with no value.
 * Delete on merge; see `learn-page-dev.ts`.
 */
export function learnPageDevDefault(): LearnPageContent {
  const brochure = 'mailto:contact@knowledgegraph.tech?subject=KGC%20Learn%20brochure';
  const programme = (id: string, title: string, text: string, children?: string[]) => ({
    id,
    title,
    text,
    children,
    link: { label: 'Learn more and download the brochure.', href: brochure, style: 'text' as const },
  });
  return {
    seoTitle: 'The Knowledge Graph Learning Program',
    seoDescription:
      'KGC | Learn: the team, the continuing education roster, and the four certificate programmes.',
    sections: [
      {
        id: 'hero',
        label: 'Hero',
        background: 'grey-wave',
        waveBehindFirstImage: true,
        width: 'wide',
        paddingTop: 'none',
        paddingBottom: 'large',
        blocks: [
          {
            id: 'hero-wordmark',
            kind: 'image',
            image: { src: '/kgc/learn-wordmark.png', alt: 'KGC | Learn', width: 1000, height: 275 },
            width: 'large',
            shape: 'original',
            align: 'center',
          },
          {
            id: 'hero-tagline',
            kind: 'text',
            text: 'Learn how knowledge graphs can shape the future of your business and career.',
            size: 'large',
            align: 'center',
          },
          { id: 'hero-strap', kind: 'text', text: '*Where peer-learning drives practice.*', size: 'large', align: 'center' },
        ],
      },
      {
        id: 'team',
        label: 'Team',
        background: 'white-wave',
        width: 'normal',
        paddingTop: 'large',
        paddingBottom: 'large',
        blocks: [
          { id: 'team-h', kind: 'heading', text: 'Meet the **KGC | Learn** Team', level: 2, size: 'x-large', align: 'center' },
          {
            id: 'team-intro',
            kind: 'text',
            text: 'KGC|Learn was established by KGC with a 2023 grant from the National Science Foundation to attract the best of the KGC Community and Conferences.',
            size: 'large',
            align: 'center',
          },
          {
            id: 'team-people',
            kind: 'people',
            style: 'cards',
            columns: 3,
            people: [
              { id: 'p-francois', name: 'François Scharffe', role: 'Co-Founder', photo: { src: '/kgc/team/francois-scharffe.jpeg', alt: 'François Scharffe', width: 300, height: 300 }, linkedin: 'https://www.linkedin.com/in/francoischarffe/' },
              { id: 'p-thomas', name: 'Thomas Deely', role: 'Co-Founder', photo: { src: '/kgc/team/thomas-deely.jpg', alt: 'Thomas Deely', width: 300, height: 300 }, linkedin: 'https://www.linkedin.com/in/thomasdeely/' },
              { id: 'p-maru', name: 'Maru Willson', role: 'Chief Learning Officer', photo: { src: '/kgc/team/maru-willson.jpeg', alt: 'Maru Willson', width: 300, height: 300 }, linkedin: 'https://www.linkedin.com/in/maruwillson/' },
            ],
          },
        ],
      },
      {
        id: 'ce',
        label: 'Continuing education',
        background: 'light-blue-wave',
        width: 'normal',
        paddingTop: 'large',
        paddingBottom: 'large',
        blocks: [
          { id: 'ce-h', kind: 'heading', text: 'Meet the **KGC|Learn**\nContinuing Education Team', level: 2, size: 'x-large', align: 'center' },
          {
            id: 'ce-people',
            kind: 'people',
            style: 'list',
            columns: 4,
            people: [
              { id: 'r1', name: 'Alex Shifrin', role: 'Subject Matter Lead' },
              { id: 'r2', name: 'Casey Hart', role: 'Guest Instructor' },
              { id: 'r3', name: 'Keith Corbett', role: 'Teaching Assistant' },
              { id: 'r4', name: 'Anatoly Scherbakov', role: 'Teaching Assistant' },
              { id: 'r5', name: 'Adam Shepherd', role: 'Teaching Assistant' },
              { id: 'r6', name: 'Vinay Chaudhri', role: 'Guest Instructor' },
            ],
          },
        ],
      },
      {
        id: 'programs',
        label: 'Programmes',
        background: 'blue',
        width: 'narrow',
        paddingTop: 'medium',
        paddingBottom: 'medium',
        blocks: [
          { id: 'pr-h', kind: 'heading', text: 'Find the program\nthat is right for you', level: 2, size: 'x-large', align: 'center' },
          {
            id: 'pr-intro',
            kind: 'text',
            text: 'Our program brings together open content from leading knowledge graph practitioners in a structured and guided environment for learners.\n\nWe use evidence-based adult learning approaches to meet participants where they are in their knowledge graph learning journey.',
            size: 'large',
          },
          {
            id: 'pr-list',
            kind: 'list',
            ordered: false,
            items: [
              programme('l1', 'Explorer Certificate', 'fully online for individuals without prior experience who learn at their own pace.'),
              programme('l2', 'Builder Micro-Certificates', 'part-virtual and part-online for individuals with experience in data science and adjacent fields who benefit from a cohort structure.', [
                'Builder MC-1 Bricks to Building KGs',
                'Builder MC-2 Build with Confidence',
                'Builder MC-3 Build with Nuance',
                'Builder MC-4 Build Something Real',
              ]),
              programme('l3', 'Team Upskilling', 'for organizations introducing knowledge graphs and AI-readiness to teams of 5 or more.'),
              programme('l4', 'Open Classroom', 'free access to our curated content without the structure and rigor of a certificate.'),
            ],
          },
        ],
      },
    ],
  };
}
