import Link from 'next/link';
import type { ReactNode } from 'react';
import { framedHtml, splitAddress } from '@/lib/email-log-core';

/**
 * One email drawn the way Gmail shows an opened message: the subject over the
 * sender line, "to" underneath, the date on the right, and the body below.
 *
 * ── The body is sandboxed ───────────────────────────────────────────────────
 *
 * The HTML goes into an `<iframe srcDoc>` with a `sandbox` that does not
 * include `allow-scripts` or `allow-same-origin`, so nothing in a message can
 * run, read the dashboard's cookies or reach its DOM. Images load, which is
 * what makes it look like the inbox. Links open in a new tab (`<base
 * target="_blank">` plus the two popup permissions); without that a click would
 * load the site inside the frame.
 *
 * No JavaScript here: the HTML/text switch is two links, so the page stays a
 * Server Component.
 */

/** Tall enough for the whole message in most cases, so it reads like an opened email rather than a scroll box. */
function frameHeight(text: string): number {
  return Math.round(Math.min(2400, Math.max(640, 520 + text.length * 0.8)));
}

export function EmailFrame({
  from,
  to,
  replyTo,
  subject,
  when,
  html,
  text,
  part,
  partHref,
  badge,
}: {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  when: string;
  html: string;
  text: string;
  /** Which part is showing. */
  part: 'html' | 'text';
  /** Builds the link for the other part. */
  partHref: (part: 'html' | 'text') => string;
  /** A label above the message: "Re-created preview". */
  badge?: ReactNode;
}) {
  const sender = splitAddress(from);
  const initial = (sender.name.match(/[A-Za-z0-9]/)?.[0] ?? '?').toUpperCase();
  const showing = part === 'html' && html ? 'html' : 'text';

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #dadce0',
        borderRadius: 8,
        fontFamily: 'Roboto, "Google Sans", Arial, sans-serif',
        overflow: 'hidden',
      }}
    >
      {badge ? <div style={{ padding: '10px 20px 0' }}>{badge}</div> : null}
      <div style={{ padding: '16px 20px 4px' }}>
        <h2 style={{ color: '#1f1f1f', fontSize: 22, fontWeight: 400, margin: '0 0 16px', overflowWrap: 'anywhere' }}>
          {subject || '(no subject)'}
        </h2>
        <div style={{ alignItems: 'flex-start', display: 'flex', gap: 12 }}>
          <div
            aria-hidden="true"
            style={{
              alignItems: 'center',
              background: '#1c2b4a',
              borderRadius: '50%',
              color: '#fff',
              display: 'flex',
              flex: '0 0 40px',
              fontSize: 18,
              height: 40,
              justifyContent: 'center',
              width: 40,
            }}
          >
            {initial}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ alignItems: 'baseline', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
              <span style={{ fontSize: 14 }}>
                <strong style={{ color: '#1f1f1f' }}>{sender.name}</strong>{' '}
                <span style={{ color: '#5e5e5e', fontSize: 12 }}>&lt;{sender.address}&gt;</span>
              </span>
              <span style={{ color: '#5e5e5e', fontSize: 12, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{when}</span>
            </div>
            <div style={{ color: '#5e5e5e', fontSize: 12, marginTop: 2, overflowWrap: 'anywhere' }}>
              to {to}
              {replyTo ? <> · reply-to {replyTo}</> : null}
            </div>
          </div>
        </div>
      </div>

      <nav className="whova-tabs underline" style={{ margin: '8px 20px 0' }} aria-label="Which part of the email">
        {html ? (
          <Link className={`nav-link${showing === 'html' ? ' active' : ''}`} href={partHref('html')}>
            As it looks
          </Link>
        ) : null}
        <Link className={`nav-link${showing === 'text' ? ' active' : ''}`} href={partHref('text')}>
          Plain text
        </Link>
      </nav>

      <div style={{ borderTop: '1px solid #eceff1', padding: showing === 'html' ? 0 : '16px 20px' }}>
        {showing === 'html' ? (
          <iframe
            title={`Email: ${subject}`}
            srcDoc={framedHtml(html)}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            // No scripts, so the frame cannot size itself; the text part is a fair guide to its length.
            style={{ border: 0, display: 'block', height: frameHeight(text), width: '100%' }}
          />
        ) : (
          <pre
            style={{
              color: '#1f1f1f',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13,
              lineHeight: 1.55,
              margin: 0,
              overflowWrap: 'anywhere',
              whiteSpace: 'pre-wrap',
            }}
          >
            {text || '(no plain-text part)'}
          </pre>
        )}
      </div>
    </div>
  );
}
