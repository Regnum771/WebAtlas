import type { Format } from '@number-flow/react';
import { NumberValue } from '@/shared/ui/NumberValue';

export interface Kpi {
  label: string;
  value: number | null;
  unit: string;
  format?: Format;
  /** The threshold it is read against, or what the number covers ("dưới BĐ1 (2,00 m)"). */
  note?: string;
  /** `alert`: a threshold is breached. */
  tone?: 'alert';
}

export interface KpiRowViewProps {
  items: Kpi[];
  /** The time every value is read at (spec: every measured value carries an "as of" time). */
  asOf: string;
}

/**
 * The dock's KPI row: value and unit, its threshold, and the time they are read at. Values sit in a
 * row divided by rules, not on cards (stat cards are banned); a breached threshold is said in words
 * as well as in the alert colour.
 */
export function KpiRowView({ items, asOf }: KpiRowViewProps) {
  return (
    <section data-slot="kpi-row" aria-label={`Chỉ số lúc ${asOf}`} className="flex flex-col gap-1">
      <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] border-0 border-y border-solid border-line-2">
        {items.map((k) => (
          <div key={k.label} data-tone={k.tone} className="flex min-w-0 flex-col gap-0.5 border-0 border-l border-solid border-line-3 px-2.5 py-2 first:border-l-0 first:pl-0">
            <dt className="truncate text-label text-ink-2">{k.label}</dt>
            <dd className="m-0 text-[16px] font-semibold text-ink in-data-[tone=alert]:text-alert-ink">
              <NumberValue value={k.value} unit={k.unit} format={k.format} />
            </dd>
            {k.note && <dd className="m-0 text-label text-ink-2 in-data-[tone=alert]:font-semibold in-data-[tone=alert]:text-alert-ink">{k.note}</dd>}
          </div>
        ))}
      </dl>
      <p className="m-0 text-label text-ink-2">Lúc <span className="font-num">{asOf}</span></p>
    </section>
  );
}
