# Plan 4 — API Control Plane (Fastify: global middleware + auth + users) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Fastify API on top of the existing `apps/api` workspace — the layered architecture with globally-injected cross-cutting concerns, a typed error hierarchy, JWT authentication with argon2 password hashing, RBAC authorization, and admin user CRUD with audit logging — plus a bootstrap-admin script. Deliverable: a login + user-management API (the control plane the later editing plans build on).

**Architecture:** Strict layering `Routes → Controllers → Services → Repositories → DB pool` (design §6.1). Cross-cutting concerns (CORS, helmet, rate-limit, request-id/logging, JWT verify, RBAC, central error handling, DB pool) are Fastify plugins/hooks registered once in `buildApp()` (§6.2). The JWT *mechanism* is a global plugin (`plugins/authentication.ts`) + a global hook (`hooks/authorization.ts`); the auth *feature* (login/me endpoints) and users *feature* (CRUD) are local modules (§6.3).

**Tech Stack:** Fastify 5, `@fastify/cors`/`@fastify/helmet`/`@fastify/rate-limit`/`@fastify/jwt`, `@node-rs/argon2` (prebuilt argon2 — no node-gyp), `zod`, `pg`, Vitest (Fastify `inject`). Builds on Plan 2's `apps/api` (pool, `app.users`, `app.audit_log`).

## Global Constraints

- Node 22 / npm 10 workspaces. All work in `apps/api`. Depends on Plan 2 (the `app.users`/`app.audit_log` migrations + `src/db/pool.ts` `getPool()`).
- The Docker stack (PostGIS) must be up for integration tests. Tests use Fastify `inject` against the dev DB and clean up their own rows (test emails end `@webatlas.test`); do not touch non-test rows.
- **Security (design §10):** passwords argon2-hashed; JWT signed from `JWT_SECRET` (env) with a short expiry; CORS locked to `CORS_ORIGIN`; helmet on; rate-limit global + stricter on `/api/auth/login`; parameterized SQL only; every user write recorded in `app.audit_log`. Never return `password_hash`.
- **Error contract:** all errors serialize to `{ "error": { "code": string, "message": string, "details"?: unknown } }` with the HTTP status from the typed error. Services/repositories `throw` typed errors; only `errorHandler` formats HTTP.
- **Layering rule:** routes attach schema+guards and call a controller; controllers validate (zod) + shape responses; services hold business logic + audit; repositories do parameterized SQL only. No SQL in controllers; no HTTP in services/repositories.
- `app.users.role` is the enum `'admin' | 'editor' | 'viewer'`; user CRUD + this plan's admin-only routes require role `admin`.

## Directory layout (end state)

```
apps/api/src/
  server.ts                 # buildApp(): register plugins (ordered) + modules; returns FastifyInstance
  start.ts                  # listen entrypoint (npm run dev/start)
  config/env.ts             # zod-validated env -> typed config
  plugins/
    db.ts                   # decorate app.pg (pool) + onClose
    security.ts             # cors + helmet + rate-limit
    authentication.ts       # @fastify/jwt + `authenticate` decorator (verify + load user)
    errorHandler.ts         # setErrorHandler + setNotFoundHandler + response error shape
  hooks/
    authorization.ts        # authorize(...roles) preHandler factory
  errors/index.ts           # AppError + typed subclasses
  lib/
    password.ts             # argon2 hash/verify
    validate.ts             # zod parse -> ValidationError
  modules/
    auth/   { routes.ts, controller.ts, service.ts }
    users/  { routes.ts, controller.ts, service.ts, repository.ts, schemas.ts }
    audit/  service.ts
  scripts/create-admin.ts   # bootstrap the first admin
  types/fastify.d.ts        # augment FastifyInstance (pg, authenticate) + FastifyRequest (currentUser)
  db/pool.ts                # (existing) getPool()
```

---

### Task 1: Fastify app skeleton + config + DB plugin + `/health`

**Files:**
- Modify: `apps/api/package.json` (deps + scripts), `apps/api/.env.example`
- Create: `apps/api/src/config/env.ts`, `apps/api/src/types/fastify.d.ts`, `apps/api/src/plugins/db.ts`, `apps/api/src/server.ts`, `apps/api/src/start.ts`, `apps/api/src/server.test.ts`

**Interfaces:**
- Produces: `buildApp(): FastifyInstance` (registers plugins + a `GET /health`), `config` (typed env), `app.pg` (the `pg.Pool`).

- [ ] **Step 1: Add dependencies + scripts**

