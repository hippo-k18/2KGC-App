import type { LearnBlock, LearnSection } from '@kgc/shared';
import { createBlock, newId, type BlockKind, type BlockOf } from './learn-editor-core';

/**
 * Ready-made sections for the "Add a section" dialog (T318).
 *
 * Each template is a function, not a constant, so every insert gets fresh ids:
 * the server refuses a page where two blocks share one, and an id that two
 * sections share would make undo and selection pick the wrong one. The copy
 * is placeholder text a course lead can overwrite, so it is short and reads
 * like the real page rather than lorem ipsum.
 */

export type TemplateCategory = 'Start' | 'People' | 'Courses' | 'Proof' | 'Contact';
export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['Start', 'People', 'Courses', 'Proof', 'Contact'];

export interface SectionTemplate {
  id: string;
  name: string;
  hint: string;
  category: TemplateCategory;
  build(): LearnSection;
}

const CONTACT = 'mailto:contact@knowledgegraph.tech';

/** A new block of `kind` with some fields replaced; the id still comes from createBlock. */
function block<K extends BlockKind>(kind: K, patch: Partial<Omit<BlockOf<K>, 'id' | 'kind'>> = {}): BlockOf<K> {
  return { ...(createBlock(kind) as BlockOf<K>), ...patch };
}

function section(label: string, blocks: LearnBlock[], extra: Partial<Omit<LearnSection, 'id' | 'label' | 'blocks'>> = {}): LearnSection {
  return {
    id: newId('s'),
    label,
    background: 'plain',
    width: 'normal',
    paddingTop: 'large',
    paddingBottom: 'large',
    blocks,
    ...extra,
  };
}

