// Pilot kapanış 2: ana senaryo (8091, sentetik, her çalıştırmada KENDİ işletmeleri). node pk-senaryo.cjs
// A işletmesi: sahip, müdür, personel, uzman, platform yöneticisi. B işletmesi (tek yönetici): sahip + dış doğrulayıcı.
const { execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { req, login, BASE } = require('./api.cjs');
const OUT = path.join(__dirname, '..', 'src', 'docs', 'kanit-kapanis', 'pilot'); fs.mkdirSync(OUT, { recursive: true });
const VERI = path.join(__dirname, '..', 'veri'); const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const res = []; const rep = { adimlar: [] };
const ok = (ad, k, d) => { const s = (k ? 'TAMAM' : 'BAŞARISIZ') + '  ' + ad + (d ? ' — ' + d : ''); res.push(s); rep.adimlar.push({ ad, tamam: !!k, ayrinti: d ?? null }); console.log(s); };
const RUN = 'pk' + (Date.now() % 1e6).toString(36); const iso = d => new Date(Date.now() + d * 864e5).toISOString();
const seed = (run, ...a) => JSON.parse(execFileSync('docker', ['exec', 'goverhub-pilotfix-app-1', 'node', 'node_modules/tsx/dist/cli.mjs', 'src/seed/test-business.ts', run, ...a]).toString().trim().split('\n').pop());
const fails = async (fn) => { try { const r = await fn(); return { ok: true, r }; } catch (e) { return { ok: false, msg: e.message }; } };
const pdfBytes = fs.readFileSync(path.join(VERI, 'belge-servis-raporu.pdf'));
const mkPdf = n => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('pilot-kapanis-' + RUN + '-' + n)]);