In `apps/api/package.json`, add to `dependencies`:
```json
    "fastify": "^5.2.0",
    "@fastify/cors": "^10.0.1",
    "@fastify/helmet": "^12.0.1",
    "@fastify/jwt": "^9.0.1",
    "@fastify/rate-limit": "^10.1.1",
    "@node-rs/argon2": "^2.0.2",
    "zod": "^3.23.8"
```
and to `scripts`:
```json
    "dev": "tsx watch src/start.ts",
    "start": "tsx src/start.ts",
    "create-admin": "tsx src/scripts/create-admin.ts"
```
Then from repo root: `npm install`.

- [ ] **Step 2: Env config**

Create `apps/api/src/config/env.ts`:
```ts
import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export const config: AppConfig = EnvSchema.parse(process.env);
```

- [ ] **Step 3: Extend the env template**

Append to `apps/api/.env.example`:
```dotenv
# API
JWT_SECRET=change_me_dev_secret_at_least_16_chars
JWT_EXPIRES_IN=12h
API_PORT=3001
API_HOST=0.0.0.0
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```
Then update your local `apps/api/.env` with the same keys (JWT_SECRET set to any ≥16-char string).

- [ ] **Step 4: Fastify type augmentation**

Create `apps/api/src/types/fastify.d.ts`:
```ts
import type { Pool } from 'pg';
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface CurrentUser {
  id: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
}

declare module 'fastify' {
  interface FastifyInstance {
    pg: Pool;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
}
```

- [ ] **Step 5: DB plugin**

Create `apps/api/src/plugins/db.ts`:
```ts
import fp from 'fastify-plugin';
import { getPool, closePool } from '../db/pool';

export default fp(async (app) => {
  app.decorate('pg', getPool());
  app.addHook('onClose', async () => {
    await closePool();
  });
});
```
> `fastify-plugin` ships as a dependency of Fastify's ecosystem; if the import fails, add `"fastify-plugin": "^5.0.1"` to dependencies and `npm install`.

- [ ] **Step 6: App builder + health route + entrypoint**

Create `apps/api/src/server.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify';
import dbPlugin from './plugins/db';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.NODE_ENV === 'test' ? 'silent' : 'info' },
    genReqId: () => crypto.randomUUID(),
  });

  app.register(dbPlugin);

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
```

Create `apps/api/src/start.ts`:
```ts
import { buildApp } from './server';
import { config } from './config/env';

const app = buildApp();
app
  .listen({ port: config.API_PORT, host: config.API_HOST })
  .then((addr) => app.log.info(`API listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
```

- [ ] **Step 7: Write the failing test**

Create `apps/api/src/server.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from './server';

const app = buildApp();

afterAll(async () => {
  await app.close();
});

