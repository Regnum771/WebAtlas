import type Map from 'ol/Map';
import Draw from 'ol/interaction/Draw';
import type { DrawEvent } from 'ol/interaction/Draw';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import type { Type as OlGeometryType } from 'ol/geom/Geometry';
import type { OgcGeometryType } from '@webatlas/shared';
import { olGeometryTo4326GeoJSON, type GeoJSONGeometry } from './geo';

// Layer geometry type -> the single OL draw type. The API ST_Multi-wraps single
// LineString/Polygon into the Multi column, so drawing the single type is correct.
const DRAW_TYPE: Record<OgcGeometryType, OlGeometryType> = {
  Point: 'Point',
  MultiLineString: 'LineString',
  MultiPolygon: 'Polygon',
};

export class DrawController {
  private map: Map;
  private tempSource: VectorSource | null = null;
  private tempLayer: VectorLayer<VectorSource> | null = null;
  private draw: Draw | null = null;

  constructor(map: Map) {
    this.map = map;
  }

  private ensureTempLayer(): VectorSource {
    if (!this.tempSource) {
      this.tempSource = new VectorSource();
      this.tempLayer = new VectorLayer({ source: this.tempSource, properties: { id: '__edit_temp__' } });
      this.map.addLayer(this.tempLayer);
    }
    return this.tempSource;
  }

  startDraw(geomType: OgcGeometryType, onFinish: (geometry: GeoJSONGeometry) => void): void {
    this.cancel();
    const source = this.ensureTempLayer();
    const draw = new Draw({ source, type: DRAW_TYPE[geomType] });
    draw.on('drawend', (evt: DrawEvent) => {
      const geom = evt.feature.getGeometry();
      if (geom) onFinish(olGeometryTo4326GeoJSON(geom));
      // One-shot: end this draw so the sketch stays put until save/cancel.
      this.removeInteraction();
    });
    this.map.addInteraction(draw);
    this.draw = draw;
  }

  private removeInteraction(): void {
    if (this.draw) {
      this.map.removeInteraction(this.draw);
      this.draw = null;
    }
  }

  cancel(): void {
    this.removeInteraction();
    this.tempSource?.clear();
  }

  dispose(): void {
    this.cancel();
    if (this.tempLayer) {
      this.map.removeLayer(this.tempLayer);
      this.tempLayer = null;
      this.tempSource = null;
    }
  }
}
