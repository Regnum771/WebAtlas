import { describe, it, expect } from 'vitest';
import { CAN_READ_FEATURES, CAN_WRITE_FEATURES, CAN_MANAGE_USERS } from './capabilities';

describe('capability policy (role → capability matrix)', () => {
  it('read features: admin, editor, viewer', () => {
    expect([...CAN_READ_FEATURES].sort()).toEqual(['admin', 'editor', 'viewer']);
  });
  it('write features: admin only (editor is read-only since 2026-09-17)', () => {
    expect([...CAN_WRITE_FEATURES]).toEqual(['admin']);
  });
  it('manage users: admin only', () => {
    expect([...CAN_MANAGE_USERS]).toEqual(['admin']);
  });
});
