import { API_BASE_URL } from '../../../shared/config';
import { ApiError, getAuthToken, notifyUnauthorized } from '../../../shared/api/apiClient';
import type { Upload } from './workspace.api';

const BASE = `${API_BASE_URL}/api/workspace`;

/** The ApiError for a refused request; a 401 also runs the app's unauthorized callback. */
function errorFrom(status: number, text: string): ApiError {
  let code = 'HTTP_ERROR';
  let message = `Request failed (${status})`;
  let details: unknown;
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string; details?: unknown } };
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    // non-JSON error body; keep defaults
  }
  // An expired session ends the same way as in apiRequest.
  if (status === 401) notifyUnauthorized();
  return new ApiError(status, code, message, details);
}

/** POST the file as multipart field `file`, reporting progress as a 0..1 fraction. */
export function uploadFile(file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<Upload> {
  return new Promise<Upload>((resolve, reject) => {
    const aborted = () => new ApiError(0, 'ABORTED', 'Đã huỷ tải lên.');
    if (signal.aborted) {
      reject(aborted());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/uploads`);
    const token = getAuthToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve((JSON.parse(xhr.responseText) as { upload: Upload }).upload);
        } catch {
          reject(new ApiError(xhr.status, 'BAD_RESPONSE', 'Phản hồi không hợp lệ.'));
        }
      } else {
        reject(errorFrom(xhr.status, xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Network request failed'));
    xhr.onabort = () => reject(aborted());
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

function filenameFrom(header: string | null): string {
  if (header) {
    const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
    if (star) {
      try {
        return decodeURIComponent(star[1].trim());
      } catch {
        // fall through to the plain form
      }
    }
    const plain = /filename\s*=\s*"([^"]*)"/i.exec(header);
    if (plain) return plain[1];
  }
  return 'ban-do';
}

/** An authorized fetch of a succeeded export's file. */
export async function downloadJobFile(jobId: string): Promise<{ blob: Blob; filename: string }> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}/jobs/${jobId}/download`, { headers });
  } catch (e) {
    throw new ApiError(0, 'NETWORK_ERROR', e instanceof Error ? e.message : 'Network request failed');
  }
  if (!res.ok) throw errorFrom(res.status, await res.text().catch(() => ''));
  return { blob: await res.blob(), filename: filenameFrom(res.headers.get('Content-Disposition')) };
}

/** How long the object URL outlives the click, so the browser has started reading it. */
export const REVOKE_DELAY_MS = 60_000;

/**
 * Save a blob through a temporary object-URL link. The URL is revoked later, not right after the
 * click: some browsers start the download asynchronously and would find it already gone.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
