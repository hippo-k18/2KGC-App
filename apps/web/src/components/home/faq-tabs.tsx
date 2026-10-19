'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/**
 * "Frequently Asked Questions", as the live site lays it out: the questions in
 * a column on the left, the selected one's answer in a panel on the right.
 *
 * A tabs pattern. Every answer is rendered on the server and the unselected
 * ones carry `hidden`, so crawlers and visitors without JavaScript still get
 * the text. Up and Down move between questions; Home and End jump to the ends.
 */
export interface FaqItem {
  question: string;
  answer: ReactNode;
}

export function FaqTabs({ heading, items }: { heading: string; items: FaqItem[] }) {
  const [at, setAt] = useState(0);
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (i: number) => {
    const next = (i + items.length) % items.length;
    setAt(next);
    tabs.current[next]?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const moves: Record<string, number> = {
      ArrowDown: i + 1,
      ArrowUp: i - 1,
      Home: 0,
      End: items.length - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      select(moves[e.key]);
    }
  };

  return (
    <section className="band-white faq-tabs" aria-labelledby={`${base}-h`}>
      <div className="wrap">
        <h2 id={`${base}-h`} className="faq-tabs-heading">
          {heading}
        </h2>
        <div className="faq-tabs-body">
          <div role="tablist" aria-orientation="vertical" aria-labelledby={`${base}-h`} className="faq-tabs-list">
            {items.map((item, i) => (
              <button
                key={item.question}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${base}-t${i}`}
                aria-selected={i === at}
                aria-controls={`${base}-p${i}`}
                tabIndex={i === at ? 0 : -1}
                className="faq-tabs-q"
                onClick={() => setAt(i)}
                onKeyDown={(e) => onKey(e, i)}
              >
                {item.question}
              </button>
            ))}
          </div>
          {items.map((item, i) => (
            <div
              key={item.question}
              role="tabpanel"
              id={`${base}-p${i}`}
              aria-labelledby={`${base}-t${i}`}
              tabIndex={0}
              hidden={i !== at}
              className="faq-tabs-panel"
            >
              {item.answer}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
