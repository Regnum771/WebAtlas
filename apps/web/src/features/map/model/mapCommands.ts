import type { Map } from 'ol';
import { fromLonLat } from 'ol/proj';
import {
  REGION_PROVINCE_NAMES,
  type BasemapName,
  type MapCommand,
} from '@webatlas/shared';
import type { BasemapType } from './MapModel';
import { PROVINCE_CENTROIDS } from './provinceCentroids';
import { MIN_ZOOM, MAX_ZOOM, INITIAL_CENTER_4326, INITIAL_ZOOM } from './zoomScale';

// Guard: BasemapName (shared contract) and BasemapType (MapModel) are independent
// types with the same literal set. If either drifts, this fails to compile.
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _basemapTypesMatch: AssertEqual<BasemapName, BasemapType> = true;
void _basemapTypesMatch;

export interface CommandDeps {
  map: Map | null;
  setBasemap: (basemap: BasemapName) => void;
  toggleLayerVisibility: (layerStateId: string) => void;
  setLayerOpacity: (layerStateId: string, opacity: number) => void;
  getLayerVisible: (layerStateId: string) => boolean;
  /**
   * Does this layerStateId exist in the current layersState? `isMapCommand`
   * checks against the fixed LAYER_STATE_IDS set, but that only guards
   * assistant-produced commands routed through the API; a UI-issued MapCommand
   * skips that check entirely. Without this, a bogus id would sail through
   * setLayerVisible/setLayerOpacity and still be reported as `ok: true`.
   */
  layerExists: (layerStateId: string) => boolean;
}

export type CommandResult = { ok: true; text: string } | { ok: false; reason: string };

const FEATURE_ZOOM = 12;
const PROVINCE_ZOOM = 9;
const ANIMATE_MS = 800;
// Faster than ANIMATE_MS: a zoom-button step is a small, local nudge (one scale
// stop), not a long jump across the map like zoomToRegion/zoomToFeature — this
// matches the 250ms the zoom buttons animated with before this command existed.
const ZOOM_STEP_ANIMATE_MS = 250;

/**
 * Executes MapCommands against OpenLayers. Dependencies are injected so this is
 * testable without a browser; the OL import is confined to this module.
 */
export function createCommandExecutor(deps: CommandDeps) {
  function animateTo(lonLat: [number, number], zoom: number): boolean {
    if (!deps.map) return false;
    deps.map.getView().animate({ center: fromLonLat(lonLat), zoom, duration: ANIMATE_MS });
    return true;
  }

  return function run(cmd: MapCommand): CommandResult {
    switch (cmd.kind) {
      case 'zoomToFeature': {
        if (!animateTo(cmd.lonLat, FEATURE_ZOOM)) return { ok: false, reason: 'Bản đồ chưa sẵn sàng.' };
        return { ok: true, text: 'Đã phóng to tới đối tượng đã chọn.' };
      }
      case 'zoomToRegion': {
        const centre = PROVINCE_CENTROIDS[cmd.provinceCode];
        if (!centre) return { ok: false, reason: 'Không có toạ độ cho tỉnh này.' };
        if (!animateTo(centre, PROVINCE_ZOOM)) return { ok: false, reason: 'Bản đồ chưa sẵn sàng.' };
        return { ok: true, text: `Đã phóng to tới ${REGION_PROVINCE_NAMES[cmd.provinceCode]}.` };
      }
      case 'resetView': {
        if (!animateTo(INITIAL_CENTER_4326, INITIAL_ZOOM)) return { ok: false, reason: 'Bản đồ chưa sẵn sàng.' };
        return { ok: true, text: 'Đã về vùng công tác.' };
      }
      case 'zoomTo': {
        if (!deps.map) return { ok: false, reason: 'Bản đồ chưa sẵn sàng.' };
        const view = deps.map.getView();
        const min = view.getMinZoom?.() ?? MIN_ZOOM;
        const max = view.getMaxZoom?.() ?? MAX_ZOOM;
        const zoom = Math.min(max, Math.max(min, cmd.zoom));
        view.animate({ zoom, duration: ZOOM_STEP_ANIMATE_MS });
        return { ok: true, text: 'Đã đổi mức thu phóng.' };
      }
      case 'setLayerVisible': {
        if (!deps.layerExists(cmd.layerStateId)) {
          return { ok: false, reason: 'Không tìm thấy lớp dữ liệu.' };
        }
        if (deps.getLayerVisible(cmd.layerStateId) !== cmd.visible) {
          deps.toggleLayerVisibility(cmd.layerStateId);
        }
        return { ok: true, text: cmd.visible ? 'Đã bật lớp dữ liệu.' : 'Đã tắt lớp dữ liệu.' };
      }
      case 'setLayerOpacity': {
        if (!deps.layerExists(cmd.layerStateId)) {
          return { ok: false, reason: 'Không tìm thấy lớp dữ liệu.' };
        }
        deps.setLayerOpacity(cmd.layerStateId, cmd.opacity);
        return { ok: true, text: `Đã đặt độ mờ ${Math.round(cmd.opacity * 100)}%.` };
      }
      case 'setBasemap': {
        deps.setBasemap(cmd.basemap);
        return { ok: true, text: 'Đã đổi bản đồ nền.' };
      }
    }
  };
}
