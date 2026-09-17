import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Map } from 'ol';
import { LEGEND_ATTRIBUTION, REGION_NAME, type BasemapName } from '@webatlas/shared';
import {
  canvasToPngBlob as defaultToBlob,
  exportMapCanvas as defaultExport,
  ExportBlockedError,
} from '../../../features/map/model/exportMap';

export const PAPER_SIZES = {
  'A4-landscape': { label: 'A4 ngang', css: 'A4 landscape', aspect: 297 / 210 },
  'A4-portrait': { label: 'A4 dọc', css: 'A4 portrait', aspect: 210 / 297 },
  'A3-landscape': { label: 'A3 ngang', css: 'A3 landscape', aspect: 420 / 297 },
  'A3-portrait': { label: 'A3 dọc', css: 'A3 portrait', aspect: 297 / 420 },
} as const;
export type PaperId = keyof typeof PAPER_SIZES;

/** Printed on every sheet: the basemap is always in the image, so its licence is always owed. */
export const BASEMAP_ATTRIBUTION: Record<BasemapName, string> = {
  street: 'Nền bản đồ: © OpenStreetMap contributors (ODbL)',
  satellite: 'Ảnh vệ tinh: Esri, Maxar, Earthstar Geographics',
  dem: 'Địa hình: Esri World Hillshade',
};

export interface PrintToggles { legend: boolean; scale: boolean; north: boolean; date: boolean; crs: boolean }

export interface UsePrintPageDeps {
  map: Map | null;
  basemap: BasemapName;
  visibleLayerIds: string[];
  crsLabel: string;
  exporter?: { exportMapCanvas: typeof defaultExport; canvasToPngBlob: typeof defaultToBlob };
}

export function usePrintPage({ map, basemap, visibleLayerIds, crsLabel, exporter }: UsePrintPageDeps) {
  const exportCanvas = exporter?.exportMapCanvas ?? defaultExport;
  const toBlob = exporter?.canvasToPngBlob ?? defaultToBlob;

  const [title, setTitle] = useState(`Bản đồ tài nguyên nước — ${REGION_NAME}`);
  const [paper, setPaper] = useState<PaperId>('A4-landscape');
  const [toggles, setToggles] = useState<PrintToggles>({ legend: true, scale: true, north: true, date: true, crs: true });
  const [blob, setBlob] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    setCapturing(true);
    setExportError(null);
    exportCanvas(map, PAPER_SIZES[paper].aspect)
      .then(toBlob)
      .then((b) => { if (!cancelled) setBlob(b); })
      .catch((e) => {
        if (cancelled) return;
        setBlob(null);
        setExportError(e instanceof ExportBlockedError ? e.message : 'Không chụp được bản đồ.');
      })
      .finally(() => { if (!cancelled) setCapturing(false); });
    return () => { cancelled = true; };
  }, [map, paper, exportCanvas, toBlob]);

  useEffect(() => {
    if (!blob) { setImageUrl(null); return; }
    const url = URL.createObjectURL(blob);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const attributions = useMemo(() => {
    const layerNotes = visibleLayerIds.map((id) => LEGEND_ATTRIBUTION[id]).filter((a): a is string => Boolean(a));
    return [BASEMAP_ATTRIBUTION[basemap], ...new Set(layerNotes)];
  }, [basemap, visibleLayerIds]);

  const toggle = useCallback((key: keyof PrintToggles) => setToggles((t) => ({ ...t, [key]: !t[key] })), []);

  const downloadPng = useCallback(() => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = 'ban-do.png';
    a.click();
  }, [imageUrl]);

  const print = useCallback(() => window.print(), []);

  return {
    title, setTitle, paper, setPaper, toggles, toggle, imageUrl, capturing, exportError,
    attributions, crsLabel, date: new Date().toLocaleDateString('vi-VN'), downloadPng, print,
  };
}
