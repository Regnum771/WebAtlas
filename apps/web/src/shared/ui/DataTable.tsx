import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export interface DataColumn<Row> {
  key: string;
  /** The header, unit included ("Mực nước (m)"). */
  label: string;
  /** Numbers are right-aligned in the number font. */
  numeric?: boolean;
  cell: (row: Row) => ReactNode;
}

export interface DataTableProps<Row> {
  /** Names the table for assistive technology; not shown. */
  caption: string;
  columns: DataColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  /** A row to highlight: `alert` for a breached threshold, `current` for the row at the current time. */
  tone?: (row: Row) => 'alert' | 'current' | undefined;
  /** Shown in place of the body when there are no rows. */
  empty?: string;
  /** The body scrolls past this height, under a sticky header. */
  maxHeight?: number;
  className?: string;
}

/**
 * A dense data table: 13 px text, 28 px rows divided by line-3, a surface-2 header that stays put
 * while the body scrolls, numbers right-aligned in JetBrains Mono. Used for every chart's table view
 * and the forecast-point table.
 */
export function DataTable<Row>({ caption, columns, rows, rowKey, tone, empty, maxHeight, className }: DataTableProps<Row>) {
  return (
    <div
      data-slot="data-table"
      className={cn('overflow-auto rounded-md border border-solid border-line', className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full border-collapse text-body">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface-2">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'h-control-sm border-0 border-b border-solid border-line px-2 text-label font-semibold whitespace-nowrap text-ink-2',
                  c.numeric ? 'text-right' : 'text-left',
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty ? (
            <tr><td colSpan={columns.length} className="px-2 py-3 text-ink-2">{empty}</td></tr>
          ) : rows.map((row, i) => {
            const t = tone?.(row);
            return (
              <tr
                key={rowKey(row, i)}
                data-tone={t}
                className="h-control-sm border-0 border-b border-solid border-line-3 last:border-b-0 data-[tone=alert]:bg-alert-tint data-[tone=alert]:text-alert-ink data-[tone=current]:bg-brand-tint"
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-2 whitespace-nowrap', c.numeric && 'text-right font-num text-num')}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
