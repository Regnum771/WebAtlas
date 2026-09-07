import { describe, it, expect } from 'vitest';
import { parseReplySegments, KNOWLEDGE_OPEN_TAG, KNOWLEDGE_CLOSE_TAG } from './assistant.js';

describe('parseReplySegments', () => {
  it('returns a single grounded segment for plain text', () => {
    expect(parseReplySegments('Có 151 đập trong vùng.')).toEqual([
      { kind: 'grounded', text: 'Có 151 đập trong vùng.' },
    ]);
  });

  it('splits a labelled general-knowledge block out of the surrounding text', () => {
    const raw = `Có 151 đập.${KNOWLEDGE_OPEN_TAG}Đập vòm thường dùng ở hẻm núi hẹp.${KNOWLEDGE_CLOSE_TAG}Bạn cần thêm gì?`;
    expect(parseReplySegments(raw)).toEqual([
      { kind: 'grounded', text: 'Có 151 đập.' },
      { kind: 'knowledge', text: 'Đập vòm thường dùng ở hẻm núi hẹp.' },
      { kind: 'grounded', text: 'Bạn cần thêm gì?' },
    ]);
  });

  it('handles a reply that is entirely general knowledge', () => {
    const raw = `${KNOWLEDGE_OPEN_TAG}Mùa khô ở Tây Nguyên kéo dài từ tháng 11.${KNOWLEDGE_CLOSE_TAG}`;
    expect(parseReplySegments(raw)).toEqual([
      { kind: 'knowledge', text: 'Mùa khô ở Tây Nguyên kéo dài từ tháng 11.' },
    ]);
  });

  it('handles more than one knowledge block', () => {
    const raw = `A${KNOWLEDGE_OPEN_TAG}B${KNOWLEDGE_CLOSE_TAG}C${KNOWLEDGE_OPEN_TAG}D${KNOWLEDGE_CLOSE_TAG}`;
    expect(parseReplySegments(raw).map((s) => s.kind)).toEqual([
      'grounded', 'knowledge', 'grounded', 'knowledge',
    ]);
  });

  it('treats an unclosed tag as knowledge to the end — never silently as grounded fact', () => {
    const raw = `Có 151 đập.${KNOWLEDGE_OPEN_TAG}Phần này không đóng thẻ`;
    expect(parseReplySegments(raw)).toEqual([
      { kind: 'grounded', text: 'Có 151 đập.' },
      { kind: 'knowledge', text: 'Phần này không đóng thẻ' },
    ]);
  });

  it('drops segments that are empty or whitespace only', () => {
    const raw = `${KNOWLEDGE_OPEN_TAG}B${KNOWLEDGE_CLOSE_TAG}   `;
    expect(parseReplySegments(raw)).toEqual([{ kind: 'knowledge', text: 'B' }]);
  });

  it('returns an empty array for an empty reply', () => {
    expect(parseReplySegments('')).toEqual([]);
    expect(parseReplySegments('   ')).toEqual([]);
  });
});
