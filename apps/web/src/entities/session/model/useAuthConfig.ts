import { useEffect, useState } from 'react';
import { fetchAuthConfig } from '../api/session.api';
import type { AuthConfig } from './session.types';

let cached: Promise<AuthConfig> | null = null;

/** The API's sign-in options, asked once per page load; null until answered or when the API is unreachable. */
export function useAuthConfig(): AuthConfig | null {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  useEffect(() => {
    let live = true;
    cached ??= fetchAuthConfig().catch((e) => { cached = null; throw e; });
    cached.then((c) => { if (live) setConfig(c); }).catch(() => { /* password form only */ });
    return () => { live = false; };
  }, []);
  return config;
}
