import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes and verifies (argon2)', async () => {
    const h = await hashPassword('s3cret-pw');
    expect(h).not.toBe('s3cret-pw');
    expect(await verifyPassword(h, 's3cret-pw')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });
});
