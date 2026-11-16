// Pilot kapanış: AM-6 canlı (8091): taslak -> inceleme -> gerekçeli onay -> gerekçeli yayın; gerekçesiz reddedilir; denetim kaydında ayrı ayrı.
// Demo kurallarına DOKUNMAZ: yalnız 2099'da yürürlüğe girecek, hiçbir işletmeye uygulanmayan yeni bir örnek kural açılır. node pk-kural.cjs
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const { req, login, BASE } = require('./api.cjs');
const OUT = path.join(__dirname, '..', 'src', 'docs', 'kanit-kapanis', 'pilot'); fs.mkdirSync(OUT, { recursive: true });
const res = []; const ok = (ad, k, d) => { const s = (k ? 'TAMAM' : 'BAŞARISIZ') + '  ' + ad + (d ? ' — ' + d : ''); res.push(s); console.log(s); };
const fail = async fn => { try { await fn(); return null; } catch (e) { return e.message; } };
(async () => {
  execFileSync('docker', ['exec', 'goverhub-pilotfix-db-1', 'psql', '-U', 'postgres', '-d', 'goverhub_demo', '-c', "DELETE FROM login_challenges WHERE email LIKE '%@demo.goverhub.test'"], { stdio: 'ignore' });
  const author = await login('yazar@demo.goverhub.test'), reviewer = await login('onay@demo.goverhub.test'), specialist = await login('alan-uzmani@demo.goverhub.test'), admin = await login('yonetici@demo.goverhub.test');
  const list = await req('GET', '/admin/rule-versions', { token: admin }); const base = (list.items || list).find(r => r.code === 'EX-COLD-CHAIN');
  const d = await req('GET', '/admin/rule-versions/' + base.id, { token: admin });
  const RUN = (Date.now() % 1e6).toString(36).toUpperCase();
  const body = { code: 'EX-PILOT-GEREKCE-' + RUN, title: 'Pilot gerekçe denemesi ' + RUN, kind: 'good_practice', isExample: true, provisionIds: d.provisionIds, ambiguityNote: null, condition: d.condition,
    obligationTitle: 'Pilot gerekçe denemesi (örnek, hiçbir işletmeye uygulanmaz)', obligationSummary: 'Yalnız gerekçe akışını denemek için; 2099\'da yürürlüğe girer.', effectiveFrom: '2099-01-01', effectiveTo: null,
    changeReason: 'Gerekçe akışı canlı doğrulaması', requiredReviewAreas: d.requiredReviewAreas, templates: d.templates.map(t => { const { hazard_type, emergency_instruction, ...rest } = t; return { ...rest, hazardType: hazard_type || t.hazardType, ...((emergency_instruction || t.emergencyInstruction) ? { emergencyInstruction: emergency_instruction || t.emergencyInstruction } : {}), code: 'pilot_gerekce_' + RUN.toLowerCase() }; }) };
  const v = (await req('POST', '/admin/rule-versions', { token: author, body })).id; const st = async () => (await req('GET', '/admin/rule-versions/' + v, { token: admin })).status;
  ok('Taslak açıldı', (await st()) === 'draft', body.code);
  await req('POST', '/admin/rule-versions/' + v + '/submit', { token: author });
  for (const area of d.requiredReviewAreas) await req('POST', '/admin/rule-versions/' + v + '/area-review', { token: specialist, body: { area, decision: 'approved', notes: 'Kaynak metinle karşılaştırıldı.' } });
  ok('Taslak incelemeye gönderildi', (await st()) === 'in_review');
  let allRefused = true, msgOk = true;
  for (const b of [undefined, {}, { reason: '' }, { reason: '    ' }, { reason: null }]) { const m = await fail(() => req('POST', '/admin/rule-versions/' + v + '/approve', { token: reviewer, body: b })); if (!m || !/422/.test(m)) allRefused = false; if (!m || !m.includes('Kuralı onaylamak için gerekçe yazmalısın.')) msgOk = false; if ((await st()) !== 'in_review') allRefused = false; }
  ok('Boş/boşluk/eksik gerekçeyle onay reddedildi, kural durumu değişmedi', allRefused && msgOk);
  ok('Yazar kendi kuralını gerekçeyle bile onaylayamıyor (rol ayrımı)', !!(await fail(() => req('POST', '/admin/rule-versions/' + v + '/approve', { token: author, body: { reason: 'Kendi kuralımı onaylıyorum.' } }))));
  await req('POST', '/admin/rule-versions/' + v + '/approve', { token: reviewer, body: { reason: '  İnceleme tamam, alan uzmanı onayı var.  ' } });
  ok('Gerekçeli onay başarılı', (await st()) === 'approved');
  let pubRefused = true; for (const b of [undefined, { reason: '   ' }]) { const m = await fail(() => req('POST', '/admin/rule-versions/' + v + '/publish', { token: admin, body: b })); if (!m || !m.includes('Kuralı yayımlamak için gerekçe yazmalısın.')) pubRefused = false; if ((await st()) !== 'approved') pubRefused = false; }
  ok('Gerekçesiz yayın reddedildi, kural onaylı kaldı', pubRefused);
  await req('POST', '/admin/rule-versions/' + v + '/publish', { token: admin, body: { reason: 'Örnek ortamda yayın denemesi.' } });
  ok('Gerekçeli yayın başarılı', (await st()) === 'published');
  const audit = await req('GET', '/admin/audit?scope=platform&eventType=rule.&limit=80', { token: admin }); const mine = (audit.items || []).filter(e => e.entityId === v);
  const ap = mine.find(e => e.eventType === 'rule.approved' && e.reason === 'İnceleme tamam, alan uzmanı onayı var.'), pu = mine.find(e => e.eventType === 'rule.published' && e.reason === 'Örnek ortamda yayın denemesi.');
  ok('Denetim kaydı: onay ve yayın ayrı kayıtlar, gerekçe + kural kodu/sürüm + kişi + zaman', !!ap && !!pu && ap.id !== pu.id && ap.occurredAt && pu.occurredAt && ap.payload.code === body.code && !!ap.actorName, ap ? ap.actorName + ' / ' + pu.actorName : 'yok');
  const old = (audit.items || []).find(e => e.eventType === 'rule.approved' && e.reason == null);
  ok('Gerekçe zorunlu olmadan önceki kayıtlar okunabiliyor ("gerekçe yok")', !!old, old ? old.entityId : 'eski kayıt yok (bu veritabanında)');
  // Önceki sürümlere bağlı görevler açılmaya devam ediyor
  const so = await login('sahip@demo.goverhub.test'); const cs = await req('GET', '/companies', { token: so }); const demo = cs.find(c => c.sites?.length && !/Test işletmesi/.test(c.name)) ?? cs[0];
  const iso = x => new Date(Date.now() + x * 864e5).toISOString();
  const ts = await req('GET', '/companies/' + demo.id + '/tasks?siteId=' + demo.sites[0].id + '&from=' + iso(-60) + '&to=' + iso(30), { token: so });
  const t0 = await req('GET', '/companies/' + demo.id + '/tasks/' + ts[0].id, { token: so });
  ok('Kural yayını sonrası mevcut görevler açılıyor, kural sürümü bağlı kalıyor', ts.length > 0 && !!t0.id, ts.length + ' görev');
  fs.writeFileSync(path.join(OUT, 'kural-gerekce-' + RUN + '.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, kural: body.code, surum: v, kayitlar: mine.map(e => ({ tur: e.eventType, gerekce: e.reason, kisi: e.actorName, zaman: e.occurredAt })), sonuclar: res }, null, 2));
  const f = res.filter(x => x.startsWith('BAŞARISIZ')); console.log(f.length ? 'BAŞARISIZ: ' + f.length : 'tüm adımlar tamam'); process.exit(f.length ? 1 : 0);
})().catch(e => { console.log(res.join('\n')); console.error('HATA', e.message); process.exit(1); });
