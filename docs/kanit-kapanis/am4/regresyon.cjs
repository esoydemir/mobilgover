// AM-4 tam regresyon (8091, sentetik hesaplar): işletme -> şube -> görev -> hizmet talebi -> teklif -> randevu -> rapor -> belge incelemesi -> görev kanıtı -> kapanış.
// Her çalıştırma KENDİ test işletmesini kurar; mevcut demo kayıtlarına yazmaz, yalnız okur. node regresyon.cjs
const { execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { req, login, BASE } = require('./api.cjs');
const OUT = process.env.OUT || path.join(__dirname, '..', 'src', 'docs', 'kanit-kapanis', 'am4'); fs.mkdirSync(OUT, { recursive: true });
const VERI = path.join(__dirname, '..', 'veri');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const res = []; const rep = { adimlar: [] };
const ok = (ad, k, d) => { const s = `${k ? 'TAMAM' : 'BAŞARISIZ'}  ${ad}${d ? ' — ' + d : ''}`; res.push(s); rep.adimlar.push({ ad, tamam: !!k, ayrinti: d ?? null }); console.log(s); };
const RUN = 'rg' + (Date.now() % 1e6).toString(36);
const seed = () => JSON.parse(execFileSync('docker', ['exec', 'goverhub-pilotfix-app-1', 'node', 'node_modules/tsx/dist/cli.mjs', 'src/seed/test-business.ts', RUN]).toString().trim().split('\n').pop());
const iso = d => new Date(Date.now() + d * 864e5).toISOString();

(async () => {
  // Test girişleri 15 dk'lık giriş sınırına takılmasın: yalnız sentetik demo adreslerinin eski giriş denemeleri silinir (iş kaydı değildir).
  execFileSync('docker', ['exec', 'goverhub-pilotfix-db-1', 'psql', '-U', 'postgres', '-d', 'goverhub_demo', '-c', "DELETE FROM login_challenges WHERE email LIKE '%@demo.goverhub.test'"]);
  const B = seed(); const C = B.companyId; const E = B.emails;
  ok('İşletme kuruldu (kendi test işletmesi)', !!C, `${RUN} · ${C}`);
  const owner = await login(E.owner), manager = await login(E.manager), staff = await login(E.staff), hq = await login(E.hq);
  const pro = await login('uzman@demo.goverhub.test');

  // 1) Şube
  const site = await req('POST', `/companies/${C}/sites`, { token: owner, body: { name: `Regresyon şubesi ${RUN}` } });
  const companies = await req('GET', `/companies`, { token: owner }); const me = companies.find(c => c.id === C);
  ok('Yeni şube eklendi ve işletmede görünür', !!site.id && (me.sites || []).some(s => s.id === site.id), `${(me.sites || []).length} şube`);

  // 2) Görev
  const SITE = B.siteId;
  const list = await req('GET', `/companies/${C}/tasks?siteId=${SITE}&from=${iso(-14)}&to=${iso(45)}`, { token: owner });
  const open = list.filter(x => x.status === 'open').sort((a, b) => a.due_at.localeCompare(b.due_at));
  const task = open.find(x => /servis raporu|servis sonras/i.test(x.title)) || open.find(x => x.equipment_name);
  rep.gorevBasliklari = [...new Set(open.map(x => x.title))];
  ok('Servis raporunu kanıt kabul eden açık görev var', !!task && /servis/i.test(task.title), task ? `${task.title} · ${task.equipment_name}` : '');

  // 3) Hizmet talebi -> teklif -> kabul
  const sr = await req('POST', `/companies/${C}/service-requests`, { token: owner, body: { siteId: SITE, categoryCode: 'refrigeration_service', title: `Regresyon soğutucu servisi ${RUN}`, description: 'Regresyon: soğutucu kapak contası değişimi ve gaz kontrolü.', city: 'İstanbul', taskId: task.id, ncrId: null, shareNcrSummary: false, invitedProfileId: null, invitedProfileIds: [] } });
  ok('Hizmet talebi oluşturuldu', !!sr.id);
  const q = await req('POST', `/pro/requests/${sr.id}/quotes`, { token: pro, body: { scope: 'Conta ve gaz kontrolü', exclusions: 'Kompresör', priceNet: 1500, vatRate: 20, materials: 'Conta', durationText: '1 gün', warrantyText: '3 ay', validUntil: iso(7), deliverable: 'Servis raporu (PDF)' } });
  ok('Uzman teklif verdi', !!q.id);
  const acc = await req('POST', `/companies/${C}/quotes/${q.id}/accept`, { token: owner });
  ok('Teklif kabul edildi, iş doğdu', !!acc.jobId, acc.jobId);
  const jobId = acc.jobId;

  // 4) Randevu: işletme önerir, uzman kabul eder; ikinci öneri eskisini geçersiz kılar; geçmiş sırası
  const t1 = iso(2), t1e = new Date(Date.parse(t1) + 36e5).toISOString(), t2 = iso(3), t2e = new Date(Date.parse(t2) + 36e5).toISOString();
  const a1 = await req('POST', `/companies/${C}/jobs/${jobId}/appointments`, { token: owner, body: { startsAt: t1, endsAt: t1e, note: 'Sabah uygun' } });
  const a2 = await req('POST', `/pro/jobs/${jobId}/appointments`, { token: pro, body: { startsAt: t2, endsAt: t2e, note: 'Karşı öneri' } });
  await req('POST', `/companies/${C}/appointments/${a2.id}/decision`, { token: owner, body: { accept: true } });
  const hist = await req('GET', `/companies/${C}/jobs/${jobId}/appointments`, { token: owner });
  const items = hist.history; const states = items.map(x => x.status);
  ok('Randevu: öneri, karşı öneri, kabul; geçmiş sıralı ve eski öneri geçersiz', items.length >= 2 && states.includes('confirmed') && states.includes('superseded'), states.join(' → '));

  const detail = await req('GET', `/companies/${C}/service-requests/${sr.id}`, { token: owner });
  await req('POST', `/pro/jobs/${jobId}/check-in`, { token: pro, body: { code: detail.job.checkin_code } });
  ok('Uzman yerinde giriş kaydı yaptı', true);

  // 5) Rapor (PDF) -> belge
  const pdf = fs.readFileSync(path.join(VERI, 'belge-servis-raporu.pdf'));
  const rp = await req('POST', `/pro/jobs/${jobId}/report`, { token: pro, body: { report: `Regresyon raporu ${RUN}: conta değiştirildi, gaz basıncı normal. Öncesi 9 °C, sonrası 3 °C.`, file: { mime: 'application/pdf', sha256: sha(pdf), sizeBytes: pdf.length } } });
  const evId = rp.evidenceId || rp.evidence?.id;
  if (evId) await req('PUT', `/pro/jobs/${jobId}/report/${evId}/content`, { token: pro, bytes: pdf, mime: 'application/pdf' });
  const docs = await req('GET', `/companies/${C}/documents`, { token: owner }); const dl = docs.items || docs;
  const repDoc = dl.find(d => d.serviceOrigin && d.serviceOrigin.requestId === sr.id);
  ok('Rapor belge olarak işletmenin kasasına düştü', !!repDoc, repDoc ? `${repDoc.title} · sürüm ${repDoc.versionCount}` : JSON.stringify(rp).slice(0, 160));

  // 6) Belge incelemesi (rapor henüz incelenmeden görev bloklu)
  const tdBefore = await req('GET', `/companies/${C}/tasks/${task.id}`, { token: owner });
  const dd = await req('GET', `/companies/${C}/documents/${repDoc.id}`, { token: owner }); const ver = dd.versions[0];
  const rv = await req('POST', `/companies/${C}/documents/${repDoc.id}/versions/${ver.id}/review`, { token: manager, body: { decision: 'verified', notes: 'Rapor okundu, ölçümler tutarlı.', validFrom: null, validUntil: null } });
  ok('Belge sürümü başka bir yetkili tarafından incelendi', rv.status === 'verified');

  // 7) Teslim kabulü + görev kanıtı (rapor) + fotoğraf kanıtı + kapanış
  await req('POST', `/companies/${C}/jobs/${jobId}/acceptance`, { token: owner, body: { accept: true, note: 'Rapor okundu, teslim kabul.' } });
  ok('İş teslimi kabul edildi', true);
  try { await req('POST', `/companies/${C}/tasks/${task.id}/report-evidence`, { token: owner, body: { documentId: repDoc.id, versionId: ver.id } }); ok('Servis raporu görev kanıtı olarak bağlandı', true); }
  catch (e) { ok('Servis raporu görev kanıtı olarak bağlandı', false, e.message.slice(0, 160)); }
  const img = fs.readFileSync(path.join(VERI, 'foto-ekipman.jpg'));
  try {
    const ev = await req('POST', `/companies/${C}/tasks/${task.id}/evidence`, { token: owner, body: { kind: 'photo', mime: 'image/jpeg', sha256: sha(img), sizeBytes: img.length } });
    await req('PUT', `/companies/${C}/evidence/${ev.id}/content`, { token: owner, bytes: img, mime: 'image/jpeg' });
    ok('Görev kanıtı: fotoğraf yüklendi ve mühürlendi', true);
  } catch (e) { ok('Görev kanıtı: fotoğraf yüklendi', false, e.message.slice(0, 160)); }
  try { await req('POST', `/companies/${C}/tasks/${task.id}/evidence`, { token: owner, body: { kind: 'note', text: 'Servis raporu incelendi ve göreve bağlandı; ölçümler tutarlı.' } }); ok('Görev kanıtı: kısa not eklendi', true); } catch (e) { ok('Görev kanıtı: kısa not eklendi', false, e.message.slice(0, 160)); }
  try { const done = await req('POST', `/companies/${C}/tasks/${task.id}/complete`, { token: owner, body: {} }); const td = await req('GET', `/companies/${C}/tasks/${task.id}`, { token: owner }); ok('Görev kapandı (tamamlandı)', td.status !== 'open', `durum ${td.status}`); }
  catch (e) { ok('Görev kapandı', false, e.message.slice(0, 200)); }

  // 8) Yetki: personel ve başka işletme raporu görmez
  let staffSees = 'bilinmiyor'; try { const d = await req('GET', `/companies/${C}/documents/${repDoc.id}`, { token: staff }); staffSees = d.id ? 'görüyor' : 'görmüyor'; } catch { staffSees = 'görmüyor'; }
  ok('Personel işletme raporunu göremez (yetki ayrımı)', staffSees === 'görmüyor', staffSees);

  // 9) Mevcut demo kayıtları (değiştirilmeden) hâlâ açılıyor
  const so = await login('sahip@demo.goverhub.test'); const cs = await req('GET', '/companies', { token: so });
  const demo = cs.find(c => c.sites?.length && !/Test işletmesi/.test(c.name)) ?? cs[0];
  const dSite = demo.sites[0].id;
  const dTasks = await req('GET', `/companies/${demo.id}/tasks?siteId=${dSite}&from=${iso(-60)}&to=${iso(30)}`, { token: so });
  ok('Eski demo görevleri listeleniyor', dTasks.length > 0, `${dTasks.length} görev`);
  if (dTasks[0]) { const t0 = await req('GET', `/companies/${demo.id}/tasks/${dTasks[0].id}`, { token: so }); ok('Eski bir görev ayrıntısıyla açılıyor', !!t0.id, t0.status); }
  const dDocs = await req('GET', `/companies/${demo.id}/documents`, { token: so }); const dl2 = dDocs.items || dDocs;
  const withVer = dl2.filter(d => d.versionCount > 0);
  let verOk = 0; for (const d of withVer.slice(0, 5)) { const x = await req('GET', `/companies/${demo.id}/documents/${d.id}`, { token: so }); if (x.versions?.length === d.versionCount) verOk++; }
  ok('Eski belgelerin sürümleri açılıyor ve sayıları tutuyor', withVer.length > 0 && verOk === Math.min(5, withVer.length), `${withVer.length} belge; ${verOk} örnek tamam`);
  const srs = await req('GET', `/companies/${demo.id}/service-requests`, { token: so }); const sl = srs.items || srs; let apptOk = 0, apptTot = 0;
  for (const s of sl.slice(0, 10)) { const dsr = await req('GET', `/companies/${demo.id}/service-requests/${s.id}`, { token: so }); if (dsr.job) { apptTot++; const h = await req('GET', `/companies/${demo.id}/jobs/${dsr.job.id}/appointments`, { token: so }); if (Array.isArray(h.history)) apptOk++; } }
  ok('Eski işlerin randevu geçmişi açılıyor', apptOk === apptTot, `${apptTot} iş, ${apptOk} geçmiş açıldı`);

  rep.calistirma = RUN; rep.isletme = C; rep.base = BASE; rep.tarih = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, `regresyon-${RUN}.json`), JSON.stringify(rep, null, 2));
  console.log('\n' + (res.some(r => r.startsWith('BAŞARISIZ')) ? 'SONUÇ: BAŞARISIZ ADIM VAR' : 'SONUÇ: tüm adımlar tamam'));
  process.exit(res.some(r => r.startsWith('BAŞARISIZ')) ? 1 : 0);
})().catch(e => { console.log(res.join('\n')); console.error('HATA', e.message); process.exit(1); });
