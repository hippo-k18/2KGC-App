import Link from 'next/link';
import { requireOrganizer } from '@/lib/auth';
import { targetDescription } from '@/lib/firestore';
import { logoutAction } from '../login/actions';

/**
 * The authenticated shell. Note that this gate is convenience, not security:
 * server actions are independently addressable endpoints, so every one of them
 * calls `requireOrganizer()` itself. A layout check alone protects the pixels
 * and nothing else.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireOrganizer();

  return (
    <>
      <nav>
        <strong>KGC console</strong>
        <Link href="/sessions">Sessions</Link>
        <Link href="/announcements">Announcements</Link>
        <Link href="/war-room">War room</Link>
        <span className="spacer" />
        <span className="muted">{targetDescription()}</span>
        <span className="muted">{actor}</span>
        <form action={logoutAction}>
          <button type="submit" style={{ marginTop: 0 }}>
            Sign out
          </button>
        </form>
      </nav>
      <main>{children}</main>
    </>
  );
}
