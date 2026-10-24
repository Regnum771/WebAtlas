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
export function nameEnAttribute(definition) {
    return { name: 'name_en', source: 'column', valueType: 'text', label: 'Tên tiếng Anh', definition, validFrom: VALID_FROM };
}
export function osmIdAttribute() {
    return {
        name: 'osm_id',
        source: 'column',
        valueType: 'text',
        label: 'Mã OpenStreetMap',
        definition: 'Mã định danh của đối tượng trong OpenStreetMap, nguồn của dữ liệu.',
        validFrom: VALID_FROM,
    };
}
export function areaKm2Attribute(definition) {
    return {
        name: 'area_km2',
        source: 'column',
        valueType: 'number',
        label: 'Diện tích',
        definition,
        storedUnit: 'km2',
        displayUnits: ['km2', 'ha'],
        displayUnit: 'km2',
        precision: 2,
        validFrom: VALID_FROM,
    };
}
/** The flood scenario tables hold one row per scenario; scenario_id names it (an identifier, so text). */
export function scenarioIdAttribute() {
    return {
        name: 'scenario_id',
        source: 'column',
        valueType: 'text',
        label: 'Kịch bản',
        definition: 'Mã kịch bản lũ mà dòng dữ liệu thuộc về, ví dụ kttv-2025-10 là trận lũ tháng 10/2025 tái hiện từ số liệu thực đo.',
        validFrom: VALID_FROM,
    };
}
export function floodMaxDepthAttribute(definition) {
    return {
        name: 'max_depth',
        source: 'column',
        valueType: 'number',
        label: 'Độ sâu ngập lớn nhất',
        definition,
        storedUnit: 'm',
        displayUnits: ['m', 'cm'],
        displayUnit: 'm',
        precision: 2,
        validFrom: VALID_FROM,
    };
}
/** Hours counted from the start of a flood scenario (hour 0). */
export function scenarioHourAttribute(name, label, definition) {
    return {
        name,
        source: 'column',
        valueType: 'number',
        label,
        definition,
        storedUnit: 'h',
        displayUnits: ['h'],
        displayUnit: 'h',
        precision: 0,
        validFrom: VALID_FROM,
    };
}
/** Listed values whose name equals the stored code, in the given order (Ruling 1). */
export function storedValues(codes) {
    return codes.map((code, i) => ({ code, name: code, order: i + 1 }));
}
