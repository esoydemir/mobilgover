import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { scanDocumentExpiry } from '../../src/services/documents';
import { client, freshEnv, type Env } from '../support/env';

/**
 * GH-05: işletmenin evrak kasası. Saklanma amacı ≠ yükümlülüğü karşılama; "bitişi var / yok / bilinmiyor" ayrı durumlar;
 * hatırlatma aralığı ve muhatap; arşiv; reddedilen son sürümde eski sürümün kalan geçerliliği; yetki kalkınca erişim.
 * Belge türleri ve süreler ÖRNEKTİR; hiçbir süre belge adından türetilmez.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const pdf = (seed: string) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(seed)]);
const fileOf = (b: Buffer) => ({ mime: 'application/pdf', sha256: createHash('sha256').update(b).digest('hex'), sizeBytes: b.length });
const notes = async (userId: string, kind: string) => (await env.ownerDb.query(`SELECT entity_id, dedupe_key FROM notifications WHERE user_id = $1 AND kind = $2`, [userId, kind])).rows;

/** Yükleyen yönetici, inceleyen sahip: yükleyen kendi belgesini inceleyemez. */
async function addVersion(docId: string, v: { validFrom?: string | null; validUntil?: string | null; endKind?: 'none' | 'unknown' }, seed: string, review?: { decision: 'verified' | 'rejected'; notes: string; validUntil?: string | null; endKind?: 'none' | 'unknown' }) {
  const f = pdf(seed);
  const r = await manager().post(`${C()}/documents/${docId}/versions`, { validFrom: v.validFrom ?? null, validUntil: v.validUntil ?? null, endKind: v.endKind, file: fileOf(f) });
  expect(r.status).toBe(201);
  expect((await manager().put(`${C()}/evidence/${r.body.evidenceId}/content`, f, 'application/pdf')).status).toBe(200);
  if (review) expect((await owner().post(`${C()}/documents/${docId}/versions/${r.body.versionId}/review`, review)).status).toBe(200);
  return r.body as { versionId: string; evidenceId: string };
}
const get = async (id: string) => (await owner().get(`${C()}/documents/${id}`)).body;
const list = async (q = '') => (await owner().get(`${C()}/documents${q}`)).body as any[];

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db);
});
afterAll(async () => { await env?.close(); });

describe('belge türleri, amaç ve sorumlu', () => {
  it('pest raporu, imza sirküleri ve serbest tür saklanır; saklanma amacı ile yükümlülüğü karşılama ayrı alanlardır', async () => {
    const pest = await manager().post(`${C()}/documents`, { docType: 'pest_report', title: 'Zararlı mücadele raporu', siteId: demo.siteId, issuer: 'Örnek İlaçlama',
      documentNo: 'ZM-2026-17', keepPurpose: 'Denetimde gösterilecek zararlı mücadele kaydı', responsibleId: demo.users.manager.id, remindDays: 14, remindUserId: demo.users.manager.id });
    expect(pest.status).toBe(201);
    const d = await get(pest.body.id);
    expect(d).toMatchObject({ docType: 'pest_report', keepPurpose: 'Denetimde gösterilecek zararlı mücadele kaydı', remindDays: 14, expiryWarningDays: 14 });
    expect(d.responsible.id).toBe(demo.users.manager.id);
    expect(d.satisfiesObligations).toEqual([]);                       // saklıyor ama hiçbir yükümlülüğü karşılamıyor
    const link = await manager().post(`${C()}/documents/${pest.body.id}/uses`, { op: 'add', kind: 'obligation', ref: 'EX-COLD-CHAIN', purpose: 'Soğuk zincir kaydına ek' });
    expect(link.status).toBe(201);
    const after = await get(pest.body.id);
    expect(after.satisfiesObligations).toHaveLength(1);
    expect(after.keepPurpose).toBe(d.keepPurpose);                    // amaç değişmedi

    expect((await owner().post(`${C()}/documents`, { docType: 'signature_circular', title: 'İmza sirküleri' })).status).toBe(201);
    expect((await manager().post(`${C()}/documents`, { docType: 'other', title: 'Serbest evrak', siteId: demo.siteId })).status).toBe(201);
    // Kapsam dışı kişi sorumlu/muhatap olamaz.
    const out = await manager().post(`${C()}/documents`, { docType: 'other', title: 'Kapsam dışı', siteId: demo.siteId, responsibleId: demo.users.expert.id });
    expect(out.status).toBe(422);
  });
});

