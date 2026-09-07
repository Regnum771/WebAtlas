import { describe, it, expect } from 'vitest';
import {
  isMapCommand,
  MAP_COMMAND_KINDS,
  LAYER_STATE_IDS,
  ADMIN_BOUNDARY_LAYER_STATE_IDS,
  BASEMAP_CONTEXT_LAYER_STATE_IDS,
  MAX_HIGHLIGHT_POINTS,
  type MapCommand,
} from './map-commands.js';
import { LAYER_ATTRIBUTE_MAP } from './layer-attributes.js';

describe('isMapCommand', () => {
  it('accepts a well-formed zoomToRegion command', () => {
    const cmd: MapCommand = { kind: 'zoomToRegion', provinceCode: '66' };
    expect(isMapCommand(cmd)).toBe(true);
  });

  it('accepts a well-formed zoomToFeature command', () => {
    const cmd: MapCommand = {
      kind: 'zoomToFeature',
      layerKey: 'dams',
      featureId: 'abc',
      lonLat: [108.1, 12.7],
    };
    expect(isMapCommand(cmd)).toBe(true);
  });

  it('rejects an unknown kind', () => {
    expect(isMapCommand({ kind: 'launchMissile' })).toBe(false);
  });

  it('rejects a province code outside the working region', () => {
    expect(isMapCommand({ kind: 'zoomToRegion', provinceCode: '01' })).toBe(false);
  });

  it('rejects lonLat that is not a two-number tuple', () => {
    expect(
      isMapCommand({ kind: 'zoomToFeature', layerKey: 'dams', featureId: 'a', lonLat: [108.1] })
    ).toBe(false);
  });

  it('accepts a well-formed resetView command (no payload to validate)', () => {
    const cmd: MapCommand = { kind: 'resetView' };
    expect(isMapCommand(cmd)).toBe(true);
  });

  it('accepts a well-formed zoomTo command', () => {
    const cmd: MapCommand = { kind: 'zoomTo', zoom: 9.5 };
    expect(isMapCommand(cmd)).toBe(true);
  });

  it('rejects zoomTo with a non-finite zoom (NaN)', () => {
    expect(isMapCommand({ kind: 'zoomTo', zoom: NaN })).toBe(false);
  });

  it('rejects zoomTo with a non-finite zoom (Infinity)', () => {
    expect(isMapCommand({ kind: 'zoomTo', zoom: Infinity })).toBe(false);
  });

  it('rejects zoomTo with a non-number zoom', () => {
    expect(isMapCommand({ kind: 'zoomTo', zoom: '9' })).toBe(false);
  });

  it('rejects opacity outside 0..1', () => {
    expect(isMapCommand({ kind: 'setLayerOpacity', layerStateId: 'layer_dams', opacity: 1.5 })).toBe(false);
  });

  it('accepts a well-formed setBasemap command with dem', () => {
    expect(isMapCommand({ kind: 'setBasemap', basemap: 'dem' })).toBe(true);
  });

  it('rejects an invalid basemap type (terrain)', () => {
    expect(isMapCommand({ kind: 'setBasemap', basemap: 'terrain' })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isMapCommand(null)).toBe(false);
    expect(isMapCommand('zoomToRegion')).toBe(false);
  });

  it('lists every kind in MAP_COMMAND_KINDS', () => {
    expect([...MAP_COMMAND_KINDS].sort()).toEqual([
      'clearHighlights',
      'highlightFeatures',
      'resetView',
      'setBasemap',
      'setLayerOpacity',
      'setLayerVisible',
      'zoomTo',
      'zoomToFeature',
      'zoomToRegion',
    ]);
  });

  it('accepts setLayerVisible with a known layerStateId', () => {
    expect(isMapCommand({ kind: 'setLayerVisible', layerStateId: 'layer_dams', visible: true })).toBe(true);
  });

  it('rejects setLayerVisible with an unknown layerStateId (assistant hallucination)', () => {
    expect(isMapCommand({ kind: 'setLayerVisible', layerStateId: 'bogus', visible: true })).toBe(false);
  });

  it('accepts setLayerOpacity with a known layerStateId', () => {
    expect(isMapCommand({ kind: 'setLayerOpacity', layerStateId: 'layer_rivers', opacity: 0.5 })).toBe(true);
  });

  it('rejects setLayerOpacity with an unknown layerStateId', () => {
    expect(isMapCommand({ kind: 'setLayerOpacity', layerStateId: 'bogus', opacity: 0.5 })).toBe(false);
  });

  it('accepts every editable layer id and the client-only administrative boundary ids', () => {
    for (const id of ['layer_dams', 'layer_rivers', 'layer_lakes', 'layer_stations', 'layer_flood',
      'layer_drought_survey', 'layer_saltwater_intrusion', 'layer_flood_generation',
      'layer_provinces_2026', 'layer_wards_2026']) {
      expect(isMapCommand({ kind: 'setLayerVisible', layerStateId: id, visible: true })).toBe(true);
    }
  });
});

describe('LAYER_STATE_IDS', () => {
  it('is derived from LAYER_ATTRIBUTE_MAP plus the admin-boundary and basemap-context ids, not a hand-typed list', () => {
    const expected = [
      ...Object.values(LAYER_ATTRIBUTE_MAP).map((info) => info.layerStateId),
      ...ADMIN_BOUNDARY_LAYER_STATE_IDS,
      ...BASEMAP_CONTEXT_LAYER_STATE_IDS,
    ];
    expect([...LAYER_STATE_IDS].sort()).toEqual([...expected].sort());
  });

  it('accepts a basemap context layer as a command target', () => {
    // The basemap context layers are deliberately commandable: an assistant
    // should be able to turn the roads off, not just the thematic layers.
    expect(isMapCommand({ kind: 'setLayerVisible', layerStateId: 'layer_bm_roads', visible: false })).toBe(true);
    expect(isMapCommand({ kind: 'setLayerOpacity', layerStateId: 'layer_bm_landuse', opacity: 0.5 })).toBe(true);
  });

  it('contains no duplicates', () => {
    expect(new Set(LAYER_STATE_IDS).size).toBe(LAYER_STATE_IDS.length);
  });
});

describe('isMapCommand — highlight variants', () => {
  it('accepts a highlightFeatures command with labelled points', () => {
    expect(
      isMapCommand({
        kind: 'highlightFeatures',
        points: [{ lonLat: [108.1, 12.7], label: 'Đập Buôn Kuốp' }, { lonLat: [108.3, 12.9] }],
      })
    ).toBe(true);
  });

  it('accepts clearHighlights', () => {
    expect(isMapCommand({ kind: 'clearHighlights' })).toBe(true);
  });

  it('rejects highlightFeatures with an empty points array', () => {
    expect(isMapCommand({ kind: 'highlightFeatures', points: [] })).toBe(false);
  });

  it('rejects more points than MAX_HIGHLIGHT_POINTS', () => {
    const points = Array.from({ length: MAX_HIGHLIGHT_POINTS + 1 }, () => ({ lonLat: [108, 12] }));
    expect(isMapCommand({ kind: 'highlightFeatures', points })).toBe(false);
  });

  it('rejects a point whose lonLat is malformed', () => {
    expect(isMapCommand({ kind: 'highlightFeatures', points: [{ lonLat: [108] }] })).toBe(false);
  });

  it('rejects a non-string label', () => {
    expect(isMapCommand({ kind: 'highlightFeatures', points: [{ lonLat: [108, 12], label: 7 }] })).toBe(false);
  });
});
