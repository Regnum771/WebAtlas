import { describe, it, expect, beforeEach } from 'vitest';
import {
  getMyMaps, layerView, toggleExpanded, setLayerVisible, setLayerOpacity, forgetMap, toggleCollapsed, resetMyMapsStore,
  setPersonalEditing, setTruncated,
} from './myMaps.store';

beforeEach(() => resetMyMapsStore());

describe('myMaps.store', () => {
  it('a layer seen for the first time is visible at full opacity', () => {
    expect(layerView('l1')).toEqual({ visible: true, opacity: 1 });
  });
  it('keeps visibility and opacity apart, per layer', () => {
    setLayerVisible('l1', false);
    setLayerOpacity('l1', 0.4);
    expect(layerView('l1')).toEqual({ visible: false, opacity: 0.4 });
    expect(layerView('l2')).toEqual({ visible: true, opacity: 1 });
  });
  it('toggles expansion and the section, which starts open', () => {
    expect(getMyMaps().collapsed).toBe(false);
    toggleExpanded('m1');
    expect(getMyMaps().expanded.has('m1')).toBe(true);
    toggleExpanded('m1');
    expect(getMyMaps().expanded.has('m1')).toBe(false);
    toggleCollapsed();
    expect(getMyMaps().collapsed).toBe(true);
  });
  it('forgetMap drops the card and its layers', () => {
    toggleExpanded('m1');
    setLayerVisible('l1', false);
    forgetMap('m1', ['l1']);
    expect(getMyMaps().expanded.has('m1')).toBe(false);
    expect(layerView('l1').visible).toBe(true);
  });
  it('personalEditing starts false and follows its setter', () => {
    expect(getMyMaps().personalEditing).toBe(false);
    setPersonalEditing(true);
    expect(getMyMaps().personalEditing).toBe(true);
  });
  it('keeps a truncation count per layer; null clears it, and a repeat publishes nothing', () => {
    setTruncated('l1', 5000);
    const before = getMyMaps();
    setTruncated('l1', 5000);
    expect(getMyMaps()).toBe(before);
    expect(getMyMaps().truncated).toEqual({ l1: 5000 });
    setTruncated('l1', null);
    expect(getMyMaps().truncated).toEqual({});
  });
});
