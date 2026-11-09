import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { topUpAllSites } from '../../src/services/horizon';
import { scanDeadlines } from '../../src/services/notifications';
import { createSession } from '../../src/services/principal';
import { client, freshEnv, type Env } from '../support/env';

/**
 * Delivery 6D: vault filters (running out, expired, waiting for review, rejected), renewal keeps the
 * old version and never carries its review over, what a document is used for, stale reminders after a
 * deadline moves, training people per version, and the PDF audit file: Turkish text, page breaks,
 * source and rule versions, example label, time and role; nothing outside the person's access, and the
 * attachment links still checked by the app. Real HTTP + PostgreSQL.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let kerem: { id: string; token: string }, site2: string;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const K = () => client(env, kerem.token);
const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const pdf = (seed: string) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(seed)]);
const fileOf = (b: Buffer) => ({ mime: 'application/pdf', sha256: createHash('sha256').update(b).digest('hex'), sizeBytes: b.length });
async function version(c: ReturnType<typeof client>, doc: string, seed: string, validUntil: string | null) {
  const f = pdf(seed);
  const v = (await c.post(`${C()}/documents/${doc}/versions`, { validFrom: day(-300), validUntil, file: fileOf(f) })).body;
  expect((await c.put(`${C()}/evidence/${v.evidenceId}/content`, f, 'application/pdf')).status).toBe(200);
  return v as { versionId: string; evidenceId: string; version: number };
}
const ids = (xs: any[]) => xs.map(x => x.id);

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  await topUpAllSites(env.db, 2);
  kerem = await env.db.system(async tx => {
    site2 = (await tx.query(`INSERT INTO sites (company_id, name) VALUES ($1, 'Beşiktaş Çarşı') RETURNING id`, [demo.companyId])).rows[0].id;
    const u = (await tx.query(`INSERT INTO users (display_name, email) VALUES ('Kerem (Beşiktaş)', 'kerem.6d@ornek.test') RETURNING id`)).rows[0].id;
    await tx.query(`INSERT INTO memberships (user_id, company_id, site_id, role, status, activated_at) VALUES ($1,$2,$3,'site_manager','active',now())`, [u, demo.companyId, site2]);
    return { id: u as string, token: await createSession(tx, u) };
  });
});
afterAll(async () => { await env?.close(); });

describe('vault filters and renewal', () => {
  let calib: string, old: string, v1: any, v2: any;
  it('running out / expired / waiting for review / rejected', async () => {
    calib = (await manager().post(`${C()}/documents`, { docType: 'calibration_certificate', title: 'Termometre kalibrasyonu', siteId: demo.siteId, equipmentId: demo.thermometerId })).body.id;
    v1 = await version(manager(), calib, 'kal-1', day(10));
    await owner().post(`${C()}/documents/${calib}/versions/${v1.versionId}/review`, { decision: 'verified', notes: 'Aslıyla karşılaştırıldı.' });
    old = (await owner().post(`${C()}/documents`, { docType: 'business_license', title: 'Eski sigorta poliçesi', siteId: demo.siteId })).body.id;
    const ov = await version(owner(), old, 'sig-1', day(-3));
    await manager().post(`${C()}/documents/${old}/versions/${ov.versionId}/review`, { decision: 'verified', notes: 'Poliçe kontrol edildi.' });
    expect(ids((await owner().get(`${C()}/documents?filter=expiring`)).body)).toEqual([calib]);
    expect(ids((await owner().get(`${C()}/documents?filter=expired`)).body)).toEqual([old]);
    expect((await owner().get(`${C()}/documents?filter=pending_review`)).body).toEqual([]);
  });

  it('a renewal waits for its own review; the old version stays valid and in the history; a rejection shows', async () => {
    v2 = await version(owner(), calib, 'kal-2', day(400));
    let d = (await owner().get(`${C()}/documents/${calib}`)).body;
    expect(d.versions.map((v: any) => [v.version, v.review_status])).toEqual([[2, 'unreviewed'], [1, 'verified']]);
    expect(d.currentVersionId).toBe(v1.versionId);
    expect(ids((await owner().get(`${C()}/documents?filter=pending_review`)).body)).toEqual([calib]);
    await manager().post(`${C()}/documents/${calib}/versions/${v2.versionId}/review`, { decision: 'rejected', notes: 'Sertifika numarası okunmuyor.' });
    expect(ids((await owner().get(`${C()}/documents?filter=rejected`)).body)).toEqual([calib]);
    const v3 = await version(owner(), calib, 'kal-3', day(400));
    d = (await owner().get(`${C()}/documents/${calib}`)).body;
    expect(d.versions.find((v: any) => v.id === v3.versionId).review_status).toBe('unreviewed');
    await manager().post(`${C()}/documents/${calib}/versions/${v3.versionId}/review`, { decision: 'verified', notes: 'Yeni sertifika kontrol edildi.' });
    d = (await owner().get(`${C()}/documents/${calib}`)).body;
    expect(d.versions.map((v: any) => v.review_status)).toEqual(['verified', 'rejected', 'verified']);
    expect(d.currentVersionId).toBe(v3.versionId);
    expect((await owner().get(`${C()}/documents?filter=expiring`)).body).toEqual([]);
  });

  it('what a document is used for: shown on the document and on the check that uses it', async () => {
    expect((await owner().post(`${C()}/documents/${calib}/uses`, { op: 'add', kind: 'task_template', ref: 'fridge_temp', purpose: 'kısa' })).status).toBe(422);
    expect((await owner().post(`${C()}/documents/${calib}/uses`, { op: 'add', kind: 'task_template', ref: 'fridge_temp', purpose: 'Sıcaklık ölçümünde kullanılan termometrenin kalibrasyon kanıtı' })).status).toBe(201);
    expect((await owner().post(`${C()}/documents/${calib}/uses`, { op: 'add', kind: 'equipment', ref: site2, purpose: 'Yanlış ekipman denemesi' })).status).toBe(422);
    const d = (await owner().get(`${C()}/documents/${calib}`)).body;
    expect(d.uses[0]).toMatchObject({ kind: 'task_template', kindLabel: 'Kontrol', purpose: expect.stringContaining('kalibrasyon kanıtı') });
    const task = (await env.ownerDb.query(`SELECT id FROM tasks WHERE company_id = $1 AND template_code = 'fridge_temp' LIMIT 1`, [demo.companyId])).rows[0].id;
    expect((await manager().get(`${C()}/tasks/${task}`)).body.relatedDocuments.map((x: any) => x.id)).toEqual([calib]);
    // Internal review and an issuer check stay separate labels.
    expect(d.status).toBe('internally_reviewed');
  });
});

describe('reminders and training', () => {
  it('a reminder for a moved deadline is marked stale, not shown as current; no second notice for the same deadline', async () => {
    const n = (await manager().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: 'Depo rafı', description: 'Raf tozlu.', hazardType: 'cleaning', severity: 'minor', containment: 'Silindi.' })).body.id;
    const a = (await manager().post(`${C()}/nonconformities/${n}/actions`, { kind: 'correction', description: 'Rafı temizle.', ownerId: demo.users.staff.id, dueAt: later(3) })).body.id;
    await scanDeadlines(env.db); await scanDeadlines(env.db);
    const staff = client(env, demo.users.staff.token);
    let items = (await staff.get(`${C()}/notifications`)).body.items.filter((x: any) => x.kind === 'action_due_soon');
    expect(items).toHaveLength(1);
    expect(items[0].stale).toBeNull();
    await manager().post(`${C()}/nonconformities/${n}/actions/${a}`, { op: 'reassign', ownerId: demo.users.staff.id, dueAt: later(72) });
    items = (await staff.get(`${C()}/notifications`)).body.items.filter((x: any) => x.kind === 'action_due_soon');
    expect(items[0].stale).toContain('Termin değişti');
  });

  it('per course: assigned, read, completed, passed and field-verified people, tied to the version', async () => {
    const c = (await owner().post(`${C()}/training/courses`, { title: 'Kalibrasyon okuma', body: 'Termometre etiketini ve geçerlilik tarihini kontrol et.',
      quiz: [{ q: 'Etiket yoksa?', options: ['Kullanmam', 'Kullanırım'], answer: 0 }], passScore: 100, links: [] })).body;
    await owner().post(`${C()}/training/versions/${c.versionId}/submit`, {});
    await owner().post(`${C()}/training/versions/${c.versionId}/publish`, {});
    const asg = (await owner().post(`${C()}/training/assignments`, { courseId: c.id, userId: demo.users.staff.id, siteId: demo.siteId, dueAt: later(48), reason: 'Kalibrasyon etiketi' })).body.id;
    const staff = client(env, demo.users.staff.token);
    await staff.post(`${C()}/training/assignments/${asg}/read`, {});
    await staff.post(`${C()}/training/assignments/${asg}/attempt`, { answers: [0] });
    await staff.post(`${C()}/training/assignments/${asg}/complete`, {});
    // A new version is published; the completion stays on version 1.
    await owner().post(`${C()}/training/courses/${c.id}/new-version`, {});
    const vs = (await owner().get(`${C()}/training/courses/${c.id}`)).body.versions;
    const draft = vs.find((v: any) => v.status === 'draft');
    await owner().post(`${C()}/training/versions/${draft.id}/submit`, {});
    await owner().post(`${C()}/training/versions/${draft.id}/publish`, {});
    const ppl = (await owner().get(`${C()}/training/courses/${c.id}/people`)).body;
    expect(ppl.summary).toMatchObject({ assigned: 1, read: 1, completed: 1, passed: 1, fieldEffective: 0 });
    expect(ppl.people[0]).toMatchObject({ version: 1, user_name: expect.stringContaining('Elif'), assigned_by_name: expect.stringContaining('Ahmet') });
    expect((await staff.get(`${C()}/training/courses/${c.id}/people`)).status).toBe(403);
    expect((await K().get(`${C()}/training/courses/${c.id}/people`)).body.people).toEqual([]);
  });
});

describe('PDF audit file', () => {
  const from = new Date(Date.now() - 30 * 86400_000).toISOString(), to = new Date(Date.now() + 86400_000).toISOString();
  const q = (extra = '') => `${C()}/audit-report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${extra}`;
  it('the data behind it: only sites and records the person may see; example label, time and role', async () => {
    // Site 2: a critical case and a document of its own.
    const n2 = (await K().post(`${C()}/nonconformities`, { siteId: site2, title: 'Beşiktaş: dondurucu alarmı çalışmıyor', description: 'Alarm sesi yok.', hazardType: 'cold_chain_temperature', severity: 'critical', containment: 'Ürün taşındı.' })).body.id;
    for (let i = 0; i < 25; i++) await manager().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: `Kadıköy kritik kayıt ${i + 1}: soğuk zincir kırıldı, ürünler ayrıldı; ölçüm ve gözlem notları uzun bir açıklama içeriyor`, description: 'Uzun metin denemesi; Türkçe karakterler: ğüşıöç ĞÜŞİÖÇ.', hazardType: 'cold_chain_temperature', severity: 'critical', containment: 'Ürün taşındı.' });
    const all = (await owner().get(q('&format=json'))).body;
    expect(all.sites).toEqual(['Kadıköy Moda', 'Beşiktaş Çarşı']);
    expect(all.example).toBe(true);
    expect(all.exampleNote).toContain('ÖRNEK VERİ');
    expect(all.requestedBy.role).toBe('İşletme sahibi');
    expect(all.sections.critical.map((x: any) => x.id)).toContain(n2);
    expect(all.sections.sources.length).toBeGreaterThan(0);
    expect(all.sections.sources[0]).toMatchObject({ rule: expect.stringMatching(/ v\d+$/), example: true });
    expect(all.sections.documents.some((d: any) => d.attachment)).toBe(true);
    const k = (await K().get(q('&format=json'))).body;
    expect(k.sites).toEqual(['Beşiktaş Çarşı']);
    expect(k.requestedBy.role).toBe('Şube yöneticisi');
    expect(k.sections.critical.map((x: any) => x.id)).toEqual([n2]);
    expect(k.sections.documents).toEqual([]);
    expect((await K().get(q(`&siteId=${demo.siteId}&format=json`))).status).toBe(404);
    expect((await client(env, demo.users.staff.token).get(q('&format=json'))).status).toBe(403);
  });

  it('a link printed in the owner\'s file does not open for another site\'s manager', async () => {
    const all = (await owner().get(q('&format=json'))).body;
    const link = all.sections.documents.find((d: any) => d.attachment).attachment as string;
    expect((await owner().get(link)).status).toBe(200);
    expect((await K().get(link)).status).toBe(404);
  });

  it('the PDF: real PDF, several pages, Turkish letters, page numbers', async () => {
    const r = await owner().get(q('&linkBase=/api'));
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(String(r.headers['content-disposition'])).toContain('denetim-dosyasi-');
    const buf = r.body as Buffer;
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    let hasPdftotext = true;
    try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch { hasPdftotext = false; }
    if (!hasPdftotext) return; // CI images without poppler: bytes checked above
    const dir = mkdtempSync(join(tmpdir(), 'gh-pdf-'));
    writeFileSync(join(dir, 'a.pdf'), buf);
    if (process.env.GH_PDF_OUT) writeFileSync(process.env.GH_PDF_OUT, buf);
    const text = execFileSync('pdftotext', [join(dir, 'a.pdf'), '-']).toString().replace(/\s+/g, ' ');
    expect(text).toContain('Açık kritik ve yüksek riskli kayıtlar');
    expect(text).toContain('Kadıköy kritik kayıt 25: soğuk zincir kırıldı, ürünler ayrıldı; ölçüm ve gözlem notları uzun bir açıklama içeriyor');
    expect(text).toContain('Şube: Kadıköy Moda, Beşiktaş Çarşı');
    expect(text).toContain('ÖRNEK VERİ');
    expect(text).toContain('Kaynak ve kural sürümleri');
    expect(text).toMatch(/Sayfa 2 \/ \d/);
    expect(text).toContain('/api/companies/');
  });
});