describe('app skeleton', () => {
  it('serves GET /health', async () => {
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 8: Run test → PASS; verify server starts**

Run from repo root:
```bash
npm run test:api
```
Expected: the `/health` test passes (the earlier Plan 2 db/seed tests still pass too). Optionally `npm run dev -w @webatlas/api` and `curl localhost:3001/health` → `{"status":"ok"}`, then stop it.

- [ ] **Step 9: Commit**

```bash
git add apps/api/ package-lock.json
git commit -m "feat(api): Fastify app skeleton with config, db plugin, health route"
```

---

### Task 2: Typed error hierarchy + central error handler + not-found

**Files:**
- Create: `apps/api/src/errors/index.ts`, `apps/api/src/plugins/errorHandler.ts`, `apps/api/src/lib/validate.ts`, `apps/api/src/plugins/errorHandler.test.ts`
- Modify: `apps/api/src/server.ts` (register errorHandler; add a test-only throwing route in the test via a local app)

**Interfaces:**
- Produces: `AppError` + `ValidationError`(400), `AuthError`(401), `ForbiddenError`(403), `NotFoundError`(404), `ConflictError`(409), `GeometryError`(422), `InternalError`(500); `errorHandlerPlugin`; `validate(schema, data)` → parsed value or throws `ValidationError`.

- [ ] **Step 1: Error hierarchy**

Create `apps/api/src/errors/index.ts`:
```ts
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) { super(400, 'VALIDATION_ERROR', message, details); }
}
export class AuthError extends AppError {
  constructor(message = 'Authentication required') { super(401, 'AUTH_ERROR', message); }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') { super(403, 'FORBIDDEN', message); }
}
export class NotFoundError extends AppError {
  constructor(message = 'Not found') { super(404, 'NOT_FOUND', message); }
}
export class ConflictError extends AppError {
  constructor(message = 'Conflict') { super(409, 'CONFLICT', message); }
}
export class GeometryError extends AppError {
  constructor(message = 'Invalid geometry', details?: unknown) { super(422, 'GEOMETRY_ERROR', message, details); }
}
export class InternalError extends AppError {
  constructor(message = 'Internal server error') { super(500, 'INTERNAL_ERROR', message); }
}
```

- [ ] **Step 2: zod validation helper**

Create `apps/api/src/lib/validate.ts`:
```ts
import type { ZodSchema } from 'zod';
import { ValidationError } from '../errors';

export function validate<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Validation failed', result.error.flatten());
  }
  return result.data;
}
```

- [ ] **Step 3: Error handler plugin**

Create `apps/api/src/plugins/errorHandler.ts`:
```ts
import fp from 'fastify-plugin';
import { AppError, InternalError, NotFoundError } from '../errors';

export default fp(async (app) => {
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  app.setErrorHandler((err, req, reply) => {
    // @fastify/rate-limit sets statusCode 429; Fastify validation sets err.validation
    let appErr: AppError;
    if (err instanceof AppError) {
      appErr = err;
    } else if ((err as { statusCode?: number }).statusCode === 429) {
      appErr = new AppError(429, 'RATE_LIMITED', 'Too many requests');
    } else {
      req.log.error(err);
      appErr = new InternalError();
    }
    if (appErr.statusCode >= 500) req.log.error(err);
    reply.code(appErr.statusCode).send({
      error: { code: appErr.code, message: appErr.message, ...(appErr.details ? { details: appErr.details } : {}) },
    });
  });
  void NotFoundError; // referenced by modules; keep import tree-shake-safe
});
```

- [ ] **Step 4: Register the error handler in `buildApp`**

In `apps/api/src/server.ts`, register it right after creating `app` (before routes):
```ts
import errorHandler from './plugins/errorHandler';
// ...
  app.register(errorHandler);
  app.register(dbPlugin);
```

- [ ] **Step 5: Write the failing test**

Create `apps/api/src/plugins/errorHandler.test.ts`:
```ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import Fastify from 'fastify';
import errorHandler from './errorHandler';
import { validate } from '../lib/validate';
import { z } from 'zod';
import { ForbiddenError, ConflictError } from '../errors';

const app = Fastify({ logger: false });
beforeAll(async () => {
  await app.register(errorHandler);
  app.get('/forbidden', async () => { throw new ForbiddenError('nope'); });
  app.get('/conflict', async () => { throw new ConflictError('dup'); });
  app.post('/validated', async (req) => validate(z.object({ n: z.number() }), req.body));
  app.get('/boom', async () => { throw new Error('unexpected'); });
  await app.ready();
});
afterAll(async () => { await app.close(); });

describe('error handler', () => {
  it('maps typed errors to their status + shape', async () => {
    const f = await app.inject({ method: 'GET', url: '/forbidden' });
    expect(f.statusCode).toBe(403);
    expect(f.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'nope' } });
    const c = await app.inject({ method: 'GET', url: '/conflict' });
    expect(c.statusCode).toBe(409);
    expect(c.json().error.code).toBe('CONFLICT');
  });
  it('maps zod validation failure to 400 with details', async () => {
    const res = await app.inject({ method: 'POST', url: '/validated', payload: { n: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.details).toBeDefined();
  });
  it('maps unknown errors to 500 without leaking the message', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
  it('unmatched route -> 404 shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 6: Run test → PASS** (`npm run test:api`); then **commit**

```bash
git add apps/api/src/errors apps/api/src/lib/validate.ts apps/api/src/plugins/errorHandler.ts apps/api/src/plugins/errorHandler.test.ts apps/api/src/server.ts
git commit -m "feat(api): typed error hierarchy + central error handler + zod validate"
```

---

### Task 3: Security plugins — CORS, helmet, rate-limit

**Files:**
- Create: `apps/api/src/plugins/security.ts`, `apps/api/src/plugins/security.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Produces: `securityPlugin` registering `@fastify/cors` (origin = `config.CORS_ORIGIN`), `@fastify/helmet`, and a global `@fastify/rate-limit` (max 100/min). Exposes a named config so `/api/auth/login` can tighten it later.

- [ ] **Step 1: Security plugin**

Create `apps/api/src/plugins/security.ts`:
```ts
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config/env';

export default fp(async (app) => {
  await app.register(helmet);
  await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true });
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
});
```

- [ ] **Step 2: Register in `buildApp`** (after errorHandler, before dbPlugin):
```ts
import security from './plugins/security';
// ...
  app.register(errorHandler);
  app.register(security);
  app.register(dbPlugin);
```

- [ ] **Step 3: Write the test**

Create `apps/api/src/plugins/security.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../server';

const app = buildApp();
afterAll(async () => { await app.close(); });

describe('security plugins', () => {
  it('sets helmet headers and rate-limit headers on /health', async () => {
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-frame-options'] ?? res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
  });
});
```

- [ ] **Step 4: Run test → PASS**; **commit**

```bash
git add apps/api/src/plugins/security.ts apps/api/src/plugins/security.test.ts apps/api/src/server.ts
git commit -m "feat(api): CORS + helmet + rate-limit security plugins"
```

---

### Task 4: Password lib + JWT/authentication plugin + authorization hook + users repository + create-admin

**Files:**
- Create: `apps/api/src/lib/password.ts`, `apps/api/src/plugins/authentication.ts`, `apps/api/src/hooks/authorization.ts`, `apps/api/src/modules/users/repository.ts`, `apps/api/src/scripts/create-admin.ts`, `apps/api/src/lib/password.test.ts`
- Modify: `apps/api/src/server.ts` (register authentication)

**Interfaces:**
- Produces: `hashPassword`/`verifyPassword`; `authenticationPlugin` (registers `@fastify/jwt`, decorates `app.authenticate` = verify JWT → load active user → set `request.currentUser`); `authorize(...roles)` preHandler factory; `usersRepository` (`findByEmailWithHash`, `findById`, `list`, `insert`, `update`, `remove`); `create-admin` CLI.

- [ ] **Step 1: Password lib**

Create `apps/api/src/lib/password.ts`:
```ts
import { hash, verify } from '@node-rs/argon2';

export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}
export function verifyPassword(hashStr: string, plain: string): Promise<boolean> {
  return verify(hashStr, plain);
}
```

- [ ] **Step 2: Users repository (parameterized SQL only)**

Create `apps/api/src/modules/users/repository.ts`:
```ts
import type { Pool } from 'pg';

export type Role = 'admin' | 'editor' | 'viewer';
export interface UserRow {
  id: string; email: string; full_name: string | null; role: Role;
  is_active: boolean; created_at: string; updated_at: string;
}
const COLS = 'id, email, full_name, role, is_active, created_at, updated_at';

export function usersRepository(pg: Pool) {
  return {
    async findByEmailWithHash(email: string): Promise<(UserRow & { password_hash: string }) | null> {
      const { rows } = await pg.query(`SELECT ${COLS}, password_hash FROM app.users WHERE email = $1`, [email]);
      return rows[0] ?? null;
    },
    async findById(id: string): Promise<UserRow | null> {
      const { rows } = await pg.query(`SELECT ${COLS} FROM app.users WHERE id = $1`, [id]);
      return rows[0] ?? null;
    },
    async list(): Promise<UserRow[]> {
      const { rows } = await pg.query(`SELECT ${COLS} FROM app.users ORDER BY created_at DESC`);
      return rows;
    },
    async insert(u: { email: string; password_hash: string; full_name: string | null; role: Role }): Promise<UserRow> {
      const { rows } = await pg.query(
        `INSERT INTO app.users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
        [u.email, u.password_hash, u.full_name, u.role]
      );
      return rows[0];
    },
    async update(id: string, patch: { full_name?: string | null; role?: Role; is_active?: boolean }): Promise<UserRow | null> {
      const sets: string[] = []; const vals: unknown[] = []; let i = 1;
      for (const [k, v] of Object.entries(patch)) { if (v !== undefined) { sets.push(`${k} = $${i++}`); vals.push(v); } }
      if (sets.length === 0) return this.findById(id);
      sets.push(`updated_at = now()`);
      vals.push(id);
      const { rows } = await pg.query(`UPDATE app.users SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${COLS}`, vals);
      return rows[0] ?? null;
    },
    async remove(id: string): Promise<boolean> {
      const { rowCount } = await pg.query(`DELETE FROM app.users WHERE id = $1`, [id]);
      return (rowCount ?? 0) > 0;
    },
  };
}
export type UsersRepository = ReturnType<typeof usersRepository>;
```

- [ ] **Step 3: Authentication plugin (@fastify/jwt + authenticate)**

Create `apps/api/src/plugins/authentication.ts`:
```ts
import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { config } from '../config/env';
import { AuthError } from '../errors';
import { usersRepository } from '../modules/users/repository';

