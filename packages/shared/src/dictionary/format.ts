import { convert, unit } from './units.js';
import type { DictAttribute, Dictionary } from './types.js';

const DASH = '—';

export function attributeOf(
  dictionary: Dictionary,
  layer: string,
  name: string,
): DictAttribute | undefined {
  const featureType = Object.hasOwn(dictionary, layer) ? dictionary[layer] : undefined;
  return featureType?.attributes.find((a) => a.name === name);
}

export function labelFor(dictionary: Dictionary, layer: string, name: string): string {
  return attributeOf(dictionary, layer, name)?.label ?? name;
}

export function valueName(attribute: DictAttribute, code: string): string {
  return attribute.values?.find((v) => v.code === code)?.name ?? code;
}

/**
 * A number in the display unit, vi-VN grouped, at the attribute's precision, without the
 * unit symbol. Missing or non-numeric values give the dash.
 */
export function formatDisplayNumber(attribute: DictAttribute, stored: unknown): string {
  return numberParts(attribute, stored)?.text ?? DASH;
}

function numberParts(
  attribute: DictAttribute,
  stored: unknown,
): { text: string; symbol: string } | undefined {
  // node-postgres returns numeric columns as strings, so accept a finite numeric string.
  let n: number;
  if (typeof stored === 'number') n = stored;
  else if (typeof stored === 'string' && stored.trim() !== '') n = Number(stored);
  else return undefined;
  if (!Number.isFinite(n)) return undefined;
  const from = attribute.storedUnit;
  const to = attribute.displayUnit ?? from;
  const value = from && to ? convert(n, from, to) : n;
  const text = value.toLocaleString('vi-VN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: attribute.precision ?? 2,
  });
  // Unit 1 has an empty symbol, so nothing is appended for it.
  return { text, symbol: to ? unit(to).symbol : '' };
}

export function formatValue(attribute: DictAttribute, stored: unknown): string {
  if (stored === null || stored === undefined) return DASH;
  if (typeof stored === 'number' && !Number.isFinite(stored)) return DASH;

  if (attribute.valueType === 'number') {
    const parts = numberParts(attribute, stored);
    if (!parts) return DASH;
    return parts.symbol ? `${parts.text} ${parts.symbol}` : parts.text;
  }
  if (attribute.valueType === 'code') return valueName(attribute, String(stored));
  return String(stored);
}

/** Text for a form input: full precision in the display unit, comma decimal, no grouping, no symbol. */
export function toDisplayInput(attribute: DictAttribute, stored: unknown): string {
  if (stored === null || stored === undefined) return '';
  if (typeof stored === 'number' && !Number.isFinite(stored)) return '';
  if (attribute.valueType !== 'number') return String(stored);
  let n: number;
  if (typeof stored === 'number') n = stored;
  else if (typeof stored === 'string' && stored.trim() !== '') n = Number(stored);
  else return '';
  if (!Number.isFinite(n)) return '';
  const from = attribute.storedUnit;
  const to = attribute.displayUnit ?? from;
  const value = from && to ? convert(n, from, to) : n;
  return value.toLocaleString('vi-VN', { useGrouping: false, maximumFractionDigits: 10 });
}

// vi-VN: a dot groups thousands, a comma marks decimals. Anything else is refused, never guessed.
const THOUSANDS_FORM = /^-?\d{1,3}(\.\d{3})*(,\d+)?$/;
const PLAIN_FORM = /^-?\d+(,\d+)?$/;

export function parseDisplay(
  attribute: DictAttribute,
  text: string,
): { ok: true; value: number } | { ok: false; message: string } {
  if (attribute.valueType !== 'number') {
    return { ok: false, message: `Trường "${attribute.label}" không nhận giá trị số.` };
  }
  const refused = {
    ok: false as const,
    message: `Không đọc được số "${text}". Dùng dấu phẩy cho phần thập phân, ví dụ 1.250,5.`,
  };
  const to = attribute.storedUnit;
  const from = attribute.displayUnit ?? to;
  let body = text.trim();
  const symbol = from ? unit(from).symbol : '';
  if (symbol && body.endsWith(symbol)) body = body.slice(0, -symbol.length).trim();
  if (!THOUSANDS_FORM.test(body) && !PLAIN_FORM.test(body)) return refused;
  const number = Number(body.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(number)) return refused;
  return { ok: true, value: from && to ? convert(number, from, to) : number };
}
