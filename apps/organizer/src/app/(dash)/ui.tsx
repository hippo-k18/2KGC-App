import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The page furniture every Whova screen repeats.
 *
 * Whova's content area is not free-form: it is a white card whose top 4px is an
 * interactive-blue rule, then a 24px header holding the feature name at 24/500
 * with a right-aligned action group, then a link row, then the body. Sixty-odd
 * screens share it, so it is a component here rather than sixty copies.
 *
 * `PageHeader` deliberately takes `links` as a separate slot from `actions`:
 * Whova puts secondary navigation ("Watch tutorial", "Learn more") on the lower
 * line as plain links separated by a thin vertical bar, and primary actions on
 * the upper line as buttons. Collapsing the two loses the distinction that makes
 * the header readable at a glance.
 */

export function PageHeader({
  title,
  tags,
  actions,
  links,
}: {
  title: string;
  tags?: ReactNode;
  actions?: ReactNode;
  links?: ReactNode[];
}) {
  return (
    <div className="whova-header">
      <div className="whova-header__blue-bar" />
      <div className="whova-header__container">
        <div className="whova-header__top">
          <span className="whova-header__feature">{title}</span>
          {tags ? <span className="whova-header__tag-group">{tags}</span> : null}
          {actions ? <span className="whova-header__action-group">{actions}</span> : null}
        </div>
        {links && links.length > 0 ? (
          <div className="whova-header__bottom">
            <div className="whova-header__link-group">
              {links.map((l, i) => (
                <span key={i} style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  {i > 0 ? <span className="whova-header__vertical-bar">|</span> : null}
                  {l}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="panel" style={style}>
      {children}
    </div>
  );
}

/** Whova's three stat tiles: uppercase letter-spaced label over a large numeral. */
export function StatTiles({ tiles }: { tiles: { label: string; value: ReactNode; sub?: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
      {tiles.map((t) => (
        <div
          key={t.label}
          style={{
            background: 'var(--surface-alt)',
            border: '1px solid var(--hairline)',
            borderRadius: 4,
            flex: '1 1 160px',
            padding: '14px 16px',
          }}
        >
          <div
            style={{
              color: 'var(--muted)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.8px',
              textTransform: 'uppercase',
            }}
          >
            {t.label}
          </div>
          <div style={{ color: 'var(--ink)', fontSize: 28, fontWeight: 500, lineHeight: '34px' }}>
            {t.value}
          </div>
          {t.sub ? <div style={{ color: 'var(--faint)', fontSize: 12 }}>{t.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}

export type Col = {
  key: string;
  label: ReactNode;
  className?: string;
  /**
   * When set, the header becomes a link that sets `?sort=<sortKey>` and toggles
   * `?dir=`. Sorting itself happens in the page's server component, because at
   * conference volumes the whole list is already in memory and a client-side
   * sort would mean shipping it twice.
   */
  sortKey?: string;
};

/**
 * Whova's table is flexbox, not `<table>` — `.whova-table-row` is a flex row and
 * the width classes (`cell-sm` 136px, `cell-md` 272px, `cell-fill` grow) are
 * fixed pixel min/max pairs rather than percentages. Reproduced literally,
 * including the semantic `role` attributes their markup omits.
 *
 * Because those widths are absolute, a table whose fixed columns sum past the
 * 850px content frame silently starves the `cell-fill` column down to nothing —
 * a Title column one character wide, which looks like a rendering bug rather
 * than a sizing one. Whova's answer is `.whova-table-wrapper.table-scroll`, so
 * that is the wrapper here, and `.cell-fill` carries a floor of its own.
 */
export function Table({
  cols,
  rows,
  empty,
  sort,
}: {
  cols: Col[];
  rows: ReactNode[][];
  empty?: ReactNode;
  /** Current sort state plus the query string to build header links from. */
  sort?: { by?: string; dir?: 'asc' | 'desc'; baseParams: URLSearchParams };
}) {
  return (
    <div className="whova-table-wrapper">
      <div className="whova-table" role="table">
        <div className="whova-table-head" role="rowgroup">
          <div className="whova-table-row" role="row">
            {cols.map((c) => {
              const sortable = sort && c.sortKey;
              if (!sortable) {
                return (
                  <div
                    key={c.key}
                    className={`whova-table-header ${c.className ?? 'cell-fill'}`}
                    role="columnheader"
                  >
                    {c.label}
                  </div>
                );
              }
              const active = sort.by === c.sortKey;
              const nextDir = active && sort.dir === 'asc' ? 'desc' : 'asc';
              const q = new URLSearchParams(sort.baseParams);
              q.set('sort', c.sortKey!);
              q.set('dir', nextDir);
              q.delete('page');
              return (
                <div
                  key={c.key}
                  className={`whova-table-header sortable-header ${active ? 'sorted ' : ''}${c.className ?? 'cell-fill'}`}
                  role="columnheader"
                  aria-sort={active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
                >
                  <Link
                    href={`?${q.toString()}`}
                    style={{ color: 'inherit', display: 'flex', textDecoration: 'none' }}
                  >
                    {c.label}
                    <span className="sort-glyph" aria-hidden="true">
                      {active ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                    </span>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
        <div className="whova-table-body" role="rowgroup">
          {rows.length === 0 ? (
            <div className="whova-empty-table">
              <div className="description">{empty ?? 'Nothing here yet'}</div>
            </div>
          ) : (
            rows.map((r, i) => (
              <div className="whova-table-row" role="row" key={i}>
                {r.map((cell, j) => (
                  <div
                    key={cols[j]?.key ?? j}
                    className={`whova-table-cell ${cols[j]?.className ?? 'cell-fill'}`}
                    role="cell"
                  >
                    {cell}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Whova prints `Items 1–N of M` and four arrow buttons under every table,
 * right-aligned, outside the border. Ours now actually pages.
 *
 * The page number is a query parameter rather than component state, which is
 * both simpler on a server-rendered page and better behaved: "page 3 of the
 * attendee list" is a link you can send someone, and the browser back button
 * does what it looks like it does. Whova keeps it in React state and loses your
 * place on reload.
 */
export function Pagination({
  total,
  page,
  perPage,
  baseParams,
}: {
  total: number;
  page: number;
  perPage: number;
  /** Current query string minus `page`, so filters survive paging. */
  baseParams: URLSearchParams;
}) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const first = total === 0 ? 0 : (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);

  const href = (p: number) => {
    const q = new URLSearchParams(baseParams);
    if (p > 1) q.set('page', String(p));
    else q.delete('page');
    const s = q.toString();
    return s ? `?${s}` : '?';
  };

  const arrow = (glyph: string, target: number, disabled: boolean, label: string) =>
    disabled ? (
      <span key={glyph} className="pager-btn" aria-disabled="true" aria-label={label}>
        {glyph}
      </span>
    ) : (
      <Link key={glyph} className="pager-btn" href={href(target)} aria-label={label}>
        {glyph}
      </Link>
    );

  return (
    <div
      style={{
        alignItems: 'center',
        color: 'var(--muted)',
        display: 'flex',
        fontSize: 13,
        gap: 6,
        justifyContent: 'flex-end',
        marginTop: 10,
      }}
    >
      <span style={{ marginRight: 6 }}>
        Items {first}–{last} of {total}
      </span>
      {arrow('«', 1, page <= 1, 'First page')}
      {arrow('‹', page - 1, page <= 1, 'Previous page')}
      <span style={{ padding: '0 4px' }}>
        {page} / {pages}
      </span>
      {arrow('›', page + 1, page >= pages, 'Next page')}
      {arrow('»', pages, page >= pages, 'Last page')}
    </div>
  );
}

/**
 * Read `?page=` and slice. Kept beside `Pagination` so a screen cannot use one
 * without the other and end up rendering "1–25 of 300" over all 300 rows.
 */
export function paginate<T>(rows: T[], page: number, perPage: number): T[] {
  return rows.slice((page - 1) * perPage, page * perPage);
}

export function Banner({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'warning' | 'danger' | 'success';
  children: ReactNode;
}) {
  return (
    <div className={`whova-banner ${kind}`}>
      <div>{children}</div>
    </div>
  );
}

/**
 * The honest gap note.
 *
 * Whova has a screen here and we do not. A greyed-out table or a disabled button
 * implies "this half-works", which is worse than saying what is missing — so
 * this states what Whova does, what this repo would need, and roughly how big
 * that is, and it is deliberately styled as prose rather than as a broken
 * feature.
 */
export function NotBuilt({
  whova,
  needs,
  size,
  refs,
}: {
  whova: string;
  needs: string;
  size?: string;
  refs?: string;
}) {
  return (
    <Panel>
      <h2 className="section-header">Not built</h2>
      <dl className="gap-grid">
        <dt>Whova does</dt>
        <dd>{whova}</dd>
        <dt>We would need</dt>
        <dd>{needs}</dd>
        {size ? (
          <>
            <dt>Rough size</dt>
            <dd>{size}</dd>
          </>
        ) : null}
        {refs ? (
          <>
            <dt>Read</dt>
            <dd>{refs}</dd>
          </>
        ) : null}
      </dl>
    </Panel>
  );
}

/**
 * Whova's tag, with their two axes: a colour and a fill.
 *
 * `outline` is a tinted pill with a coloured border and coloured text; `solid`
 * is filled. The exact hex pairs are theirs (see `globals.css`). This replaces
 * the ad-hoc `.whova-tag good|bad|draft` set the first pass invented, which
 * happened to look similar and did not match anything.
 */
export function Tag({
  color = 'grey',
  fill = 'outline',
  small,
  children,
}: {
  color?: 'red' | 'orange' | 'green' | 'purple' | 'blue' | 'grey';
  fill?: 'outline' | 'solid';
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`whova-tag-main ${color}-tag ${fill}-tag${small ? ' small' : ''}`}>
      {children}
    </span>
  );
}

/** Status tag for a session or an announcement — one mapping, used everywhere. */
export function StatusTag({ status }: { status: string }) {
  const color =
    status === 'published' || status === 'active' || status === 'ok'
      ? 'green'
      : status === 'cancelled' || status === 'error'
        ? 'red'
        : 'orange';
  return (
    <Tag color={color} fill="outline">
      {status}
    </Tag>
  );
}

/**
 * In-page tabs. Whova has two styles and uses both: `underline` for switching
 * views of one thing (Sponsors List / Sponsor Profile Reminder), `solid` for a
 * segmented control.
 */
export function Tabs({
  tabs,
  style = 'underline',
}: {
  tabs: { label: ReactNode; href: string; active?: boolean }[];
  style?: 'underline' | 'solid';
}) {
  return (
    <nav className={`whova-tabs ${style}`}>
      {tabs.map((t) => (
        <Link key={t.href} className={`nav-link${t.active ? ' active' : ''}`} href={t.href}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** Whova's custom 16px checkbox. Native controls do not match anything else here. */
export function Checkbox({
  name,
  value,
  label,
  description,
  defaultChecked,
  disabled,
}: {
  name?: string;
  value?: string;
  label: ReactNode;
  description?: ReactNode;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="whova-checkbox-label">
        <input
          className="whova-checkbox-input"
          type="checkbox"
          name={name}
          value={value}
          defaultChecked={defaultChecked}
          disabled={disabled}
        />
        <span>{label}</span>
      </label>
      {description ? <div className="whova-checkbox-description">{description}</div> : null}
    </div>
  );
}

export function Radio({
  name,
  value,
  label,
  description,
  defaultChecked,
  disabled,
}: {
  name: string;
  value?: string;
  label: ReactNode;
  description?: ReactNode;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="whova-radio-label">
        <input
          className="whova-radio-input"
          type="radio"
          name={name}
          value={value}
          defaultChecked={defaultChecked}
          disabled={disabled}
        />
        <span>{label}</span>
      </label>
      {description ? <div className="whova-radio-description">{description}</div> : null}
    </div>
  );
}

/** Whova's standalone empty state, distinct from the one inside a table. */
export function EmptyState({
  icon = '◌',
  children,
  action,
  compact,
}: {
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`whova-empty-state ${compact ? 'compact' : 'default'}`}>
      <div className="whova-empty-state__icon" aria-hidden="true">
        {icon}
      </div>
      <div className="whova-empty-state__content">{children}</div>
      {action}
    </div>
  );
}

/** Whova's striped progress bar — the blue-to-cyan repeating gradient is theirs. */
export function ProgressBar({ pct }: { pct: number }) {
  return (
    <div
      className="whova-progress-bar"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="progress-bar-estimated" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

/** The magnifier-prefixed search box Whova uses on every list screen. */
export function SearchInput({
  name = 'q',
  defaultValue,
  placeholder,
  width = 420,
}: {
  name?: string;
  defaultValue?: string;
  placeholder: string;
  width?: number;
}) {
  return (
    <div className="whova-search-input" style={{ flex: `0 1 ${width}px`, maxWidth: width, width: '100%' }}>
      <span className="search-glyph" aria-hidden="true">
        ⌕
      </span>
      <input
        className="whova-text-input"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={placeholder}
      />
    </div>
  );
}

/** Rows per page. Whova's tables page at 25; matching it keeps the pager honest. */
export const PER_PAGE = 25;

/**
 * Read paging and sorting out of the query string.
 *
 * One helper so every list screen agrees on the parameter names (`page`,
 * `sort`, `dir`) and so `baseParams` — the query minus `page` — is built the
 * same way each time. Getting that wrong is how a filter silently drops when
 * you turn the page.
 */
export function listParams(sp: Record<string, string | string[] | undefined>) {
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const page = Math.max(1, Number(one('page') ?? 1) || 1);
  const by = one('sort');
  const dir = one('dir') === 'desc' ? 'desc' : 'asc';

  const baseParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'page' || v == null) continue;
    baseParams.set(k, Array.isArray(v) ? v[0] : v);
  }

  return { page, sort: { by, dir: dir as 'asc' | 'desc', baseParams }, baseParams };
}

/** Sort a list by a named accessor, stable and case-insensitive for strings. */
export function sortRows<T>(
  rows: T[],
  by: string | undefined,
  dir: 'asc' | 'desc',
  accessors: Record<string, (r: T) => string | number>,
): T[] {
  const get = by ? accessors[by] : undefined;
  if (!get) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return String(x).localeCompare(String(y), undefined, { sensitivity: 'base' }) * sign;
  });
}
