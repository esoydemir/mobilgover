import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { suggestFields } from '../../src/services/extraction';
import { createSession } from '../../src/services/principal';
import { topUpAllSites } from '../../src/services/horizon';
import { client, freshEnv, type Env } from '../support/env';

/** Group 4: QR bound to records (rights checked on the server), reviewed extraction of document fields, source-bound assistant. */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
let other: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const manager = () => client(env, demo.users.manager.token);
const staff = () => client(env, demo.users.staff.token);
const otherOwner = () => client(env, other.users.owner.token);

beforeAll(async () => {
  env = await freshEnv();
  await seedPlatform(env.db);
  demo = await seedDemoCompany(env.db, { isDemo: true });
  other = await seedDemoCompany(env.db, { isDemo: true, name: 'Başka İşletme' });
  await topUpAllSites(env.db, 20);
});
afterAll(async () => { await env?.close(); });

describe('QR codes', () => {
  let eqToken: string, eqQr: string, docId: string, docToken: string, docQr: string;

  it('an equipment code is made once per record; the image links to the app address', async () => {
    const a = await owner().post(`${C()}/qr`, { kind: 'equipment', refId: demo.fridgeId });
    expect(a.status).toBe(201);
    expect(a.body.duplicate).toBe(false);
    eqToken = a.body.token; eqQr = a.body.id;
    expect(eqToken.length).toBeGreaterThanOrEqual(20);
    const again = await owner().post(`${C()}/qr`, { kind: 'equipment', refId: demo.fridgeId });
    expect(again.body).toMatchObject({ id: eqQr, duplicate: true });
    const img = (await owner().get(`${C()}/qr/${eqQr}/image?base=${encodeURIComponent('https://app.ornek.test')}`)).body;
    expect(img.url).toBe(`https://app.ornek.test/q/${eqToken}`);
    expect(img.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect((await owner().get(`${C()}/qr/${eqQr}/image?base=javascript:alert(1)`)).status).toBe(422);
  });

  it('only people who may write the record can make or switch codes; staff cannot', async () => {
    expect((await staff().post(`${C()}/qr`, { kind: 'equipment', refId: demo.fridgeId })).status).toBe(403);
    expect((await otherOwner().post(`${C()}/qr`, { kind: 'equipment', refId: demo.fridgeId })).status).toBe(404); // another business's record
    expect(((await staff().get(`${C()}/qr`)).body as any[])).toEqual([]);
    expect(((await manager().get(`${C()}/qr`)).body as any[]).map(q => q.id)).toEqual([eqQr]);
  });

  it('a scan opens the record for those whose own rights cover it, and is the same "no such code" for everyone else', async () => {
    const ok = await staff().get(`/qr/resolve?token=${eqToken}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ kind: 'equipment', refId: demo.fridgeId, route: `/equipment/${demo.fridgeId}`, companyId: demo.companyId });
    expect((await otherOwner().get(`/qr/resolve?token=${eqToken}`)).status).toBe(404);
    expect((await client(env, demo.users.expert.token).get(`/qr/resolve?token=${eqToken}`)).status).toBe(404); // expert grant is not an equipment right
    expect((await owner().get(`/qr/resolve?token=${'x'.repeat(30)}`)).status).toBe(404);
    const scans = (await env.ownerDb.query(`SELECT actor_id FROM audit_events WHERE event_type = 'qr.scanned'`)).rows.map((r: any) => r.actor_id);
    expect(scans).toEqual([demo.users.staff.id]);
  });

  it('a document code opens only for people who may read that document', async () => {
    docId = (await owner().post(`${C()}/documents`, { docType: 'business_license', title: 'İşyeri açma ruhsatı', siteId: demo.siteId })).body.id;
    const q = await manager().post(`${C()}/qr`, { kind: 'document', refId: docId, label: 'Ruhsat panosu' });
    expect(q.status).toBe(201);
    docToken = q.body.token; docQr = q.body.id;
    expect((await manager().get(`/qr/resolve?token=${docToken}`)).body).toMatchObject({ kind: 'document', route: `/documents/${docId}`, label: 'Ruhsat panosu' });
    expect((await staff().get(`/qr/resolve?token=${docToken}`)).status).toBe(404);
  });

  it('a deactivated code opens nothing (reason required); a new one can then be made', async () => {
    expect((await manager().post(`${C()}/qr/${docQr}/active`, { active: false })).status).toBe(422);
    expect((await manager().post(`${C()}/qr/${docQr}/active`, { active: false, reason: 'Pano değişti, etiket söküldü' })).status).toBe(200);
    expect((await manager().get(`/qr/resolve?token=${docToken}`)).status).toBe(404);
    const fresh = await manager().post(`${C()}/qr`, { kind: 'document', refId: docId });
    expect(fresh.body.duplicate).toBe(false);
    expect(fresh.body.token).not.toBe(docToken);
    expect((await manager().post(`${C()}/qr/${docQr}/active`, { active: true })).status).toBe(422); // a live code already exists
  });
});

describe('document field extraction: proposals, review, confirm', () => {
  const TEXT = `T.C. KADIKÖY BELEDİYESİ\nFen İşleri Müdürlüğü\nİŞYERİ AÇMA VE ÇALIŞMA RUHSATI\nRuhsat No: 2025/KD-118\nDüzenleme Tarihi: 15.01.2025\nGeçerlilik Tarihi: 15.01.2030\n`;
  let docId: string, versionId: string, exId: string;

  it('pure parser: values come with their snippet; impossible dates are ignored', () => {
    const s = suggestFields(TEXT);
    const by = (f: string) => s.find(x => x.field === f)!;
    expect(by('docType')).toMatchObject({ value: 'business_license' });
    expect(by('documentNo')).toMatchObject({ value: '2025/KD-118' });
    expect(by('validFrom')).toMatchObject({ value: '2025-01-15' });
    expect(by('validUntil')).toMatchObject({ value: '2030-01-15', confidence: 'medium' });
    expect(by('issuer').value).toMatch(/BELEDİYESİ/);
    expect(suggestFields('Geçerlilik: 31.02.2030 tarihine kadar geçerlidir, belge sayısı yok').some(x => x.field === 'validUntil')).toBe(false);
    const two = suggestFields('Geçerlilik tarihi 01.01.2027\nSon geçerlilik 01.06.2028').find(x => x.field === 'validUntil')!;
    expect(two).toMatchObject({ value: '2028-06-01', confidence: 'low' });
    expect(two.note).toMatch(/Birden çok/);
  });

  it('the API names the local OCR engine', async () => {
    const st = (await owner().get('/ocr/status')).body;
    expect(st).toMatchObject({ available: true });
    expect(st.engine).toMatch(/Tesseract/);
  });

  it('a reading is a pending proposal; the document is untouched until it is confirmed', async () => {
    docId = (await owner().post(`${C()}/documents`, { docType: 'other', title: 'Taranan belge', siteId: demo.siteId })).body.id;
    const file = Buffer.from('%PDF-1.4 tarama');
    const v = await owner().post(`${C()}/documents/${docId}/versions`, { validFrom: null, validUntil: null, file: { mime: 'application/pdf', sha256: createHash('sha256').update(file).digest('hex'), sizeBytes: file.length } });
    expect(v.status).toBe(201);
    versionId = v.body.versionId ?? (await owner().get(`${C()}/documents/${docId}`)).body.versions[0].id;
    expect((await staff().post(`${C()}/documents/${docId}/versions/${versionId}/extractions`, { text: TEXT })).status).toBe(404);
    expect((await owner().post(`${C()}/documents/${docId}/versions/${versionId}/extractions`, { text: 'kısa' })).status).toBe(422);
    const ex = await owner().post(`${C()}/documents/${docId}/versions/${versionId}/extractions`, { text: TEXT, source: 'device_text' });
    expect(ex.status).toBe(201);
    exId = ex.body.id;
    expect(ex.body.suggestions.length).toBeGreaterThanOrEqual(5);
    const d = (await owner().get(`${C()}/documents/${docId}`)).body;
    expect(d.docType).toBe('other');
    expect(d.versions[0].valid_until).toBeNull();
  });

  it('the person edits and confirms: only confirmed values are written; the document is still not reviewed or valid', async () => {
    expect((await staff().post(`${C()}/extractions/${exId}/decision`, { confirm: true, fields: { issuer: 'X' } })).status).toBe(404);
    expect((await owner().post(`${C()}/extractions/${exId}/decision`, { confirm: true, fields: { validFrom: '2030-02-01', validUntil: '2030-01-01' } })).status).toBe(422);
    const ok = await owner().post(`${C()}/extractions/${exId}/decision`, { confirm: true, fields: { docType: 'business_license', issuer: 'Kadıköy Belediyesi Fen İşleri Müdürlüğü', documentNo: '2025/KD-118', validFrom: '2025-01-15', validUntil: '2030-01-15' } });
    expect(ok.status).toBe(200);
    const d = (await owner().get(`${C()}/documents/${docId}`)).body;
    expect(d.versions[0]).toMatchObject({ review_status: 'unreviewed' });
    expect(String(d.versions[0].valid_until).slice(0, 10)).toBe('2030-01-15');
    expect(d.status).not.toMatch(/reviewed|verified/);
    expect((await owner().post(`${C()}/extractions/${exId}/decision`, { confirm: true, fields: {} })).status).toBe(409);
    const ev = (await env.ownerDb.query(`SELECT payload FROM audit_events WHERE event_type = 'document.extraction_confirmed'`)).rows[0].payload;
    expect(ev.applied).toMatchObject({ documentNo: '2025/KD-118', validUntil: '2030-01-15' });
    expect(ev.changedFromProposal.map((x: any) => x.field)).toContain('issuer'); // the person changed the proposed issuer line
  });

  it('a newer reading replaces a pending one; dismissing writes nothing', async () => {
    const f2 = Buffer.from('%PDF-1.4 ikinci');
    await owner().post(`${C()}/documents/${docId}/versions`, { validFrom: null, validUntil: null, file: { mime: 'application/pdf', sha256: createHash('sha256').update(f2).digest('hex'), sizeBytes: f2.length } });
    const vid = (await owner().get(`${C()}/documents/${docId}`)).body.versions[0].id;
    const a = await owner().post(`${C()}/documents/${docId}/versions/${vid}/extractions`, { text: TEXT });
    const b = await owner().post(`${C()}/documents/${docId}/versions/${vid}/extractions`, { text: `${TEXT}\nEk satır.` });
    const list = (await owner().get(`${C()}/documents/${docId}/extractions`)).body.items as any[];
    expect(list.find(x => x.id === a.body.id).status).toBe('dismissed');
    expect(list.find(x => x.id === b.body.id).status).toBe('pending');
    expect((await owner().post(`${C()}/extractions/${b.body.id}/decision`, { confirm: false })).body.status).toBe('dismissed');
    expect(String((await owner().get(`${C()}/documents/${docId}`)).body.versions[0].valid_until ?? '')).toBe('');
  });
});

describe('assistant: answers only from the business\'s own sources', () => {
  const ask = (c: ReturnType<typeof client>, question: string) => c.post(`${C()}/assistant/ask`, { question });

  it('answers from matching obligations and documents with numbered sources, labels example rules, adds nothing else', async () => {
    const r = (await ask(owner(), 'Soğuk muhafaza ünitelerinin sıcaklık kaydı nasıl tutulmalı?')).body;
    expect(r.outcome).toBe('answered');
    expect(r.sufficient).toBe(true);
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.answer).toContain('[1]');
    for (const s of r.sources) expect(r.answer).toContain(s.text.slice(0, 20));
    expect(r.notes.join(' ')).toMatch(/ÖRNEK|doğrulanmış mevzuat/);
  });

  it('says there is not enough source instead of guessing', async () => {
    const r = (await ask(owner(), 'Uzay istasyonunda kullanılacak roket yakıtı depolama standardı nedir?')).body;
    expect(r).toMatchObject({ outcome: 'insufficient', sufficient: false, sources: [] });
    expect(r.answer).toMatch(/yeterince karşılayan bir kaynak bulamadım/);
  });

  it('declines penalty amounts (pilot decision) and invents no figure', async () => {
    const r = (await ask(owner(), 'Soğutucu kaydı tutmazsam ne kadar para cezası öderim?')).body;
    expect(r.outcome).toBe('fine_declined');
    expect(r.answer).not.toMatch(/\d+\s*(TL|₺|lira)/i);
    expect(r.answer).toMatch(/tahmin edilmez/);
  });

  it('a document the person may not read is never a source; staff see only their own tasks', async () => {
    await owner().post(`${C()}/documents`, { docType: 'insurance', title: 'Yangın sigortası poliçesi gizli', siteId: null });
    const s = (await ask(staff(), 'Yangın sigortası poliçesi nerede?')).body;
    expect(s.outcome).toBe('insufficient');
    expect(JSON.stringify(s)).not.toMatch(/gizli/);
    const o = (await ask(owner(), 'Yangın sigortası poliçesi nerede?')).body;
    expect(o.sources.some((x: any) => x.kind === 'document')).toBe(true);
    expect(o.answer).toMatch(/Henüz incelenmedi/);
    expect((await otherOwner().post(`/companies/${other.companyId}/assistant/ask`, { question: 'Yangın sigortası poliçesi nerede?' })).body.outcome).toBe('insufficient'); // another business's sources are not mine
    expect((await otherOwner().post(`${C()}/assistant/ask`, { question: 'Yangın sigortası poliçesi nerede?' })).status).toBe(404);
    const out = await env.db.system(async tx => {
      const id = (await tx.query<{ id: string }>(`INSERT INTO users (display_name) VALUES ('Dış kişi') RETURNING id`)).rows[0]!.id;
      return { id, token: await createSession(tx, id, 24) };
    });
    expect((await client(env, out.token).post(`${C()}/assistant/ask`, { question: 'Soğuk muhafaza sıcaklık kaydı nedir?' })).status).toBe(404);
  });
});
