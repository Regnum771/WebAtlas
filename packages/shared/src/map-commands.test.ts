import { describe, it, expect } from 'vitest';
import { isMapCommand, MAP_COMMAND_KINDS, type MapCommand } from './map-commands.js';

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
      'setBasemap',
      'setLayerOpacity',
      'setLayerVisible',
      'zoomToFeature',
      'zoomToRegion',
    ]);
  });
});
