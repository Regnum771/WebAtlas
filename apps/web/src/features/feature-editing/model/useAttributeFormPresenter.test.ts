import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const createFeature = vi.fn();
const updateFeature = vi.fn();
vi.mock('../api/features.api', () => ({
  createFeature: (...a: unknown[]) => createFeature(...a),
  updateFeature: (...a: unknown[]) => updateFeature(...a),
}));
import { ApiError } from '../../../shared/api/apiClient';
import { useAttributeFormPresenter } from './useAttributeFormPresenter';

const baseArgs = {
  layerKey: 'dams' as const,
  attributes: ['name', 'status'],
  geometry: { type: 'Point', coordinates: [108, 13] },
  onSaved: vi.fn(),
};

describe('useAttributeFormPresenter', () => {
  beforeEach(() => { createFeature.mockReset(); baseArgs.onSaved = vi.fn(); });

  it('exposes ISO labels for DB columns and empty initial values', () => {
    const { result } = renderHook(() => useAttributeFormPresenter(baseArgs));
    expect(result.current.labels.name).toBe('geographicalName');
    expect(result.current.labels.status).toBe('operationalStatus');
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
    expect(result.current.error).toBe('Invalid geometry — please redraw');
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

  it('maps a 404 to a friendly message', async () => {
    updateFeature.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    const { result } = renderHook(() => useAttributeFormPresenter({
      layerKey: 'dams', attributes: ['name'], geometry: null,
      mode: 'edit', featureId: 'f1', initialValues: { name: 'A' }, onSaved: vi.fn(),
    }));
    await act(async () => { await result.current.submit(); });
    expect(result.current.error).toBe('This feature no longer exists');
  });
});
