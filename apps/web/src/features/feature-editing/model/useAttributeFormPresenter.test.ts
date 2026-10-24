import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const createFeature = vi.fn();
const updateFeature = vi.fn();
vi.mock('../api/features.api', () => ({
  createFeature: (...a: unknown[]) => createFeature(...a),
  updateFeature: (...a: unknown[]) => updateFeature(...a),
}));
const unit = vi.hoisted(() => ({
  state: { value: '', submittable: null as string | null, error: null as string | null, locked: false },
  args: null as null | { mode: string; anyUnit?: boolean },
}));
vi.mock('./useManagingUnitField', () => ({
  useManagingUnitField: (args: { mode: string; anyUnit?: boolean }) => {
    unit.args = args;
    return {
      ...unit.state, setValue: vi.fn(), options: [], suggestion: null, hint: null, readOnlyText: null, tree: null,
      allowed: () => true,
    };
  },
}));
// The code defaults, without the served copy's fetch.
vi.mock('../../dictionary', async () => {
  const shared = await vi.importActual<typeof import('@webatlas/shared')>('@webatlas/shared');
  return { useDictionary: () => shared.DICTIONARY };
});
import { DICTIONARY, attributeOf, labelFor, parseDisplay } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { getToasts, resetToasts } from '../../../shared/ui/toast.store';
import { useAttributeFormPresenter } from './useAttributeFormPresenter';

const baseArgs = {
  layerKey: 'dams' as const,
  attributes: ['name', 'status'],
  geometry: { type: 'Point', coordinates: [108, 13] },
  onSaved: vi.fn(),
};

describe('useAttributeFormPresenter', () => {
  beforeEach(() => { createFeature.mockReset(); baseArgs.onSaved = vi.fn(); });

  it('exposes dictionary labels for DB columns and empty initial values', () => {
    const { result } = renderHook(() => useAttributeFormPresenter(baseArgs));
    expect(result.current.labels.name).toBe(labelFor(DICTIONARY, 'dams', 'name'));
    expect(result.current.labels.status).toBe(labelFor(DICTIONARY, 'dams', 'status'));
    expect(result.current.values).toEqual({ name: '', status: '' });
  });

  it('canSave is false with no geometry, true with geometry', () => {
    const { result: no } = renderHook(() => useAttributeFormPresenter({ ...baseArgs, geometry: null }));
    expect(no.current.canSave).toBe(false);
    const { result: yes } = renderHook(() => useAttributeFormPresenter(baseArgs));
    expect(yes.current.canSave).toBe(true);
  });

  it('submit posts non-empty DB-keyed properties + geometry and calls onSaved', async () => {
    createFeature.mockResolvedValue({ id: 'x' });
    const onSaved = vi.fn();
    const { result } = renderHook(() => useAttributeFormPresenter({ ...baseArgs, onSaved }));
    act(() => { result.current.setField('name', 'Hoa Binh'); });
    await act(async () => { await result.current.submit(); });
    expect(createFeature).toHaveBeenCalledWith('dams', {
      geometry: baseArgs.geometry,
      properties: { name: 'Hoa Binh' }, // empty 'status' omitted
    });
    expect(onSaved).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('maps a 422 geometry error', async () => {
    createFeature.mockRejectedValue(new ApiError(422, 'GEOMETRY_ERROR', 'bad geom'));
    const { result } = renderHook(() => useAttributeFormPresenter(baseArgs));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('Hình vẽ không hợp lệ. Vẽ lại.');
    expect(baseArgs.onSaved).not.toHaveBeenCalled();
  });

  it('maps a 400 validation error message', async () => {
    createFeature.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'name too long'));
    const { result } = renderHook(() => useAttributeFormPresenter(baseArgs));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('name too long');
  });

  it('maps a 400 Zod flatten() error to per-column fieldErrors', async () => {
    createFeature.mockRejectedValue(new ApiError(400, 'VALIDATION_ERROR', 'Validation failed', {
      formErrors: [],
      fieldErrors: { wattage_mw: ['Expected number, received string'] },
    }));
    const { result } = renderHook(() => useAttributeFormPresenter(baseArgs));
    await act(async () => { await result.current.submit(); });
    expect(result.current.fieldErrors.wattage_mw).toContain('Expected number');
    expect(result.current.error).toBeNull();
  });
});

