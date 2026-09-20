import Link from 'next/link';
import { attendeeCategories } from '@/lib/attendee-categories';
import { UNCATEGORISED, categoryCounts, categoryLabel, inCategory } from '@/lib/attendee-categories-core';
import { requireOrganizer } from '@/lib/auth';
import { listAttendees } from '@/lib/data';
import { ROUTES } from '@/lib/nav';
import { PER_PAGE, PageHeader, Pagination, Panel, SearchInput, StatTiles, Table, Tag, listParams, paginate, sortRows } from '../../ui';
import { AssignBar, RowCheckbox } from './assign-bar';
import { CategoryEditor } from './category-editor';

export const dynamic = 'force-dynamic';

const RULES_PATH = '/tickets/attendee-customization/attendee-categories';
const ASSIGN_FORM = 'assign-category';

/**
 * Attendees › Categories.
 *
 * An organizer-authored label: create "VIP" or "Press", put people in it, and
 * it prints on the badge, shows on the holder's profile in the app, filters the
 * attendee list and both CSVs. The list is `settings/attendeeCategories`; a
 * person's category is on their registration. See `lib/attendee-categories.ts`.
 *
 * ── What this screen used to be ─────────────────────────────────────────────
 *
 * It listed `UserDoc.roles` and called them categories, read-only, on the
 * argument that assigning one means minting the `roles` claim. That is true of
 * a role and is why roles are still not edited here. A category grants nothing,
 * so it needs no claim, and the two are no longer the same word for two things.
 *
 * ── One read, one equality filter ───────────────────────────────────────────
 *
 * `listAttendees()` is the only attendee fetch, filtered and counted in memory.
 * An `orderBy` would make it a composite-index query this repo does not
 * declare, which passes on the emulator and fails in production.
 */
export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrganizer();

  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const filter = typeof sp.category === 'string' ? sp.category : undefined;
  const { page, sort, baseParams } = listParams(sp);

  const [everyone, { categories, ticketRules }] = await Promise.all([listAttendees(), attendeeCategories()]);
  // A category lives on the registration, so only ticket holders can have one.
  const all = everyone.filter((a) => a.registrationId && a.registrationStatus === 'active');

  const { counts, uncategorised } = categoryCounts(categories, all);
  const rulesBy: Record<string, string[]> = {};
  for (const r of ticketRules) (rulesBy[r.categoryId] ??= []).push(r.ticketType);

  const needle = (q ?? '').trim().toLowerCase();
  const matched = all.filter((a) => {
    if (!inCategory(a, filter)) return false;
    if (!needle) return true;
    return [a.name, a.email, a.company, a.ticketType, categoryLabel(categories, a)]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(needle));
  });

  const rows = sortRows(matched, sort.by, sort.dir, {
    name: (a) => a.name,
    company: (a) => a.company ?? '',
    ticket: (a) => a.ticketType ?? '',
    category: (a) => categoryLabel(categories, a),
  });
  const pageRows = paginate(rows, page, PER_PAGE);

  const href = (next: { q?: string; category?: string }) => {
    const p = new URLSearchParams();
    if (next.q) p.set('q', next.q);
    if (next.category) p.set('category', next.category);
    const s = p.toString();
    return `${s ? `?${s}` : '/attendees/categories'}#members`;
  };
  const chip = (on: boolean) => `whova-tag-main ${on ? 'blue-tag solid-tag' : 'grey-tag outline-tag'}`;
  const filterName =
    filter === UNCATEGORISED ? 'no category' : categories.find((c) => c.id === filter)?.name;

  return (
    <>
      <PageHeader
        title="Categories"
        info={
          <>
            <strong>Categories</strong>
            <p>
              A category is a label such as Speaker or Press. It prints on the name badge, shows on
              the attendee&apos;s profile in the app, and filters the attendee list and exports.
            </p>
          </>
        }
        links={[
          <Link key="a" href={ROUTES.attendees}>
            Attendees
          </Link>,
          <Link key="r" href={RULES_PATH}>
            Set by ticket type
          </Link>,
          <Link key="b" href="/attendees/name-badges">
            Name Badges
          </Link>,
        ]}
      />

      <StatTiles
        tiles={[
          { label: 'Categories', value: categories.length },
          { label: 'Attendees with a category', value: all.length - uncategorised, sub: `of ${all.length}` },
          { label: 'Ticket types that set one', value: ticketRules.length },
        ]}
      />

      <Panel>
        <h2 className="section-header">Categories</h2>
        <CategoryEditor categories={categories} counts={counts} rules={rulesBy} />
      </Panel>

      <Panel>
        <h2 id="members" className="section-header">
          {filterName ? `Attendees in ${filterName}` : 'Assign a category'}
        </h2>

        <form method="get" action="#members" className="toolbar">
          {filter ? <input type="hidden" name="category" value={filter} /> : null}
          <SearchInput defaultValue={q} width={420} placeholder="Enter name, email, company, ticket or category" />
          <button type="submit" className="btn btn-default">
            Search
          </button>
          {q ? (
            <Link className="btn btn-default" href={href({ category: filter })}>
              Clear
            </Link>
          ) : null}
        </form>

        <div className="toolbar">
          <Link className={chip(!filter)} href={href({ q })} style={{ textDecoration: 'none' }}>
            All ({all.length})
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              className={chip(filter === c.id)}
              href={href({ q, category: c.id })}
              style={{ textDecoration: 'none' }}
            >
              {c.name} ({counts[c.id]})
            </Link>
          ))}
          <Link
            className={chip(filter === UNCATEGORISED)}
            href={href({ q, category: UNCATEGORISED })}
            style={{ textDecoration: 'none' }}
          >
            No category ({uncategorised})
          </Link>
        </div>

        <AssignBar formId={ASSIGN_FORM} categories={categories} />

        <Table
          stackSm
          cols={[
            { key: 's', label: 'Select', className: 'cell-xs' },
            { key: 'n', label: 'Name', className: 'cell-fill', sortKey: 'name' },
            { key: 'co', label: 'Company', className: 'cell-mdsm cell-truncate', sortKey: 'company' },
            { key: 'tk', label: 'Ticket', className: 'cell-mdsm', sortKey: 'ticket' },
            { key: 'cat', label: 'Category', className: 'cell-sm', sortKey: 'category' },
          ]}
          sort={sort}
          empty="Nobody matches that"
          rows={pageRows.map((a) => {
            const c = categories.find((x) => x.id === a.categoryId);
            return [
              <RowCheckbox key="s" formId={ASSIGN_FORM} rid={a.registrationId!} name={a.name} />,
              <span key="n">
                <strong>{a.name}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {a.email}
                </div>
              </span>,
              a.company ?? <span className="muted">—</span>,
              a.ticketType ?? <span className="muted">—</span>,
              c ? (
                <Tag key="cat" color={c.color} fill="solid" small>
                  {c.name}
                </Tag>
              ) : (
                <span key="cat" className="muted">
                  —
                </span>
              ),
            ];
          })}
        />
        <Pagination total={rows.length} page={page} perPage={PER_PAGE} baseParams={baseParams} />

        <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
          Only people with an active registration are listed. A category you assign here is kept
          when that person buys another ticket.
        </p>
      </Panel>
    </>
  );
}
