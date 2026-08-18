'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { NAV, NAV_MORE } from '@/lib/site';
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
              The secondary items. On the live site these live behind the
              hamburger rather than in the primary row, so here they are visible
              only once the menu is open — which on a desktop it never is, and on
              a phone it is the same list the live site shows.
            */}
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

      <Ticker />
    </>
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
