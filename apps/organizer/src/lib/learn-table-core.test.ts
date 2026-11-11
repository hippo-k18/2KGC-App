import { describe, expect, it } from 'vitest';
import type { RichDoc } from '@kgc/shared';
import { addColumn, addRow, docToGrid, gridToDoc, removeColumn, removeRow, MAX_TABLE_COLUMNS } from './learn-table-core';

describe('table grid', () => {
  it('round-trips plain cells and the header row', () => {
    const grid = { header: true, rows: [['Course', 'Weeks'], ['Explorer', '8'], ['Builder', 'two\nlines']] };
    const back = docToGrid(gridToDoc(grid));
    expect(back).toEqual({ ...grid, rich: false });
  });

  it('says when a cell holds formatting or a merge', () => {
    const doc: RichDoc = {
      type: 'doc',
      content: [{ type: 'table', content: [{ type: 'tableRow', content: [
        { type: 'tableCell', colspan: 2, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A', marks: [{ type: 'bold' }] }] }] },
      ] }] }],
    };
    const g = docToGrid(doc);
    expect(g.rich).toBe(true);
    expect(g.header).toBe(false);
    expect(g.rows).toEqual([['A']]);
  });

  it('pads short rows and starts a doc with no table as a 2 by 2 grid', () => {
    expect(docToGrid({ type: 'doc', content: [] }).rows).toEqual([['', ''], ['', '']]);
    const g = docToGrid(gridToDoc({ header: false, rows: [['a', 'b'], ['c']] }));
    expect(g.rows[1]).toEqual(['c', '']);
  });

  it('adds and removes rows and columns within limits', () => {
    const rows = [['a', 'b'], ['c', 'd']];
    expect(addRow(rows, 1)).toEqual([['a', 'b'], ['', ''], ['c', 'd']]);
    expect(removeRow(rows, 0)).toEqual([['c', 'd']]);
    expect(removeRow([['x']], 0)).toEqual([['x']]);
    expect(addColumn(rows, 0)).toEqual([['', 'a', 'b'], ['', 'c', 'd']]);
    expect(removeColumn(rows, 1)).toEqual([['a'], ['c']]);
    const wide = [Array(MAX_TABLE_COLUMNS).fill('')];
    expect(addColumn(wide)).toBe(wide);
  });
});
