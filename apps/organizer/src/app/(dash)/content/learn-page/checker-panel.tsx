'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { isSafeHref } from '@kgc/shared';
import type { LearnPageContent } from '@kgc/shared';
import {
  accessibilityIssues,
  ISSUE_RULE_LABEL,
  pageLinks,
  type Issue,
  type IssueRule,
  type PageLink,
  type Where,
} from '@/lib/learn-tools-core';
import type { PublishBlocker } from '@/lib/learn-library-edit-core';
import './tools.css';

/**
 * The page checks (T318): accessibility problems and every link, worked out in
 * the browser from the draft, so the lists update as the course lead fixes
 * things. "Show me" hands the place back to the shell, which selects it.
 */

export type CheckerTab = 'accessibility' | 'links';

type LinkFilter = 'all' | 'problems' | 'external' | 'internal' | 'anchor' | 'contact';

const LINK_FILTERS: { id: LinkFilter; label: string; test: (l: PageLink) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'problems', label: 'Problems', test: (l) => l.status !== 'ok' },
  { id: 'external', label: 'Other websites', test: (l) => l.type === 'external' },
  { id: 'internal', label: 'This site', test: (l) => l.type === 'internal' },
  { id: 'anchor', label: 'This page', test: (l) => l.type === 'anchor' },
  { id: 'contact', label: 'Email and phone', test: (l) => l.type === 'email' || l.type === 'phone' },
];

