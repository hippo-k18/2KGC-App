'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { CircleIcon, ChevronIcon, SquareIcon, TAB_ICONS } from '@/lib/icons';

/**
 * Whova's two navigation surfaces, rebuilt against their own DOM.
 *
 * The class names below are not invented — `#top-nav > .nav-menus > .menu-item`,
 * and `.sidebar > .sidebar-menu > .sidebar-menu-item > .firstlevel >
 * .firstlevel-name`, with `.treeview-menu` and `.treeview-submenu` beneath — are
 * the structure Whova's bundle emits, kept so that `globals.css` can be a
 * transcription of their stylesheet rather than a paraphrase of it.
 *
 * The rail's nesting is worth stating precisely, because getting it one level
 * out is the easiest mistake here and it makes the whole thing feel wrong. The
 * *children* of the active tab are the first level — for Content that is
 * Basics, Branding Center, Agenda Center — and the tab's own name appears only
 * in the box header above them. Their children are the second level (hollow
 * circle bullet) and grandchildren the third (filled square).
 *
 * The other behavioural copy: a first-level group auto-expands when the current
 * page is inside it and is otherwise collapsed, and the disclosure arrow is a
 * *separate* click target from the label — in Whova, clicking "Agenda Center"
 * navigates to Agenda Center and clicking the chevron next to it only expands.
 * That split feels wrong until you have used it, and organizers have.
 *
 * Client-only because `usePathname()` is what decides "current" and `useState`
 * is what holds the expansion. It receives the tree as a prop and reads nothing.
 */

export interface SlimNode {
  name: string;
  title: string;
  slug: string;
  widthClass?: string;
  tag?: string;
  tagLabel?: string;
  implemented?: boolean;
  children?: SlimNode[];
}

function Tag({ node }: { node: SlimNode }) {
  if (!node.tag) return null;
  return <span className={`menu-tag ${node.tag}`}>{node.tagLabel ?? node.tag}</span>;
}

