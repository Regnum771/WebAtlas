import { describe, it, expect } from 'vitest';
import { ROLE_LABELS } from './roleLabels';

describe('ROLE_LABELS', () => {
  it('names every role in Vietnamese', () => {
    expect(ROLE_LABELS).toEqual({ admin: 'Quản trị viên', editor: 'Biên tập viên', viewer: 'Người xem' });
  });
});
