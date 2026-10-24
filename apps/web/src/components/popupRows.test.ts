import { describe, it, expect } from 'vitest';
import { DICTIONARY } from '@webatlas/shared';
import { popupHas, popupLabel, popupValue } from './popupRows';

describe('popupRows', () => {
  it('reads the ISO property of a column and shows the display unit', () => {
    expect(popupValue(DICTIONARY, 'dams', 'wattage_mw', { ratedPower: 40 })).toBe('40 MW');
    expect(popupValue(DICTIONARY, 'rivers', 'length_m', { length: 12500 })).toBe('12,5 km');
  });
  it('labels come from the dictionary', () => {
    expect(popupLabel(DICTIONARY, 'dams', 'wattage_mw')).toBe('Công suất');
  });
  it('an unknown code is shown as the code', () => {
    expect(popupValue(DICTIONARY, 'dams', 'status', { operationalStatus: 'moi' })).toBe('moi');
  });
  it('reports a missing value', () => {
    expect(popupHas('lakes', 'volume_mcm', { volume: null })).toBe(false);
    expect(popupHas('lakes', 'volume_mcm', { volume: 0 })).toBe(true);
    expect(popupValue(DICTIONARY, 'lakes', 'volume_mcm', {})).toBe('—');
  });
});
