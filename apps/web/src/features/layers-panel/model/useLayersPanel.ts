import { useMemo } from 'react';
import { legendFor, type LegendEntry } from '@webatlas/shared';
import { useMapContext, type LayerState } from '../../../app/providers/MapProvider';
import { LAYER_DISPLAY, type LayerDisplayMeta } from '../../../entities/layer/layerDisplay';
import { LAYER_REGISTRY } from '../../../entities/layer/layerRegistry';
import { useLayerCatalog } from '../../../entities/layer/useLayerCatalog';
import { createCommandExecutor } from '../../map/model/mapCommands';
import { formatScale, scaleAtZoom, snapScaleForReadout } from '../../map/model/zoomScale';
import { useDictionary } from '../../dictionary';

export interface PanelLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  /** The map is zoomed out past the layer's first scale: it draws nothing yet. */
  gated: boolean;
  /** "từ 1:555.000": the layer draws only from that scale in. Absent for a layer drawn at every scale. */
  scaleNote?: string;
  /** The first entry of the layer's legend, drawn beside its name; null when it has none. */
  swatch?: LegendEntry | null;
}

export interface PanelGroup {
  name: string;
  layers: PanelLayer[];
  /** Layers of the group that are on. */
  on: number;
  total: number;
}

/** The scale a minimum zoom stands for, as the status bar's readout would print it. */
function scaleNoteFor(minZoom: number): string {
  return `từ ${formatScale(snapScaleForReadout(scaleAtZoom(minZoom)))}`;
}

/** Folds case and Vietnamese accents (đ included), so "dap" finds "Đập". */
export function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
}

/** Pure: the groups narrowed to layers whose name holds `query`; empty groups drop out. */
export function filterPanelGroups(groups: PanelGroup[], query: string): PanelGroup[] {
  const q = foldForSearch(query);
  if (!q) return groups;
  return groups
    .map((g) => ({ ...g, layers: g.layers.filter((l) => foldForSearch(l.name).includes(q)) }))
    .filter((g) => g.layers.length > 0);
}

/** Pure: turns layer state + display metadata into grouped rows. Tested directly. */
export function buildPanelGroups(input: {
  // Only the fields this function reads — LAYER_DISPLAY entries (which carry
  // defaultVisible/opacity too) satisfy this structurally.
  display: Record<string, Pick<LayerDisplayMeta, 'name' | 'group' | 'minZoom'>>;
  layersState: Pick<LayerState, 'id' | 'visible' | 'opacity'>[];
  currentZoom: number;
  /** The swatch for a layer's row; rows get none without it. */
  swatchFor?: (layerStateId: string) => LegendEntry | null;
}): PanelGroup[] {
  const groups: PanelGroup[] = [];

  for (const state of input.layersState) {
    const meta = input.display[state.id];
    if (!meta) continue; // no display metadata: not renderable, skip rather than crash

    // layer_rivers keeps minZoom 8.5 because the FULL network only draws from there,
    // but the river overview shows the main rivers at every zoom level. Saying
    // "shown from 8.5" would then contradict what the user is looking at.
    const alwaysDrawnBySubstitute = state.id === 'layer_rivers';
    const limited = !alwaysDrawnBySubstitute && meta.minZoom !== undefined;
    const gated = limited && input.currentZoom < meta.minZoom!;
    let group = groups.find((g) => g.name === meta.group);
    if (!group) {
      group = { name: meta.group, layers: [], on: 0, total: 0 };
      groups.push(group);
    }
    group.layers.push({
      id: state.id,
      name: meta.name,
      visible: state.visible,
      opacity: state.opacity,
      gated,
      scaleNote: limited ? scaleNoteFor(meta.minZoom!) : undefined,
      ...(input.swatchFor ? { swatch: input.swatchFor(state.id) } : {}),
    });
    group.total += 1;
    if (state.visible) group.on += 1;
  }

  return groups;
}

export function useLayersPanel(currentZoom: number) {
  const { map, setBasemap, layersState, toggleLayerVisibility, setLayerOpacity } = useMapContext();
  const catalog = useLayerCatalog();
  const dictionary = useDictionary();

  const groups = buildPanelGroups({
    display: LAYER_DISPLAY,
    layersState,
    currentZoom,
    swatchFor: (id) => legendFor(id, dictionary)[0]?.entries[0] ?? null,
  });
  const onCount = groups.reduce((n, g) => n + g.on, 0);

  // A layer the API says exists but that has no display metadata would silently
  // vanish from the panel. Surface it instead: map catalog keys through
  // LAYER_REGISTRY to their layerStateId and check LAYER_DISPLAY covers each.
  const missingDisplay = (catalog.data ?? [])
    .map((entry) => LAYER_REGISTRY.find((r) => r.layerKey === entry.key)?.layerStateId)
    .filter((layerStateId): layerStateId is string => layerStateId !== undefined)
    .filter((layerStateId) => LAYER_DISPLAY[layerStateId] === undefined);

  // Panel mutations go through the same command layer every other layer
  // mutator uses (the map tools, search) — see mapCommands.ts. Before this, the
  // panel called the context setters directly, so setLayerVisible/
  // setLayerOpacity had zero UI producers.
  const run = useMemo(
    () =>
      createCommandExecutor({
        map,
        setBasemap,
        toggleLayerVisibility,
        setLayerOpacity,
        getLayerVisible: (id) => layersState.find((l) => l.id === id)?.visible ?? false,
        layerExists: (id) => layersState.some((l) => l.id === id),
      }),
    [map, setBasemap, toggleLayerVisibility, setLayerOpacity, layersState],
  );

  const onToggleLayerVisibility = (layerStateId: string) => {
    // The context setter toggles; setLayerVisible carries the intended
    // ABSOLUTE value, so compute the new state from the current one here.
    const current = layersState.find((l) => l.id === layerStateId)?.visible ?? false;
    run({ kind: 'setLayerVisible', layerStateId, visible: !current });
  };

  const onSetLayerOpacity = (layerStateId: string, opacity: number) => {
    run({ kind: 'setLayerOpacity', layerStateId, opacity });
  };

  /** Tắt hết: every layer of the panel off, each through the executor. */
  const turnAllOff = () => {
    for (const layer of groups.flatMap((g) => g.layers)) {
      if (layer.visible) run({ kind: 'setLayerVisible', layerStateId: layer.id, visible: false });
    }
  };

  return {
    groups,
    onCount,
    turnAllOff,
    toggleLayerVisibility: onToggleLayerVisibility,
    setLayerOpacity: onSetLayerOpacity,
    catalogError: catalog.isError,
    missingDisplay,
  };
}
