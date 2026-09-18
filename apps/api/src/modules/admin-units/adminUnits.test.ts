import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../server';

let app: ReturnType<typeof buildApp>;
beforeAll(async () => { app = buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

describe('GET /api/admin-units', () => {
  it('lists all 34 provinces with a usable extent, without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin-units?level=province' });
    expect(res.statusCode).toBe(200);
    const units = res.json().units as Array<{ code: string; name: string; bbox: number[] }>;
    expect(units).toHaveLength(34);

    const dakLak = units.find((u) => u.code === '66')!;
    expect(dakLak.name).toContain('Đắk Lắk');
    const [west, south, east, north] = dakLak.bbox;
    expect(west).toBeGreaterThan(107);
    expect(east).toBeLessThan(110);
    expect(south).toBeLessThan(north);
  });

  it('lists the wards of one province', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin-units?level=ward&province=66' });
    expect(res.statusCode).toBe(200);
    const units = res.json().units as Array<{ code: string }>;
    expect(units.length).toBeGreaterThan(0);
    expect(units.every((u) => u.code.startsWith('66') || u.code.length > 2)).toBe(true);
  });

  it('refuses a ward listing without a province, and an unknown level', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin-units?level=ward' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/admin-units?level=commune' })).statusCode).toBe(400);
  });
});