describe('useAttributeFormPresenter (edit mode)', () => {
  beforeEach(() => { updateFeature.mockReset(); });

  it('seeds values from initialValues and can save without geometry', () => {
    const { result } = renderHook(() => useAttributeFormPresenter({
      layerKey: 'dams', attributes: ['name', 'status'], geometry: null,
      mode: 'edit', featureId: 'f1', initialValues: { name: 'Hoa Binh', status: 'binh_thuong' }, onSaved: vi.fn(),
    }));
    expect(result.current.values).toEqual({ name: 'Hoa Binh', status: 'binh_thuong' });
    expect(result.current.canSave).toBe(true); // no geometry required on edit
  });

  it('submit PUTs non-empty props (+ geometry when present) and calls onSaved', async () => {
    updateFeature.mockResolvedValue({ id: 'f1' });
    const onSaved = vi.fn();
    const geom = { type: 'Point', coordinates: [108, 13] };
    const { result } = renderHook(() => useAttributeFormPresenter({
      layerKey: 'dams', attributes: ['name'], geometry: geom,
      mode: 'edit', featureId: 'f1', initialValues: { name: 'A' }, onSaved,
    }));
    act(() => result.current.setField('name', 'B'));
    await act(async () => { await result.current.submit(); });
    expect(updateFeature).toHaveBeenCalledWith('dams', 'f1', { geometry: geom, properties: { name: 'B' } });
    expect(onSaved).toHaveBeenCalled();
  });

  it('maps STALE_EDIT to the try-again message, ahead of the generic 409', async () => {
    updateFeature.mockRejectedValue(new ApiError(409, 'STALE_EDIT', 'layer changed'));
    const { result } = renderHook(() => useAttributeFormPresenter({
      layerKey: 'dams', attributes: ['name'], geometry: null,
      mode: 'edit', featureId: 'f1', initialValues: { name: 'A' }, onSaved: vi.fn(),
    }));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('Lớp này vừa được người khác thay đổi. Thử lưu lại.');
  });

  it('maps a 404 to a friendly message', async () => {
    updateFeature.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    const { result } = renderHook(() => useAttributeFormPresenter({
      layerKey: 'dams', attributes: ['name'], geometry: null,
      mode: 'edit', featureId: 'f1', initialValues: { name: 'A' }, onSaved: vi.fn(),
    }));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('Đối tượng này không còn nữa.');
  });

  it('asks for a drawing first and reports unknown failures in Vietnamese', async () => {
    const { result } = renderHook(() => useAttributeFormPresenter({ ...baseArgs, geometry: null }));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('Vẽ hình trước khi lưu.');
    createFeature.mockRejectedValue(new Error('boom'));
    const { result: r2 } = renderHook(() => useAttributeFormPresenter(baseArgs));
    await act(async () => { await r2.current.submit(); });
    expect(r2.current.error).toBe('Chưa lưu được. Thử lại.');
  });

  it('maps a 409 to the duplicate message', async () => {
    createFeature.mockRejectedValue(new ApiError(409, 'CONFLICT', 'dupe'));
    const { result } = renderHook(() => useAttributeFormPresenter(baseArgs));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('Đã có đối tượng như thế này.');
  });

  describe('managing unit', () => {
    beforeEach(() => { createFeature.mockReset(); resetToasts(); unit.state = { value: '', submittable: null, error: null, locked: false }; updateFeature.mockReset(); });

    it('a 403 OUT_OF_JURISDICTION shows the server message as the form error', async () => {
      updateFeature.mockRejectedValue(new ApiError(403, 'OUT_OF_JURISDICTION', 'Đối tượng thuộc Đà Nẵng; nhóm của anh/chị chỉ có quyền trong Quảng Ngãi.'));
      const { result } = renderHook(() => useAttributeFormPresenter({
        ...baseArgs, mode: 'edit', featureId: 'f1', geometry: null,
      }));
      await act(async () => { await result.current.submit(); });
      expect(result.current.error).toBe('Đối tượng thuộc Đà Nẵng; nhóm của anh/chị chỉ có quyền trong Quảng Ngãi.');
    });

    it('a 403 refused for submission.review adds a line naming the missing right', async () => {
      updateFeature.mockRejectedValue(new ApiError(403, 'OUT_OF_JURISDICTION', 'Đối tượng thuộc Đà Nẵng; nhóm của anh/chị chỉ có quyền trong Quảng Ngãi.',
        { unit: '48', permission: 'submission.review', allowed: ['51'] }));
      const { result } = renderHook(() => useAttributeFormPresenter({
        ...baseArgs, mode: 'edit', featureId: 'f1', geometry: null,
      }));
      await act(async () => { await result.current.submit(); });
      expect(result.current.error).toBe('Đối tượng thuộc Đà Nẵng; nhóm của anh/chị chỉ có quyền trong Quảng Ngãi.');
      expect(result.current.errorDetail).toBe('Thiếu quyền duyệt và xuất bản.');
    });

    it('edit: a feature whose unit the user may not save locks Lưu', async () => {
      unit.state = { value: '51', submittable: null, error: null, locked: true };
      const { result } = renderHook(() => useAttributeFormPresenter({
        ...baseArgs, attributes: ['name', 'managing_unit'], mode: 'edit', featureId: 'f1', geometry: null,
      }));
      expect(result.current.canSave).toBe(false);
      await act(async () => { await result.current.submit(); });
      expect(updateFeature).not.toHaveBeenCalled();
    });

    it('asks the field for the operation it serves', () => {
      renderHook(() => useAttributeFormPresenter(baseArgs));
      expect(unit.args?.mode).toBe('create');
      renderHook(() => useAttributeFormPresenter({ ...baseArgs, mode: 'edit', featureId: 'f1' }));
      expect(unit.args?.mode).toBe('edit');
    });

    it('a 403 NO_PERMISSION shows the server message', async () => {
      createFeature.mockRejectedValue(new ApiError(403, 'NO_PERMISSION', 'Anh/chị chưa có quyền sửa đối tượng ở đơn vị nào.'));
      const { result } = renderHook(() => useAttributeFormPresenter(baseArgs));
      await act(async () => { await result.current.submit(); });
      expect(result.current.error).toBe('Anh/chị chưa có quyền sửa đối tượng ở đơn vị nào.');
    });

    it('a save with an OUTSIDE_MANAGING_UNIT warning shows the warning toast', async () => {
      createFeature.mockResolvedValue({ id: 'x', warnings: [{ code: 'OUTSIDE_MANAGING_UNIT', message: 'Hình nằm ngoài Đà Nẵng.' }] });
      const { result } = renderHook(() => useAttributeFormPresenter(baseArgs));
      await act(async () => { await result.current.submit(); });
      expect(getToasts()).toEqual([expect.objectContaining({ tone: 'warning', title: 'Hình nằm ngoài Đà Nẵng.' })]);
    });

    it('sends the chosen unit on create', async () => {
      unit.state = { value: '48', submittable: '48', error: null, locked: false };
      createFeature.mockResolvedValue({ id: 'x', warnings: [] });
      const { result } = renderHook(() => useAttributeFormPresenter({ ...baseArgs, attributes: ['name', 'managing_unit'] }));
      await act(async () => { await result.current.submit(); });
      expect(createFeature).toHaveBeenCalledWith('dams', { geometry: baseArgs.geometry, properties: { managing_unit: '48' } });
    });

    it('forwards anyUnit to the managing unit field', () => {
      renderHook(() => useAttributeFormPresenter({ ...baseArgs, anyUnit: true }));
      expect(unit.args?.anyUnit).toBe(true);
      renderHook(() => useAttributeFormPresenter(baseArgs));
      expect(unit.args?.anyUnit).toBeFalsy();
    });

    it('does not submit a unit the user cannot write', async () => {
      unit.state = { value: '51', submittable: null, error: 'Quảng Ngãi nằm ngoài phạm vi của anh/chị — hãy chọn đơn vị khác.', locked: false };
      const { result } = renderHook(() => useAttributeFormPresenter({ ...baseArgs, attributes: ['name', 'managing_unit'] }));
      expect(result.current.canSave).toBe(false);
      await act(async () => { await result.current.submit(); });
      expect(createFeature).not.toHaveBeenCalled();
    });
  });
});

