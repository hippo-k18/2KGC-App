import Link from 'next/link';
import {
  CFP_STATUS_LABEL,
  missingSettings,
  typeLabel,
  type CfpStatus,
} from '@kgc/scripts/src/lib/cfp-core';
import type { CallCfpSettings } from '@kgc/shared';
import { Banner, Tag } from '../../ui';
import { CFA_BASE } from './routes';

/**
 * Pieces the call-for-papers screens share (T249): the status tag the inbox
 * reads, and the warning while Min's dates and addresses are not all set.
 */

const COLOUR: Record<CfpStatus, 'grey' | 'blue' | 'green' | 'red' | 'orange' | 'purple'> = {
  draft: 'grey',
  open: 'blue',
  accepted: 'green',
  'details-received': 'purple',
  rejected: 'red',
  waitlisted: 'orange',
  withdrawn: 'grey',
};

export function CfpStatusTag({ status }: { status: CfpStatus }) {
  return (
    <Tag color={COLOUR[status]} small>
      {CFP_STATUS_LABEL[status]}
    </Tag>
  );
}

/** Says which settings are unset and what that leaves out. Renders nothing when all are set. */
export function CfpSettingsWarning({ callId, cfp }: { callId: string; cfp: CallCfpSettings }) {
  const missing = missingSettings(cfp);
  if (missing.length === 0) return null;
  return (
    <Banner kind="warning">
      <strong>
        {missing.length} rolling-review setting{missing.length === 1 ? ' is' : 's are'} not set:
      </strong>{' '}
      {missing.join(', ')}. Until a date is set, the page and the emails leave out the sentence that
      would carry it, and nobody is sent a notice or reminder without an address.{' '}
      <Link href={`${CFA_BASE}/rolling-review?call=${callId}`}>Set them</Link>
    </Banner>
  );
}

/** Talk / Workshop / All, as links that keep the other query parameters. */
export function TypeFilter({
  base,
  current,
  params,
  types,
}: {
  base: string;
  current?: string;
  params: Record<string, string | undefined>;
  /** The call's ticked session types. One tab each, after All (T271). */
  types: readonly string[];
}) {
  if (types.length < 2) return null;
  const href = (type?: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== 'type' && k !== 'page') q.set(k, v);
    if (type) q.set('type', type);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const item = (label: string, type?: string) => (
    <Link
      key={label}
      href={href(type)}
      className={`whova-btn-main small ${current === type ? 'primary' : 'secondary'}`}
      aria-current={current === type ? 'page' : undefined}
    >
      {label}
    </Link>
  );
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 12px' }} role="group" aria-label="Session type">
      {item('All')}
      {types.map((t) => item(`${typeLabel(t)}s`, t))}
    </div>
  );
}
