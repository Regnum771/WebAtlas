export function validateEmail(value: string): string | null {
  if (value === '') return 'Nhập email.';
  const at = value.indexOf('@');
  if (at === -1 || at === value.length - 1) return 'Email thiếu phần sau dấu @.';
  if (!/^\S+@\S+\.\S+$/.test(value)) return 'Email chưa đúng dạng.';
  return null;
}

export function validatePassword(value: string): string | null {
  return value === '' ? 'Nhập mật khẩu.' : null;
}
