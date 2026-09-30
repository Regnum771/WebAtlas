import { describe, it, expect } from 'vitest';
import type { Roi } from '@webatlas/shared';
import { DEFAULT_PARAMS, buildInput } from './tools';

const roi: Roi = { source: 'admin', level: 'province', code: '66' };

describe('buildInput', () => {
  it('sends the ROI as it is, with each tool’s own parameters', () => {
    expect(buildInput('select_within', DEFAULT_PARAMS, roi)).toEqual({ roi, layerKeys: ['dams'] });
    expect(buildInput('nearest', DEFAULT_PARAMS, roi)).toEqual({ roi, layerKey: 'dams', k: 5 });
    expect(buildInput('elevation_profile', DEFAULT_PARAMS, roi)).toEqual({ roi, samples: 100 });
    expect(buildInput('zonal_elevation', DEFAULT_PARAMS, roi)).toEqual({ roi });
  });
});
