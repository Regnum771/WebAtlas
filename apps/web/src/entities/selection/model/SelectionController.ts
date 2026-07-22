import type Map from 'ol/Map';
import Select from 'ol/interaction/Select';
import type { SelectEvent } from 'ol/interaction/Select';
import type Feature from 'ol/Feature';
import type BaseLayer from 'ol/layer/Base';
import type { EditableLayerKey } from '@webatlas/shared';
import { parseFeatureId, resolveLayerKey, type Selection } from './selection';
import { makeSelectionStyle } from './selectionStyle';

/**
 * The app's ONE selection interaction. It replaces two that previously coexisted and
 * did not know about each other: a rivers-only Select in MapModel (always active) and
 * the editing-only SelectController (active only inside edit mode).
 *
 * Selection is role-agnostic and mode-free. Editing subscribes to it; it does not own
 * it, and selecting never starts geometry modification.
 */
export class SelectionController {
  private map: Map;
  private layerKeyByStateId: Record<string, EditableLayerKey>;
  private select: Select | null = null;
  private selected: Selection | null = null;
  private onChange: ((sel: Selection | null) => void) | null = null;

  constructor(map: Map, layerKeyByStateId: Record<string, EditableLayerKey>) {
    this.map = map;
    this.layerKeyByStateId = layerKeyByStateId;
  }

  activate(onChange: (sel: Selection | null) => void): void {
    this.deactivate();
    this.onChange = onChange;
    const editableIds = new Set(Object.keys(this.layerKeyByStateId));
    const select = new Select({
      layers: (layer: BaseLayer) => editableIds.has(layer.get('id')),
      style: makeSelectionStyle,
    });
    select.on('select', (evt: SelectEvent) => {
      const feature = evt.selected[0];
      if (!feature) { this.setSelected(null); return; }
      this.setSelected(this.toSelection(feature));
    });
    this.map.addInteraction(select);
    this.select = select;
  }

  /**
   * Select a feature the user did not click — e.g. from a filter or search result.
   * Returns the resulting Selection, or null if the feature is not loaded.
   */
  selectById(layerKey: EditableLayerKey, featureId: string): Selection | null {
    const feature = this.findFeature(layerKey, featureId);
    if (!feature) return null;
    const sel = this.toSelection(feature);
    if (!sel) return null;
    // Keep the OL interaction's own collection in step so the highlight renders and a
    // subsequent map click deselects cleanly.
    const coll = this.select?.getFeatures();
    coll?.clear();
    coll?.push(feature);
    this.setSelected(sel);
    return sel;
  }

  getSelected(): Selection | null {
    return this.selected;
  }

  clear(): void {
    this.select?.getFeatures().clear();
    this.setSelected(null);
  }

  deactivate(): void {
    this.select?.getFeatures().clear();
    this.selected = null;
    if (this.select) {
      this.map.removeInteraction(this.select);
      this.select = null;
    }
    this.onChange = null;
  }

  dispose(): void {
    this.deactivate();
  }

  private setSelected(sel: Selection | null): void {
    this.selected = sel;
    this.onChange?.(sel);
  }

  private findFeature(layerKey: EditableLayerKey, featureId: string): Feature | null {
    const stateId = Object.keys(this.layerKeyByStateId)
      .find((id) => this.layerKeyByStateId[id] === layerKey);
    if (!stateId) return null;
    const layer = this.map.getLayers().getArray()
      .find((l) => l.get('id') === stateId) as
      | { getSource(): { getFeatures(): Feature[] } | null }
      | undefined;
    const src = layer?.getSource?.();
    if (!src) return null;
    return src.getFeatures()
      .find((f) => parseFeatureId(String(f.getId() ?? '')).featureId === featureId) ?? null;
  }

  private toSelection(feature: Feature): Selection | null {
    const { typename, featureId } = parseFeatureId(String(feature.getId() ?? ''));
    const layerKey = resolveLayerKey(typename, this.layerKeyByStateId);
    if (!layerKey) return null;
    const geomKey = feature.getGeometryName();
    const isoProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(feature.getProperties())) {
      if (k !== geomKey) isoProps[k] = v;
    }
    return { layerKey, featureId, feature, isoProps };
  }
}
