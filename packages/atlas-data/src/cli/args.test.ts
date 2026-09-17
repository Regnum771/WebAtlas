import { describe, it, expect } from 'vitest';
import { parseBuildArgs } from './args';

describe('parseBuildArgs', () => {
  it('returns empty filters when no arguments are given', () => {
    expect(parseBuildArgs([])).toEqual({ only: [], except: [] });
  });

  it('parses --only with a space-separated value', () => {
    expect(parseBuildArgs(['--only', 'basemap,dem'])).toEqual({
      only: ['basemap', 'dem'],
      except: [],
    });
  });

  it('parses --except with a space-separated value', () => {
    expect(parseBuildArgs(['--except', 'basemap,dem'])).toEqual({
      only: [],
      except: ['basemap', 'dem'],
    });
  });

  it('parses the --only=<ids> equals form', () => {
    expect(parseBuildArgs(['--only=contours'])).toEqual({
      only: ['contours'],
      except: [],
    });
  });

  it('parses the --except=<ids> equals form', () => {
    expect(parseBuildArgs(['--except=contours'])).toEqual({
      only: [],
      except: ['contours'],
    });
  });

  it('trims whitespace around each comma-separated id', () => {
    expect(parseBuildArgs(['--only', ' basemap , dem '])).toEqual({
      only: ['basemap', 'dem'],
      except: [],
    });
  });

  it('accepts --only and --except together', () => {
    expect(parseBuildArgs(['--only', 'basemap', '--except', 'dem'])).toEqual({
      only: ['basemap'],
      except: ['dem'],
    });
  });

  it('throws naming the flag when --only has no value (end of argv)', () => {
    expect(() => parseBuildArgs(['--only'])).toThrow(/atlas:build: .*--only/);
  });

  it('throws naming the flag when --except has no value (end of argv)', () => {
    expect(() => parseBuildArgs(['--except'])).toThrow(/atlas:build: .*--except/);
  });

  it('throws when the value looks like another flag', () => {
    expect(() => parseBuildArgs(['--only', '--except'])).toThrow(/atlas:build: .*--only/);
  });

  it('throws when --only is given twice', () => {
    expect(() => parseBuildArgs(['--only', 'a', '--only', 'b'])).toThrow(/atlas:build: .*--only/);
  });

  it('throws when --except is given twice', () => {
    expect(() => parseBuildArgs(['--except', 'a', '--except', 'b'])).toThrow(
      /atlas:build: .*--except/,
    );
  });

  it('throws when --only=<ids> and --only <ids> are both given', () => {
    expect(() => parseBuildArgs(['--only=a', '--only', 'b'])).toThrow(/atlas:build: .*--only/);
  });

  it('throws on an empty id from a double comma', () => {
    expect(() => parseBuildArgs(['--only', 'a,,b'])).toThrow(/atlas:build: /);
  });

  it('throws on an empty id from a trailing comma', () => {
    expect(() => parseBuildArgs(['--only', 'a,'])).toThrow(/atlas:build: /);
  });

  it('throws on an unknown flag, naming it', () => {
    expect(() => parseBuildArgs(['--exept', 'demo'])).toThrow(/atlas:build: .*--exept/);
  });

  it('throws on a bare positional argument, naming it', () => {
    expect(() => parseBuildArgs(['demo'])).toThrow(/atlas:build: .*demo/);
  });
});
