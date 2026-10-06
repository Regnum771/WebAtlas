import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFormFields } from './useFormFields';

const required = (v: string) => (v ? null : 'trống');
const validators = { a: required, b: required };
const setup = () => renderHook(() => useFormFields({ a: '', b: '' }, validators));

describe('useFormFields', () => {
  it('does not check a field while it is first being typed in', () => {
    const { result } = setup();
    act(() => result.current.set('a', ''));
    expect(result.current.errors.a).toBeUndefined();
  });

  it('checks a field on blur', () => {
    const { result } = setup();
    act(() => result.current.blur('a'));
    expect(result.current.errors.a).toBe('trống');
  });

  it('rechecks on each keystroke once the field shows an error', () => {
    const { result } = setup();
    act(() => result.current.blur('a'));
    act(() => result.current.set('a', 'x'));
    expect(result.current.errors.a).toBeUndefined();
  });

  it('stops rechecking once the error is cleared, until the next blur', () => {
    const { result } = setup();
    act(() => result.current.blur('a'));
    act(() => result.current.set('a', 'x'));
    act(() => result.current.set('a', ''));
    // The error cleared, so the field is not rechecked until the next blur.
    expect(result.current.errors.a).toBeUndefined();
    act(() => result.current.blur('a'));
    expect(result.current.errors.a).toBe('trống');
  });

  it('never changes the value when it reports an error', () => {
    const { result } = setup();
    act(() => result.current.set('a', 'x'));
    act(() => result.current.set('a', ''));
    act(() => result.current.blur('a'));
    expect(result.current.errors.a).toBe('trống');
    expect(result.current.values.a).toBe('');
    act(() => result.current.set('b', '  '));
    expect(result.current.values.b).toBe('  ');
  });

  it('validateAll returns the first field in error, in validator order', () => {
    const { result } = setup();
    let first: string | null = null;
    act(() => {
      result.current.set('b', 'ok');
      first = result.current.validateAll();
    });
    expect(first).toBe('a');
    expect(result.current.errors).toEqual({ a: 'trống' });
    act(() => {
      result.current.set('a', 'ok');
      first = result.current.validateAll();
    });
    expect(first).toBeNull();
    expect(result.current.errors).toEqual({});
  });

  it('clear empties one field and drops its error, leaving the others', () => {
    const { result } = setup();
    act(() => result.current.set('a', 'x'));
    act(() => result.current.set('b', 'y'));
    act(() => result.current.blur('a'));
    act(() => result.current.set('b', ''));
    act(() => result.current.blur('b'));
    expect(result.current.errors.b).toBe('trống');
    act(() => result.current.clear('b'));
    expect(result.current.values).toEqual({ a: 'x', b: '' });
    expect(result.current.errors).toEqual({});
    act(() => result.current.set('b', ''));
    expect(result.current.errors.b).toBeUndefined();
  });
});
