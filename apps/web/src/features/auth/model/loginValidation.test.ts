import { describe, it, expect } from 'vitest';
import { validateEmail, validatePassword } from './loginValidation';

describe('validateEmail', () => {
  it.each([
    ['', 'Nhập email.'],
    ['bientap', 'Email thiếu phần sau dấu @.'],
    ['bientap@', 'Email thiếu phần sau dấu @.'],
    ['a@b', 'Email chưa đúng dạng.'],
  ])('email %j → %s', (value, message) => {
    expect(validateEmail(value)).toBe(message);
  });

  it('accepts a@b.vn', () => {
    expect(validateEmail('a@b.vn')).toBeNull();
  });
});

describe('validatePassword', () => {
  it('asks for a password when empty', () => {
    expect(validatePassword('')).toBe('Nhập mật khẩu.');
  });
  it('accepts any non-empty password', () => {
    expect(validatePassword('x')).toBeNull();
  });
});
