'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The editor's sections. The path is matched on its end because the same page
 * is `/write/profile` on the blog host and `/blog/write/profile` elsewhere.
 */
export function StudioNav({ base, editor, reviewCount }: { base: string; editor: boolean; reviewCount: number }) {
  const path = usePathname().replace(/^\/blog(?=\/)/, '');
  const items = [
    { href: '/write', label: 'Posts', on: path === '/write' || /^\/write\/(?!profile|review)/.test(path) },
    ...(editor
      ? [
          { href: '/write/review', label: 'Review', on: path === '/write/review', count: reviewCount },
        ]
      : []),
    { href: '/write/profile', label: 'Profile', on: path === '/write/profile' },
  ];
  return (
    <nav className="st-nav" aria-label="Blog editor">
      {items.map((item) => (
        <Link key={item.href} href={base + item.href} aria-current={item.on ? 'page' : undefined}>
          {item.label}
          {'count' in item && item.count ? <span className="st-count">{item.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
