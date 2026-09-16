import { describe, it, expect } from 'vitest';
import { basemapInfoUrl, pickBasemapFeature, BASEMAP_INFO_LAYERS } from './basemapInfo';

const VIEW = {
  extent: [11_911_186, 1_164_133, 11_912_409, 1_165_356] as [number, number, number, number],
  size: [256, 256] as [number, number],
  pixel: [128, 128] as [number, number],
};

describe('basemapInfoUrl', () => {
  const url = () => new URL(basemapInfoUrl(VIEW.extent, VIEW.size, VIEW.pixel));

  it('asks GeoServer for JSON so the caller does not parse HTML', () => {
    expect(url().searchParams.get('INFO_FORMAT')).toBe('application/json');
  });

  it('queries the basemap vector layers, not the cached tile group', () => {
    // The layer group renders as raster; GetFeatureInfo has to name the real
    // feature types or it returns nothing useful.
    const layers = url().searchParams.get('QUERY_LAYERS');
    expect(layers).toBe(BASEMAP_INFO_LAYERS.join(','));
    expect(layers).toContain('roads_region');
  });

  it('passes the clicked pixel and the matching viewport, so the hit lands where the user clicked', () => {
    const p = url().searchParams;
    expect(p.get('I')).toBe('128');
    expect(p.get('J')).toBe('128');
    expect(p.get('WIDTH')).toBe('256');
    expect(p.get('HEIGHT')).toBe('256');
    expect(p.get('BBOX')).toBe('11911186,1164133,11912409,1165356');
    expect(p.get('CRS')).toBe('EPSG:3857');
  });

  it('uses a click tolerance, because hitting a 2px line exactly is not realistic', () => {
    expect(Number(url().searchParams.get('BUFFER'))).toBeGreaterThan(0);
  });

  it('rounds the pixel — GeoServer rejects fractional I/J', () => {
    const p = new URL(basemapInfoUrl(VIEW.extent, VIEW.size, [10.7, 20.2])).searchParams;
    expect(p.get('I')).toBe('11');
    expect(p.get('J')).toBe('20');
  });
});

describe('pickBasemapFeature', () => {
  const road = (props: Record<string, unknown>) => ({ properties: props });

  it('returns null when nothing was hit', () => {
    expect(pickBasemapFeature({ features: [] })).toBeNull();
    expect(pickBasemapFeature({})).toBeNull();
  });

  it('prefers a named feature over an unnamed one', () => {
    // Clicking a junction returns several ways; the one with a name is the one
    // the user can actually act on.
    const picked = pickBasemapFeature({
      features: [road({ fclass: 'residential', name: null }), road({ fclass: 'primary', name: 'Quốc lộ 14' })],
    });
    expect(picked?.name).toBe('Quốc lộ 14');
  });

  it('falls back to the first feature when none is named', () => {
    const picked = pickBasemapFeature({ features: [road({ fclass: 'track', name: null })] });
    expect(picked?.fclass).toBe('track');
    expect(picked?.name).toBeNull();
  });

  it('keeps the attributes worth showing and drops the noise', () => {
    const picked = pickBasemapFeature({
      features: [road({ fclass: 'primary', name: 'Lê Duẩn', ref: 'QL14', oneway: 'B', maxspeed: 60, osm_id: '123', code: 5112 })],
    });
    expect(picked).toMatchObject({ name: 'Lê Duẩn', fclass: 'primary', ref: 'QL14', maxspeed: 60 });
    // osm_id and code are internal identifiers, not information for a reader.
    expect(picked).not.toHaveProperty('osm_id');
    expect(picked).not.toHaveProperty('code');
  });

  it('drops a zero maxspeed — OSM uses 0 for "not recorded", not for a 0 km/h limit', () => {
    const picked = pickBasemapFeature({ features: [road({ fclass: 'residential', name: 'X', maxspeed: 0 })] });
    expect(picked?.maxspeed).toBeUndefined();
  });
});
