import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { buildApp } from '../../server';
import { closePool, getPool } from '../../db/pool';
import { hashPassword } from '../../lib/password';

/**
 * The whole SSO round trip against a fake OIDC provider on a local port: discovery, keys, the
 * token endpoint and an ID token signed for the nonce the API put in the authorization URL.
 */
let app: ReturnType<typeof buildApp>;
let provider: Server;
let issuer = '';
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let jwk: JWK;
/** code -> claims the next token request returns; set by each test. */
const codes = new Map<string, Record<string, unknown>>();
let lastTokenRequest: URLSearchParams | null = null;

const CLIENT = 'webatlas-api';
const SECRET = 'client-secret';
const EMAIL_DOMAIN = '@sso.webatlas.test';
const OIDC_ENV = ['OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'WEB_ORIGIN'] as const;

beforeAll(async () => {
  // A developer's apps/api/.env may configure the real Keycloak; every test starts unconfigured.
  for (const k of OIDC_ENV) delete process.env[k];
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };

  provider = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    res.setHeader('content-type', 'application/json');
    if (url.pathname.endsWith('/.well-known/openid-configuration')) {
      res.end(JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/certs`,
        end_session_endpoint: `${issuer}/logout`,
      }));
    } else if (url.pathname.endsWith('/certs')) {
      res.end(JSON.stringify({ keys: [jwk] }));
    } else if (url.pathname.endsWith('/token')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      lastTokenRequest = new URLSearchParams(body);
      const auth = Buffer.from(String(req.headers.authorization ?? '').replace('Basic ', ''), 'base64').toString();
      const claims = codes.get(lastTokenRequest.get('code') ?? '');
      if (auth !== `${CLIENT}:${SECRET}` || !claims) { res.statusCode = 400; res.end('{"error":"invalid_grant"}'); return; }
      const idToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(issuer).setAudience(CLIENT).setIssuedAt().setExpirationTime('5m')
        .sign(privateKey);
      res.end(JSON.stringify({ id_token: idToken, access_token: 'unused' }));
    } else {
      res.statusCode = 404; res.end('{}');
    }
  });
  await new Promise<void>((r) => provider.listen(0, '127.0.0.1', () => r()));
  issuer = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/realms/test`;

  app = buildApp();
  await app.ready();
});

const setEnv = () => {
  process.env.OIDC_ISSUER_URL = issuer;
  process.env.OIDC_CLIENT_ID = CLIENT;
  process.env.OIDC_CLIENT_SECRET = SECRET;
  process.env.OIDC_REDIRECT_URI = 'http://localhost:3001/api/auth/oidc/callback';
  process.env.WEB_ORIGIN = 'http://localhost:5173';
};

afterEach(async () => {
  for (const k of OIDC_ENV) delete process.env[k];
  codes.clear();
  await getPool().query(`DELETE FROM app.users WHERE email LIKE $1`, [`%${EMAIL_DOMAIN}`]);
});

afterAll(async () => {
  await app.close();
  await closePool();
  await new Promise<void>((r) => provider.close(() => r()));
});

/** Starts a sign-in, then returns from the "provider" with a code whose ID token carries `claims`. */
async function roundTrip(claims: Record<string, unknown>, returnTo = '/ban-do') {
  const start = await app.inject({ method: 'GET', url: `/api/auth/oidc/login?returnTo=${encodeURIComponent(returnTo)}` });
  expect(start.statusCode).toBe(302);
  const authorize = new URL(String(start.headers.location));
  const cookie = String(start.headers['set-cookie']).split(';')[0];
  const code = `code-${Math.random()}`;
  codes.set(code, { nonce: authorize.searchParams.get('nonce'), ...claims });
  const back = await app.inject({
    method: 'GET',
    url: `/api/auth/oidc/callback?code=${code}&state=${authorize.searchParams.get('state')}`,
    headers: { cookie },
  });
  expect(back.statusCode).toBe(303);
  const location = new URL(String(back.headers.location));
  return { authorize, location, fragment: new URLSearchParams(location.hash.slice(1)) };
}

describe('SSO configuration', () => {
  it('offers no SSO when it is not configured, and the routes are absent', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/config' })).json()).toEqual({ sso: null });
    expect((await app.inject({ method: 'GET', url: '/api/auth/oidc/login' })).statusCode).toBe(404);
  });

  it('offers SSO with the provider sign-out returning to the web app', async () => {
    setEnv();
    const { sso } = (await app.inject({ method: 'GET', url: '/api/auth/config' })).json();
    expect(sso.loginPath).toBe('/api/auth/oidc/login');
    const end = new URL(sso.endSessionUrl);
    expect(end.origin + end.pathname).toBe(`${issuer}/logout`);
    expect(end.searchParams.get('client_id')).toBe(CLIENT);
    expect(end.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:5173/');
  });

  it('offers no SSO while the provider is unreachable', async () => {
    setEnv();
    process.env.OIDC_ISSUER_URL = 'http://127.0.0.1:1/realms/none';
    expect((await app.inject({ method: 'GET', url: '/api/auth/config' })).json()).toEqual({ sso: null });
  });
});

describe('SSO round trip', () => {
  it('sends the browser to the provider with PKCE, state and nonce in a signed HttpOnly cookie', async () => {
    setEnv();
    const start = await app.inject({ method: 'GET', url: '/api/auth/oidc/login?returnTo=/ban-do' });
    const authorize = new URL(String(start.headers.location));
    expect(authorize.origin + authorize.pathname).toBe(`${issuer}/auth`);
    expect(authorize.searchParams.get('client_id')).toBe(CLIENT);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('scope')).toBe('openid email profile');
    const cookie = String(start.headers['set-cookie']);
    expect(cookie).toMatch(/^webatlas_oidc=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/auth/oidc');
  });

  it('creates a reader on a first sign-in and hands a working token back in the fragment', async () => {
    setEnv();
    const email = `moi${EMAIL_DOMAIN}`;
    const { location, fragment } = await roundTrip({ sub: 'sub-new', email, email_verified: true, name: 'Người Mới' });
    expect(location.origin + location.pathname).toBe('http://localhost:5173/dang-nhap/xong');
    expect(fragment.get('returnTo')).toBe('/ban-do');
    expect(fragment.get('id_token')).toBeTruthy();
    expect(lastTokenRequest?.get('code_verifier')).toBeTruthy();
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${fragment.get('token')}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ email, role: 'viewer', isAdmin: false });
    const { rows } = await getPool().query(`SELECT oidc_subject, password_hash, full_name FROM app.users WHERE email = $1`, [email]);
    expect(rows[0]).toEqual({ oidc_subject: 'sub-new', password_hash: null, full_name: 'Người Mới' });
  });

  it('an SSO-only account cannot use the password sign-in', async () => {
    setEnv();
    const email = `chi-sso${EMAIL_DOMAIN}`;
    await roundTrip({ sub: 'sub-only', email, email_verified: true });
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'anything' } });
    expect(res.statusCode).toBe(401);
  });

  it('links an existing account by verified email, case-insensitively, and keeps its role', async () => {
    setEnv();
    const email = `co-san${EMAIL_DOMAIN}`;
    await getPool().query(
      `INSERT INTO app.users (email, password_hash, full_name, role) VALUES ($1, $2, 'Có Sẵn', 'admin')`,
      [email, await hashPassword('pw-123456')],
    );
    const { fragment } = await roundTrip({ sub: 'sub-link', email: email.toUpperCase(), email_verified: true });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${fragment.get('token')}` } });
    expect(me.json().user).toMatchObject({ email, role: 'admin' });
    const again = await roundTrip({ sub: 'sub-link', email: 'changed-at-provider@x.test', email_verified: true });
    expect(again.fragment.get('token')).toBeTruthy();
  });

  it('refuses to link by an unverified email', async () => {
    setEnv();
    const email = `chua-xac-minh${EMAIL_DOMAIN}`;
    await getPool().query(`INSERT INTO app.users (email, password_hash, role) VALUES ($1, $2, 'admin')`, [email, await hashPassword('pw-123456')]);
    const { fragment } = await roundTrip({ sub: 'sub-attacker', email, email_verified: false });
    expect(fragment.get('error')).toBe('email');
    expect(fragment.get('token')).toBeNull();
  });

  it('refuses an email already linked to another subject, and a deactivated account', async () => {
    setEnv();
    const email = `da-gan${EMAIL_DOMAIN}`;
    await roundTrip({ sub: 'sub-first', email, email_verified: true });
    expect((await roundTrip({ sub: 'sub-second', email, email_verified: true })).fragment.get('error')).toBe('conflict');
    await getPool().query(`UPDATE app.users SET is_active = false WHERE email = $1`, [email]);
    expect((await roundTrip({ sub: 'sub-first', email, email_verified: true })).fragment.get('error')).toBe('inactive');
  });

  it('refuses a callback without the matching state cookie', async () => {
    setEnv();
    const start = await app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    const noCookie = await app.inject({ method: 'GET', url: `/api/auth/oidc/callback?code=x&state=${state}` });
    expect(new URLSearchParams(new URL(String(noCookie.headers.location)).hash.slice(1)).get('error')).toBe('state');
    const cookie = String(start.headers['set-cookie']).split(';')[0];
    const wrong = await app.inject({ method: 'GET', url: `/api/auth/oidc/callback?code=x&state=other`, headers: { cookie } });
    expect(new URLSearchParams(new URL(String(wrong.headers.location)).hash.slice(1)).get('error')).toBe('state');
  });

  it('refuses an ID token minted for another sign-in (nonce mismatch)', async () => {
    setEnv();
    const { fragment } = await roundTrip({ sub: 'sub-replay', email: `replay${EMAIL_DOMAIN}`, email_verified: true, nonce: 'stolen' });
    expect(fragment.get('error')).toBe('failed');
  });

  it('passes on the provider refusing, and never returns off-site', async () => {
    setEnv();
    const start = await app.inject({ method: 'GET', url: '/api/auth/oidc/login?returnTo=https://evil.example/' });
    const cookie = String(start.headers['set-cookie']).split(';')[0];
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    const denied = await app.inject({ method: 'GET', url: `/api/auth/oidc/callback?error=access_denied&state=${state}`, headers: { cookie } });
    expect(new URLSearchParams(new URL(String(denied.headers.location)).hash.slice(1)).get('error')).toBe('access_denied');
    const { fragment } = await roundTrip({ sub: 'sub-off', email: `off${EMAIL_DOMAIN}`, email_verified: true }, 'https://evil.example/');
    expect(fragment.get('returnTo')).toBe('/');
  });
});
