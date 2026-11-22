import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/** B-10: a rejected form names the wrong fields in Turkish, one line per field; no English validator text reaches the person. */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);

beforeAll(async () => { env = await freshEnv(); await seedPlatform(env.db); demo = await seedDemoCompany(env.db, { isDemo: true }); });
afterAll(async () => { await env?.close(); });

describe('B-10 Turkish field-level validation messages', () => {
  it('a bad product assessment form lists each wrong field with its own Turkish line', async () => {
    const n = (await owner().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: 'Dolap sıcak', description: 'Dolap sınırın üstünde.', hazardType: 'cold_chain_temperature', severity: 'major', equipmentId: demo.fridgeId, containment: 'Kapı kapatıldı.' })).body.id;
    const r = await owner().post(`${C()}/nonconformities/${n}/product-assessments`, { product: 'S', quantity: -3, unit: null, quantityUnknown: false, firstAction: 'x'.repeat(2001), assessorId: 'bozuk' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('INVALID');
    const d = r.body.error.details as { field: string; label: string; message: string }[];
    expect(Array.isArray(d)).toBe(true);
    expect(d.length).toBeGreaterThanOrEqual(2);
    for (const f of d) { expect(typeof f.field).toBe('string'); expect(f.message).toMatch(/[ıüöçşğİ]|olmalı|olabilir|gerekli|seç|geçersiz|yaz/i); }
    expect(d.find(f => f.field === 'firstAction')).toMatchObject({ label: 'Alınan ilk önlem', message: 'En fazla 2000 karakter olabilir.' });
    expect(d.find(f => f.field === 'assessorId')?.message).toBe('Geçerli bir seçim yap.');
    expect(d.find(f => f.field === 'quantity')?.message).toMatch(/En az 0/);
    expect(r.body.error.message).toMatch(/^Alanları düzelt — /);
    expect(JSON.stringify(r.body)).not.toMatch(/Too small|Invalid input|Invalid UUID|expected|Required/);
  });

  it('a missing required field says it is required', async () => {
    const r = await owner().post(`${C()}/nonconformities`, { siteId: demo.siteId });
    expect(r.status).toBe(422);
    const d = r.body.error.details as { field: string; message: string }[];
    expect(d.find(f => f.field === 'title')?.message).toBe('Bu alan gerekli.');
    expect(JSON.stringify(r.body)).not.toMatch(/Too small|Invalid input|Required|expected/);
  });
});