describe('bitişi var / bitiş tarihi yok / tarih henüz bilinmiyor', () => {
  it('tarih belge adından türetilmez; tarihsiz sürüm "bilinmiyor" olur ve bilgi tamamlama listesine düşer', async () => {
    const doc = (await manager().post(`${C()}/documents`, { docType: 'insurance', title: 'Yıllık sigorta poliçesi (1 yıl geçerli)', siteId: demo.siteId })).body.id;
    const v = await addVersion(doc, {}, 'sigorta');
    let d = await get(doc);
    expect(d.endKind).toBe('unknown');
    expect(d.validUntil).toBeNull();
    expect(d.infoNeeded).toBe(true);
    expect((await list('?filter=info_needed')).map(x => x.id)).toContain(doc);
    // İnceleyen tarihi belgeden okuyup yazınca liste dışına çıkar.
    expect((await owner().post(`${C()}/documents/${doc}/versions/${v.versionId}/review`, { decision: 'verified', notes: 'Poliçe aslı görüldü; bitiş yazıldı.', validUntil: day(300) })).status).toBe(200);
    d = await get(doc);
    expect(d).toMatchObject({ endKind: 'dated', validUntil: day(300), infoNeeded: false });
    expect((await list('?filter=info_needed')).map(x => x.id)).not.toContain(doc);
  });

  it('"bitiş tarihi yok" ayrı bir durumdur; tarihle birlikte seçilemez; gözden geçirme tarihi bitişten ayrıdır', async () => {
    const doc = (await manager().post(`${C()}/documents`, { docType: 'signature_circular', title: 'İmza sirküleri 2026', siteId: demo.siteId, reviewOn: day(365) })).body.id;
    const bad = await manager().post(`${C()}/documents/${doc}/versions`, { validUntil: day(10), endKind: 'none', file: fileOf(pdf('x')) });
    expect(bad.status).toBe(422);
    const f = pdf('sirkuler');
    const r = await manager().post(`${C()}/documents/${doc}/versions`, { validFrom: day(-30), endKind: 'none', file: fileOf(f) });
    expect(r.status).toBe(201);
    await manager().put(`${C()}/evidence/${r.body.evidenceId}/content`, f, 'application/pdf');
    expect((await manager().post(`${C()}/documents/${doc}/versions/${r.body.versionId}/review`, { decision: 'verified', notes: 'Kendi yüklediğimi inceliyorum.' })).status).toBe(422); // yükleyen inceleyemez
    expect((await owner().post(`${C()}/documents/${doc}/versions/${r.body.versionId}/review`, { decision: 'verified', notes: 'Noter onaylı sirküler aslı görüldü.' })).status).toBe(200);
    const d = await get(doc);
    expect(d).toMatchObject({ endKind: 'none', validUntil: null, reviewOn: day(365), infoNeeded: false, status: 'internally_reviewed' });
    expect((await list('?filter=info_needed')).map(x => x.id)).not.toContain(doc);
  });
});

describe('hatırlatma: eşikte tek uyarı, muhatap, bitişsiz belge, arşiv', () => {
  let pest: string;
  it('tarihli pest raporu seçilen eşikte (14 gün) tek uyarı üretir; yalnız seçilen muhataba gider', async () => {
    pest = (await list()).find(x => x.docType === 'pest_report').id;
    await addVersion(pest, { validFrom: day(-300), validUntil: day(20) }, 'pest-1', { decision: 'verified', notes: 'Rapor aslı görüldü, tarihler doğru.' });
    const t = (n: number) => new Date(Date.now() + n * 86400_000);
    await scanDocumentExpiry(env.db, t(0));      // bitişe 20 gün: eşik (14) dışında
    expect((await notes(demo.users.manager.id, 'doc_expiring')).length).toBe(0);
    await scanDocumentExpiry(env.db, t(6));      // bitişe 14 gün: eşikte
    await scanDocumentExpiry(env.db, t(6));
    await scanDocumentExpiry(env.db, t(7));      // sonraki gün aynı uyarı tekrar etmez
    const n = await notes(demo.users.manager.id, 'doc_expiring');
    expect(n.length).toBe(1);
    expect((await notes(demo.users.owner.id, 'doc_expiring')).length).toBe(0); // muhatap seçildiği için tek kişi
  });

  it('yenileme kabul edilince eski sürümün bekleyen uyarısı durur: eski uyarı "belge yenilendi" diye işaretlenir', async () => {
    await addVersion(pest, { validFrom: day(0), validUntil: day(400) }, 'pest-2', { decision: 'verified', notes: 'Yenilenen rapor aslı görüldü.' });
    const inbox = (await manager().get(`${C()}/notifications`)).body.items as any[];
    const w = inbox.find(i => i.kind === 'doc_expiring');
    expect(w.stale).toMatch(/yenilendi/);
    await scanDocumentExpiry(env.db, new Date(Date.now() + 6 * 86400_000));
    expect((await notes(demo.users.manager.id, 'doc_expiring')).length).toBe(1); // yenisi için uyarı yok
  });

  it('bitiş tarihi olmayan imza sirküleri süre aşımı üretmez; arşivlenir; arşiv nedensiz yapılmaz, geçmiş silinmez', async () => {
    const circ = (await list()).find(x => x.title === 'İmza sirküleri 2026');
    expect(circ.endKind).toBe('none');
    await scanDocumentExpiry(env.db, new Date(Date.now() + 3650 * 86400_000));
    expect((await notes(demo.users.manager.id, 'doc_expired')).filter(n => n.entity_id === circ.id).length).toBe(0);
    expect((await notes(demo.users.owner.id, 'doc_expired')).filter(n => n.entity_id === circ.id).length).toBe(0);
    expect((await owner().post(`${C()}/documents/${circ.id}/archive`, { reason: '' })).status).toBe(422);
    expect((await owner().post(`${C()}/documents/${circ.id}/archive`, { reason: 'Yeni sirküler çıktı, bu arşive alındı.' })).status).toBe(200);
    expect((await list()).map(x => x.id)).not.toContain(circ.id);
    expect((await owner().post(`${C()}/documents/${circ.id}/archive`, { reason: 'Tekrar arşivle.' })).status).toBe(409);
    expect((await env.ownerDb.query(`SELECT count(*)::int AS n FROM document_versions WHERE document_id = $1`, [circ.id])).rows[0].n).toBe(1);
  });
});

