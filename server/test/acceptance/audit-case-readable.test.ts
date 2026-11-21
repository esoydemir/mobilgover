import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedDemoProvider, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/**
 * The audit file read alone: an open case shows its record number, equipment, first response, owner, deadline, actions and service state; a case that was closed
 * and reopened says so (who closed it, who reopened it and why); the effectiveness measurement carries its unit and limit; an action line says which action it is about.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

let pro: { id: string; token: string };
beforeAll(async () => { env = await freshEnv(); const platform = await seedPlatform(env.db); demo = await seedDemoCompany(env.db, { isDemo: true }); await topUpAllSites(env.db, 2); pro = await seedDemoProvider(env.db, platform.marketReviewer.id, 'murat.denetim@ornek.test'); });
afterAll(async () => { await env?.close(); });

describe('audit file: open, closed and reopened case', () => {
  it('shows what an auditor needs without the app', async () => {
    const N = (id: string) => `${C()}/nonconformities/${id}`;
    const mk = async (title: string) => (await manager().post(`${C()}/nonconformities`, { siteId: demo.siteId, title, description: 'İç sıcaklık 9 °C.', hazardType: 'cold_chain_temperature', severity: 'critical', equipmentId: demo.fridgeId, containment: 'Ürünler taşındı, üst limit aşan ürünler imha edildi.' })).body.id as string;
    const open = await mk('Açık vaka: kapı contası');
    const reopened = await mk('Yeniden açılan vaka: termostat');
    await owner().post(`${N(reopened)}/assignment`, { ownerId: demo.users.manager.id, dueAt: later(72), reason: 'Sorumlu' });
    await manager().post(`${N(reopened)}/causes`, { stage: 'initial', categories: ['equipment'], notes: 'Termostat şüphesi.' });
    for (const [kind, description] of [['correction', 'Termostatı değiştir.'], ['corrective_action', 'Termostat kontrolünü bakım planına ekle.']]) {
      const a = (await manager().post(`${N(reopened)}/actions`, { kind, description })).body.id;
      await manager().post(`${N(reopened)}/actions/${a}`, { op: 'done', notes: 'Yapıldı.' });
      await owner().post(`${N(reopened)}/actions/${a}`, { op: 'verify', result: 'accepted', notes: 'Yerinde baktım.' });
    }
    await owner().post(`${N(reopened)}/causes`, { stage: 'verified', categories: ['equipment'], notes: 'Termostat doğrulandı.' });
    expect((await manager().post(`${N(reopened)}/steps`, { step: 'effectiveness_check', notes: 'İki gün ölçüm.', measurement: { value: 3 } })).status).toBe(201);
    expect((await owner().post(`${N(reopened)}/verify`, { result: 'effective', notes: 'Kendi ölçümümle 3 °C.' })).body.status).toBe('closed');
    expect((await owner().post(`${N(reopened)}/reopen`, { reason: 'Üç gün sonra yine 8 °C ölçüldü; çözüm kalıcı değil.' })).status).toBe(200);

    const from = new Date(Date.now() - 864e5).toISOString(), to = new Date(Date.now() + 864e5).toISOString();
    const rep = (await owner().get(`${C()}/audit-report?siteId=${demo.siteId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=json`)).body;
    const crit = rep.sections.critical as any[];
    const o = crit.find(x => x.id === open)!, r = crit.find(x => x.id === reopened)!;
    expect(o).toMatchObject({ ref: open.slice(0, 8), equipment: expect.any(String), containment: 'Ürünler taşındı, üst limit aşan ürünler imha edildi.', owner: '—', reopened: 0, service: [] });
    expect(r.reopened).toBe(1);
    expect(r.owner).not.toBe('—');
    expect(r.history.join('\n')).toContain('Vaka kapandı (bağımsız doğrulama)');
    expect(r.history.join('\n')).toContain('YENİDEN AÇILDI');
    expect(r.history.join('\n')).toContain('Üç gün sonra yine 8 °C');
    // A case closed in the period reads on its own too: action lines name the action, the measurement carries unit and limit.
    const closed = await mk('Kapalı vaka: kapı contası');
    await owner().post(`${N(closed)}/assignment`, { ownerId: demo.users.manager.id, dueAt: later(72), reason: 'Sorumlu' });
    await manager().post(`${N(closed)}/causes`, { stage: 'initial', categories: ['equipment'], notes: 'Conta.' });
    for (const [kind, description] of [['correction', 'Contayı değiştir.'], ['corrective_action', 'Conta kontrolünü bakım planına ekle.']]) {
      const a = (await manager().post(`${N(closed)}/actions`, { kind, description })).body.id;
      await manager().post(`${N(closed)}/actions/${a}`, { op: 'done', notes: 'Yapıldı.' });
      await owner().post(`${N(closed)}/actions/${a}`, { op: 'verify', result: 'accepted', notes: 'Yerinde baktım.' });
    }
    // A service report for this case, delivered but not reviewed.
    const P = client(env, pro.token);
    const reqId = (await owner().post(`${C()}/service-requests`, { siteId: demo.siteId, categoryCode: 'refrigeration_service', title: 'Conta servisi', description: 'Servis.', city: 'İstanbul', ncrId: closed, taskId: null })).body.id;
    const q = (await P.post(`/pro/requests/${reqId}/quotes`, { scope: 'Servis', exclusions: 'Kompresör', priceNet: 1500, vatRate: 20, materials: 'Parça', durationText: '2 saat', warrantyText: '3 ay', validUntil: later(48), deliverable: 'Servis raporu (PDF)' })).body.id;
    const jobId = (await owner().post(`${C()}/quotes/${q}/accept`)).body.jobId;
    await P.post(`/pro/jobs/${jobId}/check-in`, { code: (await owner().get(`${C()}/service-requests/${reqId}`)).body.job.checkin_code });
    const file = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(`rapor-${jobId}`)]);
    const rr = await P.post(`/pro/jobs/${jobId}/report`, { report: 'Conta servisi: kapı contası değiştirildi, kapı hizalandı.', file: { mime: 'application/pdf', sha256: createHash('sha256').update(file).digest('hex'), sizeBytes: file.length } });
    await P.put(`/pro/jobs/${jobId}/report/${rr.body.evidenceId}/content`, file, 'application/pdf');
    await owner().post(`${N(closed)}/causes`, { stage: 'verified', categories: ['equipment'], notes: 'Conta doğrulandı.' });
    await manager().post(`${N(closed)}/steps`, { step: 'effectiveness_check', notes: 'İki gün ölçüm.', measurement: { value: 3 } });
    expect((await owner().post(`${N(closed)}/verify`, { result: 'effective', notes: 'Kendi ölçümümle 3 °C.' })).body.status).toBe('closed');
    const rep2 = (await owner().get(`${C()}/audit-report?siteId=${demo.siteId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=json`)).body;
    const seq = (rep2.sections.closures.cases as any[]).find(c => c.id === closed)!.sequence.map((x: any) => x.text).join('\n');
    expect(seq).toContain('Aksiyon yapıldı beyanı [Contayı değiştir.]');
    expect(seq).toContain('Aksiyon bağımsız doğrulandı [Conta kontrolünü bakım planına ekle.]');
    expect(seq).toMatch(/yeni ölçüm 3( |,)/);
    expect(seq).not.toContain('ölçüm 3 )');
    expect((rep2.sections.closures.cases as any[]).find(c => c.id === closed)!.serviceReports.join(' ')).toContain('ŞU AN İNCELENMEMİŞ');
    const vid = (await owner().get(`${C()}/documents/${rr.body.documentId}`)).body.versions[0].id as string;
    await owner().post(`${C()}/documents/${rr.body.documentId}/versions/${vid}/review`, { decision: 'verified', notes: 'Rapor okundu.' });
    const rep3 = (await owner().get(`${C()}/audit-report?siteId=${demo.siteId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=json`)).body;
    expect((rep3.sections.closures.cases as any[]).find(c => c.id === closed)!.serviceReports.join(' ')).toContain('incelendi (');
  });
});
