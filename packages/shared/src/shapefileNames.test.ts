import { describe, it, expect } from 'vitest';
import { shapefileFieldNames } from './shapefileNames.js';

const tos = (names: string[]) => shapefileFieldNames(names).map((e) => e.to);

describe('shapefileFieldNames', () => {
  it('short names pass, long names cut, clashes numbered, case-insensitive', () => {
    // Short names pass unchanged, in order, one entry per input.
    expect(shapefileFieldNames(['ten', 'dung_tich', 'ma_so_1234'])).toEqual([
      { from: 'ten', to: 'ten' },
      { from: 'dung_tich', to: 'dung_tich' },
      { from: 'ma_so_1234', to: 'ma_so_1234' },
    ]);

    // A long name is cut to its first 10 characters.
    expect(shapefileFieldNames(['ten_cong_trinh_thuy_loi'])).toEqual([
      { from: 'ten_cong_trinh_thuy_loi', to: 'ten_cong_t' },
    ]);

    // Clashes after the cut: first 8 characters, '_' and a counter from 1.
    expect(tos(['ten_cong_trinh', 'ten_cong_trinh_2', 'ten_cong_tac'])).toEqual([
      'ten_cong_t', 'ten_cong_1', 'ten_cong_2',
    ]);

    // Case-insensitive: 'TEN' clashes with 'ten'; the first one keeps its name.
    expect(tos(['ten', 'TEN', 'Ten'])).toEqual(['ten', 'TEN_1', 'Ten_2']);
    expect(tos(['Ten_Cong_Trinh', 'ten_cong_trinh_x'])).toEqual(['Ten_Cong_T', 'ten_cong_1']);

    // A name that fits keeps itself even when a longer, earlier name would cut to it.
    expect(tos(['ten_cong_trinh', 'ten_cong_t'])).toEqual(['ten_cong_1', 'ten_cong_t']);

    // A counter never yields a name that is taken, nor one longer than 10 characters.
    expect(tos(['abcdefghijk', 'abcdefghijx', 'abcdefgh_1'])).toEqual(['abcdefghij', 'abcdefgh_2', 'abcdefgh_1']);
    const many = Array.from({ length: 12 }, (_, i) => `truong_rat_dai_${i}`);
    const out = tos(many);
    expect(out.slice(0, 3)).toEqual(['truong_rat', 'truong_r_1', 'truong_r_2']);
    expect(out[10]).toBe('truong__10');
    for (const to of out) expect(to.length).toBeLessThanOrEqual(10);
    expect(new Set(out.map((t) => t.toLowerCase())).size).toBe(out.length);

    expect(shapefileFieldNames([])).toEqual([]);
  });

  it('folds names to ASCII so every name fits the 10 bytes of a .dbf field', () => {
    // Diacritics removed, đ/Đ to d/D, anything outside [A-Za-z0-9_] to '_', then cut.
    expect(shapefileFieldNames(['ngày_xây_dựng'])).toEqual([{ from: 'ngày_xây_dựng', to: 'ngay_xay_d' }]);
    // A short name that folds is changed, so it is reported: from !== to.
    expect(shapefileFieldNames(['đập', 'Đơn vị'])).toEqual([
      { from: 'đập', to: 'dap' },
      { from: 'Đơn vị', to: 'Don_vi' },
    ]);
    // Only an ASCII-safe name of at most 10 characters counts as unchanged, and keeps its name
    // even when a folded name would have taken it.
    expect(tos(['đập', 'dap'])).toEqual(['dap_1', 'dap']);
    expect(tos(['Tên công trình', 'Tên công trình 2'])).toEqual(['Ten_cong_t', 'Ten_cong_1']);
    expect(tos(['a-b', 'a b'])).toEqual(['a_b', 'a_b_1']);

    const names = ['Tên công trình thủy lợi', 'ngày', 'Ngày', 'dung tích (triệu m³)', 'Đập', 'ổ_ầ_ữ_ỹ_ợ_ằ'];
    const out = tos(names);
    for (const to of out) {
      expect(Buffer.byteLength(to, 'utf8'), to).toBeLessThanOrEqual(10);
      expect(to).toMatch(/^[A-Za-z0-9_]*$/);
    }
    expect(new Set(out.map((t) => t.toLowerCase())).size).toBe(out.length);
  });
});