describe('reddedilen son sürüm', () => {
  it('ret gerekçesi görünür; önceki sürümün kalan geçerliliği ve karşıladığı yükümlülük ayrı gösterilir', async () => {
    const doc = (await manager().post(`${C()}/documents`, { docType: 'maintenance_report', title: 'Soğutucu bakım raporu', siteId: demo.siteId })).body.id;
    await addVersion(doc, { validFrom: day(-10), validUntil: day(100) }, 'bakim-1', { decision: 'verified', notes: 'Rapor aslı görüldü.' });
    await manager().post(`${C()}/documents/${doc}/uses`, { op: 'add', kind: 'obligation', ref: 'EX-COLD-CHAIN', purpose: 'Soğutucu servis kaydı' });
    await addVersion(doc, { validUntil: day(500) }, 'bakim-2', { decision: 'rejected', notes: 'Rapor başka bir cihaza ait; kabul edilmedi.' });
    const d = await get(doc);
    expect(d.latestRejection).toMatchObject({ version: 2, reason: 'Rapor başka bir cihaza ait; kabul edilmedi.' });
    expect(d.stillValid).toMatchObject({ version: 1, validUntil: day(100), remainingDays: 100 });
    expect(d.status).toBe('internally_reviewed');
    expect(d.satisfiesObligations.map((o: any) => o.ref)).toEqual(['EX-COLD-CHAIN']);
    expect((await list()).find(x => x.id === doc)).toMatchObject({ latestRejected: true, latestRejection: { version: 2 } });
  });
});

describe('yetki kalkınca erişim', () => {
  it('liste, ayrıntı, dosya ve QR yeni kapsama uyar: şirket belgesinin şube paylaşımı kaldırılınca şube yöneticisi hiçbirine erişemez', async () => {
    const doc = (await owner().post(`${C()}/documents`, { docType: 'business_license', title: 'Şirket ruhsatı' })).body.id;
    const f = pdf('ruhsat-sirket');
    const v = await owner().post(`${C()}/documents/${doc}/versions`, { endKind: 'none', file: fileOf(f) });
    await owner().put(`${C()}/evidence/${v.body.evidenceId}/content`, f, 'application/pdf');
    const q = await owner().post(`${C()}/qr`, { kind: 'document', refId: doc, label: 'Ruhsat' });
    expect(q.status).toBe(201);
    const fileOpen = () => env.app.inject({ method: 'GET', url: `${C()}/evidence/${v.body.evidenceId}/content`, headers: { authorization: `Bearer ${demo.users.manager.token}` } });
    const visible = async () => ({
      list: (await manager().get(`${C()}/documents`)).body.some((x: any) => x.id === doc),
      detail: (await manager().get(`${C()}/documents/${doc}`)).status,
      file: (await fileOpen()).statusCode,
      qr: (await manager().get(`/qr/resolve?token=${q.body.token}`)).status,
    });
    expect(await visible()).toEqual({ list: false, detail: 404, file: 404, qr: 404 });
    expect((await owner().post(`${C()}/documents/${doc}/shares`, { siteId: demo.siteId, share: true })).status).toBe(200);
    expect(await visible()).toEqual({ list: true, detail: 200, file: 200, qr: 200 });
    expect((await owner().post(`${C()}/documents/${doc}/shares`, { siteId: demo.siteId, share: false })).status).toBe(200);
    expect(await visible()).toEqual({ list: false, detail: 404, file: 404, qr: 404 });
    // Çalışan (belge yetkisi yok) hiçbir zaman göremez.
    expect((await staff().get(`${C()}/documents/${doc}`)).status).toBe(404);
  });

  it('üyelik pasifleştirilince şubenin belgeleri o kişi için kapanır', async () => {
    const siteDoc = (await list()).find(x => x.docType === 'maintenance_report').id;
    expect((await manager().get(`${C()}/documents/${siteDoc}`)).status).toBe(200);
    const m = ((await owner().get(`${C()}/members`)).body as any[]).find(x => x.id === demo.users.manager.id)!;
    expect((await owner().post(`${C()}/members/${m.membership_id}/suspend`, { reason: 'işten ayrıldı' })).status).toBe(200);
    expect((await manager().get(`${C()}/documents/${siteDoc}`)).status).toBe(404);
    expect((await manager().get(`${C()}/documents`)).status).toBeGreaterThanOrEqual(400);
  });
});
