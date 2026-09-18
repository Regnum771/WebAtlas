import { describe, it, expect } from 'vitest';
import { cropRect, canvasToPngBlob, ExportBlockedError } from './exportMap';

describe('cropRect', () => {
  it('crops a wide viewport to a portrait aspect, centred', () => {
    expect(cropRect(1000, 500, 210 / 297)).toEqual({ x: 323, y: 0, w: 354, h: 500 });
  });
  it('crops a tall viewport to a landscape aspect, centred', () => {
    expect(cropRect(600, 1000, 297 / 210)).toEqual({ x: 0, y: 288, w: 600, h: 424 });
  });
});

describe('canvasToPngBlob', () => {
  it('turns a SecurityError into ExportBlockedError', async () => {
    const canvas = { toBlob: () => { throw new DOMException('tainted', 'SecurityError'); } } as unknown as HTMLCanvasElement;
    await expect(canvasToPngBlob(canvas)).rejects.toBeInstanceOf(ExportBlockedError);
  });
});