export default fp(async (app) => {
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: config.JWT_EXPIRES_IN } });

  app.decorate('authenticate', async (request) => {
    let payload: { sub: string };
    try {
      payload = await request.jwtVerify();
    } catch {
      throw new AuthError('Invalid or expired token');
    }
    const user = await usersRepository(app.pg).findById(payload.sub);
    if (!user || !user.is_active) throw new AuthError('User not found or inactive');
    request.currentUser = { id: user.id, email: user.email, role: user.role };
  });
});
```
> The login endpoint (Task 5) signs tokens as `app.jwt.sign({ sub: user.id, role: user.role })`.

- [ ] **Step 4: Authorization hook (RBAC)**

Create `apps/api/src/hooks/authorization.ts`:
```ts
import type { FastifyRequest } from 'fastify';
import { ForbiddenError, AuthError } from '../errors';
import type { Role } from '../modules/users/repository';

export function authorize(...roles: Role[]) {
  return async (request: FastifyRequest) => {
    if (!request.currentUser) throw new AuthError();
    if (!roles.includes(request.currentUser.role)) throw new ForbiddenError('Insufficient role');
  };
}
```

- [ ] **Step 5: Register authentication in `buildApp`** (after dbPlugin — it uses `app.pg`):
```ts
import authentication from './plugins/authentication';
// ...
  app.register(dbPlugin);
  app.register(authentication);
