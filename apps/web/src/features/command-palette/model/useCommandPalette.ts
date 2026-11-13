import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMapContext } from '../../../app/providers/MapProvider';
import { LAYER_DISPLAY } from '../../../entities/layer/layerDisplay';
import { useSession } from '../../../entities/session/model/session.store';
import { createCommandExecutor } from '../../map/model/mapCommands';
import { foldForSearch } from '../../layers-panel/model/useLayersPanel';
import { useSearch } from '../../search/model/useSearch';
import { goToSearchHit } from '../../search/model/goToHit';
import type { SearchHit } from '../../search/api/search.api';
import { toggleAssistant } from '../../shell/model/shell.store';

/** Layers listed for one query, at most. */
const MAX_LAYERS = 8;

/**
 * "lat, lon" typed as decimal degrees: "15.88, 108.33", "15.88 108.33" or, with decimal commas,
 * "15,88; 108,33". Null for anything else, or for a latitude or longitude out of range.
 */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const t = text.trim();
  if (!t) return null;
  const parts = t.includes(';') ? t.split(';').map((p) => p.trim().replace(',', '.')) : t.split(/[\s,]+/);
  if (parts.length !== 2) return null;
  if (!parts.every((p) => /^-?\d+(\.\d+)?$/.test(p))) return null;
  const [lat, lon] = parts.map(Number);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** An element where typing goes: a shortcut must not fire there. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type);
  }
  return false;
}

/** Marks the palette's own input: Ctrl K there closes the palette. */
export const PALETTE_INPUT_ATTR = 'data-palette-input';

/**
 * The global shortcuts: Ctrl K (or ⌘K) opens or closes the palette, / opens Trợ lý. Neither fires
 * while the reader types in an input, a textarea or an editable element, except Ctrl K in the
 * palette's own input.
 */
export function usePaletteShortcuts({ onPalette, onAssistant }: { onPalette: () => void; onAssistant: (() => void) | null }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const typing = isTypingTarget(e.target);
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        const inPalette = e.target instanceof HTMLElement && e.target.hasAttribute(PALETTE_INPUT_ATTR);
        if (typing && !inPalette) return;
        e.preventDefault();
        onPalette();
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && onAssistant && !typing) {
        e.preventDefault();
        onAssistant();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onPalette, onAssistant]);
}

export type PaletteCommandId = 'all-off' | 'print' | 'assistant';
export interface PaletteCommand { id: PaletteCommandId; label: string; shortcut?: string }
export interface PaletteLayer { id: string; name: string; visible: boolean }

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  const search = useSearch();
  const { map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState } = useMapContext();
  const { status } = useSession();
  const navigate = useNavigate();
  const signedIn = status === 'authenticated';

  const run = useMemo(() => createCommandExecutor({
    map, setBasemap, toggleLayerVisibility, setLayerOpacity,
    getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
    layerExists: (id) => layersState.some((l) => l.id === id),
  }), [map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState]);

  const q = foldForSearch(search.query);
  const layers: PaletteLayer[] = q
    ? layersState
      .filter((l) => LAYER_DISPLAY[l.id] && foldForSearch(LAYER_DISPLAY[l.id].name).includes(q))
      .slice(0, MAX_LAYERS)
      .map((l) => ({ id: l.id, name: LAYER_DISPLAY[l.id].name, visible: l.visible }))
    : [];
  const coordinate = parseLatLon(search.query);
  const allCommands: PaletteCommand[] = [
    { id: 'all-off', label: 'Tắt hết lớp' },
    { id: 'print', label: 'In và xuất' },
    ...(signedIn ? [{ id: 'assistant' as const, label: 'Trợ lý', shortcut: '/' }] : []),
  ];
  const commands = allCommands.filter((c) => !q || foldForSearch(c.label).includes(q));

  const close = () => {
    setOpen(false);
    search.clear();
  };

  usePaletteShortcuts({
    onPalette: () => setOpen((o) => {
      if (o) search.clear();
      return !o;
    }),
    onAssistant: signedIn ? toggleAssistant : null,
  });

  return {
    open,
    openPalette: () => setOpen(true),
    close,
    query: search.query,
    setQuery: search.setQuery,
    places: { hits: search.results, status: search.status, retry: search.retry },
    layers,
    coordinate,
    commands,
    onPlace: (hit: SearchHit) => { close(); goToSearchHit(hit, run); },
    onLayer: (id: string) => {
      const visible = layersState.find((l) => l.id === id)?.visible ?? false;
      run({ kind: 'setLayerVisible', layerStateId: id, visible: !visible });
      close();
    },
    onCoordinate: () => {
      if (!coordinate) return;
      close();
      run({
        kind: 'showGeometries',
        fit: true,
        items: [{ geometry: { type: 'Point', coordinates: [coordinate.lon, coordinate.lat] }, role: 'highlight', label: `${coordinate.lat}, ${coordinate.lon}` }],
      });
    },
    onCommand: (id: PaletteCommandId) => {
      close();
      if (id === 'all-off') {
        // As the panel's Tắt hết: the layers it lists.
        for (const l of layersState) if (l.visible && LAYER_DISPLAY[l.id]) run({ kind: 'setLayerVisible', layerStateId: l.id, visible: false });
      } else if (id === 'print') navigate('/print');
      else if (id === 'assistant') toggleAssistant();
    },
  };
}
