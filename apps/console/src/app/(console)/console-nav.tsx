'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { SlimNode } from '@/lib/nav';

/**
 * Whova's two-level chrome: top-level tabs across the top, and the selected
 * tab's whole sub-tree in a left rail, expanded.
 *
 * This is a client component only because `usePathname()` is the only thing
 * that knows which entry is current — it holds no data and talks to nothing.
 * It receives `slimNav()` rather than the real tree so the placeholder prose
 * stays on the server.
 */
export function ConsoleTabs({ nav }: { nav: SlimNode[] }) {
  const pathname = usePathname();
  const top = pathname.split('/')[1] ?? '';

  return (
    <nav className="tabs">
      {nav.map((n) => (
        <Link key={n.slug} href={`/${n.slug}`} aria-current={n.slug === top}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

function Branch({ nodes, prefix, pathname }: { nodes: SlimNode[]; prefix: string; pathname: string }) {
  return (
    <ul>
      {nodes.map((n) => {
        const href = `${prefix}/${n.slug}`;
        const current = pathname === href;
        return (
          <li key={href}>
            <Link href={href} aria-current={current} className={`k-${n.kind}`}>
              {n.label}
              {n.ours ? <span className="tag ours">ours</span> : null}
              {n.kind === 'placeholder' ? <span className="tag">not built</span> : null}
            </Link>
            {n.children ? <Branch nodes={n.children} prefix={href} pathname={pathname} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ConsoleRail({ nav }: { nav: SlimNode[] }) {
  const pathname = usePathname();
  const topSlug = pathname.split('/')[1] ?? '';
  const top = nav.find((n) => n.slug === topSlug);

  if (!top) return null;

  return (
    <>
      <Link href={`/${top.slug}`} className="railhead" aria-current={pathname === `/${top.slug}`}>
        {top.label}
      </Link>
      {top.children ? (
        <Branch nodes={top.children} prefix={`/${top.slug}`} pathname={pathname} />
      ) : null}
    </>
  );
}
