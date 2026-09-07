import { describe, it, expect } from 'vitest';
import { usageTokens } from './service';

describe('usageTokens', () => {
  it('sums input, output, and both cache fields when all are present', () => {
    // Cache fields are real billed input, not just input_tokens: the system
    // block carries a cache breakpoint precisely so the tool definitions are
    // served from cache on later turns, and that cache traffic must still
    // count against the per-user daily ceiling.
    expect(
      usageTokens({
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 30,
      })
    ).toBe(200);
  });

  it('treats absent cache fields as zero rather than propagating NaN', () => {
    expect(
      usageTokens({
        input_tokens: 100,
        output_tokens: 50,
      })
    ).toBe(150);
  });

  it('treats null cache fields as zero', () => {
    expect(
      usageTokens({
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      })
    ).toBe(150);
  });

  it('treats a null input_tokens as zero', () => {
    expect(
      usageTokens({
        input_tokens: null,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      })
    ).toBe(65);
  });

  it('is zero for an all-zero usage record', () => {
    expect(
      usageTokens({
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      })
    ).toBe(0);
  });

  it('counts a cache-heavy turn correctly, where cache_read dominates over input_tokens', () => {
    // The realistic steady-state case: after the first turn, the resent tool
    // definitions and system prompt are served almost entirely from cache.
    expect(
      usageTokens({
        input_tokens: 5,
        output_tokens: 40,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 4000,
      })
    ).toBe(4045);
  });
});
