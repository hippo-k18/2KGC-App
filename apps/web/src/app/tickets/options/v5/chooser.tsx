'use client';

import { useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ChooserModel, Row } from './model';
import s from './styles.module.css';

/**
 * The choosing surface: stacked selectable rows, and a summary beside them that
 * always says what is currently chosen and what changing it would cost.
 *
 * ── Every row is a real link first, and a control second ────────────────────
 *
 * Each row's header is an `<a href="…?tier=<id>#buy">` — the same contract the
 * other nine options use and the same one the shared checkout reads. With
 * JavaScript off, clicking a row navigates, the server re-renders with that
 * tier selected and the page lands on the checkout: identical behaviour to
 * every static variant.
 *
 * With JavaScript on, the click is intercepted so the buyer *stays where they
 * are* — the point of this layout is comparing without leaving — and three
 * things happen instead: local state moves the selection immediately, and
 * `router.replace` rewrites `?tier=` so the checkout below is already on the
 * right ticket by the time they scroll to it. Modifier-clicks and middle-clicks
 * fall through to the browser, because a link that eats cmd-click is not a link.
 */
export function Chooser({ model, basePath }: { model: ChooserModel; basePath: string }) {
  const router = useRouter();
  const [chosen, setChosen] = useState(model.selectedId);
  const selected = model.rows.find((r) => r.id === chosen) ?? model.rows[0];
  if (!selected) return null;

  function select(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    setChosen(id);
    router.replace(`${basePath}?tier=${encodeURIComponent(id)}`, { scroll: false });
  }

  const bundle =
    model.bundle && (selected.isTop || model.bundle.ids.includes(selected.id))
      ? model.bundle
      : null;
  const topName = model.rows.find((r) => r.isTop)?.name ?? '';
  const upgrade = selected.upgrade;

  return (
    <div className={s.layout}>
      <ol className={s.rows}>
        {model.rows.map((row) => (
          <TierRow
            key={row.id}
            row={row}
            selected={row.id === selected.id}
            onSelect={select}
          />
        ))}
      </ol>

      <aside className={s.panel} aria-labelledby="v5-panel-title">
        <div className={s.panelInner}>
          <h2 className={s.panelTitle} id="v5-panel-title">
            Your ticket
          </h2>
          <p className={s.panelName}>{selected.name}</p>
          <p className={s.panelPrice}>{selected.price}</p>
          <p className={s.panelTagline}>{selected.tagline}</p>

          {upgrade ? (
            <div className={s.delta}>
              <h3 className={s.deltaHead}>
                <span>Move up to {upgrade.toName}</span>
                <span className={s.deltaAmount}>{upgrade.delta}</span>
              </h3>
              {upgrade.adds.length > 0 && (
                <>
                  <p className={s.deltaLead}>For that, you also get:</p>
                  <ul className={s.deltaList}>
                    {upgrade.adds.map((add) => (
                      <li key={add}>{add}</li>
                    ))}
                  </ul>
                </>
              )}
              <a
                className={s.deltaLink}
                href={`${basePath}?tier=${encodeURIComponent(upgrade.toId)}#buy`}
                onClick={(e) => select(e, upgrade.toId)}
              >
                Switch to {upgrade.toName}
              </a>
            </div>
          ) : (
            <p className={s.deltaLead}>
              Nothing on this page is missing from this ticket. There is no upgrade from here.
            </p>
          )}

          {bundle && (
            <p className={s.bundle}>
              {bundle.names} bought separately come to <strong>{bundle.separately}</strong>.{' '}
              {topName} is <strong>{bundle.together}</strong>, {bundle.difference} less.
            </p>
          )}

          {selected.onSale ? (
            <a className={s.cta} href={selected.href}>
              Continue with {selected.name}
            </a>
          ) : (
            <p className={s.ctaClosed}>
              {selected.unavailableReason ?? 'Not available'}. Pick another ticket to carry on.
            </p>
          )}

          <p className={s.live} aria-live="polite">
            {selected.name}, {selected.price}, selected.
          </p>
        </div>
      </aside>
    </div>
  );
}

function TierRow({
  row,
  selected,
  onSelect,
}: {
  row: Row;
  selected: boolean;
  onSelect: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
}) {
  const className = [s.row, selected ? s.rowOn : '', row.onSale ? '' : s.rowClosed]
    .filter(Boolean)
    .join(' ');

  const heading = (
    <>
      <span className={s.dot} aria-hidden="true" />
      <span className={s.rowName}>{row.name}</span>
      <span className={s.rowPrice}>{row.price}</span>
      <span className={s.rowTagline}>{row.tagline}</span>
    </>
  );

  return (
    <li className={className}>
      {row.onSale ? (
        <a
          className={s.rowLink}
          href={row.href}
          aria-current={selected ? 'true' : undefined}
          onClick={(e) => onSelect(e, row.id)}
        >
          {heading}
        </a>
      ) : (
        <span className={s.rowLink}>{heading}</span>
      )}
      {!row.onSale && (
        <p className={s.closedNote}>{row.unavailableReason ?? 'Not on sale'}</p>
      )}
      <ul className={s.lines}>
        {row.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </li>
  );
}
