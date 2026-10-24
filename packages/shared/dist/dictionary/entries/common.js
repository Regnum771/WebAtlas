/** Date the code entries of Plan A take effect. */
export const VALID_FROM = '2026-10-24';
// Builders for attributes several layers share, so their labels stay identical everywhere.
export function nameAttribute(definition) {
    return { name: 'name', source: 'column', valueType: 'text', label: 'Tên', definition, validFrom: VALID_FROM };
}
export function externalIdAttribute(definition = 'Mã định danh của đối tượng trong nguồn dữ liệu gốc, giữ nguyên qua các phiên bản dữ liệu.') {
    return {
        name: 'external_id',
        source: 'column',
        valueType: 'text',
        label: 'Mã định danh',
        definition,
        validFrom: VALID_FROM,
    };
}
export function managingUnitAttribute() {
    return {
        name: 'managing_unit',
        source: 'column',
        valueType: 'text',
        label: 'Đơn vị chủ quản',
        definition: 'Mã đơn vị hành chính quản lý đối tượng (VN, mã tỉnh hoặc mã xã/phường), gán ban đầu theo đơn vị nhỏ nhất chứa đối tượng.',
        validFrom: VALID_FROM,
    };
}
/**
 * Closed list: the popup (DynamicPopup.tsx) picks the risk badge class by branching on
 * 'Cao' and 'Trung bình', which is application code depending on the codes (spec §2.2).
 * The codes are the Vietnamese words stored today in all four layers (Ruling 1).
 */
export function riskLevelAttribute(definition) {
    return {
        name: 'risk_level',
        source: 'column',
        valueType: 'code',
        label: 'Mức rủi ro',
        definition,
        codeList: 'closed',
        values: [
            { code: 'Trung bình', name: 'Trung bình', order: 1 },
            { code: 'Cao', name: 'Cao', order: 2 },
        ],
        validFrom: VALID_FROM,
    };
}
/** Listed values whose name equals the stored code, in the given order (Ruling 1). */
export function storedValues(codes) {
    return codes.map((code, i) => ({ code, name: code, order: i + 1 }));
}