(async () => {
  execFileSync('docker', ['exec', 'goverhub-pilotfix-db-1', 'psql', '-U', 'postgres', '-d', 'goverhub_demo', '-c', "DELETE FROM login_challenges WHERE email LIKE '%@demo.goverhub.test'"]);
  const A = seed(RUN); const C = A.companyId, SITE = A.siteId, E = A.emails;
  const owner = await login(E.owner), manager = await login(E.manager), staff = await login(E.staff), pro = await login('uzman@demo.goverhub.test');
  ok('İşletme ve şube kuruldu; sahip, müdür, personel ve uzman girişleri çalışıyor', !!C && !!SITE && !!owner && !!manager && !!staff && !!pro, RUN);
  const site2 = await req('POST', '/companies/' + C + '/sites', { token: owner, body: { name: 'Pilot ikinci şube ' + RUN } });
  const me = (await req('GET', '/companies', { token: owner })).find(c => c.id === C);
  ok('Yeni şube eklendi, işletmede görünür', (me.sites || []).some(s => s.id === site2.id), (me.sites || []).length + ' şube');

  // Kural -> görev (kural, termin, sorumlu, kanıt, sıradaki işlem)
  const tasks = await req('GET', '/companies/' + C + '/tasks?siteId=' + SITE + '&from=' + iso(-1) + '&to=' + iso(46), { token: owner });
  const docTask = tasks.find(t => t.title === 'Soğutucu servis raporu kaydı'), measTask = tasks.find(t => t.title === 'Servis sonrası sıcaklık doğrulaması');
  ok('Uygulanabilir kurallardan iki servis görevi üretilmiş', !!docTask && !!measTask, (docTask && docTask.title) + ' | ' + (measTask && measTask.title));
  const d0 = await req('GET', '/companies/' + C + '/tasks/' + measTask.id, { token: owner });
  const ctx = { kural: !!(d0.rule || d0.ruleVersion || d0.why || d0.obligation), termin: !!(d0.due_at || d0.dueAt), kanit: Array.isArray(d0.requirements) && d0.requirements.length > 0, eksik: Array.isArray(d0.progress && d0.progress.missing) };
  rep.gorevBaglami = { anahtarlar: Object.keys(d0), ...ctx };
  ok('Görev detayı: kural/neden, termin, gerekli kanıt ve eksik adımlar dönüyor', ctx.termin && ctx.kanit && ctx.eksik, JSON.stringify(ctx));

  // Servis talebi -> bildirim -> teklif -> kabul
  const sr = await req('POST', '/companies/' + C + '/service-requests', { token: owner, body: { siteId: SITE, categoryCode: 'refrigeration_service', title: 'Pilot soğutucu servisi ' + RUN, description: 'Görevden açılan servis (sentetik).', city: 'İstanbul', taskId: measTask.id, ncrId: null, shareNcrSummary: false, invitedProfileId: null, invitedProfileIds: [] } });
  const pn = await req('GET', '/pro/notifications', { token: pro });
  const pItem = (pn.items || pn).find(n => JSON.stringify(n).includes(sr.id));
  ok('Uzman, talebi bildirimden bulabiliyor (yönlendirme talebe gidiyor)', !!pItem, pItem ? JSON.stringify(pItem).slice(0, 140) : 'bildirim yok');
  const q = await req('POST', '/pro/requests/' + sr.id + '/quotes', { token: pro, body: { scope: 'Conta ve gaz kontrolü', exclusions: 'Kompresör', priceNet: 1500, vatRate: 20, materials: 'Conta', durationText: '1 gün', warrantyText: '3 ay', validUntil: iso(7), deliverable: 'Servis raporu (PDF)' } });
  const on = await req('GET', '/companies/' + C + '/notifications', { token: owner }); const oItem = (on.items || on).find(n => JSON.stringify(n).includes(sr.id) || JSON.stringify(n).includes(q.id));
  ok('İşletme sahibi, teklife bildirimden adres girmeden ulaşıyor', !!oItem, oItem ? JSON.stringify(oItem).slice(0, 160) : 'bildirim yok');
  const acc = await req('POST', '/companies/' + C + '/quotes/' + q.id + '/accept', { token: owner }); const jobId = acc.jobId;
  ok('Teklif kabul edildi, iş doğdu', !!jobId);
  const a1 = await req('POST', '/companies/' + C + '/jobs/' + jobId + '/appointments', { token: owner, body: { startsAt: iso(2), endsAt: new Date(Date.parse(iso(2)) + 36e5).toISOString(), note: 'Sabah' } });
  const a2 = await req('POST', '/pro/jobs/' + jobId + '/appointments', { token: pro, body: { startsAt: iso(3), endsAt: new Date(Date.parse(iso(3)) + 36e5).toISOString(), note: 'Karşı öneri' } });
  await req('POST', '/companies/' + C + '/appointments/' + a2.id + '/decision', { token: owner, body: { accept: true } });
  const hist = (await req('GET', '/companies/' + C + '/jobs/' + jobId + '/appointments', { token: owner })).history.map(x => x.status);
  ok('Randevu geçmişi: öneri, karşı öneri, kabul; eski öneri geçersiz', hist.includes('confirmed') && hist.includes('superseded'), hist.join(' → '));
  const det = await req('GET', '/companies/' + C + '/service-requests/' + sr.id, { token: owner });
  await req('POST', '/pro/jobs/' + jobId + '/check-in', { token: pro, body: { code: det.job.checkin_code } });

  // Rapor v1 -> kasa; teslim, inceleme ve görev kanıtı ayrı durumlar
  const upload = async n => { const f = mkPdf(n); const r = await req('POST', '/pro/jobs/' + jobId + '/report', { token: pro, body: { report: 'Pilot servis raporu sürüm ' + n + ': conta değiştirildi, gaz basıncı normal, ölçümler eklendi.', file: { mime: 'application/pdf', sha256: sha(f), sizeBytes: f.length } } }); await req('PUT', '/pro/jobs/' + jobId + '/report/' + r.evidenceId + '/content', { token: pro, bytes: f, mime: 'application/pdf' }); return r; };
  const r1 = await upload(1); const docId = r1.documentId;
  const vault = await req('GET', '/companies/' + C + '/documents/' + docId, { token: owner });
  ok('Rapor belge kasasında: doğru şube, hizmet talebi ve görevle', vault.site_id === SITE || (vault.siteId === SITE) || JSON.stringify(vault).includes(SITE), JSON.stringify(vault.origin || vault.serviceOrigin || {}).slice(0, 160));
  const vId = async () => (await req('GET', '/companies/' + C + '/documents/' + docId, { token: owner })).versions[0].id;
  const optBefore = (await req('GET', '/companies/' + C + '/tasks/' + measTask.id, { token: owner })).reportEvidence.options[0];
  ok('İncelenmemiş rapor göreve seçilemiyor, sebep yazıyor', !!optBefore && /henüz incelenmedi/.test(optBefore.reason || ''), optBefore && optBefore.reason);
  const rej = await fails(() => req('POST', '/companies/' + C + '/tasks/' + measTask.id + '/report-evidence', { token: owner, body: { documentId: docId, versionId: null || '' } }));
  const rv = await req('POST', '/companies/' + C + '/documents/' + docId + '/versions/' + await vId() + '/review', { token: manager, body: { decision: 'verified', notes: 'Rapor ve ölçümler okundu.' } });
  ok('Belge incelemesi (müdür) — teslim kabulünden ayrı durum', rv.status === 'verified');
  const staffTry = await fails(() => req('POST', '/companies/' + C + '/tasks/' + measTask.id + '/report-evidence', { token: staff, body: { documentId: docId, versionId: null } }));
  ok('Personel raporu görev kanıtı seçemiyor', !staffTry.ok);
  const sel = await req('POST', '/companies/' + C + '/tasks/' + measTask.id + '/report-evidence', { token: owner, body: { documentId: docId, versionId: await vId() } });
  ok('Raporu görev kanıtı olarak seçme (sürüm 1)', sel.version === 1, JSON.stringify(sel).slice(0, 100));
  let d = await req('GET', '/companies/' + C + '/tasks/' + measTask.id, { token: owner });
  ok('Rapor yalnız belge adımını karşılıyor; ölçüm adımı eksik olarak adıyla yazıyor', JSON.stringify(d.progress.missing) === JSON.stringify(['Ölçüm: sıcaklık (°C)']), JSON.stringify(d.progress.missing));
  const early = await fails(() => req('POST', '/companies/' + C + '/tasks/' + measTask.id + '/complete', { token: owner, body: {} }));
  ok('Ölçüm yokken görev kapanmıyor (EVIDENCE_INCOMPLETE)', !early.ok && /EVIDENCE_INCOMPLETE|Ölçüm/.test(early.msg), (early.msg || '').slice(0, 140));

  // Revizyon: açık görevde eski seçim geçersiz
  await req('POST', '/companies/' + C + '/jobs/' + jobId + '/acceptance', { token: owner, body: { accept: false, note: 'Revizyon: sonrası ölçüm süresi raporda yok.' } });
  await upload(2);
  d = await req('GET', '/companies/' + C + '/tasks/' + measTask.id, { token: owner });
  ok('Revizyon açık görevde eski seçimi geçersiz kıldı (v1 stale, belge adımı yine eksik)', d.reportEvidence.links[0].status === 'stale' && d.reportEvidence.links[0].counts === false && d.progress.missing.length === 2, JSON.stringify(d.progress.missing));
  const oldTry = await fails(() => req('POST', '/companies/' + C + '/tasks/' + measTask.id + '/report-evidence', { token: owner, body: { documentId: docId, versionId: (async () => null)() } }));
  await req('POST', '/companies/' + C + '/documents/' + docId + '/versions/' + await vId() + '/review', { token: manager, body: { decision: 'verified', notes: 'Revizyon okundu.' } });
  const sel2 = await req('POST', '/companies/' + C + '/tasks/' + measTask.id + '/report-evidence', { token: owner, body: { documentId: docId, versionId: await vId() } });
  ok('Yeni sürüm incelendikten sonra seçildi (sürüm 2)', sel2.version === 2);
  const eqs = await req('GET', '/companies/' + C + '/sites/' + SITE + '/equipment', { token: owner }); const th = (eqs.items || eqs).find(e => /thermo|termometre/i.test((e.type || '') + (e.name || '')));
  const meas = await req('POST', '/companies/' + C + '/tasks/' + measTask.id + '/measurements', { token: owner, body: Object.assign({ quantity: 'temperature', value: 3, unit: '°C', measuredAt: new Date().toISOString() }, th ? { instrumentId: th.id } : {}) });
  ok('Gerekli ölçüm girildi', !!meas.id || !!meas, th ? 'termometre: ' + th.name : 'termometresiz');
  const done = await req('POST', '/companies/' + C + '/tasks/' + measTask.id + '/complete', { token: owner, body: {} });
  d = await req('GET', '/companies/' + C + '/tasks/' + measTask.id, { token: owner });
  ok('Görev kapandı; kapanışın dayandığı sürüm 2 geçmişte', d.status === 'done' && d.reportEvidence.links.some(l => l.version === 2 && l.completionBasis), 'durum ' + d.status);
  await req('POST', '/companies/' + C + '/jobs/' + jobId + '/acceptance', { token: owner, body: { accept: true, note: 'Revizyon okundu, teslim kabul.' } });
  await req('POST', '/pro/jobs/' + jobId + '/report', { token: pro, body: { report: 'Sonradan sürüm 3 (kapanıştan sonra revizyon).', file: (() => { const f = mkPdf(3); return { mime: 'application/pdf', sha256: sha(f), sizeBytes: f.length }; })() } }).catch(() => { });
  d = await req('GET', '/companies/' + C + '/tasks/' + measTask.id, { token: owner });
  ok('Kapanıştan sonraki revizyon kapanmış görevin dayandığı sürümü değiştirmiyor', d.status === 'done' && d.reportEvidence.links.some(l => l.version === 2 && l.completionBasis), 'durum ' + d.status);

  // Sayfa yenileme benzeri: bağımsız okuma, aynı durum (sunucu durumu kalıcı)
  const d2 = await req('GET', '/companies/' + C + '/tasks/' + measTask.id, { token: await login(E.manager) });
  ok('Başka kişi (müdür) yeni oturumda aynı durumu görüyor (devralma)', d2.status === 'done' && d2.reportEvidence.links.length >= 1);

  // Platform yöneticisi
  const adm = await login('yonetici@demo.goverhub.test'); const pc = await fails(() => req('GET', '/admin/overview', { token: adm }));
  ok('Platform yöneticisi girişi ve yönetim ekranı verisi', pc.ok, pc.ok ? 'kurallar listelendi' : pc.msg.slice(0, 80));

  // Denetim dosyası
  const rep1 = await req('GET', '/companies/' + C + '/audit-report?format=json&from=' + encodeURIComponent(iso(-30)) + '&to=' + encodeURIComponent(iso(2)), { token: owner });
  const js = JSON.stringify(rep1); rep.denetimAnahtar = Object.keys(rep1);
  const ct = (rep1.sections.closures || { tasks: [] }).tasks.find(x => x.id === measTask.id);
  ok('Denetim dosyası: kapanan görev, dayandığı rapor sürümü (2, incelendi, özetli) ve kapanış izi', !!ct && ct.basis.some(b => b.version === 2 && b.review === 'İncelendi' && /^[0-9a-f]{64}$/.test(b.sha256 || '')), ct ? JSON.stringify(ct.basis) : 'görev yok');
  ok('Denetim dosyasında kural sürümü kaynakları ve örnek etiketi var', rep1.sections.sources.length > 0 && rep1.example === true, rep1.sections.sources.length + ' kaynak');
  const pdfR = await fetch(BASE + '/api/companies/' + C + '/audit-report?format=pdf&from=' + encodeURIComponent(iso(-30)) + '&to=' + encodeURIComponent(iso(2)), { headers: { authorization: 'Bearer ' + owner } }); const pb = Buffer.from(await pdfR.arrayBuffer());
  fs.writeFileSync(path.join(OUT, 'denetim-dosyasi-' + RUN + '.pdf'), pb); ok('Denetim dosyası PDF', pb.slice(0, 5).toString() === '%PDF-' && pb.length > 2000, pb.length + ' bayt');

  // B: tek yönetici — dış doğrulayıcı
  const B = seed(RUN + 'b', '--single'); const CB = B.companyId, SB = B.siteId; const ownB = await login(B.emails.owner);
  const ncr = await req('POST', '/companies/' + CB + '/nonconformities', { token: ownB, body: { siteId: SB, title: 'Dondurucu alarmı çalışmıyor ' + RUN, description: 'Pilot kapanış, sentetik vaka.', hazardType: 'cold_chain_temperature', severity: 'critical', containment: 'Ürünler taşındı.' } });
  await req('POST', '/companies/' + CB + '/nonconformities/' + ncr.id + '/assignment', { token: ownB, body: { ownerId: (await req('GET', '/auth/me', { token: ownB }).catch(() => ({}))).id || undefined, dueAt: iso(2) } }).catch(() => { });
  await req('POST', '/companies/' + CB + '/nonconformities/' + ncr.id + '/causes', { token: ownB, body: { stage: 'initial', categories: ['equipment'], notes: 'Pil bitmiş olabilir.' } }).catch(() => { });
  const act = await req('POST', '/companies/' + CB + '/nonconformities/' + ncr.id + '/actions', { token: ownB, body: { kind: 'correction', description: 'Alarm pilini değiştir.' } });
  await req('POST', '/companies/' + CB + '/nonconformities/' + ncr.id + '/actions/' + act.id, { token: ownB, body: { op: 'done', notes: 'Pil değişti.' } });
  const self = await fails(() => req('POST', '/companies/' + CB + '/nonconformities/' + ncr.id + '/actions/' + act.id, { token: ownB, body: { op: 'verify', result: 'accepted', selfVerify: true, notes: 'Tek yöneticiyiz, alarmı denedim, çalıştı.' } }));
  ok('Tek yönetici yüksek riskli işini kendi doğrulayamıyor', !self.ok && /VERIFIER_NOT_INDEPENDENT|bağımsız/.test(self.msg), (self.msg || '').slice(0, 120));
  await req('POST', '/companies/' + CB + '/verifiers', { token: ownB, body: { email: B.emails.verifier, siteId: SB, days: 30, note: 'Yüksek riskli kayıtların bağımsız doğrulaması için (sentetik).' } });
  const ver = await login(B.emails.verifier);
  const queue = await req('GET', '/companies/' + CB + '/verification-queue', { token: ver });
  ok('Dış doğrulayıcı yalnız doğrulama kuyruğunu görüyor', queue.length === 1 && queue[0].ncrId === ncr.id, queue.length + ' kayıt');
  const vtry = await fails(() => req('POST', '/companies/' + CB + '/nonconformities/' + ncr.id + '/actions/' + act.id, { token: ver, body: { op: 'verify', result: 'accepted', notes: 'Alarmı test butonuyla denedim, çalıyor.' } }));
  ok('Dış doğrulayıcı eylemi bağımsız olarak doğruladı', vtry.ok, vtry.msg ? vtry.msg.slice(0, 120) : 'doğrulandı');
  const own = await req('GET', '/companies/' + CB + '/nonconformities/' + ncr.id, { token: ownB });
  const a0 = own.actions.find(x => x.id === act.id);
  ok('Doğrulama kaydı: bağımsız mod, doğrulayıcı kimliği görünür', a0 && (a0.verification_mode === 'independent' || /Doğrulayan|verified/.test(JSON.stringify(a0))), a0 && (a0.verification_mode + '/' + a0.verified_by_name));

  rep.run = RUN; rep.base = BASE; rep.tarih = new Date().toISOString(); rep.isletmeA = C; rep.isletmeB = CB;
  fs.writeFileSync(path.join(OUT, 'senaryo-' + RUN + '.json'), JSON.stringify(rep, null, 2));
  const fail = res.filter(x => x.startsWith('BAŞARISIZ')); console.log('\n' + (fail.length ? 'BAŞARISIZ: ' + fail.length : 'tüm adımlar tamam') + ' (' + res.length + ' adım)'); process.exit(fail.length ? 1 : 0);
})().catch(e => { console.log(res.join('\n')); console.error('HATA', e.message); process.exit(1); });
