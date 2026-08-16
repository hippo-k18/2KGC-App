'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from '@/lib/site';

/**
 * The one client component in the site chrome. It exists only so the current
 * page can be marked with `aria-current` — everything else here is static.
 * No data, no Firebase, nothing secret: this file could be public and it would
 * not matter, which is the test every client component in this app has to pass.
 */
export function SiteHeader() {
  const path = usePathname();

  return (
    <header className="site-header">
      <div className="wrap bar">
        <Link href="/" className="logo" aria-label="Knowledge Graph Conference, home">
          <Image src="/kgc-logo.png" alt="Knowledge Graph Conference" width={400} height={207} priority />
        </Link>
        <nav aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={path === item.href ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
          <Link href="/tickets" className="btn btn-primary btn-sm" style={{ marginLeft: 8 }}>
            Register now
          </Link>
        </nav>
      </div>
    </header>
  );
}
