import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '../../../shared/api/apiClient';

const getCatalogueItem = vi.fn();
vi.mock('../api/catalogue.api', () => ({ getCatalogueItem: (...a: unknown[]) => getCatalogueItem(...a) }));

import {
  addCatalogueLayer, getCatalogue, refreshCatalogueLayers, removeCatalogueLayer, resetCatalogue, setCatalogueLayer,
} from './catalogue.store';
import type { CatalogueItem } from '../api/catalogue.api';

const item = (id: string, over: Partial<CatalogueItem> = {}): CatalogueItem => ({
  id, kind: 'vector', title: `Lớp ${id}`, abstract: '', managingUnit: null, isPublished: true, mine: false,
  variable: null, unit: null, timeSteps: null, bbox4326: null, layerName: `geonode:${id}`, ...over,
});

describe('catalogue.store', () => {
  beforeEach(() => { resetCatalogue(); getCatalogueItem.mockReset(); });

  it('adding the same item twice keeps one layer', () => {
    addCatalogueLayer(item('a'));
    addCatalogueLayer(item('a'));
    expect(getCatalogue()).toHaveLength(1);
    expect(getCatalogue()[0]).toMatchObject({ visible: true, opacity: 1, status: 'ok' });
  });

  it('patches and removes a layer', () => {
    addCatalogueLayer(item('a'));
    addCatalogueLayer(item('b'));
    setCatalogueLayer('a', { visible: false, opacity: 0.4 });
    expect(getCatalogue()[0]).toMatchObject({ visible: false, opacity: 0.4 });
    removeCatalogueLayer('a');
    expect(getCatalogue().map((l) => l.item.id)).toEqual(['b']);
  });

  it('a 404 on refresh marks the layer gone; other layers are refreshed', async () => {
    addCatalogueLayer(item('a'));
    addCatalogueLayer(item('b'));
    getCatalogueItem.mockImplementation(async (id: string) => {
      if (id === 'a') throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy dữ liệu trong Danh mục.');
      return item('b', { title: 'Mới' });
    });
    await refreshCatalogueLayers();
    const [a, b] = getCatalogue();
    expect(a.status).toBe('gone');
    expect(b.status).toBe('ok');
    expect(b.item.title).toBe('Mới');
  });

  it('a network failure on refresh leaves the layer as it was', async () => {
    addCatalogueLayer(item('a'));
    getCatalogueItem.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'x'));
    await refreshCatalogueLayers();
    expect(getCatalogue()[0].status).toBe('ok');
  });
});
