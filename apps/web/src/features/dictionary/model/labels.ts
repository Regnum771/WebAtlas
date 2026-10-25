import type { AttributeSource, ValueType } from '@webatlas/shared';

/** Vietnamese names of the value types, as the layer page and the editor show them. */
export const TYPE_LABEL: Record<ValueType, string> = { text: 'chữ', number: 'số', date: 'ngày', code: 'mã' };

/** Where an attribute's values are kept, in Vietnamese. */
export const SOURCE_LABEL: Record<AttributeSource, string> = {
  column: 'cột dữ liệu',
  extra: 'thuộc tính bổ sung',
  band: 'kênh ảnh',
};