export const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    id: 'hero',
    name: 'Hero',
    hint: 'A big heading, a line of text and two buttons',
    category: 'Start',
    build: () =>
      section(
        'Hero',
        [
          block('heading', { text: 'Learn to build knowledge graphs', level: 1, size: 'x-large', align: 'center' }),
          block('text', {
            text: 'Courses for people who want to use knowledge graphs at work, taught by practitioners.',
            size: 'large',
            align: 'center',
          }),
          block('buttons', {
            align: 'center',
            buttons: [
              { label: 'Ask about the next cohort', href: `${CONTACT}?subject=Next%20cohort`, style: 'primary' },
              { label: 'Get the brochure', href: `${CONTACT}?subject=KGC%20Learn%20brochure`, style: 'secondary' },
            ],
          }),
        ],
        { background: 'grey-wave' },
      ),
  },
  {
    id: 'contents-intro',
    name: 'Contents and intro',
    hint: 'Links to each part of the page, then a short introduction',
    category: 'Start',
    build: () =>
      section('Contents and intro', [
        block('toc', { title: 'On this page' }),
        block('text', {
          text: 'This page explains how the programme works, who teaches it and how to sign up.',
          spaceAbove: 'medium',
        }),
      ]),
  },
  {
    id: 'text-image',
    name: 'Text and image',
    hint: 'Text on the left, a picture on the right',
    category: 'Start',
    build: () => {
      const heading = block('heading', { text: 'Learn with a cohort', level: 2, align: 'left' });
      const text = block('text', {
        text: 'You meet your group online each week, work on a real project and get feedback from an instructor.',
      });
      const image = block('image', { width: 'full', shape: 'rounded' });
      return section('Text and image', [heading, text, image], {
        layout: 'two-equal',
        blockColumn: { [heading.id]: 0, [text.id]: 0, [image.id]: 1 },
      });
    },
  },
  {
    id: 'team',
    name: 'Team',
    hint: 'A heading and cards for the people who teach',
    category: 'People',
    build: () =>
      section(
        'Team',
        [
          block('heading', { text: 'Meet the team', level: 2, align: 'center' }),
          block('people', {
            style: 'cards',
            columns: 3,
            people: [
              { id: newId('p'), name: 'First person', role: 'Programme lead' },
              { id: newId('p'), name: 'Second person', role: 'Instructor' },
              { id: newId('p'), name: 'Third person', role: 'Teaching assistant' },
            ],
          }),
        ],
        { background: 'white-wave' },
      ),
  },
  {
    id: 'course-list',
    name: 'Course list',
    hint: 'A heading and a card for each course, with a link',
    category: 'Courses',
    build: () =>
      section(
        'Courses',
        [
          block('heading', { text: 'Find the course that suits you', level: 2, align: 'center' }),
          block('cards', {
            columns: 3,
            items: [
              {
                id: newId('i'),
                title: 'Explorer',
                text: 'Online and at your own pace, for people new to knowledge graphs.',
                link: { label: 'Ask about Explorer', href: `${CONTACT}?subject=Explorer`, style: 'text' },
              },
              {
                id: newId('i'),
                title: 'Builder',
                text: 'A cohort course for people who already work with data.',
                link: { label: 'Ask about Builder', href: `${CONTACT}?subject=Builder`, style: 'text' },
              },
              {
                id: newId('i'),
                title: 'Team upskilling',
                text: 'Training for a team of five or more, planned with you.',
                link: { label: 'Ask about team training', href: `${CONTACT}?subject=Team%20upskilling`, style: 'text' },
              },
            ],
          }),
        ],
        { background: 'light-blue-wave' },
      ),
  },
  {
    id: 'questions',
    name: 'Questions',
    hint: 'A heading and answers that open when clicked',
    category: 'Courses',
    build: () =>
      section('Questions', [
        block('heading', { text: 'Questions people ask', level: 2, align: 'center' }),
        block('accordion', {
          allowMany: true,
          items: [
            {
              id: newId('i'),
              title: 'Do I need to know how to code?',
              text: 'No. The Explorer course starts from the beginning. Builder courses expect some experience with data.',
            },
            {
              id: newId('i'),
              title: 'How much time does a course take?',
              text: 'Plan for about four hours a week, including the live session.',
            },
            {
              id: newId('i'),
              title: 'Do I get a certificate?',
              text: 'Yes. You get a certificate when you finish the course and its project.',
            },
            {
              id: newId('i'),
              title: 'Can my employer pay?',
              text: 'Yes. We can send an invoice to your organisation. Email us to arrange it.',
            },
          ],
        }),
      ]),
  },
  {
    id: 'testimonial',
    name: 'Testimonial',
    hint: 'A quote from a past learner, in a card',
    category: 'Proof',
    build: () =>
      section('Testimonial', [
        block('quote', {
          text: 'The weekly sessions kept me going, and I finished with a graph I now use at work.',
          name: 'A past learner',
          role: 'Data analyst',
          style: 'card',
          align: 'center',
        }),
      ]),
  },
  {
    id: 'numbers',
    name: 'Numbers',
    hint: 'Three figures with a label under each',
    category: 'Proof',
    build: () =>
      section('Numbers', [
        block('stats', {
          columns: 3,
          align: 'center',
          items: [
            { id: newId('i'), value: '500+', label: 'Learners so far' },
            { id: newId('i'), value: '4', label: 'Programmes' },
            { id: newId('i'), value: '12', label: 'Instructors' },
          ],
        }),
      ]),
  },
  {
    id: 'gallery',
    name: 'Gallery',
    hint: 'A heading and a grid of pictures',
    category: 'Proof',
    build: () =>
      section('Gallery', [
        block('heading', { text: 'From our classes', level: 2, align: 'center' }),
        block('gallery', { layout: 'grid', columns: 3, images: [], lightbox: true }),
      ]),
  },
  {
    id: 'call-to-action',
    name: 'Call to action',
    hint: 'A blue band with a heading, a line of text and a button',
    category: 'Contact',
    build: () =>
      section(
        'Call to action',
        [
          block('heading', { text: 'Ready to start?', level: 2, align: 'center' }),
          block('text', { text: 'Tell us what you want to learn and we will suggest a course.', align: 'center' }),
          block('buttons', {
            align: 'center',
            buttons: [{ label: 'Email us', href: CONTACT, style: 'primary' }],
          }),
        ],
        { background: 'blue', paddingTop: 'medium', paddingBottom: 'medium' },
      ),
  },
  {
    id: 'contact-map',
    name: 'Contact and map',
    hint: 'A heading, how to reach you and a map',
    category: 'Contact',
    build: () =>
      section('Contact', [
        block('heading', { text: 'Get in touch', level: 2, align: 'center' }),
        block('text', {
          text: 'Email us at [contact@knowledgegraph.tech](mailto:contact@knowledgegraph.tech) and we will reply within two working days.',
          align: 'center',
        }),
        block('embed', { provider: 'google-maps', url: '', aspect: '16:9', title: 'Map' }),
      ]),
  },
];
