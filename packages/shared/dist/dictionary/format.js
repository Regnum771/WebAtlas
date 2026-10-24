import { convert, unit } from './units.js';
const DASH = '—';
export function attributeOf(dictionary, layer, name) {
    const featureType = Object.hasOwn(dictionary, layer) ? dictionary[layer] : undefined;
    return featureType?.attributes.find((a) => a.name === name);
}
export function labelFor(dictionary, layer, name) {
    return attributeOf(dictionary, layer, name)?.label ?? name;
}
export function valueName(attribute, code) {
    return attribute.values?.find((v) => v.code === code)?.name ?? code;
}
export function formatValue(attribute, stored) {
    if (stored === null || stored === undefined)
        return DASH;
    if (typeof stored === 'number' && !Number.isFinite(stored))
        return DASH;
    if (attribute.valueType === 'number') {
        // node-postgres returns numeric columns as strings, so accept a finite numeric string.
        let n;
        if (typeof stored === 'number')
            n = stored;
        else if (typeof stored === 'string' && stored.trim() !== '')
            n = Number(stored);
        else
            return DASH;
        if (!Number.isFinite(n))
            return DASH;
        const from = attribute.storedUnit;
        const to = attribute.displayUnit ?? from;
        const value = from && to ? convert(n, from, to) : n;
        const text = value.toLocaleString('vi-VN', {
            minimumFractionDigits: 0,
            maximumFractionDigits: attribute.precision ?? 2,
        });
        // Unit 1 has an empty symbol, so nothing is appended for it.
        const symbol = to ? unit(to).symbol : '';
        return symbol ? `${text} ${symbol}` : text;
    }
    if (attribute.valueType === 'code')
        return valueName(attribute, String(stored));
    return String(stored);
}
// vi-VN: a dot groups thousands, a comma marks decimals. Anything else is refused, never guessed.
const THOUSANDS_FORM = /^-?\d{1,3}(\.\d{3})*(,\d+)?$/;
const PLAIN_FORM = /^-?\d+(,\d+)?$/;
export function parseDisplay(attribute, text) {
    if (attribute.valueType !== 'number') {
        return { ok: false, message: `Trường "${attribute.label}" không nhận giá trị số.` };
    }
    const refused = {
        ok: false,
        message: `Không đọc được số "${text}". Dùng dấu phẩy cho phần thập phân, ví dụ 1.250,5.`,
    };
    const to = attribute.storedUnit;
    const from = attribute.displayUnit ?? to;
    let body = text.trim();
    const symbol = from ? unit(from).symbol : '';
    if (symbol && body.endsWith(symbol))
        body = body.slice(0, -symbol.length).trim();
    if (!THOUSANDS_FORM.test(body) && !PLAIN_FORM.test(body))
        return refused;
    const number = Number(body.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(number))
        return refused;
    return { ok: true, value: from && to ? convert(number, from, to) : number };
}
