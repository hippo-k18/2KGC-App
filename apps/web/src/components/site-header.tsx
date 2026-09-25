'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ABOUT_MENU, NAV, NAV_MORE } from '@/lib/site';

/**
 * The site chrome above the fold: the orange announcement bar, then the navy
 * header.
 *
 * A client component only so the current page can carry `aria-current` and the
 * mobile menu can open. No data, no Firebase, nothing secret — this file could
 * be served to anyone and it would not matter, which is the test every client
 * component in this app has to pass.
 *
 * The logo is the real wordmark from the live site: "KGC" with a knowledge-graph
 * wireframe inside the letterforms, in white. It is the single most recognisable
 * element on the page, which is why the header behind it is solid navy rather
 * than the translucent white bar this used to be — the mark is white, so on white
 * it disappeared.
 */
export function SiteHeader({
  logoUrl,
  eventName = 'Knowledge Graph Conference',
  showAgenda = false,
  showSpeakers = false,
}: {
  /** The logo saved on App Branding, resolved in the root layout. Unset keeps the wordmark. */
  logoUrl?: string;
  eventName?: string;
  /** Marketing > Event Website switches, resolved in the root layout. */
  showAgenda?: boolean;
  showSpeakers?: boolean;
} = {}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);

  // The bar opens with the caret in it, and Escape or a new page closes it.
  useEffect(() => {
    if (!searching) return;
    searchInput.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSearching(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [searching]);

  useEffect(() => setSearching(false), [path]);

  /*
   * While the menu is open the page behind it must not scroll.
   *
   * The panel is its own scroll container now (`.site-header nav.open`), but a
   * drag that reaches either end of it still propagates to the document unless
   * the document is frozen — which is precisely what the client saw: the menu
   * stayed put and the page moved underneath it.
   *
   * Three things have to undo the lock, not one. Closing it, unmounting (a route
   * change while the menu is open would otherwise leave the whole site
   * unscrollable), and crossing back above the breakpoint, because on a tablet
   * rotated to landscape the panel stops being displayed while `open` stays true
   * and the body stays locked with nothing on screen to explain it. The query is
   * written as the exact complement of the CSS breakpoint so the two cannot
   * drift apart.
   */
  useEffect(() => {
    if (!open) return;

    document.body.classList.add('nav-open');

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const desktop = window.matchMedia('(width > 900px)');
    const onBreakpoint = () => {
      if (desktop.matches) setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    desktop.addEventListener('change', onBreakpoint);

    return () => {
      document.body.classList.remove('nav-open');
      document.removeEventListener('keydown', onKeyDown);
      desktop.removeEventListener('change', onBreakpoint);
    };
  }, [open]);

  return (
    <>
      {/*
        The announcement bar sits BELOW the navy header, not above it. Measured on
        knowledgegraph.tech at a 1512px viewport: the header occupies y 0–100 and
        the orange strip y 100–132. Ours had them the other way round, which put
        the first thing a visitor sees — an orange band — above the brand.

        ── Why the strip itself is no longer rendered here ────────────────────
        The bar now carries what the organizer actually announced, read from
        Firestore. This file is a client component, so nothing in it can read
        Firestore, and hoisting the read into the root layout would either bake
        one moment's announcements into every statically-rendered page or force
        the whole site dynamic to serve one strip. It rendered on `/` and only
        on `/` anyway, so `app/page.tsx` — already `force-dynamic` for the same
        reason every other Firestore-reading page is — renders it instead, as
        its first child. That is the same position in the document: immediately
        after `</header>`, since the layout's `<main>` follows it directly and
        carries no styling of its own.
      */}
      <header className="site-header">
        <div className="wrap bar">
          <Link href="/" className="logo" aria-label={`${eventName}, home`}>
            {/*
              Intrinsic size is the file's own 2048×763, so Next can reserve the
              right box; CSS takes it down to the header height. `priority`
              because it is the largest thing above the fold on every page.
            */}
            {logoUrl ? (
              // A logo saved on App Branding. A plain `img`: its host is not in
              // `images.remotePatterns`, and `next/image` throws on one that is not.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={eventName} />
            ) : (
              <Image
                src="/kgc/cropped-White-Wordmark-2.png"
                alt="Knowledge Graph Conference"
                width={2048}
                height={763}
                priority
              />
            )}
          </Link>

          <nav id="main-nav" aria-label="Main" className={open ? 'open' : undefined}>
            {/* Hamburger-only items (`.nav-more` is hidden on desktop), first in the phone menu. */}
            {NAV_MORE.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="nav-more"
                aria-current={path === item.href ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            {NAV.filter(
              (item) =>
                (showAgenda || item.href !== '/agenda') &&
                (showSpeakers || item.href !== '/speakers'),
            ).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={path === item.href ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            {/*
              About KGC, as a dropdown — the live site's own arrangement, and the
              reason it works: everything that used to be hidden at desktop
              widths now has a visible route to it.

              Open on hover *and* on focus, so it is reachable from the keyboard;
              `:focus-within` in CSS handles the latter without any state here.
              On a phone the panel is always expanded inline instead, because a
              hover menu inside an already-open hamburger is a trap.
            */}
            <div className="has-menu">
              <Link
                href="/about"
                className="menu-parent"
                aria-current={path.startsWith('/about') ? 'page' : undefined}
                aria-haspopup="true"
                onClick={() => setOpen(false)}
              >
                About KGC
                <ChevronIcon />
              </Link>

              <div className="submenu" role="group" aria-label="About KGC">
                {ABOUT_MENU.map((item) =>
                  item.external ? (
                    <a key={item.href} href={item.href} target="_blank" rel="noreferrer">
                      {item.label}
                    </a>
                  ) : (
                    <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
                      {item.label}
                    </Link>
                  ),
                )}
              </div>
            </div>

            <Link href="/tickets" className="btn btn-primary btn-sm" style={{ marginLeft: 8 }}>
              Register now
            </Link>
          </nav>

          {/*
            The two icon controls travel together, in the live site's order:
            the orange magnifier, then the hamburger.

            They used to sit on either side of `<nav>`, and `<nav>` is the
            element that carries `margin-left: auto`. Below 900px it is
            `display: none`, so nothing was pushing the icons anywhere and both
            landed against the wordmark with the rest of the bar empty beside
            them. Grouping them is also what lets the hamburger keep its place at
            the very end of the row on a phone while staying hidden on desktop.

            The magnifier opens a search box for the whole site under the bar.
            Without script it is an ordinary link to the search page.
          */}
          <div className="header-actions">
            <Link
              href="/search"
              className="search"
              aria-label="Search the site"
              aria-expanded={searching}
              aria-controls="site-search"
              onClick={(e) => {
                e.preventDefault();
                setOpen(false);
                setSearching((v) => !v);
              }}
            >
              <SearchIcon />
            </Link>

            <button
              type="button"
              className="menu-toggle"
              aria-expanded={open}
              aria-controls="main-nav"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((v) => !v)}
            >
              <MenuIcon open={open} />
            </button>
          </div>
        </div>

        {searching && (
          <form id="site-search" className="site-search" role="search" action="/search" method="get">
            <div className="wrap site-search-form">
              <label className="sr-only" htmlFor="site-search-input">
                Search the site
              </label>
              <input
                ref={searchInput}
                id="site-search-input"
                type="search"
                name="q"
                placeholder="Search the site"
                autoComplete="off"
              />
              <button type="submit" className="btn btn-primary">
                Search
              </button>
            </div>
          </form>
        )}
      </header>

    </>
  );
}

function ChevronIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="chev">
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2.5" />
      <path d="m16.5 16.5 4 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      {open ? (
        <path d="m5 5 14 14M19 5 5 19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      )}
    </svg>
  );
}