function StatusIcon({ status }: { status: 'ok' | 'warning' | 'error' }) {
  // The words beside each icon carry the meaning; the icon is a quick scan aid.
  if (status === 'error')
    return (
      <svg className="le-tools-icon is-error" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path d="M8 4.5v4.2M8 11.2v.3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  if (status === 'warning')
    return (
      <svg className="le-tools-icon is-warning" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.5 15 14H1z" fill="currentColor" strokeLinejoin="round" />
        <path d="M8 6v3.6M8 11.6v.3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg className="le-tools-icon is-ok" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="m4.8 8.2 2.2 2.2 4.2-4.4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function placeLabel(content: LearnPageContent, where: Where): string {
  if (!where.sectionId) return `Page settings, ${where.field}`;
  const label = content.sections.find((s) => s.id === where.sectionId)?.label || 'Untitled section';
  return `${label}, ${where.field}`;
}

function AccessibilityTab({ content, onJump }: { content: LearnPageContent; onJump: (where: Where) => void }) {
  const issues = useMemo(() => accessibilityIssues(content), [content]);
  const groups = useMemo(() => {
    const byRule = new Map<IssueRule, Issue[]>();
    for (const i of issues) byRule.set(i.rule, [...(byRule.get(i.rule) ?? []), i]);
    // The label table's order, so the groups do not shuffle as issues come and go.
    return (Object.keys(ISSUE_RULE_LABEL) as IssueRule[])
      .filter((r) => byRule.has(r))
      .map((r) => ({ rule: r, items: byRule.get(r)! }));
  }, [issues]);

  if (issues.length === 0)
    return (
      <div className="le-tools-allgood" role="status">
        <StatusIcon status="ok" />
        <div>
          <strong>No problems found</strong>
          <p>Images have descriptions, headings are in order, colours are easy to read and links say where they go.</p>
        </div>
      </div>
    );

  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <>
      <p className="le-tools-summary" role="status">
        <strong>{issues.length === 1 ? '1 thing to fix' : `${issues.length} things to fix`}</strong>
        {errors > 0 && errors < issues.length && (
          <span className="le-muted">
            {' '}
            ({errors} {errors === 1 ? 'needs' : 'need'} fixing before you publish)
          </span>
        )}
      </p>
      {groups.map((g) => {
        const severity = g.items.some((i) => i.severity === 'error') ? 'error' : 'warning';
        return (
          <section key={g.rule} className="le-tools-group" aria-label={`${ISSUE_RULE_LABEL[g.rule]}, ${g.items.length}`}>
            <h3 className="le-tools-group-title">
              <StatusIcon status={severity} />
              {ISSUE_RULE_LABEL[g.rule]} <span className="le-count">{g.items.length}</span>
            </h3>
            <ul className="le-tools-list">
              {g.items.map((i) => (
                <li key={i.id} className="le-tools-issue">
                  <div className="le-tools-issue-text">
                    <span className="le-tools-sr">{i.severity === 'error' ? 'Problem: ' : 'Worth a look: '}</span>
                    <span className="le-tools-issue-msg">{i.message}</span>
                    <span className="le-tools-issue-fix">{i.fix}</span>
                    <span className="le-tools-where">{placeLabel(content, i.where)}</span>
                  </div>
                  <button type="button" className="btn btn-default btn-sm" onClick={() => onJump(i.where)}>
                    Show me
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function LinksTab({ content, onJump }: { content: LearnPageContent; onJump: (where: Where) => void }) {
  const links = useMemo(() => pageLinks(content), [content]);
  const [filter, setFilter] = useState<LinkFilter>('all');
  const active = LINK_FILTERS.find((f) => f.id === filter)!;
  const shown = links.filter(active.test);
  const problems = links.filter((l) => l.status !== 'ok').length;

  if (links.length === 0) return <p className="le-muted">There are no links on the page yet.</p>;

  return (
    <>
      <p className="le-tools-summary" role="status">
        <strong>{links.length === 1 ? '1 link' : `${links.length} links`}</strong>
        {problems > 0 ? `, ${problems} with a problem` : ', all fine'}
      </p>
      <div className="le-tools-chips" role="group" aria-label="Show">
        {LINK_FILTERS.map((f) => {
          const n = links.filter(f.test).length;
          return (
            <button
              key={f.id}
              type="button"
              className={`le-tools-chip${filter === f.id ? ' is-on' : ''}`}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label} <span className="le-tools-chip-n">{n}</span>
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <p className="le-muted">{filter === 'problems' ? 'No link problems.' : 'No links of this kind.'}</p>
      ) : (
        <ul className="le-tools-list le-tools-links">
          {shown.map((l) => (
            <li key={l.id} className={`le-tools-link is-${l.status}`}>
              <div className="le-tools-link-text">
                <span className="le-tools-link-label">{l.text.trim() || 'No link text'}</span>
                <span className="le-tools-link-href" title={l.href}>
                  {l.href || 'No address'}
                </span>
                <span className="le-tools-link-status">
                  <StatusIcon status={l.status} />
                  <span className="le-tools-sr">{l.status === 'ok' ? 'Fine: ' : l.status === 'error' ? 'Problem: ' : 'Worth a look: '}</span>
                  {l.message}
                </span>
                <span className="le-tools-where">{placeLabel(content, l.where)}</span>
              </div>
              <div className="le-tools-link-actions">
                <button type="button" className="btn btn-default btn-sm" onClick={() => onJump(l.where)}>
                  Show me
                </button>
                {l.type === 'external' && isSafeHref(l.href) && (
                  <a className="btn btn-default btn-sm" href={l.href} target="_blank" rel="noreferrer">
                    Open<span className="le-tools-sr"> {l.text.trim() || l.href} in a new tab</span>
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * What the server refuses to publish, the same list the Publish dialog shows
 * (T325, E F10), so the checks and the dialog never disagree about what
 * blocks a publish.
 */
function Blockers({ blockers, onJump }: { blockers: PublishBlocker[]; onJump: (where: Where) => void }) {
  if (blockers.length === 0) return null;
  return (
    <section className="le-tools-group le-tools-blockers" aria-label={`Needs fixing before you publish, ${blockers.length}`}>
      <h3 className="le-tools-group-title">
        <StatusIcon status="error" />
        Needs fixing before you publish <span className="le-count">{blockers.length}</span>
      </h3>
      <ul className="le-tools-list">
        {blockers.map((b, i) => (
          <li key={i} className="le-tools-issue">
            <div className="le-tools-issue-text">
              <span className="le-tools-sr">Problem: </span>
              <span className="le-tools-issue-msg">{b.message}</span>
            </div>
            {b.sectionId && (
              <button
                type="button"
                className="btn btn-default btn-sm"
                onClick={() => onJump({ sectionId: b.sectionId, blockId: b.blockId, field: 'Block' })}
              >
                Show me
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const TABS: { id: CheckerTab; label: string }[] = [
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'links', label: 'Links' },
];

export function CheckerPanel({
  content,
  blockers = [],
  onJump,
  onClose,
  initialTab = 'accessibility',
}: {
  content: LearnPageContent;
  /** Publish blockers from the shell (`draftPublishBlockers`). */
  blockers?: PublishBlocker[];
  onJump: (where: Where) => void;
  onClose: () => void;
  initialTab?: CheckerTab;
}) {
  const [tab, setTab] = useState<CheckerTab>(initialTab);
  const ids = useId();
  const tabRefs = useRef<Record<CheckerTab, HTMLButtonElement | null>>({ accessibility: null, links: null });
  // Counts for the tab labels, so the other tab says whether it needs a visit.
  const issueCount = useMemo(() => accessibilityIssues(content).length, [content]);
  const linkProblems = useMemo(() => pageLinks(content).filter((l) => l.status !== 'ok').length, [content]);

  // Focus starts on the open tab, so a keyboard user lands inside the panel
  // that the shortcut opened rather than back in the outline.
  useEffect(() => {
    tabRefs.current[initialTab]?.focus();
  }, [initialTab]);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  return (
    <div
      className="le-tools-panel"
      role="region"
      aria-label="Check the page"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="le-tools-head">
        <h2 className="le-tools-title">Check the page</h2>
        <button type="button" className="le-tools-close" onClick={onClose} aria-label="Close the checks">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="le-tools-tabs" role="tablist" aria-label="Checks">
        {TABS.map((t, i) => {
          const n = t.id === 'accessibility' ? issueCount + blockers.length : linkProblems;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`${ids}-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${ids}-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={tab === t.id ? 'is-on' : ''}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.label}
              {n > 0 && (
                <span className="le-tools-tab-n">
                  {n}
                  <span className="le-tools-sr">{t.id === 'accessibility' ? ' to fix' : ' with a problem'}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      {TABS.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${ids}-panel-${t.id}`}
          aria-labelledby={`${ids}-tab-${t.id}`}
          hidden={tab !== t.id}
          tabIndex={0}
          className="le-tools-body"
        >
          {tab === t.id && t.id === 'accessibility' && <Blockers blockers={blockers} onJump={onJump} />}
          {tab === t.id && (t.id === 'accessibility' ? <AccessibilityTab content={content} onJump={onJump} /> : <LinksTab content={content} onJump={onJump} />)}
        </div>
      ))}
    </div>
  );
}
