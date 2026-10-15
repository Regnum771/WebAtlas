import { describe, it, expect, vi, afterEach } from 'vitest';
import { preloadFrames } from './flood.api';

const realImage = globalThis.Image;
afterEach(() => { globalThis.Image = realImage; });

describe('preloadFrames', () => {
  it('loads frames in the CORS mode the map draws them with, so playback reuses the cached image', async () => {
    const seen: (string | null)[] = [];
    globalThis.Image = class {
      crossOrigin: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) { seen.push(this.crossOrigin); queueMicrotask(() => this.onload?.()); }
    } as unknown as typeof Image;
    const progress = vi.fn();
    await preloadFrames('kttv-2025-10', 2, progress);
    expect(seen).toEqual(['anonymous', 'anonymous', 'anonymous']);
    expect(progress).toHaveBeenLastCalledWith(3);
  });
});
