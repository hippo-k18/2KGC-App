'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import './extras.css';

/**
 * Plain answers for the person who runs the course, in the order they tend to
 * be asked. Each answer says where to click, not how the editor works inside.
 */
const ANSWERS: { q: string; a: ReactNode }[] = [
  {
    q: 'How do I change text?',
    a: (
      <p>
        Click the text on the page and type. Use the small toolbar that appears to make words bold, add a link or make a
        list.
      </p>
    ),
  },
  {
    q: 'How do I add a picture?',
    a: (
      <p>
        Select an image block, or add one with Add a block, then drag a picture onto it or choose Upload image. Add a
        short description so people using screen readers know what it shows.
      </p>
    ),
  },
  {
    q: 'How do I move things?',
    a: (
      <p>
        Drag a section or a block up or down in the list on the left, or use the arrow buttons next to it. With the
        keyboard, select it in the list and press Alt with the up or down arrow.
      </p>
    ),
  },
  {
    q: 'How do I add a section?',
    a: (
      <p>
        Choose Add a section. Pick a ready-made one, such as a team, a list of courses or questions and answers, then
        change the words. Saved sections are ones you or a colleague kept for reuse.
      </p>
    ),
  },
  {
    q: 'What does Publish do?',
    a: (
      <p>
        It puts your draft on the website, so visitors see it within a minute. The page before it is kept in History,
        so you can bring it back.
      </p>
    ),
  },
  {
    q: 'Can I undo?',
    a: (
      <p>
        Yes. Use the undo arrow at the top, or press Cmd+Z on a Mac or Ctrl+Z on Windows. Redo is next to it. To go back
        further than this visit, open History and restore an older version.
      </p>
    ),
  },
  {
    q: 'What is a draft?',
    a: (
      <p>
        Your working copy. It saves on its own as you go, and only you and your colleagues in the dashboard can see it.
        The website keeps showing the last published page until you publish.
      </p>
    ),
  },
  {
    q: 'How do I schedule a change?',
    a: (
      <p>
        Choose Schedule next to Publish and pick a date and time. The draft as it is at that moment goes live. You can
        keep editing until then, or cancel the schedule.
      </p>
    ),
  },
  {
    q: 'How do I share the draft before it is live?',
    a: (
      <p>
        Choose Share the draft and create a preview link. Anyone with the link can see the draft without signing in.
        Turn the link off when you no longer need it.
      </p>
    ),
  },
  {
    q: 'How do I make the page easy for everyone to read?',
    a: (
      <p>
        Open the accessibility check. It lists things to fix, such as a picture with no description, text that is hard
        to read on its background, or a link that only says &ldquo;click here&rdquo;. Click a problem to go straight to
        it.
      </p>
    ),
  },
  {
    q: 'What if two of us edit at once?',
    a: (
      <p>
        If a colleague saves while you are editing, a red note appears at the top. You choose to load their version or
        keep yours. To avoid this, agree who is editing, or edit different days.
      </p>
    ),
  },
];

export function HelpPanel({
  onClose,
  onStartTour,
  onShowShortcuts,
}: {
  onClose: () => void;
  onStartTour: () => void;
  onShowShortcuts: () => void;
}) {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const panelRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<Set<number>>(() => new Set());

  // Focus moves into the panel when it opens and goes back when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => before?.focus?.();
  }, []);

  const toggle = (i: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  return (
    <aside className="le-x-help" aria-labelledby={titleId} ref={panelRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="le-x-help-head">
        <h2 id={titleId}>Help</h2>
        <button type="button" className="le-icon-btn" onClick={onClose} aria-label="Close help">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="le-x-help-body">
        <div className="le-x-help-actions">
          <button type="button" className="btn btn-default btn-sm" onClick={onStartTour}>
            Take the tour again
          </button>
          <button type="button" className="btn btn-default btn-sm" onClick={onShowShortcuts}>
            Keyboard shortcuts
          </button>
        </div>

        <div className="le-x-acc">
          {ANSWERS.map((item, i) => {
            const isOpen = open.has(i);
            const btnId = `${baseId}-q${i}`;
            const panelId = `${baseId}-a${i}`;
            return (
              <div key={item.q} className={`le-x-acc-item${isOpen ? ' is-open' : ''}`}>
                <h3>
                  <button
                    id={btnId}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => toggle(i)}
                  >
                    <span>{item.q}</span>
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                      <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </h3>
                <div id={panelId} role="region" aria-labelledby={btnId} hidden={!isOpen} className="le-x-acc-panel">
                  {item.a}
                </div>
              </div>
            );
          })}
        </div>

        <p className="le-x-help-contact">
          Stuck? Email <a href="mailto:contact@knowledgegraph.tech">contact@knowledgegraph.tech</a>
        </p>
      </div>
    </aside>
  );
}
