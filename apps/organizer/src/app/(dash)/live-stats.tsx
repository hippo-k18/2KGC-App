import Link from 'next/link';
import { ROUTES } from '@/lib/nav';

/**
 * `#live-stats` — Whova's band between the tab bar and the content.
 *
 * A 62px white strip holding an `#f4f6f8` pill of `LABEL: value` pairs split by
 * hairline dividers, the values in 20/500 interactive blue. Whova's set is
 * app downloads, returning Whova users, messages, community posts, photos,
 * sessions added, document views, meet-ups, sponsor impressions.
 *
 * Ours shows the counts we can actually answer, and — this is the substitution
 * worth knowing about — Whova's headline number is *app downloads*, which we
 * cannot measure at all without an app-store presence. The closest honest
 * equivalent is how many ticket holders have signed in and made a profile,
 * which is the same question ("are people actually going to use this?") asked
 * of data we hold. Every figure here is a live Firestore count, not a sample.
 *
 * Rendered in the layout, so it appears on every screen exactly as Whova's does.
 */
export interface LiveStat {
  label: string;
  value: number | string;
  href?: string;
}

export function LiveStats({ stats }: { stats: LiveStat[] }) {
  return (
    <div id="live-stats" className="layout-boxed">
      <div className="live-stats-title">
        <span className="subtitle-1">Live Event Stats</span>
        <div className="stats-list">
          {stats.map((s, i) => (
            <div key={s.label} style={{ alignItems: 'center', display: 'flex', gap: 12 }}>
              {i > 0 ? <span className="divider" aria-hidden="true" /> : null}
              {s.href ? (
                <Link
                  href={s.href}
                  style={{ alignItems: 'center', display: 'flex', textDecoration: 'none' }}
                >
                  <span className="stats-tag-title">{s.label}:</span>
                  <span className="stats-value">{s.value}</span>
                </Link>
              ) : (
                <span style={{ alignItems: 'center', display: 'flex' }}>
                  <span className="stats-tag-title">{s.label}:</span>
                  <span className="stats-value">{s.value}</span>
                </span>
              )}
            </div>
          ))}
        </div>
        <Link
          href={ROUTES.report}
          style={{ fontSize: 13, marginLeft: 12, whiteSpace: 'nowrap' }}
        >
          View All
        </Link>
      </div>
    </div>
  );
}