export function TopNav({ nav, draftTabs }: { nav: SlimNode[]; draftTabs: string[] }) {
  const pathname = usePathname();
  const top = pathname.split('/')[1] ?? '';

  return (
    <section id="top-nav" className="layout-boxed">
      <ul className="nav-menus">
        {nav.map((n) => (
          <li key={n.slug} className={`menu-item ${n.widthClass ?? 'medium'} ${n.slug === top ? 'active' : ''}`}>
            <Link href={`/${n.slug}`}>
              {TAB_ICONS[n.name]}
              <span className="menu-title">{n.title}</span>
              {draftTabs.includes(n.name) ? (
                <span className="event-status-badge badge-alert">Draft</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Third({ nodes, prefix, pathname }: { nodes: SlimNode[]; prefix: string; pathname: string }) {
  return (
    <ul className="treeview-submenu">
      {nodes.map((n) => {
        const href = `${prefix}/${n.slug}`;
        return (
          <li key={href} className={`treeview-submenu-item ${pathname === href ? 'active' : ''}`}>
            <Link className="thirdlevel-name" href={href}>
              <SquareIcon />
              <span className="nav-label">{n.title}</span>
              <Tag node={n} />
              {n.implemented ? null : <span className="menu-tag stub">nav</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Second({ nodes, prefix, pathname }: { nodes: SlimNode[]; prefix: string; pathname: string }) {
  return (
    <ul className="treeview-menu">
      {nodes.map((n) => {
        const href = `${prefix}/${n.slug}`;
        return (
          <div key={href}>
            <li className={`treeview-menu-item ${pathname === href ? 'active' : ''}`}>
              <Link className="secondlevel-name" href={href}>
                <CircleIcon />
                <span className="nav-label">{n.title}</span>
                <Tag node={n} />
                {n.children || n.implemented ? null : <span className="menu-tag stub">nav</span>}
              </Link>
            </li>
            {n.children ? <Third nodes={n.children} prefix={href} pathname={pathname} /> : null}
          </div>
        );
      })}
    </ul>
  );
}

function FirstLevel({ node, prefix, pathname }: { node: SlimNode; prefix: string; pathname: string }) {
  const href = `${prefix}/${node.slug}`;
  const inside = pathname === href || pathname.startsWith(`${href}/`);
  const [open, setOpen] = useState(inside);

  return (
    <>
      <li className={`sidebar-menu-item ${pathname === href ? 'active' : ''}`}>
        <div className="firstlevel">
          <Link className="firstlevel-name" href={href} onClick={() => setOpen(true)}>
            <span className="nav-label">{node.title}</span>
            <Tag node={node} />
            {node.children || node.implemented ? null : <span className="menu-tag stub">nav</span>}
          </Link>
          {node.children ? (
            <button
              type="button"
              className="firstlevel-arrow"
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${node.title}`}
              onClick={() => setOpen((v) => !v)}
            >
              <ChevronIcon open={open} />
            </button>
          ) : null}
        </div>
      </li>
      {node.children && open ? (
        <Second nodes={node.children} prefix={href} pathname={pathname} />
      ) : null}
    </>
  );
}

/**
 * The left rail.
 *
 * Whova stacks three boxed cards here: `MENU` (which holds only "Event List"),
 * then the selected tab's own sub-tree, then "Tutorials and Guides". The middle
 * one is the whole reason the rail exists; the outer two are near-constant and
 * are reproduced because their absence is the kind of thing that makes a
 * familiar screen feel subtly wrong.
 */
/** The nine screens backed by real data, for the third rail box. */
const BUILT: [string, string][] = [
  ['Basics', '/content/basics'],
  ['Session Manager', '/content/agenda-center/session-manager'],
  ['Track Manager', '/content/agenda-center/track-manager'],
  ['Speaker Manager', '/content/speaker-center/speaker-manager'],
  ['Sponsor Manager', '/content/sponsor-center/sponsor-manager'],
  ['Announcements', '/engagement/announcements'],
  ['Attendees', '/attendees/manage-attendees/attendees'],
  ['Check-in', '/attendees/check-in-and-checkout/check-in'],
  ['Report', '/tools/report'],
];

export function Sidebar({ nav, footnote }: { nav: SlimNode[]; footnote: string }) {
  const pathname = usePathname();
  const topSlug = pathname.split('/')[1] ?? '';
  const active = nav.find((n) => n.slug === topSlug);

  /**
   * Whova drops the whole rail when the active tab has no children — Publish is
   * the only one — and lets the content frame span the full 1060px. Returning
   * null here rather than rendering an empty aside is what reproduces that.
   */
  if (!active?.children) return null;

  return (
    <aside className="frame-left-side">
      <div className="sidebar">
        <div className="sidebar-header">Menu</div>
        <ul className="sidebar-menu">
          <li className="treeview-menu-item">
            <Link className="secondlevel-name" href="/">
              <CircleIcon />
              <span>Event List</span>
            </Link>
          </li>
        </ul>
      </div>

      <div className="sidebar">
        <div className="sidebar-header">
          <span>{active.title}</span>
          {active.slug === 'tickets' ? (
            <Link className="btn btn-primary sidebar-header-btn" href="/tickets/ticket-setup">
              Step-by-step guide ›
            </Link>
          ) : null}
        </div>
        <ul className="sidebar-menu">
          {active.children.map((c) => (
            <FirstLevel key={c.slug} node={c} prefix={`/${active.slug}`} pathname={pathname} />
          ))}
        </ul>
        <p className="sidebar-footnote">{footnote}</p>
      </div>

      <div className="sidebar">
        <div className="sidebar-header">Tutorials and Guides</div>
        <ul className="sidebar-menu">
          {[
            ['Organizer Setup Tutorials', '/tools/app-adoption'],
            ['Guides to Share', '/tools/app-adoption'],
            ['FAQ', '/tools'],
          ].map(([label, href]) => (
            <li key={label} className="treeview-menu-item">
              <Link className="secondlevel-name" href={href}>
                <CircleIcon />
                <span className="nav-label">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/*
        Whova's third rail box. Theirs advertises their newest features with a
        green "6 NEW" pill; ours points at the screens here that carry real data,
        which is the same job — telling an organizer where the value is — done
        with the only news we actually have.
      */}
      <div className="sidebar">
        <div className="sidebar-header">
          <span>Built here</span>
          <span className="menu-tag new">{BUILT.length} real</span>
        </div>
        <ul className="sidebar-menu">
          {BUILT.map(([label, href]) => (
            <li
              key={href}
              className={`treeview-menu-item ${pathname === href ? 'active' : ''}`}
            >
              <Link className="secondlevel-name" href={href}>
                <CircleIcon />
                <span className="nav-label">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