```

- [ ] **Step 6: Bootstrap-admin script**

Create `apps/api/src/scripts/create-admin.ts`:
```ts
import { getPool, closePool } from '../db/pool';
import { usersRepository } from '../modules/users/repository';
import { hashPassword } from '../lib/password';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : process.env[name.toUpperCase().replace(/-/g, '_')];
}

async function main() {
  const email = arg('email');
  const password = arg('password');
  const fullName = arg('name') ?? null;
  if (!email || !password) {
    console.error('Usage: npm run create-admin -w @webatlas/api -- --email <e> --password <p> [--name <n>]');
    process.exit(1);
  }
  const repo = usersRepository(getPool());
  const existing = await repo.findByEmailWithHash(email);
  if (existing) {
    await repo.update(existing.id, { role: 'admin', is_active: true });
    console.log(`Updated existing user ${email} to active admin`);
  } else {
    const u = await repo.insert({ email, password_hash: await hashPassword(password), full_name: fullName, role: 'admin' });
    console.log(`Created admin ${u.email} (${u.id})`);
  }
}
main().then(() => closePool()).catch((e) => { console.error(e); process.exitCode = 1; return closePool(); });
```

- [ ] **Step 7: Password roundtrip test**

Create `apps/api/src/lib/password.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes and verifies (argon2)', async () => {
    const h = await hashPassword('s3cret-pw');
    expect(h).not.toBe('s3cret-pw');
    expect(await verifyPassword(h, 's3cret-pw')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });
});
```

- [ ] **Step 8: Run test → PASS; verify create-admin works**

Run from repo root (stack up):
```bash
npm run test:api
npm run create-admin -w @webatlas/api -- --email admin@webatlas.test --password admin-pass-123 --name "Root Admin"
```
Expected: password test passes; the script prints `Created admin admin@webatlas.test (...)`. (This admin is used by Task 5/6 tests.)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/password.ts apps/api/src/lib/password.test.ts apps/api/src/plugins/authentication.ts apps/api/src/hooks/authorization.ts apps/api/src/modules/users/repository.ts apps/api/src/scripts/create-admin.ts apps/api/src/server.ts
git commit -m "feat(api): argon2 password lib, JWT authentication, RBAC hook, users repo, create-admin"
```

---

### Task 5: `modules/auth` — `POST /api/auth/login` + `GET /api/auth/me`

**Files:**
- Create: `apps/api/src/modules/auth/{service.ts,controller.ts,routes.ts}`, `apps/api/src/modules/auth/auth.test.ts`
- Modify: `apps/api/src/server.ts` (register auth routes under `/api`)

**Interfaces:**
- Consumes: `usersRepository`, `verifyPassword`, `app.jwt`, `app.authenticate`.
- Produces: `POST /api/auth/login` → `{ token, user }`; `GET /api/auth/me` → `{ user }` (auth required). Login is rate-limited tighter than global.

- [ ] **Step 1: Auth service**

Create `apps/api/src/modules/auth/service.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { usersRepository, type UserRow } from '../users/repository';
import { verifyPassword } from '../../lib/password';
import { AuthError } from '../../errors';

export async function login(app: FastifyInstance, email: string, password: string): Promise<{ token: string; user: UserRow }> {
  const row = await usersRepository(app.pg).findByEmailWithHash(email);
  if (!row || !row.is_active) throw new AuthError('Invalid credentials');
  const ok = await verifyPassword(row.password_hash, password);
  if (!ok) throw new AuthError('Invalid credentials');
  const { password_hash, ...user } = row;
  const token = app.jwt.sign({ sub: user.id, role: user.role });
  return { token, user };
}
```

- [ ] **Step 2: Controller + routes**

Create `apps/api/src/modules/auth/controller.ts`:
```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validate } from '../../lib/validate';
import { login } from './service';

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function loginHandler(req: FastifyRequest, reply: FastifyReply) {
  const { email, password } = validate(LoginBody, req.body);
  const result = await login(req.server, email, password);
  reply.send(result);
}

export async function meHandler(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ user: req.currentUser });
}
```

Create `apps/api/src/modules/auth/routes.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { loginHandler, meHandler } from './controller';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, loginHandler);
  app.get('/me', { preHandler: app.authenticate }, meHandler);
}
```

