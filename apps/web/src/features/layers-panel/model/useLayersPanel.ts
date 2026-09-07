import { useMapContext, type LayerState } from '../../../app/providers/MapProvider';
import { LAYER_DISPLAY, type LayerDisplayMeta } from '../../../entities/layer/layerDisplay';
import { LAYER_REGISTRY } from '../../../entities/layer/layerRegistry';
import { useLayerCatalog } from '../../../entities/layer/useLayerCatalog';

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
  const { layersState, toggleLayerVisibility, setLayerOpacity } = useMapContext();
  const catalog = useLayerCatalog();

  const groups = buildPanelGroups({ display: LAYER_DISPLAY, layersState, currentZoom });

  // A layer the API says exists but that has no display metadata would silently
  // vanish from the panel. Surface it instead: map catalog keys through
  // LAYER_REGISTRY to their layerStateId and check LAYER_DISPLAY covers each.
  const missingDisplay = (catalog.data ?? [])
    .map((entry) => LAYER_REGISTRY.find((r) => r.layerKey === entry.key)?.layerStateId)
    .filter((layerStateId): layerStateId is string => layerStateId !== undefined)
    .filter((layerStateId) => LAYER_DISPLAY[layerStateId] === undefined);

  return { groups, toggleLayerVisibility, setLayerOpacity, catalogError: catalog.isError, missingDisplay };
}
