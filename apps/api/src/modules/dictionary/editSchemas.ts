import { z } from 'zod';

/*
 * Request bodies of the dictionary edit API (spec §2.2, Plan C Task 5). These schemas check the
 * shape of each field; the rules that need the stored row (units of the stored unit's dimension,
 * the display unit within the permitted list, validTo not before validFrom) are in edit.ts. Every
 * refusal names the field in Vietnamese and carries `details: { field }`, so the editor can show
 * it under that field.
 */

/** Vietnamese names of the fields, for refusals. */
export const FIELD_LABELS: Record<string, string> = {
  // Feature type
  name: 'Tên lớp',
  geometryMeaning: 'Ý nghĩa hình học',
  kind: 'Loại dữ liệu',
  table: 'Bảng dữ liệu',
  crs: 'Hệ toạ độ',
  geometryType: 'Kiểu hình học',
  // Both
  definition: 'Định nghĩa',
  validFrom: 'Ngày bắt đầu dùng',
  validTo: 'Ngày ngừng dùng',
  // Attribute
  label: 'Nhãn',
  valueType: 'Kiểu giá trị',
  displayUnits: 'Đơn vị hiển thị được phép',
  displayUnit: 'Đơn vị hiển thị',
  precision: 'Số chữ số thập phân',
  cfStandardName: 'Tên chuẩn CF',
  // Locked or not offered here: named in refusals only.
  source: 'Nguồn',
  storedUnit: 'Đơn vị lưu',
  nodata: 'Giá trị không có dữ liệu',
  scale: 'Hệ số tỉ lệ',
  offset: 'Độ lệch',
  ord: 'Thứ tự',
  codeList: 'Danh sách mã',
  values: 'Các giá trị',
};

export const fieldName = (field: string) => FIELD_LABELS[field] ?? field;

export const MESSAGES = {
  changed: 'Mục này vừa được người khác sửa.',
  locked: (field: string) => `Trường "${fieldName(field)}" theo cấu trúc dữ liệu, không sửa được.`,
  valueType: 'Chỉ đổi được kiểu của thuộc tính bổ sung.',
  unknownField: (field: string) => `Không sửa được trường "${fieldName(field)}".`,
  body: 'Nội dung yêu cầu không hợp lệ.',
  expectedRevision: 'Thiếu phiên bản của mục đang sửa.',
  text: (field: string, max: number) => `Trường "${fieldName(field)}" phải có nội dung, dài tối đa ${max} ký tự.`,
  geometryMeaning: `Trường "${fieldName('geometryMeaning')}" phải là chính xác, gần đúng hoặc điểm đại diện.`,
  validTo: `Trường "${fieldName('validTo')}" phải là ngày dạng YYYY-MM-DD, không sớm hơn ngày bắt đầu dùng.`,
  displayUnits: `Trường "${fieldName('displayUnits')}" chỉ nhận các đơn vị cùng thứ nguyên với đơn vị lưu, ít nhất một đơn vị.`,
  displayUnitsKeepShown: `Trường "${fieldName('displayUnits')}" phải gồm đơn vị hiển thị đang dùng.`,
  displayUnit: `Trường "${fieldName('displayUnit')}" phải là một trong các đơn vị hiển thị được phép.`,
  precision: `Trường "${fieldName('precision')}" phải là số nguyên từ 0 đến 6.`,
  cfStandardName: `Trường "${fieldName('cfStandardName')}" chỉ gồm chữ thường không dấu, chữ số và dấu gạch dưới, bắt đầu bằng chữ.`,
  restoreFields: 'Cần nêu ít nhất một trường để khôi phục.',
  noDefault: 'Mục này không còn trong từ điển mặc định, không khôi phục được.',
  historyLimit: 'Số dòng lịch sử phải là số nguyên từ 1 đến 200.',
  historyAttribute: 'Cần nêu lớp khi lọc theo thuộc tính.',
};

const NAME_MAX = 200;
const DEFINITION_MAX = 2000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Ruling 9: the CF standard name is checked for form only, not against the CF table.
const CF_NAME = /^[a-z][a-z0-9_]*$/;

/** Trimmed, non-empty text of at most `max` characters. */
const text = (field: string, max: number) => {
  const message = MESSAGES.text(field, max);
  return z.string({ invalid_type_error: message, required_error: message }).trim().min(1, message).max(max, message);
};

/** A real calendar date (2026-02-30 is refused), or null to un-retire. */
function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
const validTo = z
  .string({ invalid_type_error: MESSAGES.validTo })
  .refine(isDate, MESSAGES.validTo)
  .nullable();

const expectedRevision = z.number({ invalid_type_error: MESSAGES.expectedRevision, required_error: MESSAGES.expectedRevision })
  .int(MESSAGES.expectedRevision)
  .nonnegative(MESSAGES.expectedRevision);

export const featureTypeEditSchema = z.object({
  expectedRevision,
  name: text('name', NAME_MAX).optional(),
  definition: text('definition', DEFINITION_MAX).optional(),
  geometryMeaning: z.enum(['exact', 'approximate', 'representativePoint'], {
    errorMap: () => ({ message: MESSAGES.geometryMeaning }),
  }).optional(),
  validTo: validTo.optional(),
}, { invalid_type_error: MESSAGES.body }).strict();

const unitCode = z.string({ invalid_type_error: MESSAGES.displayUnits });

export const attributeEditSchema = z.object({
  expectedRevision,
  label: text('label', NAME_MAX).optional(),
  definition: text('definition', DEFINITION_MAX).optional(),
  displayUnits: z.array(unitCode, { invalid_type_error: MESSAGES.displayUnits })
    .min(1, MESSAGES.displayUnits)
    .refine((units) => new Set(units).size === units.length, MESSAGES.displayUnits)
    .optional(),
  displayUnit: z.string({ invalid_type_error: MESSAGES.displayUnit }).optional(),
  precision: z.number({ invalid_type_error: MESSAGES.precision }).int(MESSAGES.precision)
    .min(0, MESSAGES.precision).max(6, MESSAGES.precision).optional(),
  cfStandardName: z.string({ invalid_type_error: MESSAGES.cfStandardName })
    .regex(CF_NAME, MESSAGES.cfStandardName).nullable().optional(),
  validTo: validTo.optional(),
  // Only reached for an `extra` attribute (Ruling 5): edit.ts refuses it on any other.
  valueType: z.enum(['text', 'number', 'date', 'code'], {
    errorMap: () => ({ message: `Trường "${fieldName('valueType')}" phải là text, number, date hoặc code.` }),
  }).optional(),
}, { invalid_type_error: MESSAGES.body }).strict();

export const restoreSchema = z.object({
  fields: z.array(z.string({ invalid_type_error: MESSAGES.restoreFields }), { invalid_type_error: MESSAGES.restoreFields, required_error: MESSAGES.restoreFields })
    .min(1, MESSAGES.restoreFields),
}, { invalid_type_error: MESSAGES.body }).strict();

// `?layer=` (empty) means no filter, as an absent parameter does.
const filter = z.string().optional().transform((v) => (v === '' ? undefined : v));

export const historyQuerySchema = z.object({
  layer: filter,
  attribute: filter,
  limit: z.coerce.number({ invalid_type_error: MESSAGES.historyLimit })
    .int(MESSAGES.historyLimit).min(1, MESSAGES.historyLimit).max(200, MESSAGES.historyLimit).default(50),
}).refine((q) => q.attribute === undefined || q.layer !== undefined, { message: MESSAGES.historyAttribute, path: ['attribute'] });