- [ ] **Step 3: Register under `/api/auth` in `buildApp`**

In `apps/api/src/server.ts`, after plugins:
```ts
import authRoutes from './modules/auth/routes';
// ...
  app.register(authRoutes, { prefix: '/api/auth' });
```

- [ ] **Step 4: Write the test**

Create `apps/api/src/modules/auth/auth.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from '../users/repository';
import { hashPassword } from '../../lib/password';

const app = buildApp();
const EMAIL = 'login-test@webatlas.test';
const PW = 'login-pass-123';

beforeAll(async () => {
  await app.ready();
  const repo = usersRepository(getPool());
  const existing = await repo.findByEmailWithHash(EMAIL);
  if (!existing) await repo.insert({ email: EMAIL, password_hash: await hashPassword(PW), full_name: 'Login Test', role: 'admin' });
});
afterAll(async () => {
  await getPool().query('DELETE FROM app.users WHERE email = $1', [EMAIL]);
  await app.close();
});

describe('auth', () => {
  it('logs in with valid credentials and returns a token + user (no hash)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: EMAIL, password: PW } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(body.user.email).toBe(EMAIL);
    expect(body.user.password_hash).toBeUndefined();
  });
  it('rejects a wrong password with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: EMAIL, password: 'nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('AUTH_ERROR');
  });
  it('GET /api/auth/me returns the current user with a token, 401 without', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: EMAIL, password: PW } });
    const token = login.json().token;
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(EMAIL);
    const anon = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anon.statusCode).toBe(401);
  });
});
```

- [ ] **Step 5: Run test → PASS**; **commit**

```bash
git add apps/api/src/modules/auth apps/api/src/server.ts
git commit -m "feat(api): auth module - login (JWT) + me endpoints"
```

---

### Task 6: `modules/users` — admin CRUD + audit logging

**Files:**
- Create: `apps/api/src/modules/audit/service.ts`, `apps/api/src/modules/users/{schemas.ts,service.ts,controller.ts,routes.ts}`, `apps/api/src/modules/users/users.test.ts`
- Modify: `apps/api/src/server.ts` (register users routes under `/api/users`)

**Interfaces:**
- Consumes: `usersRepository`, `hashPassword`, `authorize('admin')`, `app.authenticate`.
- Produces: `GET/POST/PUT/DELETE /api/users` (admin only); every write recorded via `auditService.record(...)`. `POST` hashes the password + maps unique-violation to `ConflictError`.

- [ ] **Step 1: Audit service**

Create `apps/api/src/modules/audit/service.ts`:
```ts
import type { Pool } from 'pg';

export function auditService(pg: Pool) {
  return {
    async record(entry: {
      userId?: string; action: 'create' | 'update' | 'delete';
      tableName: string; featureId?: string | null; before?: unknown; after?: unknown;
    }): Promise<void> {
      await pg.query(
        `INSERT INTO app.audit_log (user_id, action, table_name, feature_id, before, after)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entry.userId ?? null, entry.action, entry.tableName, entry.featureId ?? null,
         entry.before ? JSON.stringify(entry.before) : null, entry.after ? JSON.stringify(entry.after) : null]
      );
    },
  };
}
```

- [ ] **Step 2: Users schemas + service**

Create `apps/api/src/modules/users/schemas.ts`:
```ts
import { z } from 'zod';
export const CreateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().optional(),
  role: z.enum(['admin', 'editor', 'viewer']).default('viewer'),
});
export const UpdateUserBody = z.object({
  full_name: z.string().nullable().optional(),
  role: z.enum(['admin', 'editor', 'viewer']).optional(),
  is_active: z.boolean().optional(),
});
export const UserIdParams = z.object({ id: z.string().uuid() });
```

Create `apps/api/src/modules/users/service.ts`:
```ts
import type { Pool } from 'pg';
import { usersRepository, type UserRow, type Role } from './repository';
import { auditService } from '../audit/service';
import { hashPassword } from '../../lib/password';
import { ConflictError, NotFoundError } from '../../errors';

