import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setAuthToken, ApiError } from '../../../shared/api/apiClient';
import { uploadFile, downloadJobFile } from './transfer';

class FakeXhr {
  static last: FakeXhr;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = '';
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  aborted = false;
  constructor() { FakeXhr.last = this; }
  open(m: string, u: string) { this.method = m; this.url = u; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(b: unknown) { this.body = b; }
  abort() { this.aborted = true; this.onabort?.(); }
}

describe('uploadFile', () => {
  beforeEach(() => { vi.stubGlobal('XMLHttpRequest', FakeXhr); setAuthToken('tok'); });
  afterEach(() => { setAuthToken(null); });

  it('reports progress, resolves the upload, and an abort rejects with ABORTED', async () => {
    const file = new File(['abc'], 'a.zip');
    const progress = vi.fn();
    const p = uploadFile(file, progress, new AbortController().signal);
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toMatch(/\/api\/workspace\/uploads$/);
    expect(xhr.headers.Authorization).toBe('Bearer tok');
    expect((xhr.body as FormData).get('file')).toBeInstanceOf(File);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    expect(progress).toHaveBeenCalledWith(0.25);
    xhr.status = 201;
    xhr.responseText = JSON.stringify({ upload: { id: 'u1', originalName: 'a.zip', sizeBytes: 3, createdAt: 'x' } });
    xhr.onload?.();
    await expect(p).resolves.toMatchObject({ id: 'u1' });

    const ac = new AbortController();
    const p2 = uploadFile(file, vi.fn(), ac.signal);
    ac.abort();
    await expect(p2).rejects.toMatchObject({ status: 0, code: 'ABORTED' });
    expect(FakeXhr.last.aborted).toBe(true);
  });

  it('rejects with an ApiError built from the error body', async () => {
    const p = uploadFile(new File(['a'], 'a.zip'), vi.fn(), new AbortController().signal);
    const xhr = FakeXhr.last;
    xhr.status = 413;
    xhr.responseText = JSON.stringify({ error: { code: 'QUOTA', message: 'Hết dung lượng.' } });
    xhr.onload?.();
    await expect(p).rejects.toBeInstanceOf(ApiError);
    await expect(p).rejects.toMatchObject({ status: 413, code: 'QUOTA', message: 'Hết dung lượng.' });
  });
});

describe('downloadJobFile', () => {
  afterEach(() => { setAuthToken(null); });

  it('sends the token and reads filename* from Content-Disposition', async () => {
    setAuthToken('tok');
    const blob = new Blob(['x']);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'Content-Disposition': "attachment; filename*=UTF-8''B%E1%BA%A3n%20%C4%91%E1%BB%93.gpkg" }),
      blob: async () => blob,
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await downloadJobFile('j1');
    expect(r.filename).toBe('Bản đồ.gpkg');
    expect(r.blob).toBe(blob);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/workspace\/jobs\/j1\/download$/);
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('falls back to filename="…" and then to ban-do', async () => {
    const mk = (cd: string | null) => vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: new Headers(cd ? { 'Content-Disposition': cd } : {}), blob: async () => new Blob(),
    });
    vi.stubGlobal('fetch', mk('attachment; filename="x.zip"'));
    expect((await downloadJobFile('j')).filename).toBe('x.zip');
    vi.stubGlobal('fetch', mk(null));
    expect((await downloadJobFile('j')).filename).toBe('ban-do');
  });
});
