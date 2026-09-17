import type { Map } from 'ol';

export class ExportBlockedError extends Error {
  constructor() {
    super('Không xuất được ảnh do máy chủ bản đồ nền chặn. Hãy thử đổi bản đồ nền.');
    this.name = 'ExportBlockedError';
  }
}

/** Largest centred rectangle of `aspect` (w/h) inside width × height. */
export function cropRect(width: number, height: number, aspect: number) {
  let w = width;
  let h = Math.round(width / aspect);
  if (h > height) {
    h = height;
    w = Math.round(height * aspect);
  }
  return { x: Math.round((width - w) / 2), y: Math.round((height - h) / 2), w, h };
}

/**
 * Composites every OpenLayers layer canvas into one canvas cropped to the paper
 * aspect — the official OL "export map" technique, plus a crop. Waits for
 * `rendercomplete` so tiles still loading are not captured half-drawn.
 */
export function exportMapCanvas(map: Map, aspect: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    map.once('rendercomplete', () => {
      try {
        const size = map.getSize();
        if (!size) throw new Error('Bản đồ chưa sẵn sàng.');
        const crop = cropRect(size[0], size[1], aspect);
        const out = document.createElement('canvas');
        out.width = crop.w;
        out.height = crop.h;
        const ctx = out.getContext('2d');
        if (!ctx) throw new Error('Trình duyệt không hỗ trợ xuất ảnh.');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, crop.w, crop.h);
        // Plain `canvas`, not `.ol-layer canvas`: the basemap TileLayer is built
        // with `className: 'basemap-tile-layer'` (MapModel.ts, for the DEM CSS
        // blend hook), which OpenLayers uses as the LAYER CONTAINER's className
        // instead of the default 'ol-layer' — the official OL "export map"
        // recipe's `.ol-layer canvas` selector then never matches the basemap's
        // own canvas, and the exported image silently drops the basemap tiles
        // while keeping every vector/context layer (still default 'ol-layer').
        // Every render canvas lives directly under the viewport regardless of
        // its container's class, and no other canvas is mounted there — the
        // controls in use (scale bar, mouse position) are plain DOM, not canvas.
        map.getViewport().querySelectorAll<HTMLCanvasElement>('canvas').forEach((canvas) => {
          if (canvas.width === 0) return;
          const parent = canvas.parentElement as HTMLElement | null;
          const opacity = parent?.style.opacity || canvas.style.opacity;
          ctx.globalAlpha = opacity === '' || opacity === undefined ? 1 : Number(opacity);
          const m = canvas.style.transform.match(/^matrix\(([^(]*)\)$/);
          const matrix = m
            ? m[1].split(',').map(Number)
            : [parseFloat(canvas.style.width) / canvas.width, 0, 0, parseFloat(canvas.style.height) / canvas.height, 0, 0];
          ctx.setTransform(1, 0, 0, 1, -crop.x, -crop.y);
          ctx.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
          const bg = parent?.style.backgroundColor;
          if (bg) {
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(canvas, 0, 0);
        });
        ctx.globalAlpha = 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        resolve(out);
      } catch (e) {
        reject(e);
      }
    });
    map.renderSync();
  });
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ExportBlockedError())), 'image/png');
    } catch (e) {
      reject(e instanceof DOMException && e.name === 'SecurityError' ? new ExportBlockedError() : e);
    }
  });
}