export function usersService(pg: Pool) {
  const repo = usersRepository(pg);
  const audit = auditService(pg);
  return {
    list: () => repo.list(),
    async create(input: { email: string; password: string; full_name?: string; role: Role }, actorId?: string): Promise<UserRow> {
      const existing = await repo.findByEmailWithHash(input.email);
      if (existing) throw new ConflictError('Email already in use');
      const user = await repo.insert({
        email: input.email, password_hash: await hashPassword(input.password),
        full_name: input.full_name ?? null, role: input.role,
      });
      await audit.record({ userId: actorId, action: 'create', tableName: 'app.users', featureId: user.id, after: user });
      return user;
    },
    async update(id: string, patch: { full_name?: string | null; role?: Role; is_active?: boolean }, actorId?: string): Promise<UserRow> {
      const before = await repo.findById(id);
      if (!before) throw new NotFoundError('User not found');
      const after = await repo.update(id, patch);
      await audit.record({ userId: actorId, action: 'update', tableName: 'app.users', featureId: id, before, after });
      return after!;
    },
    async remove(id: string, actorId?: string): Promise<void> {
      const before = await repo.findById(id);
      if (!before) throw new NotFoundError('User not found');
      await repo.remove(id);
      await audit.record({ userId: actorId, action: 'delete', tableName: 'app.users', featureId: id, before });
    },
  };
}
```

- [ ] **Step 3: Controller + routes**

Create `apps/api/src/modules/users/controller.ts`:
```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { validate } from '../../lib/validate';
import { usersService } from './service';
import { CreateUserBody, UpdateUserBody, UserIdParams } from './schemas';

export async function listUsers(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ users: await usersService(req.server.pg).list() });
}
export async function createUser(req: FastifyRequest, reply: FastifyReply) {
  const body = validate(CreateUserBody, req.body);
  const user = await usersService(req.server.pg).create(body, req.currentUser?.id);
  reply.code(201).send({ user });
}
export async function updateUser(req: FastifyRequest, reply: FastifyReply) {
  const { id } = validate(UserIdParams, req.params);
  const patch = validate(UpdateUserBody, req.body);
  const user = await usersService(req.server.pg).update(id, patch, req.currentUser?.id);
  reply.send({ user });
}
export async function deleteUser(req: FastifyRequest, reply: FastifyReply) {
  const { id } = validate(UserIdParams, req.params);
  await usersService(req.server.pg).remove(id, req.currentUser?.id);
  reply.code(204).send();
}
```

Create `apps/api/src/modules/users/routes.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { authorize } from '../../hooks/authorization';
import { listUsers, createUser, updateUser, deleteUser } from './controller';

export default async function usersRoutes(app: FastifyInstance) {
  const adminOnly = { preHandler: [app.authenticate, authorize('admin')] };
  app.get('/', adminOnly, listUsers);
  app.post('/', adminOnly, createUser);
  app.put('/:id', adminOnly, updateUser);
  app.delete('/:id', adminOnly, deleteUser);
}
```

- [ ] **Step 4: Register under `/api/users`**

In `apps/api/src/server.ts`:
```ts
import usersRoutes from './modules/users/routes';
// ...
  app.register(usersRoutes, { prefix: '/api/users' });
```

- [ ] **Step 5: Write the test**

Create `apps/api/src/modules/users/users.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';
import { getPool } from '../../db/pool';
import { usersRepository } from './repository';
import { hashPassword } from '../../lib/password';

const app = buildApp();
const ADMIN = 'users-admin@webatlas.test';
const EDITOR = 'users-editor@webatlas.test';
const PW = 'admin-pass-123';
const created: string[] = [];

async function tokenFor(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PW } });
  return res.json().token as string;
}

beforeAll(async () => {
  await app.ready();
  const repo = usersRepository(getPool());
  for (const [email, role] of [[ADMIN, 'admin'], [EDITOR, 'editor']] as const) {
    if (!(await repo.findByEmailWithHash(email))) {
      await repo.insert({ email, password_hash: await hashPassword(PW), full_name: role, role });
    }
  }
});
afterAll(async () => {
  await getPool().query(`DELETE FROM app.users WHERE email LIKE '%@webatlas.test'`);
  await app.close();
});

