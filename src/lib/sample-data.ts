/**
 * PLACEHOLDER CONTENT — delete this file once Firestore is wired up.
 *
 * It exists so every screen renders something real to design against before the
 * Firebase project is created. Shapes deliberately mirror `src/types/models.ts`
 * minus the Timestamp fields, so swapping in live data is a small change.
 */

export interface SampleSession {
  id: string;
  title: string;
  day: string;
  start: string;
  end: string;
  room: string;
  track: string;
  format: 'keynote' | 'talk' | 'panel' | 'workshop';
  speakers: string[];
}

export const SAMPLE_DAYS = [
  { id: '2026-05-04', label: 'Mon', date: 'May 4' },
  { id: '2026-05-05', label: 'Tue', date: 'May 5' },
  { id: '2026-05-06', label: 'Wed', date: 'May 6' },
];

export const SAMPLE_SESSIONS: SampleSession[] = [
  {
    id: 's1',
    title: 'Opening Keynote: Knowledge Graphs in the Age of LLMs',
    day: '2026-05-04',
    start: '9:00 AM',
    end: '10:00 AM',
    room: 'Verizon Auditorium',
    track: 'Main Stage',
    format: 'keynote',
    speakers: ['Sample Speaker'],
  },
  {
    id: 's2',
    title: 'Building Ontologies That Survive Contact With Production',
    day: '2026-05-04',
    start: '10:30 AM',
    end: '11:15 AM',
    room: 'Room 301',
    track: 'Engineering',
    format: 'talk',
    speakers: ['Sample Speaker'],
  },
  {
    id: 's3',
    title: 'Panel: Graph RAG in the Enterprise',
    day: '2026-05-04',
    start: '11:30 AM',
    end: '12:15 PM',
    room: 'Room 301',
    track: 'Applications',
    format: 'panel',
    speakers: ['Sample Speaker', 'Another Speaker'],
  },
  {
    id: 's4',
    title: 'Workshop: Modelling Your First Knowledge Graph',
    day: '2026-05-05',
    start: '9:30 AM',
    end: '12:00 PM',
    room: 'Lab B',
    track: 'Workshops',
    format: 'workshop',
    speakers: ['Another Speaker'],
  },
  {
    id: 's5',
    title: 'Entity Resolution at Scale',
    day: '2026-05-05',
    start: '1:00 PM',
    end: '1:45 PM',
    room: 'Verizon Auditorium',
    track: 'Engineering',
    format: 'talk',
    speakers: ['Sample Speaker'],
  },
  {
    id: 's6',
    title: 'Closing Remarks',
    day: '2026-05-06',
    start: '4:00 PM',
    end: '4:30 PM',
    room: 'Verizon Auditorium',
    track: 'Main Stage',
    format: 'keynote',
    speakers: ['Sample Speaker'],
  },
];

export interface SampleSpeaker {
  id: string;
  name: string;
  title: string;
  company: string;
  bio: string;
}

export const SAMPLE_SPEAKERS: SampleSpeaker[] = [
  {
    id: 'sp1',
    name: 'Sample Speaker',
    title: 'Principal Data Architect',
    company: 'Example Corp',
    bio: 'Placeholder biography. Replace with speaker data imported into the `speakers` collection.',
  },
  {
    id: 'sp2',
    name: 'Another Speaker',
    title: 'Head of Knowledge Engineering',
    company: 'Sample Labs',
    bio: 'Placeholder biography. Replace with speaker data imported into the `speakers` collection.',
  },
];