describe('useAttributeFormPresenter with a save dependency', () => {
  beforeEach(() => {
    createFeature.mockReset();
    updateFeature.mockReset();
    resetToasts();
    unit.state = { value: '', submittable: null, error: null, locked: false };
  });

  it('useAttributeFormPresenter without save still calls the official API', async () => {
    createFeature.mockResolvedValue({ id: 'x', warnings: [] });
    updateFeature.mockResolvedValue({ id: 'f1', warnings: [] });
    const { result } = renderHook(() => useAttributeFormPresenter(baseArgs));
    act(() => result.current.setField('name', 'Hoa Binh'));
    await act(async () => { await result.current.submit(); });
    expect(createFeature).toHaveBeenCalledWith('dams', { geometry: baseArgs.geometry, properties: { name: 'Hoa Binh' } });
    const { result: edit } = renderHook(() => useAttributeFormPresenter({
      ...baseArgs, mode: 'edit', featureId: 'f1', geometry: null, initialValues: { name: 'A' },
    }));
    await act(async () => { await edit.current.submit(); });
    expect(updateFeature).toHaveBeenCalledWith('dams', 'f1', { properties: { name: 'A' } });
  });

  it('a save dependency replaces the official create and update, and its warnings are shown', async () => {
    const save = vi.fn().mockResolvedValue({ warnings: [{ code: 'OUTSIDE_MANAGING_UNIT', message: 'Hình nằm ngoài Đà Nẵng.' }] });
    const onSaved = vi.fn();
    const { result } = renderHook(() => useAttributeFormPresenter({ ...baseArgs, onSaved, save }));
    act(() => result.current.setField('name', 'Hoa Binh'));
    await act(async () => { await result.current.submit(); });
    expect(save).toHaveBeenCalledWith({ name: 'Hoa Binh' }, baseArgs.geometry);
    expect(createFeature).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
    expect(getToasts()).toEqual([expect.objectContaining({ tone: 'warning', title: 'Hình nằm ngoài Đà Nẵng.' })]);

    save.mockClear();
    save.mockResolvedValue(undefined);
    const { result: edit } = renderHook(() => useAttributeFormPresenter({
      ...baseArgs, mode: 'edit', featureId: 'f1', geometry: null, initialValues: { name: 'A' }, save,
    }));
    act(() => edit.current.setField('name', 'B'));
    await act(async () => { await edit.current.submit(); });
    expect(save).toHaveBeenCalledWith({ name: 'B' }, null);
    expect(updateFeature).not.toHaveBeenCalled();
  });

  it("a save dependency's own failure shows its message, and the typed values stay", async () => {
    const save = vi.fn().mockRejectedValue(new Error('Bản đồ đã thay đổi ở nơi khác. Đã tải lại bản mới nhất; hãy thử lại.'));
    const onSaved = vi.fn();
    const { result } = renderHook(() => useAttributeFormPresenter({ ...baseArgs, onSaved, save }));
    act(() => result.current.setField('name', 'Hoa Binh'));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('Bản đồ đã thay đổi ở nơi khác. Đã tải lại bản mới nhất; hãy thử lại.');
    expect(result.current.values.name).toBe('Hoa Binh');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('an API error from a save dependency is mapped like the official one', async () => {
    const save = vi.fn().mockRejectedValue(new ApiError(422, 'GEOMETRY_ERROR', 'bad geom'));
    const { result } = renderHook(() => useAttributeFormPresenter({ ...baseArgs, save }));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('Hình vẽ không hợp lệ. Vẽ lại.');
  });
});

describe('useAttributeFormPresenter: the data dictionary', () => {
  beforeEach(() => {
    createFeature.mockReset();
    updateFeature.mockReset().mockResolvedValue({ id: 'r1', warnings: [] });
    resetToasts();
    unit.state = { value: '', submittable: null, error: null, locked: false };
  });

  const river = (initialValues: Record<string, string>, save?: ReturnType<typeof vi.fn>) => ({
    layerKey: 'rivers' as const, attributes: ['name', 'length_m'], geometry: null,
    mode: 'edit' as const, featureId: 'r1', initialValues, onSaved: vi.fn(), save,
  });

  it('form labels come from the dictionary', () => {
    const { result } = renderHook(() => useAttributeFormPresenter({ ...baseArgs, attributes: ['name', 'wattage_mw'] }));
    expect(result.current.labels.wattage_mw).toBe(attributeOf(DICTIONARY, 'dams', 'wattage_mw')!.label);
    expect(result.current.labels.wattage_mw).not.toBe('ratedPower');
  });

  it('a number field shows its display unit', () => {
    const { result } = renderHook(() => useAttributeFormPresenter({
      ...baseArgs, layerKey: 'lakes', attributes: ['name', 'volume_mcm'],
    }));
    expect(result.current.fields.volume_mcm.unitSymbol).toBe('triệu m³');
    expect(result.current.fields.name.unitSymbol).toBeUndefined();
    expect(result.current.fields.name.options).toBeUndefined();
  });

  it('an untouched number field saves its stored value unchanged', async () => {
    const { result } = renderHook(() => useAttributeFormPresenter(river({ name: 'Sông X', length_m: '12345.678' })));
    // Seeded in km at full precision, never rounded to the display precision.
    expect(result.current.values.length_m).toBe('12,345678');
    act(() => result.current.setField('name', 'Sông Y'));
    await act(async () => { await result.current.submit(); });
    expect(updateFeature).toHaveBeenCalledWith('rivers', 'r1', { properties: { name: 'Sông Y', length_m: '12345.678' } });

    // The same through the edit-copy form's save; text typed and put back counts as untouched.
    const save = vi.fn().mockResolvedValue(undefined);
    const { result: copy } = renderHook(() => useAttributeFormPresenter(river({ name: 'Sông X', length_m: '12345.678' }, save)));
    act(() => copy.current.setField('length_m', '12,3'));
    act(() => copy.current.setField('length_m', '12,345678'));
    await act(async () => { await copy.current.submit(); });
    expect(save).toHaveBeenCalledWith({ name: 'Sông X', length_m: '12345.678' }, null);
  });

  it('an edited number field is converted back to the stored unit', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAttributeFormPresenter(river({ name: 'Sông X', length_m: '12345.678' })));
    act(() => result.current.setField('length_m', '12,5'));
    await act(async () => { await result.current.submit(); });
    expect(updateFeature).toHaveBeenCalledWith('rivers', 'r1', { properties: { name: 'Sông X', length_m: 12500 } });

    const { result: copy } = renderHook(() => useAttributeFormPresenter(river({ name: 'Sông X', length_m: '' }, save)));
    act(() => copy.current.setField('length_m', '1.250,5'));
    await act(async () => { await copy.current.submit(); });
    expect(save).toHaveBeenCalledWith({ name: 'Sông X', length_m: 1250500 }, null);
  });

  it('an unreadable number blocks the save with the field message', async () => {
    const save = vi.fn();
    const onSaved = vi.fn();
    const { result } = renderHook(() => useAttributeFormPresenter({
      ...river({ name: 'Sông X', length_m: '12345.678' }, save), onSaved,
    }));
    act(() => result.current.setField('length_m', '12.5'));
    await act(async () => { await result.current.submit(); });
    const lengthM = attributeOf(DICTIONARY, 'rivers', 'length_m')!;
    const refusal = parseDisplay(lengthM, '12.5');
    expect(refusal.ok).toBe(false);
    expect(result.current.fieldErrors.length_m).toBe(refusal.ok ? '' : refusal.message);
    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(updateFeature).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(result.current.values.length_m).toBe('12.5');
  });

  it('a code field is a select of value names', async () => {
    const { result } = renderHook(() => useAttributeFormPresenter({
      ...baseArgs, mode: 'edit', featureId: 'f1', geometry: null, initialValues: { name: 'A', status: 'binh_thuong' },
    }));
    expect(result.current.fields.status.options).toEqual([
      { value: 'binh_thuong', label: 'Bình thường' },
      { value: 'xa_lu', label: 'Xả lũ' },
      { value: 'nguy_hiem', label: 'Nguy hiểm' },
    ]);
    expect(result.current.values.status).toBe('binh_thuong');
    act(() => result.current.setField('status', 'xa_lu'));
    updateFeature.mockResolvedValue({ id: 'f1' });
    await act(async () => { await result.current.submit(); });
    // The stored code is what is sent.
    expect(updateFeature).toHaveBeenCalledWith('dams', 'f1', { properties: { name: 'A', status: 'xa_lu' } });
  });

  it('an unknown code keeps its option in the form select', () => {
    const { result } = renderHook(() => useAttributeFormPresenter({
      ...baseArgs, mode: 'edit', featureId: 'f1', geometry: null, initialValues: { name: 'A', status: 'dang_xay' },
    }));
    expect(result.current.values.status).toBe('dang_xay');
    expect(result.current.fields.status.options).toContainEqual({ value: 'dang_xay', label: 'dang_xay' });
    expect(result.current.fields.status.options).toHaveLength(4);
  });

  it('the managing unit keeps its own field: no options, no unit, sent only when changed', async () => {
    unit.state = { value: '48', submittable: '48', error: null, locked: false };
    const { result } = renderHook(() => useAttributeFormPresenter({
      ...baseArgs, attributes: ['name', 'managing_unit'], mode: 'edit', featureId: 'f1', geometry: null,
      initialValues: { name: 'A', managing_unit: '48' },
    }));
    expect(result.current.fields.managing_unit).toEqual({});
    updateFeature.mockResolvedValue({ id: 'f1' });
    await act(async () => { await result.current.submit(); });
    expect(updateFeature).toHaveBeenCalledWith('dams', 'f1', { properties: { name: 'A' } });
  });
});