describe('users CRUD (admin only)', () => {
  it('rejects non-admin with 403 and anonymous with 401', async () => {
    const editorToken = await tokenFor(EDITOR);
    const forbidden = await app.inject({ method: 'GET', url: '/api/users', headers: { authorization: `Bearer ${editorToken}` } });
    expect(forbidden.statusCode).toBe(403);
    const anon = await app.inject({ method: 'GET', url: '/api/users' });
    expect(anon.statusCode).toBe(401);
  });

  it('admin creates (hashed), lists, updates, deletes; audit rows written', async () => {
    const token = await tokenFor(ADMIN);
    const auth = { authorization: `Bearer ${token}` };
    const newEmail = 'created-user@webatlas.test';

    const create = await app.inject({ method: 'POST', url: '/api/users', headers: auth, payload: { email: newEmail, password: 'new-pass-123', role: 'editor' } });
    expect(create.statusCode).toBe(201);
    const id = create.json().user.id;
    created.push(id);
    expect(create.json().user.password_hash).toBeUndefined();

    // password stored hashed, not plaintext
    const { rows } = await getPool().query('SELECT password_hash FROM app.users WHERE id = $1', [id]);
    expect(rows[0].password_hash).not.toBe('new-pass-123');

    const dup = await app.inject({ method: 'POST', url: '/api/users', headers: auth, payload: { email: newEmail, password: 'x2345678', role: 'viewer' } });
    expect(dup.statusCode).toBe(409);

    const list = await app.inject({ method: 'GET', url: '/api/users', headers: auth });
    expect(list.json().users.some((u: { id: string }) => u.id === id)).toBe(true);

    const upd = await app.inject({ method: 'PUT', url: `/api/users/${id}`, headers: auth, payload: { role: 'admin', is_active: false } });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().user.role).toBe('admin');

    const del = await app.inject({ method: 'DELETE', url: `/api/users/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);

    const audit = await getPool().query(`SELECT action FROM app.audit_log WHERE table_name = 'app.users' AND feature_id = $1 ORDER BY created_at`, [id]);
    expect(audit.rows.map((r) => r.action)).toEqual(['create', 'update', 'delete']);
  });
});
```

- [ ] **Step 6: Run test → PASS** (`npm run test:api` — all suites green); **commit**

```bash
git add apps/api/src/modules/audit apps/api/src/modules/users apps/api/src/server.ts
git commit -m "feat(api): users admin CRUD with RBAC + audit logging"
```

---

## Self-Review

**1. Spec coverage (design §6, §10, §11):**
- Layered Routes→Controllers→Services→Repositories→pool → Tasks 4–6 ✓
- Global plugins (cors, helmet, rate-limit, request-id via `genReqId`, logging via Fastify pino, JWT auth, error handler, not-found, DB pool) → Tasks 1–4 ✓
- Typed error hierarchy + central handler + `{error:{code,message,details}}` → Task 2 ✓
- Authentication *mechanism* global (`plugins/authentication.ts` + `hooks/authorization.ts`) vs auth *feature* local (`modules/auth`, `modules/users`) → §6.3 ✓
- API surface `POST /api/auth/login`, `GET /api/auth/me`, `GET/POST/PUT/DELETE /api/users` → Tasks 5–6 ✓
- argon2 hashing, JWT env secret + short expiry, CORS locked, helmet, login rate-limit, parameterized SQL, audit on writes, never leak `password_hash` → Tasks 3–6 ✓
- Bootstrap admin (no public registration) → Task 4 `create-admin` ✓
- **Deferred (stated, not gaps):** the layer registry + feature CRUD API (`/api/layers/...`) is **Plan 5**; testcontainers-isolated tests (these run against the dev DB with `@webatlas.test` cleanup) are a later hardening; refresh-token rotation is out of scope per design §12.

**2. Placeholder scan:** every file's full content is given; no TBD/TODO.

**3. Type/name consistency:** `Role`, `UserRow`, `usersRepository`, `usersService`, `auditService`, `authorize`, `app.authenticate`, `app.jwt.sign({ sub, role })` ↔ `jwtVerify()` payload `{ sub }` are used consistently across tasks. The response error shape `{ error: { code, message, details? } }` is identical in `errorHandler` and asserted in every test. `app.currentUser`/`request.currentUser` typed in `types/fastify.d.ts`.

**4. Risks for the implementer:**
- **Plugin registration order matters:** `errorHandler` first (so it catches everything), then `security`, then `dbPlugin` (decorates `app.pg`), then `authentication` (uses `app.pg`), then route modules. `authenticate`/`authorize` reference `app.pg`/`currentUser`, so they must register after `dbPlugin`.
- **`@node-rs/argon2`** is prebuilt (no node-gyp) — reliable on Windows/Node 22. If unavailable, `argon2` (native) is the fallback but may need build tools; report if the install fails.
- **`@fastify/jwt` payload:** `request.jwtVerify()` returns the signed payload; we read `sub`. Ensure `sign({ sub: user.id, role })` matches.
- **Tests need the dev DB up and an admin present.** Each auth/users test seeds its own `@webatlas.test` users and deletes them in `afterAll`; never delete non-`.test` rows.
- **StrictMode/parallel tests:** Vitest may run test files in parallel against one DB; the `@webatlas.test` email namespacing keeps them isolated, but if flakiness appears, run `vitest run --no-file-parallelism`.

---

## Follow-on

- **Plan 5** — layer registry (`layers/registry.ts`) + feature CRUD (`/api/layers/:key/features`) with geometry validation (`ST_IsValid`) + audit, and the frontend admin editing mode (draw/modify/delete + attribute forms) reusing `LAYER_ATTRIBUTE_MAP`.
- Hardening: testcontainers-isolated integration tests; refresh tokens if sessions need to outlive the short JWT; GeoServer compose healthcheck (carried from Plan 2).
