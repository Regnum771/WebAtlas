import type Map from 'ol/Map';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import Select from 'ol/interaction/Select';
import type { SelectEvent } from 'ol/interaction/Select';
import Feature, { type FeatureLike } from 'ol/Feature';
import type BaseLayer from 'ol/layer/Base';
import type Layer from 'ol/layer/Layer';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { createEditingStyle } from 'ol/style/Style';
import type { EditableLayerKey } from '@webatlas/shared';
import { olGeometryTo4326GeoJSON, geoJSON4326ToOlGeometry, type GeoJSONGeometry } from './geo';
import { fetchFeatureGeometry } from '../../search/api/search.api';

export interface EditSelection {
  layerKey: EditableLayerKey;
  featureId: string;
  geometry: GeoJSONGeometry;
  isoProps: Record<string, unknown>;
}

const EDITING_STYLES = createEditingStyle();

/** A water layer drawn from vector tiles (waterTiles.ts); the overview is not editable. */
function isEditableTileLayer(layer: BaseLayer): boolean {
  const tile = layer.get('waterTileLayer');
  return Boolean(tile) && tile !== 'rivers_overview';
}

export class SelectController {
  private map: Map;
  private layerKeyByStateId: Record<string, EditableLayerKey>;
  private select: Select | null = null;
  private selected: Feature | null = null;
  private clickHandler: ((evt: MapBrowserEvent) => void) | null = null;
  /** The tile feature currently selected, so a second click on it does not re-fetch and discard edits. */
  private tileSelection: { layerKey: string; id: string } | null = null;
  /** Bumped on every tile click and on deactivate: a late geometry response for an older click is dropped. */
  private clickSeq = 0;
  /**
   * Holds the fetched copy of a selected tile feature: the search endpoint's simplified geometry
   * (saved only if the user moves it, see geometryChanged). Tile geometry is clipped and
   * simplified to the tile grid, so it can be neither edited nor shown as the thing being edited. Unmanaged
   * (setMap), so it is not in the map's layer list and is never a popup, snap or select target.
   */
  private editLayer: VectorLayer<VectorSource> | null = null;

  constructor(map: Map, layerKeyByStateId: Record<string, EditableLayerKey>) {
    this.map = map;
    this.layerKeyByStateId = layerKeyByStateId;
  }

  activate(onSelect: (sel: EditSelection) => void): void {
    this.deactivate();
    const editableIds = new Set(Object.keys(this.layerKeyByStateId));
    const select = new Select({
      // Only hit-test the editable WFS layers: Select never selects tile features.
      layers: (layer: BaseLayer) => editableIds.has(layer.get('id')) && !isEditableTileLayer(layer),
    });
    select.on('select', (evt: SelectEvent) => {
      const feature = evt.selected[0];
      if (!feature) {
        // A click on a tile feature deselects in Select's eyes; the tile path owns that selection.
        if (!this.tileSelection) this.selected = null;
        return;
      }
      this.clearTileSelection();
      this.selected = feature;
      // Which editable layer? The Select event carries no layer, so derive the key
      // from the feature id's typename prefix (e.g. "dams.<uuid>").
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

    const clickHandler = (evt: MapBrowserEvent) => {
      // Topmost editable hit, WFS or tile alike: a dam drawn over a river belongs to Select.
      let hit: { feature: FeatureLike; layer: Layer } | null = null;
      this.map.forEachFeatureAtPixel(
        evt.pixel,
        (feature, layer) => {
          hit = { feature, layer };
          return true;
        },
        { layerFilter: (l) => editableIds.has(l.get('id')) && (isEditableTileLayer(l) || !l.get('waterTileLayer')) },
      );
      const found = hit as { feature: FeatureLike; layer: Layer } | null;
      if (!found || !isEditableTileLayer(found.layer)) return;
      void this.selectTileFeature(found.feature, onSelect);
    };
    this.map.on('singleclick', clickHandler);
    this.clickHandler = clickHandler;
  }

  /** Selection of a tile feature: fetch the search endpoint's simplified geometry, which is what the editor edits. */
  private async selectTileFeature(feature: FeatureLike, onSelect: (sel: EditSelection) => void): Promise<void> {
    const props = feature.getProperties();
    const id = typeof props.id === 'string' ? props.id : null;
    const layerKey = this.resolveLayerKey(String(props.layerKey ?? ''));
    if (!id || !layerKey) return;
    if (this.tileSelection?.layerKey === layerKey && this.tileSelection.id === id) return;
    const seq = ++this.clickSeq;
    let geometry: GeoJSONGeometry;
    try {
      ({ geometry } = await fetchFeatureGeometry(layerKey, id));
    } catch (e) {
      console.warn(`[select] could not load the geometry of ${layerKey}/${id}`, e);
      return;
    }
    if (seq !== this.clickSeq || !this.select) return; // a newer click, or edit mode ended
    const isoProps: Record<string, unknown> = {};
    // `layer` is the MVT layer name the format adds to every feature; not an attribute.
    for (const [k, v] of Object.entries(props)) {
      if (k !== 'geometry' && k !== 'layer') isoProps[k] = v;
    }
    this.select.getFeatures().clear();
    const editFeature = new Feature({ geometry: geoJSON4326ToOlGeometry(geometry) });
    this.showEditFeature(editFeature);
    this.selected = editFeature;
    this.tileSelection = { layerKey, id };
    onSelect({ layerKey, featureId: id, geometry, isoProps });
  }

  private showEditFeature(feature: Feature): void {
    if (!this.editLayer) {
      this.editLayer = new VectorLayer({
        source: new VectorSource(),
        style: (f) => EDITING_STYLES[f.getGeometry()?.getType() ?? 'LineString'],
        properties: { id: 'layer_edit_selection' },
      });
      this.editLayer.setMap(this.map);
    }
    const source = this.editLayer.getSource()!;
    source.clear();
    source.addFeature(feature);
  }

  /** Also drops any geometry fetch still in flight, so it cannot override what replaced it. */
  private clearTileSelection(): void {
    this.clickSeq++;
    this.tileSelection = null;
    this.editLayer?.getSource()?.clear();
  }

  // Map a WFS typename (e.g. "dams") or a tile feature's layerKey to the editable layer key.
  // WFS ids are "<typename>.<uuid>" where typename matches the layer key for the 7 layers.
  private resolveLayerKey(typename: string): EditableLayerKey | null {
    const values = Object.values(this.layerKeyByStateId);
    return (values as string[]).includes(typename) ? (typename as EditableLayerKey) : null;
  }

  getSelectedFeature(): Feature | null {
    return this.selected;
  }

  clear(): void {
    this.select?.getFeatures().clear();
    this.clearTileSelection();
    this.selected = null;
  }

  deactivate(): void {
    this.clear();
    if (this.select) {
      this.map.removeInteraction(this.select);
      this.select = null;
    }
    if (this.clickHandler) {
      this.map.un('singleclick', this.clickHandler);
      this.clickHandler = null;
    }
  }

  dispose(): void {
    this.deactivate();
    this.editLayer?.setMap(null);
    this.editLayer = null;
  }
}
