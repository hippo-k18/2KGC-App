import type { RichDoc, RichNode } from '@kgc/shared';

/**
 * A table block's RichDoc as a grid of plain cells and back (T318), for the
 * settings panel's table form. T317's rich editor edits tables with
 * formatting; this grid is the quick way to type cells, add rows and turn the
 * header row on, and it says when a cell holds formatting it would drop.
 */

export interface TableGrid {
  /** The first row is header cells. */
  header: boolean;
  rows: string[][];
  /** Some cell has formatting, a link or a merge that typing in the grid would drop. */
  rich: boolean;
}

type Row = Extract<RichNode, { type: 'tableRow' }>;
type Cell = Extract<RichNode, { type: 'tableCell' | 'tableHeader' }>;

function cellText(cell: Cell): { text: string; rich: boolean } {
  let rich = !!(cell.colspan && cell.colspan > 1) || !!(cell.rowspan && cell.rowspan > 1);
  const parts: string[] = [];
  const walk = (nodes: RichNode[] | undefined, depth: number) => {
    (nodes ?? []).forEach((n, i) => {
      if (n.type === 'text') {
        if (n.marks?.length) rich = true;
        parts.push(n.text);
      } else if (n.type === 'hardBreak') parts.push('\n');
      else if ('content' in n) {
        if (n.type !== 'paragraph') rich = true;
        if (depth === 0 && i > 0) parts.push('\n');
        walk(n.content, depth + 1);
      }
    });
  };
  walk(cell.content, 0);
  return { text: parts.join(''), rich };
}

export function docToGrid(doc: RichDoc): TableGrid {
  const table = doc.content.find((n) => n.type === 'table') as Extract<RichNode, { type: 'table' }> | undefined;
  if (!table) return { header: true, rows: [['', ''], ['', '']], rich: doc.content.length > 0 };
  let rich = doc.content.length > 1;
  const rows = (table.content as Row[]).map((r) =>
    (r.content as Cell[]).map((c) => {
      const t = cellText(c);
      if (t.rich) rich = true;
      return t.text;
    }),
  );
  const first = table.content[0] as Row | undefined;
  const header = !!first && first.content.length > 0 && first.content.every((c) => c.type === 'tableHeader');
  const width = Math.max(1, ...rows.map((r) => r.length));
  return { header, rows: rows.map((r) => [...r, ...Array(width - r.length).fill('')]), rich };
}

function paragraphs(text: string): RichNode[] {
  return text.split('\n').map((line) =>
    line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' },
  );
}

export function gridToDoc(grid: Pick<TableGrid, 'header' | 'rows'>): RichDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: grid.rows.map((r, i) => ({
          type: 'tableRow',
          content: r.map((text) => ({ type: grid.header && i === 0 ? 'tableHeader' : 'tableCell', content: paragraphs(text) }) as RichNode),
        })),
      },
    ],
  };
}

export const MAX_TABLE_ROWS = 50;
export const MAX_TABLE_COLUMNS = 8;

export function addRow(rows: string[][], at = rows.length): string[][] {
  if (rows.length >= MAX_TABLE_ROWS) return rows;
  const next = rows.slice();
  next.splice(at, 0, Array(rows[0]?.length ?? 2).fill(''));
  return next;
}

export function removeRow(rows: string[][], at: number): string[][] {
  return rows.length <= 1 ? rows : rows.filter((_, i) => i !== at);
}

export function addColumn(rows: string[][], at = rows[0]?.length ?? 0): string[][] {
  if ((rows[0]?.length ?? 0) >= MAX_TABLE_COLUMNS) return rows;
  return rows.map((r) => {
    const next = r.slice();
    next.splice(at, 0, '');
    return next;
  });
}

export function removeColumn(rows: string[][], at: number): string[][] {
  return (rows[0]?.length ?? 0) <= 1 ? rows : rows.map((r) => r.filter((_, i) => i !== at));
}
