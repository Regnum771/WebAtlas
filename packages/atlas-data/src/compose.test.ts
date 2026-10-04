import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import { composeArgs, composeEnv, composeFile, COMPOSE_INTERPOLATED_KEYS } from './compose';

describe('composeEnv', () => {
  it('removes every key compose interpolates from infra/.env, and keeps the rest', () => {
    const env = { POSTGRES_PASSWORD: 'x', GEOSERVER_ADMIN_PASSWORD: 'y', PATH: '/bin', COMPOSE_PROJECT_NAME: 'p' };
    const out = composeEnv(env);
    for (const k of COMPOSE_INTERPOLATED_KEYS) expect(out[k]).toBeUndefined();
    expect(out.PATH).toBe('/bin');
    // The acceptance run selects its throwaway project through this; it must pass through.
    expect(out.COMPOSE_PROJECT_NAME).toBe('p');
  });

  it('removes the keys whatever their case (Windows environment names are case-insensitive)', () => {
    const out = composeEnv({ Postgres_Password: 'x', geoserver_admin_user: 'y', Path: 'p' });
    expect(out.Postgres_Password).toBeUndefined();
    expect(out.geoserver_admin_user).toBeUndefined();
    expect(out.Path).toBe('p');
  });

  it('does not mutate its input', () => {
    const env = { POSTGRES_PASSWORD: 'x' };
    composeEnv(env);
    expect(env.POSTGRES_PASSWORD).toBe('x');
  });
});

describe('composeFile / composeArgs', () => {
  it('defaults to infra/docker-compose.yml under the repo root', () => {
    expect(composeFile({}, '/repo')).toBe(join('/repo', 'infra', 'docker-compose.yml'));
    expect(composeArgs({}, '/repo')).toEqual(['compose', '-f', join('/repo', 'infra', 'docker-compose.yml')]);
  });

  it('honours ATLAS_COMPOSE_FILE (atlas:up --compose)', () => {
    expect(composeFile({ ATLAS_COMPOSE_FILE: '/x/prod.yml' }, '/repo')).toBe('/x/prod.yml');
  });

  it('a relative ATLAS_COMPOSE_FILE is relative to the repository, where docker runs', () => {
    expect(composeFile({ ATLAS_COMPOSE_FILE: 'infra/other.yml' }, '/repo')).toBe(resolve('/repo', 'infra/other.yml'));
  });
});
