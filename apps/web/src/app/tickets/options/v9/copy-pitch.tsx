'use client';

import { useCallback, useRef, useState } from 'react';

type Status = 'idle' | 'copied' | 'failed';

/**
 * Copies the approval note to the clipboard.
 *
 * The note is fully rendered on the page above this button, so a browser that
 * refuses clipboard access loses a convenience and nothing else — which is why
 * the failure state says "select it above" rather than pretending to have
 * worked.
 */
export function CopyPitch({ text, className }: { text: string; className?: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
    timer.current = setTimeout(() => setStatus('idle'), 4000);
  }, [text]);

  return (
    <button type="button" className={className} onClick={copy}>
      <span aria-live="polite">
        {status === 'copied'
          ? 'Copied to the clipboard'
          : status === 'failed'
            ? 'Could not copy — select the text above'
            : 'Copy this note'}
      </span>
    </button>
  );
}
