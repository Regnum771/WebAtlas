import type Map from 'ol/Map';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import Collection from 'ol/Collection';
import Feature from 'ol/Feature';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { createEditingStyle } from 'ol/style/Style';
import { geoJSON4326ToOlGeometry, olGeometryTo4326GeoJSON, type GeoJSONGeometry } from './geo';

const EDITING_STYLES = createEditingStyle();

export class ModifyController {
  private map: Map;
  private modify: Modify | null = null;
  private translate: Translate | null = null;
  /**
   * Holds the copy that startOnCopy edits. Unmanaged (setMap), so it is not in the map's layer
   * list and is never a popup, snap or select target.
   */
  private copyLayer: VectorLayer<VectorSource> | null = null;

  constructor(map: Map) {
    this.map = map;
  }

  start(feature: Feature, onChange: (geometry: GeoJSONGeometry) => void): void {
    this.cancel();
    const features = new Collection<Feature>([feature]);
    // Emit only when the geometry really changed: Translate ends on a plain click too, and
    // the editor treats any emitted geometry as an edit to save (useEditExistingPresenter).
    let lastRevision = feature.getGeometry()?.getRevision();
    const emit = () => {
      const geom = feature.getGeometry();
      if (!geom || geom.getRevision() === lastRevision) return;
      lastRevision = geom.getRevision();
      onChange(olGeometryTo4326GeoJSON(geom));
    };
    const modify = new Modify({ features });
    modify.on('modifyend', emit);
    const translate = new Translate({ features });
    translate.on('translateend', emit);
    this.map.addInteraction(modify);
    this.map.addInteraction(translate);
    this.modify = modify;
    this.translate = translate;
  }

  /**
   * Edits a copy of an EPSG:4326 geometry, drawn on its own layer above everything else. The
   * feature the geometry came from is never touched: a personal layer's features are only ever
   * replaced by reading the layer again (refreshPersonalLayer).
   */
  startOnCopy(geometry: GeoJSONGeometry, onChange: (geometry: GeoJSONGeometry) => void): void {
    const copy = new Feature({ geometry: geoJSON4326ToOlGeometry(geometry) });
    // start() cancels first, which empties the copy layer: add the copy after it.
    this.start(copy, onChange);
    if (!this.copyLayer) {
      this.copyLayer = new VectorLayer({
        source: new VectorSource(),
        style: (f) => EDITING_STYLES[f.getGeometry()?.getType() ?? 'LineString'],
        properties: { id: 'layer_edit_copy' },
      });
      this.copyLayer.setMap(this.map);
    }
    this.copyLayer.getSource()!.addFeature(copy);
  }

  cancel(): void {
    if (this.modify) { this.map.removeInteraction(this.modify); this.modify = null; }
    if (this.translate) { this.map.removeInteraction(this.translate); this.translate = null; }
    this.copyLayer?.getSource()?.clear();
  }

  dispose(): void {
    this.cancel();
    this.copyLayer?.setMap(null);
    this.copyLayer = null;
  }
}
