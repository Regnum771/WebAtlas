import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The platform's design tokens, as stored in tokens.json. */
export type Tokens = {
  color: Record<string, string>;
  colorDark: Record<string, string>;
  radius: Record<string, number>;
  shadow: Record<string, string>;
  font: Record<string, string>;
  text: Record<string, number>;
  size: Record<string, number>;
  motion: Record<string, number>;
  contrast: Array<[fg: string, bg: string]>;
};

/** A tokens.json problem; the message names the offending key. */
export class TokenError extends Error {
  override name = 'TokenError';
}

const DEFAULT_PATH = fileURLToPath(new URL('../tokens.json', import.meta.url));
const HEX = /^#[0-9A-Fa-f]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function group(raw: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = raw[name];
  if (!isRecord(value)) throw new TokenError(`${name}: expected an object`);
  return value;
}

function colours(raw: Record<string, unknown>, name: string): Record<string, string> {
  const entries = group(raw, name);
  for (const [key, value] of Object.entries(entries)) {
    // Only 6-digit hex: the generated files and the contrast check read it directly.
    if (typeof value !== 'string' || !HEX.test(value)) {
      throw new TokenError(`${name}.${key}: expected a 6-digit hex colour, got ${JSON.stringify(value)}`);
    }
  }
  return entries as Record<string, string>;
}

function lengths(raw: Record<string, unknown>, name: string): Record<string, number> {
  const entries = group(raw, name);
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TokenError(`${name}.${key}: expected a non-negative number, got ${JSON.stringify(value)}`);
    }
  }
  return entries as Record<string, number>;
}

function strings(raw: Record<string, unknown>, name: string): Record<string, string> {
  const entries = group(raw, name);
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TokenError(`${name}.${key}: expected a non-empty string`);
    }
  }
  return entries as Record<string, string>;
}

/** Checks a parsed tokens.json and returns it typed; throws TokenError naming the bad key. */
export function validateTokens(raw: unknown): Tokens {
  if (!isRecord(raw)) throw new TokenError('tokens: expected an object');
  const color = colours(raw, 'color');
  const tokens: Tokens = {
    color,
    colorDark: colours(raw, 'colorDark'),
    radius: lengths(raw, 'radius'),
    shadow: strings(raw, 'shadow'),
    font: strings(raw, 'font'),
    text: lengths(raw, 'text'),
    size: lengths(raw, 'size'),
    motion: lengths(raw, 'motion'),
    contrast: [],
  };
  const pairs = raw.contrast;
  if (!Array.isArray(pairs)) throw new TokenError('contrast: expected a list of [fg, bg] pairs');
  pairs.forEach((pair, i) => {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new TokenError(`contrast[${i}]: expected a [fg, bg] pair`);
    }
    for (const name of pair) {
      if (typeof name !== 'string' || !(name in color)) {
        throw new TokenError(`contrast[${i}]: ${JSON.stringify(name)} is not a colour token`);
      }
    }
    tokens.contrast.push([pair[0], pair[1]]);
  });
  return tokens;
}

/** Reads and validates tokens.json (the package's own by default). */
export function loadTokens(path: string = DEFAULT_PATH): Tokens {
  return validateTokens(JSON.parse(readFileSync(path, 'utf8')));
}
