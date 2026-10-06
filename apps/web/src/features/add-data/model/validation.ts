const URL_ERROR = 'Nhập địa chỉ bắt đầu bằng http:// hoặc https://.';

/** A WMS address must be an absolute http(s) URL. Returns the message for the field, or null. */
export function validateWmsUrl(value: string): string | null {
  try {
    const { protocol } = new URL(value.trim());
    return protocol === 'http:' || protocol === 'https:' ? null : URL_ERROR;
  } catch {
    return URL_ERROR;
  }
}

export function validateLayerName(value: string): string | null {
  return value.trim() === '' ? 'Nhập tên lớp.' : null;
}
