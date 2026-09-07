import { describe, it, expect } from 'vitest';
import { KNOWLEDGE_OPEN_TAG, KNOWLEDGE_CLOSE_TAG, type MapContext } from '@webatlas/shared';
import { SYSTEM_PROMPT, formatMapContext } from './prompt';

const MAP_CONTEXT: MapContext = {
  bbox: [107.5, 12.0, 109.0, 13.5],
  zoom: 9.25,
  visibleLayerStateIds: ['layer_dams', 'layer_rivers'],
  basemap: 'street',
};

describe('SYSTEM_PROMPT', () => {
  it('names both knowledge tags so the model can produce parseable output', () => {
    expect(SYSTEM_PROMPT).toContain(KNOWLEDGE_OPEN_TAG);
    expect(SYSTEM_PROMPT).toContain(KNOWLEDGE_CLOSE_TAG);
  });

  it('instructs the model to report missing data rather than fill the gap', () => {
    expect(SYSTEM_PROMPT).toContain('Không có dữ liệu');
  });

  it('is stable across calls — a varying prefix would miss the cache every turn', () => {
    expect(SYSTEM_PROMPT).toBe(SYSTEM_PROMPT);
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe('formatMapContext', () => {
  it('includes the viewport, zoom, visible layers and basemap', () => {
    const text = formatMapContext(MAP_CONTEXT);
    expect(text).toContain('107.5');
    expect(text).toContain('13.5');
    expect(text).toContain('9.25');
    expect(text).toContain('layer_dams');
    expect(text).toContain('street');
  });

  it('says so explicitly when no layer is visible', () => {
    expect(formatMapContext({ ...MAP_CONTEXT, visibleLayerStateIds: [] })).toContain('không có lớp nào');
  });

  it('includes the selected feature when there is one', () => {
    const text = formatMapContext({
      ...MAP_CONTEXT,
      selectedFeature: { layerKey: 'dams', featureId: 'abc', name: 'Đập Buôn Kuốp' },
    });
    expect(text).toContain('Đập Buôn Kuốp');
    expect(text).toContain('abc');
  });

  it('omits the selection line entirely when nothing is selected', () => {
    expect(formatMapContext(MAP_CONTEXT)).not.toContain('Đối tượng đang chọn');
  });
});
