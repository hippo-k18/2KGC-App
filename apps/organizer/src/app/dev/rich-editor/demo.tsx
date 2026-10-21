'use client';

import { useState } from 'react';
import type { RichContent, RichDoc } from '@kgc/shared';
import { RichEditor, type RichAnchor } from '@/components/rich-editor';
import './demo.css';

const ANCHORS: RichAnchor[] = [
  { id: 'hero', label: 'Hero (section)' },
  { id: 'team', label: 'Team (section)' },
  { id: 'programmes', label: 'Programmes (section)' },
  { id: 'explorer', label: 'Explorer Certificate (block)' },
];

const SAMPLE: RichDoc = {
  type: 'doc',
  content: [
    { type: 'heading', level: 2, content: [{ type: 'text', text: 'Find the program that is right for you' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Our program brings together ' },
        { type: 'text', text: 'open content', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' from leading ' },
        { type: 'text', text: 'knowledge graph', marks: [{ type: 'italic' }, { type: 'color', color: 'teal' }] },
        { type: 'text', text: ' practitioners. Read the ' },
        { type: 'text', text: 'brochure', marks: [{ type: 'link', href: 'mailto:contact@knowledgegraph.tech' }] },
        { type: 'text', text: ' or jump to the ' },
        { type: 'text', text: 'team', marks: [{ type: 'link', href: '#team' }] },
        { type: 'text', text: '.' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Explorer Certificate', marks: [{ type: 'bold' }] }, { type: 'text', text: ', fully online' }] }] },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Builder Micro-Certificates', marks: [{ type: 'bold' }] }] },
            {
              type: 'orderedList',
              content: [
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bricks to Building KGs' }] }] },
                { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Build with Confidence' }] }] },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Where peer-learning drives practice.', marks: [{ type: 'highlight', color: 'light-blue' }] }] }],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Programme' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Format' }] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Explorer' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Online, self-paced' }] }] },
          ],
        },
      ],
    },
    { type: 'paragraph', align: 'center', content: [{ type: 'text', text: 'E = mc' }, { type: 'text', text: '2', marks: [{ type: 'superscript' }] }, { type: 'text', text: ' and H' }, { type: 'text', text: '2', marks: [{ type: 'subscript' }] }, { type: 'text', text: 'O' }] },
  ],
};

const V1_MARKDOWN = 'Meet the **KGC | Learn**\nContinuing Education Team\n\n*Where peer-learning drives practice.* [Download the brochure](mailto:contact@knowledgegraph.tech)';

export function RichEditorDemo() {
  const [full, setFull] = useState<RichContent>(SAMPLE);
  const [heading, setHeading] = useState<RichContent>('Meet the **KGC | Learn** Team');
  const [body, setBody] = useState<RichContent>(
    'KGC|Learn was established by KGC with a 2023 grant from the National Science Foundation to attract the best of the KGC Community and Conferences.',
  );
  const [legacy, setLegacy] = useState<RichContent>(V1_MARKDOWN);
  const [short, setShort] = useState<RichContent>('');
  const [show, setShow] = useState<'full' | 'heading' | 'body' | 'legacy' | 'short'>('full');
  const json = { full, heading, body, legacy, short }[show];

  return (
    <main className="rd-page">
      <h1 className="rd-title">Rich text editor</h1>
      <p className="rd-lede">Development workbench. Not linked from the dashboard.</p>

      <section className="rd-card" id="full">
        <h2>Full editor</h2>
        <RichEditor variant="full" value={full} onChange={setFull} anchors={ANCHORS} placeholder="Write something" ariaLabel="Programme text" />
      </section>

      <section className="rd-card" id="inline">
        <h2>Inline, in the page preview</h2>
        <div className="rd-band">
          <RichEditor variant="inline" singleLine value={heading} onChange={setHeading} anchors={ANCHORS} ariaLabel="Heading" className="rd-h2" />
          <RichEditor variant="inline" value={body} onChange={setBody} anchors={ANCHORS} ariaLabel="Intro text" className="rd-text" />
        </div>
      </section>

      <section className="rd-card" id="legacy">
        <h2>A v1 Markdown string</h2>
        <pre className="rd-pre">{V1_MARKDOWN}</pre>
        <RichEditor variant="full" value={legacy} onChange={setLegacy} anchors={ANCHORS} ariaLabel="Legacy text" />
      </section>

      <section className="rd-card" id="limit">
        <h2>With a word limit</h2>
        <RichEditor variant="full" value={short} onChange={setShort} maxWords={12} placeholder="A short bio, twelve words at most" ariaLabel="Short bio" />
      </section>

      <section className="rd-card" id="json">
        <h2>Stored value</h2>
        <div className="rd-tabs">
          {(['full', 'heading', 'body', 'legacy', 'short'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>
              {k}
            </button>
          ))}
        </div>
        <pre className="rd-pre rd-json">{JSON.stringify(json, null, 2)}</pre>
      </section>
    </main>
  );
}
