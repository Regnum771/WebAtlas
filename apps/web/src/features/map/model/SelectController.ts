import type Map from 'ol/Map';
import Select from 'ol/interaction/Select';
import type { SelectEvent } from 'ol/interaction/Select';
import type Feature from 'ol/Feature';
import type BaseLayer from 'ol/layer/Base';
import type { EditableLayerKey } from '@webatlas/shared';
import { olGeometryTo4326GeoJSON, type GeoJSONGeometry } from './geo';

export interface EditSelection {
  layerKey: EditableLayerKey;
  featureId: string;
  geometry: GeoJSONGeometry;
  isoProps: Record<string, unknown>;
}

export class SelectController {
  private map: Map;
  private layerKeyByStateId: Record<string, EditableLayerKey>;
  private select: Select | null = null;
  private selected: Feature | null = null;

  constructor(map: Map, layerKeyByStateId: Record<string, EditableLayerKey>) {
    this.map = map;
    this.layerKeyByStateId = layerKeyByStateId;
  }

  activate(onSelect: (sel: EditSelection) => void): void {
    this.deactivate();
    const editableIds = new Set(Object.keys(this.layerKeyByStateId));
    const select = new Select({
      // Only hit-test the editable WFS layers.
      layers: (layer: BaseLayer) => editableIds.has(layer.get('id')),
    });
    select.on('select', (evt: SelectEvent) => {
      const feature = evt.selected[0];
      if (!feature) { this.selected = null; return; }
      this.selected = feature;
      // Which editable layer? The Select event carries no layer, so read it from the
      // feature's layer via the map's forEachFeatureAtPixel is unavailable here; instead
      // derive the key from the feature id's typename prefix (e.g. "dams.<uuid>").
      const rawId = String(feature.getId() ?? '');
      const dot = rawId.indexOf('.');
      const featureId = dot >= 0 ? rawId.slice(dot + 1) : rawId;
      const typename = dot >= 0 ? rawId.slice(0, dot) : '';
      const layerKey = this.resolveLayerKey(typename);
      if (!layerKey) return;
      const geom = feature.getGeometry();
      if (!geom) return;
      const geometry = olGeometryTo4326GeoJSON(geom);
      const geomKey = feature.getGeometryName();
      const isoProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(feature.getProperties())) {
        if (k !== geomKey) isoProps[k] = v;
      }
      onSelect({ layerKey, featureId, geometry, isoProps });
    });
    this.map.addInteraction(select);
    this.select = select;
  }

  // Map a WFS typename (e.g. "dams") to the editable layer key. WFS ids are
  // "<typename>.<uuid>" where typename matches the layer key for the 7 layers.
  private resolveLayerKey(typename: string): EditableLayerKey | null {
    const values = Object.values(this.layerKeyByStateId);
    return (values as string[]).includes(typename) ? (typename as EditableLayerKey) : null;
  }

  getSelectedFeature(): Feature | null {
    return this.selected;
  }

  clear(): void {
    this.select?.getFeatures().clear();
    this.selected = null;
  }

  deactivate(): void {
    this.clear();
    if (this.select) {
      this.map.removeInteraction(this.select);
      this.select = null;
    }
  }

  dispose(): void {
    this.deactivate();
  }
}
