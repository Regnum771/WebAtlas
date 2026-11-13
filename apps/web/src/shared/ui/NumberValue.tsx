import NumberFlow, { type Format } from '@number-flow/react';
import { cn } from '@/shared/lib/utils';

export interface NumberValueProps {
  /** null: no value yet, shown as an em dash. */
  value: number | null;
  /** The unit, always shown after the value (spec: every measured value carries a unit). */
  unit: string;
  /** Intl number options; Vietnamese grouping and decimal comma either way. */
  format?: Format;
  className?: string;
}

const LOCALE = 'vi-VN';

/**
 * A measured value and its unit, in JetBrains Mono so the digits keep their width while NumberFlow
 * animates a change. Assistive technology reads the plain formatted text; the animated digits are
 * hidden from it, so a change is never spelled out digit by digit.
 */
export function NumberValue({ value, unit, format, className }: NumberValueProps) {
  const text = value === null ? '—' : new Intl.NumberFormat(LOCALE, format).format(value);
  return (
    <span data-slot="number-value" className={cn('inline-flex items-baseline gap-1 font-num', className)}>
      <span className="sr-only">{`${text} ${unit}`}</span>
      <span aria-hidden="true" className="tabular-nums">
        {value === null ? '—' : <NumberFlow value={value} locales={LOCALE} format={format} />}
      </span>
      <span aria-hidden="true" className="text-[0.85em] text-ink-2">{unit}</span>
    </span>
  );
}
