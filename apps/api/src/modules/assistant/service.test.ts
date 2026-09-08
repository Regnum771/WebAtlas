import { describe, it, expect } from 'vitest';
import { usageTokens, collectReplyText } from './service';

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

describe('collectReplyText', () => {
  /** A message as the runner yields it, trimmed to what the extractor reads. */
  const msg = (...blocks: Array<{ type: string; text?: string; name?: string }>) =>
    ({ content: blocks }) as never;

  it('keeps the answer when the model ends on a tool call with nothing left to say', () => {
    // Observed live for "5 đập gần Buôn Ma Thuột nhất?": the model narrates,
    // calls a data tool, writes the REAL ANSWER alongside a highlight_features
    // call, then emits an empty end_turn once that tool returns. Reading only
    // the last message threw the answer away and showed an apology instead.
    // Our own system prompt (rule 7: highlight the features you name) makes
    // this the common path, not an edge case.
    const messages = [
      msg({ type: 'text', text: 'Tôi sẽ tìm 5 đập gần Buôn Ma Thuột nhất cho bạn.' }, { type: 'tool_use', name: 'nearest_features' }),
      msg({ type: 'text', text: 'Dưới đây là 5 đập gần nhất:\n1. Đăk Ru — 26,43 km' }, { type: 'tool_use', name: 'highlight_features' }),
      msg(),
    ];
    const text = collectReplyText(messages);
    expect(text).toContain('Đăk Ru');
    expect(text).toContain('26,43 km');
  });

  it('keeps every text run in the order the model produced them', () => {
    const messages = [msg({ type: 'text', text: 'một' }), msg({ type: 'text', text: 'hai' })];
    expect(collectReplyText(messages)).toBe('một\nhai');
  });

  it('ignores non-text blocks', () => {
    const messages = [msg({ type: 'tool_use', name: 'x' }, { type: 'text', text: 'ba' })];
    expect(collectReplyText(messages)).toBe('ba');
  });

  it('skips messages that carry no text at all', () => {
    const messages = [msg({ type: 'text', text: 'bốn' }), msg(), msg({ type: 'tool_use', name: 'y' })];
    expect(collectReplyText(messages)).toBe('bốn');
  });

  it('returns an empty string when the model genuinely said nothing', () => {
    expect(collectReplyText([msg(), msg({ type: 'tool_use', name: 'z' })])).toBe('');
    expect(collectReplyText([])).toBe('');
  });

  it('drops whitespace-only text rather than emitting blank lines', () => {
    const messages = [msg({ type: 'text', text: '  ' }), msg({ type: 'text', text: 'năm' })];
    expect(collectReplyText(messages)).toBe('năm');
  });
});
