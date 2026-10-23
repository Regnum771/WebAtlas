import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMapContext } from '../../../app/providers/MapProvider';
import { drawingJustEnded, isDrawing } from '../../map/model/drawingState';
import { useMapEditing } from '../../map/model/mapEditing';
import type { DrawnRoiGeometry } from '@webatlas/shared';
import { setRoi } from '../../roi/model/roi.store';
import type { MapDetail, PersonalFeature } from '../api/workspace.api';
import { getMyMaps, useMyMapsStore } from './myMaps.store';
import { personalFeatureAt } from './personalLayers';
import { keys } from './queries';

export interface PersonalCardRow { key: string; value: string }
export interface PersonalCardData {
  mapId: string;
  layerId: string;
  /** The layer's title. */
  title: string;
  rows: PersonalCardRow[];
  feature: PersonalFeature;
}

/** A property value as the card shows it: a missing value is a dash. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** The geometry types a drawn ROI accepts; multi-part geometries are not. */
const ROI_GEOMETRY_TYPES = new Set(['Point', 'LineString', 'Polygon']);

interface MapClick { pixel: number[]; coordinate: number[] }

/**
 * The card of a clicked personal feature. A click that hits no personal feature closes it; a
 * click while a drawing or an edit mode (official or personal) holds the map opens nothing, as
 * DynamicPopup does for the official popup.
 */
export function usePersonalPopupPresenter() {
  const { map } = useMapContext();
  const { editing } = useMapEditing();
  const qc = useQueryClient();
  const [open, setOpen] = useState<{ card: PersonalCardData; coordinate: number[] } | null>(null);
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  // Read at click time, so a change of mode does not re-subscribe the handler.
  const editingRef = useRef(editing);
  useEffect(() => { editingRef.current = editing; }, [editing]);

  useEffect(() => {
    if (!map) return;
    const toWindow = (px: number[]): [number, number] => {
      const origin = map.getTargetElement().getBoundingClientRect();
      return [px[0] + origin.left, px[1] + origin.top];
    };
    const onClick = (e: MapClick) => {
      if (editingRef.current || getMyMaps().personalEditing || isDrawing() || drawingJustEnded()) return;
      const hit = personalFeatureAt(map, e.pixel);
      if (!hit) {
        setOpen(null);
        return;
      }
      const detail = qc.getQueryData<MapDetail>(keys.map(hit.mapId));
      const title = detail?.layers.find((l) => l.id === hit.layerId)?.title ?? '';
      const rows = Object.entries(hit.feature.properties).map(([key, value]) => ({ key, value: formatValue(value) }));
      setOpen({ card: { ...hit, title, rows }, coordinate: e.coordinate });
      setAnchor(toWindow(e.pixel));
    };
    map.on('singleclick', onClick);
    return () => { map.un('singleclick', onClick); };
  }, [map, qc]);

  // The card is placed in window coordinates (it is portalled to <body>) and follows the map.
  useEffect(() => {
    if (!map || !open) return;
    const update = () => {
      const px = map.getPixelFromCoordinate(open.coordinate);
      if (!px) return;
      const origin = map.getTargetElement().getBoundingClientRect();
      setAnchor([px[0] + origin.left, px[1] + origin.top]);
    };
    update();
    map.on('postrender', update);
    return () => { map.un('postrender', update); };
  }, [map, open]);

  // The card's map was folded, deleted or unshared: its layers left the map, so the card goes too.
  const { expanded } = useMyMapsStore();
  const shown = open && expanded.has(open.card.mapId) ? open : null;
  useEffect(() => {
    if (open && !shown) setOpen(null);
  }, [open, shown]);

  const geometry = shown?.card.feature.geometry ?? null;
  const canUseAsRoi = geometry !== null && ROI_GEOMETRY_TYPES.has(geometry.type);

  return {
    card: shown?.card ?? null,
    anchor: shown ? anchor : null,
    close: () => setOpen(null),
    canUseAsRoi,
    /**
     * Makes the feature the analysis region and closes the card. The geometry goes to the API as
     * is: one over its vertex cap comes back as a 400 whose message the ROI store shows.
     */
    useAsRoi: () => {
      if (!geometry || !canUseAsRoi) return;
      void setRoi({ source: 'drawn', geometry: geometry as DrawnRoiGeometry }, { fit: 'ifOutside' });
      setOpen(null);
    },
  };
}
