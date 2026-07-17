import type Map from 'ol/Map';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import Collection from 'ol/Collection';
import type Feature from 'ol/Feature';
import { olGeometryTo4326GeoJSON, type GeoJSONGeometry } from './geo';

export class ModifyController {
  private map: Map;
  private modify: Modify | null = null;
  private translate: Translate | null = null;

  constructor(map: Map) {
    this.map = map;
  }

  start(feature: Feature, onChange: (geometry: GeoJSONGeometry) => void): void {
    this.cancel();
    const features = new Collection<Feature>([feature]);
    const emit = () => {
      const geom = feature.getGeometry();
      if (geom) onChange(olGeometryTo4326GeoJSON(geom));
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

  cancel(): void {
    if (this.modify) { this.map.removeInteraction(this.modify); this.modify = null; }
    if (this.translate) { this.map.removeInteraction(this.translate); this.translate = null; }
  }

  dispose(): void {
    this.cancel();
  }
}
