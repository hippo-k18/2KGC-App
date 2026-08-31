import {
  SETTINGS_REGISTER,
  type SettingsFieldFacts,
  type SettingsKey,
  type SettingsSurface,
} from '@kgc/shared';
import { GapPanel, Table, Tag } from './ui';

/**
 * "Where does this actually go?", rendered from the contract rather than typed
 * out on each screen.
 *
 * Five screens write `settings`, and until 2026-08-31 every one of them
 * described its own reach in hand-written prose. That prose was mostly correct
 * and it aged the wrong way: two screens still said `SETTINGS_KEYS.logistics`
 * was written by nothing, months after the Emergency Manager started writing
 * it. Prose cannot be kept true by a compiler; `SETTINGS_REGISTER` can, because
 * adding a field without deciding who reads it does not typecheck.
 *
 * ── Why this is a `GapPanel` and the warning above it is a `Banner` ─────────
 *
 * Two different audiences. The organizer needs one sentence, always visible,
 * saying the switch they just moved does not move anything — that is the
 * `Banner` each screen already carries, and it stays on in a demo because an
 * organizer misled by a settings form is the failure this whole task is about.
 * Whoever is *building* this needs the per-field table with the reasons and the
 * follow-up numbers, and that is developer material: `SHOW_GAP_NOTES`, same as
 * the other 126 notes. See `lib/gap-notes.ts`.
 */

const SURFACE_LABEL: Record<SettingsSurface, string> = {
  organizer: 'this dashboard',
  web: 'the public website',
  app: 'the attendee app',
};

function statusTag(facts: SettingsFieldFacts) {
  if (facts.status === 'live') {
    return <Tag color="green">read by {facts.readers.map((r) => SURFACE_LABEL[r]).join(', ')}</Tag>;
  }
  if (facts.status === 'pending') {
    return <Tag color="orange">waiting on {facts.handoff ?? 'a follow-up'}</Tag>;
  }
  return <Tag color="grey">recorded only</Tag>;
}

/**
 * The reach table for one settings bag.
 *
 * `fields` is explicit rather than "every field of the bag" because `access` is
 * written by three screens and each should account for its own controls — a
 * table listing the other screens' fields reads as a defect list for something
 * this screen cannot change.
 */
export function SettingsReach<K extends SettingsKey>({
  bag,
  fields,
  style,
}: {
  bag: K;
  fields: readonly (keyof (typeof SETTINGS_REGISTER)[K] & string)[];
  style?: React.CSSProperties;
}) {
  const register = SETTINGS_REGISTER[bag] as Record<string, SettingsFieldFacts>;

  return (
    <GapPanel style={style}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Where these values go</h2>
      <p className="body-2">
        Generated from <code>SETTINGS_REGISTER</code> in <code>@kgc/shared</code>, which is the one
        place the dashboard, the website and the app agree about this document. A surface that
        starts reading a field flips its entry there, and this table follows.
      </p>
      <Table
        cols={[
          { key: 'f', label: 'Field', className: 'cell-md' },
          { key: 's', label: 'Reach', className: 'cell-sm' },
          { key: 'w', label: 'Why', className: 'cell-fill' },
        ]}
        empty="No fields declared"
        rows={fields.map((f) => {
          const facts = register[f];
          return [
            <code key="f">{f}</code>,
            <span key="s">{statusTag(facts)}</span>,
            <span key="w" className="muted">
              {facts.why}
            </span>,
          ];
        })}
      />
    </GapPanel>
  );
}
