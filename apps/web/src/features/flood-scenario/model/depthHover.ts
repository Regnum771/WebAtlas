import type { Map, MapBrowserEvent } from 'ol';
import Overlay from 'ol/Overlay';
import { depthAt, formatDepth, type FramePixels } from './depthColour';

/** Pixels of each frame URL, decoded once through a canvas (frames are served with CORS). */
const pixels = new globalThis.Map<string, Promise<FramePixels | null>>();

function framePixels(url: string): Promise<FramePixels | null> {
  let p = pixels.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve({ width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data });
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    pixels.set(url, p);
  }
  return p;
}

export interface DepthHoverInput { frameUrl: string; extent: readonly number[]; time: string }

/**
 * A small label by the cursor with the flood depth under it at the slider's hour, read from the
 * frame the map is drawing. Returns a function to update the frame and one to remove the hover.
 */
export function attachDepthHover(map: Map) {
  const el = document.createElement('div');
  el.className = 'flood-depth-tip';
  el.hidden = true;
  const overlay = new Overlay({ element: el, offset: [14, 14], positioning: 'top-left', stopEvent: false });
  map.addOverlay(overlay);
  let input: DepthHoverInput | null = null;
  let seq = 0;

  const onMove = (e: MapBrowserEvent) => {
    if (!input || e.dragging) { el.hidden = true; return; }
    const mine = ++seq;
    const { frameUrl, extent, time } = input;
    void framePixels(frameUrl).then((frame) => {
      if (mine !== seq) return;
      const m = frame ? depthAt(frame, extent, e.coordinate) : null;
      if (m === null) { el.hidden = true; return; }
      el.textContent = `Ngập ${formatDepth(m)} · ${time}`;
      el.hidden = false;
      overlay.setPosition(e.coordinate);
    });
  };
  const onOut = () => { seq++; el.hidden = true; };
  map.on('pointermove', onMove);
  map.getViewport().addEventListener('mouseleave', onOut);

  return {
    update(next: DepthHoverInput | null) { input = next; if (!next) onOut(); },
    remove() {
      map.un('pointermove', onMove);
      map.getViewport().removeEventListener('mouseleave', onOut);
      map.removeOverlay(overlay);
    },
  };
}
