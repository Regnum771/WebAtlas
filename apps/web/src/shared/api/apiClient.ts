import { API_BASE_URL } from '../config';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;
let unauthorizedCb: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}
/** The current bearer token, for requests that cannot go through apiRequest (XHR upload, blob download). */
export function getAuthToken(): string | null {
  return authToken;
}
export function onUnauthorized(cb: () => void): void {
  unauthorizedCb = cb;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  // A FormData body needs the browser's own multipart Content-Type (with its boundary).
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (!headers['Content-Type'] && init.body && !isForm) headers['Content-Type'] = 'application/json';
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch (e) {
    throw new ApiError(0, 'NETWORK_ERROR', e instanceof Error ? e.message : 'Network request failed');
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  let code = 'HTTP_ERROR';
  let message = `Request failed (${res.status})`;
  let details: unknown;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    // non-JSON error body; keep defaults
  }

  if (res.status === 401 && unauthorizedCb) unauthorizedCb();
  throw new ApiError(res.status, code, message, details);
}
