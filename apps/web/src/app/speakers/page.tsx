import type { Metadata } from 'next';
import Link from 'next/link';
import { listSpeakers, type SpeakerCard } from '@/lib/data';

export const metadata: Metadata = {
  title: 'Speakers',
  description:
    'The people speaking at the Knowledge Graph Conference 2027, from the conference database.',
};

/**
 * The speaker list, rendered from the `speakers` collection.
 *
 * The incumbent site embeds this from Whova in an iframe, which is why it does
 * not appear in search results and cannot be linked to. Here it is server
 * rendered from our own data: the same documents the mobile app reads, so a
 * correction in the organizer console shows up in both places at once.
 */
export const dynamic = 'force-dynamic';

/** Initials for the fallback avatar. Two at most, so the circle stays legible. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function Speaker({ s }: { s: SpeakerCard }) {
  const role = [s.title, s.company].filter(Boolean).join(', ');
  return (
    <div className="card speaker">
      {s.photoURL ? (
        // Remote speaker photos come from arbitrary hosts, so this is a plain
        // <img>: `next/image` would need every one of those hosts listed in
        // `images.remotePatterns`, and a speaker added in the console with a
        // new host would then render a 400 instead of a face.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="avatar" src={s.photoURL} alt="" width={56} height={56} />
      ) : (
        <div className="avatar" aria-hidden="true">
          {initials(s.name)}
        </div>
      )}
      <div>
        <div className="name">{s.name}</div>
        {role && <div className="role">{role}</div>}
        {s.bio && <p className="bio">{s.bio}</p>}
        <div className="links">
          {s.linkedin && (
            <a href={s.linkedin} target="_blank" rel="noreferrer noopener">
              LinkedIn
            </a>
          )}
          {s.x && (
            <a href={s.x} target="_blank" rel="noreferrer noopener">
              X
            </a>
          )}
          {s.website && (
            <a href={s.website} target="_blank" rel="noreferrer noopener">
              Website
            </a>
          )}
          {s.sessionCount > 0 && (
            <span className="muted">
              {s.sessionCount} session{s.sessionCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function SpeakersPage() {
  const speakers = await listSpeakers();

  return (
    <section>
      <div className="wrap">
        <p className="eyebrow">2027 programme</p>
        <h1>Speakers</h1>
        <p className="lede">
          {speakers.length} confirmed so far, listed by surname, and growing as the programme
          committee works through the submissions. Sessions for each speaker are on the{' '}
          <Link href="/agenda">agenda</Link>.
        </p>

        {speakers.length === 0 ? (
          <p className="notice">
            The speaker list is not published yet. Check back shortly — or{' '}
            <Link href="/tickets">register</Link> and we will mail you when it goes live.
          </p>
        ) : (
          <div className="grid g2" style={{ marginTop: 32 }}>
            {speakers.map((s) => (
              <Speaker key={s.id} s={s} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
