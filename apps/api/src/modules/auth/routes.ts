import type { FastifyInstance, FastifyReply } from 'fastify';
import { loginHandler, meHandler } from './controller';
import { config, oidcConfig, type OidcConfig } from '../../config/env';
import {
  newLoginState, oidcClient, readCookie, signState, verifyState,
  STATE_COOKIE, STATE_TTL_MS, type OidcClient,
} from './oidc';
import { resolveSsoUser } from './sso';

const LOGIN_PATH = '/api/auth/oidc/login';
const COOKIE_PATH = '/api/auth/oidc';

function stateCookie(value: string, maxAgeS: number, secure: boolean): string {
  return [
    `${STATE_COOKIE}=${encodeURIComponent(value)}`, `Path=${COOKIE_PATH}`, `Max-Age=${maxAgeS}`,
    'HttpOnly', 'SameSite=Lax', ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, loginHandler);
  app.get('/me', { preHandler: app.authenticate }, meHandler);

  // Re-read per request so a test (or an operator restart with new env) needs no rebuild of the
  // app; the client is cached per configuration so discovery and keys are fetched once.
  let client: { key: string; c: OidcClient } | null = null;
  const sso = (): { cfg: OidcConfig; c: OidcClient } | null => {
    const cfg = oidcConfig();
    if (!cfg) return null;
    const key = JSON.stringify(cfg);
    if (client?.key !== key) client = { key, c: oidcClient(cfg) };
    return { cfg, c: client.c };
  };

  /** Public: what the sign-in dialog offers. No SSO when it is unconfigured or the provider is unreachable. */
  app.get('/config', async () => {
    const s = sso();
    if (!s) return { sso: null };
    try {
      const endSessionUrl = await s.c.endSessionUrl();
      return { sso: endSessionUrl ? { loginPath: LOGIN_PATH, endSessionUrl } : null };
    } catch (e) {
      app.log.warn({ err: e }, 'SSO provider unreachable; offering the password sign-in only');
      return { sso: null };
    }
  });

  const handBack = (reply: FastifyReply, cfg: OidcConfig, fragment: Record<string, string>, secure: boolean) => {
    reply.header('set-cookie', stateCookie('', 0, secure));
    reply.header('cache-control', 'no-store');
    // The token rides in the fragment: it never reaches a server log or a Referer header.
    return reply.redirect(`${cfg.webOrigin}/dang-nhap/xong#${new URLSearchParams(fragment).toString()}`, 303);
  };

  app.get<{ Querystring: { returnTo?: string } }>(
    '/oidc/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const s = sso();
      if (!s) return reply.code(404).send({ error: { code: 'SSO_DISABLED', message: 'Single sign-on is not configured' } });
      const state = newLoginState(req.query.returnTo ?? '/');
      let url: string;
      try {
        url = await s.c.authorizationUrl(state);
      } catch (e) {
        app.log.error({ err: e }, 'SSO provider unreachable');
        return handBack(reply, s.cfg, { error: 'unavailable' }, req.protocol === 'https');
      }
      reply.header('set-cookie', stateCookie(signState(state, config.JWT_SECRET), STATE_TTL_MS / 1000, req.protocol === 'https'));
      reply.header('cache-control', 'no-store');
      return reply.redirect(url, 302);
    },
  );

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/oidc/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const s = sso();
      if (!s) return reply.code(404).send({ error: { code: 'SSO_DISABLED', message: 'Single sign-on is not configured' } });
      const secure = req.protocol === 'https';
      const saved = verifyState(readCookie(req.headers.cookie, STATE_COOKIE), config.JWT_SECRET);
      if (req.query.error) return handBack(reply, s.cfg, { error: req.query.error === 'access_denied' ? 'access_denied' : 'failed' }, secure);
      if (!saved || !req.query.state || req.query.state !== saved.state || !req.query.code) {
        return handBack(reply, s.cfg, { error: 'state' }, secure);
      }
      let redeemed;
      try {
        redeemed = await s.c.redeem(req.query.code, saved);
      } catch (e) {
        app.log.error({ err: e }, 'SSO code exchange or ID token check failed');
        return handBack(reply, s.cfg, { error: 'failed' }, secure);
      }
      const result = await resolveSsoUser(app, redeemed.identity);
      if ('refused' in result) return handBack(reply, s.cfg, { error: result.refused }, secure);
      const token = app.jwt.sign({ sub: result.user.id, role: result.user.role });
      return handBack(reply, s.cfg, { token, id_token: redeemed.idToken, returnTo: saved.returnTo }, secure);
    },
  );
}
