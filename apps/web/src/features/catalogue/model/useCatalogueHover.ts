import { useEffect } from 'react';
import type Map from 'ol/Map';
import type { MapBrowserEvent } from 'ol';
import Overlay from 'ol/Overlay';
import type ImageLayer from 'ol/layer/Image';
import type ImageWMS from 'ol/source/ImageWMS';
import { fetchCatalogueJson } from '../api/catalogue.api';
import { formatStepLocal } from '../../time-slider/model/timeSteps';
import { getCatalogue } from './catalogue.store';
import { CATALOGUE_LAYER_PROP } from './catalogueLayers';

const REST_MS = 300;
/** Raster nodata is written as -9999; anything this low is no value. */
const NODATA_BELOW = -9990;

/** `0.3049, 'm'` -> `0,30 m`: Vietnamese decimal comma, two decimals for a depth in metres. */
export function formatHoverValue(value: number, unit: string | null): string {
  const digits = unit === 'm' ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 };
  const n = value.toLocaleString('vi-VN', digits);
  return unit ? `${n} ${unit}` : n;
}

interface FeatureInfo { features?: { properties?: Record<string, unknown> | null }[] }

/** The tooltip text from a GetFeatureInfo JSON body, or null for nodata / an empty answer. */
export function hoverText(info: FeatureInfo, unit: string | null, step: string): string | null {
  const props = info.features?.[0]?.properties;
  if (!props) return null;
  for (const raw of Object.values(props)) {
    const v = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(v) || v < NODATA_BELOW) continue;
    return `${formatHoverValue(v, unit)} · ${formatStepLocal(step)}`;
  }
  return null;
}

/** The topmost visible time-series layer that currently has a TIME. */
function topSeriesLayer(map: Map): { layer: ImageLayer<ImageWMS>; unit: string | null } | null {
  const store = getCatalogue();
  const found = map.getLayers().getArray()
    .filter((l) => typeof l.get(CATALOGUE_LAYER_PROP) === 'string' && l.getVisible())
    .sort((a, b) => (b.getZIndex() ?? 0) - (a.getZIndex() ?? 0));
  for (const l of found) {
    const entry = store.find((c) => c.item.id === l.get(CATALOGUE_LAYER_PROP));
    if (!entry || entry.status !== 'ok' || !entry.visible || entry.item.kind !== 'timeseries') continue;
    const layer = l as ImageLayer<ImageWMS>;
    if (!layer.getSource()?.getParams().TIME) continue;
    return { layer, unit: entry.item.unit };
  }
  return null;
}

/**
 * A small label by the cursor with the value of the topmost visible time-series layer, asked
 * after the pointer rests 300 ms (GetFeatureInfo as JSON, through the authorised proxy).
 * Returns a function that removes the hover.
 */
export function attachCatalogueHover(map: Map): () => void {
  const el = document.createElement('div');
  el.className = 'catalogue-hover-tip';
  el.hidden = true;
  const overlay = new Overlay({ element: el, offset: [14, 14], positioning: 'top-left', stopEvent: false });
  map.addOverlay(overlay);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const cancel = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    controller?.abort();
    controller = null;
    el.hidden = true;
  };

  const ask = (coordinate: number[]) => {
    const top = topSeriesLayer(map);
    const view = map.getView();
    const resolution = view.getResolution();
    if (!top || resolution === undefined) return;
    const source = top.layer.getSource()!;
    const step = String(source.getParams().TIME);
    const url = source.getFeatureInfoUrl(coordinate, resolution, view.getProjection(), { INFO_FORMAT: 'application/json' });
    if (!url) return;
    const mine = new AbortController();
    controller = mine;
    fetchCatalogueJson<FeatureInfo>(url, mine.signal).then(
      (info) => {
        if (mine.signal.aborted) return;
        const text = hoverText(info, top.unit, step);
        if (text === null) { el.hidden = true; return; }
        el.textContent = text;
        el.hidden = false;
        overlay.setPosition(coordinate);
      },
      () => { if (!mine.signal.aborted) el.hidden = true; },
    );
  };

  const onMove = (e: MapBrowserEvent) => {
    cancel();
    if (e.dragging) return;
    const coordinate = e.coordinate;
    timer = setTimeout(() => { timer = null; ask(coordinate); }, REST_MS);
  };
  map.on('pointermove', onMove);
  const viewport = map.getViewport();
  viewport.addEventListener('mouseleave', cancel);

  return () => {
    cancel();
    map.un('pointermove', onMove);
    viewport.removeEventListener('mouseleave', cancel);
    map.removeOverlay(overlay);
  };
}

/** Hover values for the catalogue's time-series layers while the pointer rests on the map. */
export function useCatalogueHover(map: Map | null): void {
  useEffect(() => {
    if (!map) return;
    return attachCatalogueHover(map);
  }, [map]);
}
