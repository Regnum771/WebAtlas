import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { OidcConfig } from '../../config/env';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

/** What the API needs from a verified ID token. */
export interface OidcIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** Carried through the provider round trip in a signed, HttpOnly cookie. */
export interface LoginState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  /** Epoch ms after which the round trip is refused. */
  exp: number;
}

export const STATE_COOKIE = 'webatlas_oidc';
export const STATE_TTL_MS = 10 * 60_000;

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (secret: string, body: string) => createHmac('sha256', secret).update(`oidc-state.${body}`).digest('base64url');

/** A dedicated HMAC (not a JWT under the API's signing key), so the cookie can never pass as a bearer token. */
export function signState(s: LoginState, secret: string): string {
  const body = b64url(JSON.stringify(s));
  return `${body}.${mac(secret, body)}`;
}

export function verifyState(value: string | undefined, secret: string, now = Date.now()): LoginState | null {
  if (!value) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(mac(secret, body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LoginState;
    return typeof s.exp === 'number' && s.exp > now ? s : null;
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** Only an in-app path: anything else could send a user off-site after signing in. */
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}

export function newLoginState(returnTo: string, now = Date.now()): LoginState {
  return {
    state: b64url(randomBytes(24)),
    nonce: b64url(randomBytes(24)),
    verifier: b64url(randomBytes(32)),
    returnTo: safeReturnTo(returnTo),
    exp: now + STATE_TTL_MS,
  };
}

export class OidcError extends Error {
  constructor(readonly code: 'unavailable' | 'exchange' | 'token', message: string) {
    super(message);
    this.name = 'OidcError';
  }
}

/** One client per configuration: the discovery document and the signing keys are fetched once and reused. */
export function oidcClient(cfg: OidcConfig, fetchFn: typeof fetch = fetch) {
  let discovery: Promise<Discovery> | null = null;
  let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  function discover(): Promise<Discovery> {
    discovery ??= (async () => {
      const res = await fetchFn(`${cfg.issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(3_000) });
      if (!res.ok) throw new OidcError('unavailable', `discovery answered ${res.status}`);
      const d = (await res.json()) as Discovery;
      if (d.issuer.replace(/\/+$/, '') !== cfg.issuer) throw new OidcError('unavailable', `issuer mismatch: ${d.issuer}`);
      return d;
    })().catch((e) => {
      discovery = null;
      throw e instanceof OidcError ? e : new OidcError('unavailable', String(e));
    });
    return discovery;
  }

  return {
    discover,

    async authorizationUrl(s: LoginState): Promise<string> {
      const d = await discover();
      const url = new URL(d.authorization_endpoint);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        scope: 'openid email profile',
        state: s.state,
        nonce: s.nonce,
        code_challenge: createHash('sha256').update(s.verifier).digest('base64url'),
        code_challenge_method: 'S256',
      }).toString();
      return url.toString();
    },

    /** The provider's sign-out, returning to the web app; the caller adds id_token_hint. */
    async endSessionUrl(): Promise<string | null> {
      const d = await discover();
      if (!d.end_session_endpoint) return null;
      const url = new URL(d.end_session_endpoint);
      url.searchParams.set('client_id', cfg.clientId);
      url.searchParams.set('post_logout_redirect_uri', `${cfg.webOrigin}/`);
      return url.toString();
    },

    /** Exchanges the code and verifies the ID token: signature, issuer, audience, expiry and nonce. */
    async redeem(code: string, s: LoginState): Promise<{ identity: OidcIdentity; idToken: string }> {
      const d = await discover();
      const basic = Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString('base64');
      const res = await fetchFn(d.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, code_verifier: s.verifier }),
        signal: AbortSignal.timeout(5_000),
      }).catch((e) => { throw new OidcError('unavailable', String(e)); });
      if (!res.ok) throw new OidcError('exchange', `token endpoint answered ${res.status}`);
      const body = (await res.json()) as { id_token?: string };
      if (!body.id_token) throw new OidcError('exchange', 'no id_token in the token response');

      jwks ??= createRemoteJWKSet(new URL(d.jwks_uri));
      let claims;
      try {
        ({ payload: claims } = await jwtVerify(body.id_token, jwks, { issuer: d.issuer, audience: cfg.clientId }));
      } catch (e) {
        throw new OidcError('token', `id_token rejected: ${(e as Error).message}`);
      }
      if (claims.nonce !== s.nonce) throw new OidcError('token', 'nonce mismatch');
      if (typeof claims.sub !== 'string' || claims.sub === '') throw new OidcError('token', 'no subject');
      const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
      return {
        idToken: body.id_token,
        identity: {
          subject: claims.sub,
          email: str(claims.email)?.toLowerCase() ?? null,
          emailVerified: claims.email_verified === true,
          name: str(claims.name) ?? str(claims.preferred_username),
        },
      };
    },
  };
}

export type OidcClient = ReturnType<typeof oidcClient>;
