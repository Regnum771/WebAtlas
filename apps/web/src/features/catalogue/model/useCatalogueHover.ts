import { useEffect, useRef } from 'react';
import { useTimeSlider } from '../../time-slider/model/timeSlider.store';
import type Map from 'ol/Map';
import type { MapBrowserEvent } from 'ol';
import Overlay from 'ol/Overlay';
import type ImageLayer from 'ol/layer/Image';
import type ImageWMS from 'ol/source/ImageWMS';
import { fetchCatalogueJson, type CatalogueItem } from '../api/catalogue.api';
import { formatStepLocal } from '../../time-slider/model/timeSteps';
import { getCatalogue, useCatalogueStore } from './catalogue.store';
import { CATALOGUE_ITEM_PROP, CATALOGUE_LAYER_PROP } from './catalogueLayers';

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

/**
 * The topmost visible time-series layer that currently has a TIME, of either scope: the
 * free-standing catalogue layers and the personal maps' catalogue links (catalogueLayers.ts
 * CatalogueLayerScope). Both carry the entry they show (CATALOGUE_ITEM_PROP); a free-standing
 * layer must also still be ok and visible in its store, which may run ahead of the next sync.
 */
function topSeriesLayer(map: Map): { layer: ImageLayer<ImageWMS>; unit: string | null } | null {
  const store = getCatalogue();
  const found = map.getLayers().getArray()
    .filter((l) => l.get(CATALOGUE_ITEM_PROP) !== undefined && l.getVisible())
    .sort((a, b) => (b.getZIndex() ?? 0) - (a.getZIndex() ?? 0));
  for (const l of found) {
    const item = l.get(CATALOGUE_ITEM_PROP) as CatalogueItem;
    if (item.kind !== 'timeseries') continue;
    const freeId = l.get(CATALOGUE_LAYER_PROP);
    if (typeof freeId === 'string') {
      const entry = store.find((c) => c.item.id === freeId);
      if (!entry || entry.status !== 'ok' || !entry.visible) continue;
    }
    const layer = l as ImageLayer<ImageWMS>;
    if (!layer.getSource()?.getParams().TIME) continue;
    return { layer, unit: item.unit };
  }
  return null;
}

/**
 * A small label by the cursor with the value of the topmost visible time-series layer (a
 * free-standing catalogue layer or a personal map's catalogue link), asked
 * after the pointer rests 300 ms (GetFeatureInfo as JSON, through the authorised proxy).
 * Returns a function that removes the hover.
 */
export function attachCatalogueHover(map: Map): { hide: () => void; remove: () => void } {
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
  // A layer leaving the map (a personal link hidden or its map collapsed, a layer removed) may be
  // the one the label is about.
  const layers = map.getLayers();
  layers.on('remove', cancel);

  const remove = () => {
    cancel();
    map.un('pointermove', onMove);
    layers.un('remove', cancel);
    viewport.removeEventListener('mouseleave', cancel);
    map.removeOverlay(overlay);
  };
  return { hide: cancel, remove };
}

/**
 * Hover values for the catalogue's time-series layers while the pointer rests on the map. The
 * label goes away when the slider time or the catalogue layers change (a layer toggled off or removed).
 */
export function useCatalogueHover(map: Map | null): void {
  const layers = useCatalogueStore();
  const { time } = useTimeSlider();
  const handle = useRef<ReturnType<typeof attachCatalogueHover> | null>(null);
  useEffect(() => {
    if (!map) return;
    handle.current = attachCatalogueHover(map);
    return () => { handle.current?.remove(); handle.current = null; };
  }, [map]);
  useEffect(() => { handle.current?.hide(); }, [layers, time]);
}
