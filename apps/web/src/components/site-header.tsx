'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ABOUT_MENU, NAV, NAV_MORE } from '@/lib/site';
import { Ticker } from '@/components/ticker';

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
export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/*
        The announcement bar sits BELOW the navy header, not above it. Measured on
        knowledgegraph.tech at a 1512px viewport: the header occupies y 0–100 and
        the orange strip y 100–132. Ours had them the other way round, which put
        the first thing a visitor sees — an orange band — above the brand.
      */}
      <header className="site-header">
        <div className="wrap bar">
          <Link href="/" className="logo" aria-label="Knowledge Graph Conference, home">
            {/*
              Intrinsic size is the file's own 2048×763, so Next can reserve the
              right box; CSS takes it down to the header height. `priority`
              because it is the largest thing above the fold on every page.
            */}
            <Image
              src="/kgc/cropped-White-Wordmark-2.png"
              alt="Knowledge Graph Conference"
              width={2048}
              height={763}
              priority
            />
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

          <nav id="main-nav" aria-label="Main" className={open ? 'open' : undefined}>
            {NAV.map((item) => (
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
                  item.todo ? (
                    // Not built here yet. Rendered so the shape of the live menu
                    // is visible, but inert — a link to a 404 is worse than none.
                    <span key={item.href} className="submenu-todo" aria-disabled="true">
                      {item.label}
                      <em>not built yet</em>
                    </span>
                  ) : item.external ? (
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
            <Link href="/tickets" className="btn btn-primary btn-sm" style={{ marginLeft: 8 }}>
              Register now
            </Link>
          </nav>

          {/*
            Search is present and orange on the live site. It routes to a real
            page rather than opening a box that does nothing: a search field that
            swallows a query is worse than an honest link.
          */}
          <Link href="/agenda" className="search" aria-label="Search the agenda">
            <SearchIcon />
          </Link>
        </div>
      </header>

      {/*
        The announcement bar is the homepage's, and only the homepage's.
        Measured across seven live pages: `/` carries it, and `/community`,
        `/team`, `/hcls`, `/tickets`, `/about-kgc` and `/2026-speakers` carry no
        orange bar at all. Ours ran it on all sixteen routes, which put a 34px
        band of scrolling capitals between the header and the first heading of
        every interior page — the most visible structural difference left
        between the two builds, and on every page but one.
      */}
      {path === '/' && <Ticker />}
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
