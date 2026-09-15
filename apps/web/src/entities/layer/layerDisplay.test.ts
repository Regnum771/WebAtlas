import { describe, it, expect } from 'vitest';
import { LAYER_STATE_IDS, TERRAIN_LAYER_STATE_IDS } from '@webatlas/shared';
import { LAYER_DISPLAY } from './layerDisplay';

describe('LAYER_DISPLAY', () => {
  // LAYER_DISPLAY's keys and the shared LAYER_STATE_IDS set are two
  // hand-maintained lists that must describe the same set of layers. This
  // guards against exactly the drift the codebase has already been bitten by
  // (terrain/dem, legend colours): if someone adds/removes a layer on one
  // side and forgets the other, this test fails instead of the mismatch
  // surfacing later as "unknown layer id" or a silently-missing panel row.
  it('has exactly the same keys as the shared LAYER_STATE_IDS set', () => {
    expect(Object.keys(LAYER_DISPLAY).sort()).toEqual([...LAYER_STATE_IDS].sort());
  });

  it('puts contours in their own terrain group, read from the shared constant', () => {
    const [CONTOURS] = TERRAIN_LAYER_STATE_IDS;
    expect(LAYER_DISPLAY[CONTOURS]).toMatchObject({ group: 'Địa hình', defaultVisible: false });
  });
});
