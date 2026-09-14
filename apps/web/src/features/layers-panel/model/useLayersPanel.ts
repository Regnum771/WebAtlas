import { useMemo } from 'react';
import { useMapContext, type LayerState } from '../../../app/providers/MapProvider';
import { LAYER_DISPLAY, type LayerDisplayMeta } from '../../../entities/layer/layerDisplay';
import { LAYER_REGISTRY } from '../../../entities/layer/layerRegistry';
import { useLayerCatalog } from '../../../entities/layer/useLayerCatalog';
import { createCommandExecutor } from '../../map/model/mapCommands';

export interface PanelLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  gated: boolean;
  gateHint?: string;
}

export interface PanelGroup {
  name: string;
  layers: PanelLayer[];
}

function formatZoom(z: number): string {
  return String(z).replace('.', ',');
}

/** Pure: turns layer state + display metadata into grouped rows. Tested directly. */
export function buildPanelGroups(input: {
  // Only the fields this function reads — LAYER_DISPLAY entries (which carry
  // defaultVisible/opacity too) satisfy this structurally.
  display: Record<string, Pick<LayerDisplayMeta, 'name' | 'group' | 'minZoom'>>;
  layersState: Pick<LayerState, 'id' | 'visible' | 'opacity'>[];
  currentZoom: number;
}): PanelGroup[] {
  const groups: PanelGroup[] = [];

  for (const state of input.layersState) {
    const meta = input.display[state.id];
    if (!meta) continue; // no display metadata: not renderable, skip rather than crash

    const gated = meta.minZoom !== undefined && input.currentZoom < meta.minZoom;
    let group = groups.find((g) => g.name === meta.group);
    if (!group) {
      group = { name: meta.group, layers: [] };
      groups.push(group);
    }
    group.layers.push({
      id: state.id,
      name: meta.name,
      visible: state.visible,
      opacity: state.opacity,
      gated,
      gateHint: gated ? `hiện từ mức ${formatZoom(meta.minZoom!)}` : undefined,
    });
  }

  return groups;
}

export function useLayersPanel(currentZoom: number) {
  const { map, setBasemap, layersState, toggleLayerVisibility, setLayerOpacity } = useMapContext();
  const catalog = useLayerCatalog();

  const groups = buildPanelGroups({ display: LAYER_DISPLAY, layersState, currentZoom });

  // A layer the API says exists but that has no display metadata would silently
  // vanish from the panel. Surface it instead: map catalog keys through
  // LAYER_REGISTRY to their layerStateId and check LAYER_DISPLAY covers each.
  const missingDisplay = (catalog.data ?? [])
    .map((entry) => LAYER_REGISTRY.find((r) => r.layerKey === entry.key)?.layerStateId)
    .filter((layerStateId): layerStateId is string => layerStateId !== undefined)
    .filter((layerStateId) => LAYER_DISPLAY[layerStateId] === undefined);

  // Panel mutations go through the same command layer every other layer
  // mutator uses (MapToolbar, search) — see mapCommands.ts. Before this, the
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

  return {
    groups,
    toggleLayerVisibility: onToggleLayerVisibility,
    setLayerOpacity: onSetLayerOpacity,
    catalogError: catalog.isError,
    missingDisplay,
  };
}
