import { describe, it, expect } from 'vitest';
import { validateLayerName, validateWmsUrl } from './validation';

describe('validateWmsUrl', () => {
  it.each(['', 'ftp://x/wms', 'example.com/wms', 'not a url'])('refuses %j as an address', (v) => {
    expect(validateWmsUrl(v)).toBe('Nhập địa chỉ bắt đầu bằng http:// hoặc https://.');
  });

  it('accepts an https address with a query string', () => {
    expect(validateWmsUrl('https://example.com/geoserver/wms?map=a&token=b')).toBeNull();
  });

  it('accepts an http address, and ignores spaces around it', () => {
    expect(validateWmsUrl('  http://localhost:8080/geoserver/wms ')).toBeNull();
  });
});

describe('validateLayerName', () => {
  it.each(['', '   '])('refuses %j as a layer name', (v) => {
    expect(validateLayerName(v)).toBe('Nhập tên lớp.');
  });

  it('accepts a workspace-qualified name', () => {
    expect(validateLayerName('ws:rivers')).toBeNull();
  });
});
