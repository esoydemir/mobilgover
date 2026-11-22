// Masaüstü masa kabulü: iki kullanıcı (platform yöneticisi + alan inceleyici) ayrı oturumlarda. Hepsi SENTETİK.
const { chromium, OUT, URL, API, q, login, api, txt } = require('./leg-lib.cjs'); const fs = require('fs'); const T = 'C:/Users/gkhno/AppData/Local/Temp/';
const ids = JSON.parse(fs.readFileSync(T + 't7-weekly.json')); const STEP = process.env.STEP || 'all';
const TITLE = 'Sentetik Taşınmaz Aracılık Hizmetleri Dosya Düzeni Yönetmeliği'; const DAY = new Date().toISOString().slice(0, 10).replaceAll('-', ''); const PUBID = `${DAY}-95`;
const sites = { emlakA: ids.estate.A, emlakB: ids.estate.B, market: ids.market.S, elektrik: ids.elektrik.S };
const snap = () => { const o = {}; for (const [k, s] of Object.entries(sites)) o[k] = `gorev=${q(`SELECT count(*) FROM tasks WHERE site_id='${s}'`)} bildirim=${q(`SELECT count(*) FROM notifications WHERE site_id='${s}'`)}`; o.roller = q(`SELECT count(*) FROM platform_roles`); o.alanlar = q(`SELECT count(*) FROM reviewer_areas`); return o; };
const pn = (W, s) => `${OUT}/${W}-${s}.png`; const sleep = ms => new Promise(r => setTimeout(r, ms));
const mk = async (b, w = 1366, h = 768) => { const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage(); p.on('pageerror', e => console.log('PAGEERROR', e.message)); return p; };
const rowId = () => q(`SELECT id FROM legislation_changes WHERE doc_title='${TITLE}'`);
(async () => {
  const b = await chromium.launch(); const W = +(process.env.W || 1366), H = +(process.env.H || 768); const PRE = process.env.PRE || 'a';
  if (STEP === 'all' || STEP === '1') {
    console.log('ONCE', JSON.stringify(snap()));
    fs.writeFileSync(T + 't8-before.json', JSON.stringify(snap()));
    const cur = JSON.parse(fs.readFileSync(T + 'synth-publish.json', 'utf8')); if (!cur.find(x => x.id === PUBID)) cur.push({ id: PUBID, title: TITLE, sayi: 99095, articles: ['Bu Yönetmelik, gayrimenkul aracılık hizmeti veren işletmeleri kapsar.', 'Gayrimenkul aracılık hizmeti veren işletmeler, mülk sahipleriyle yaptıkları yetki sözleşmelerinin dosyasını düzenli kontrol eder.', 'Bu Yönetmelik 02/12/2026 tarihinde yürürlüğe girer.'] });
    fs.writeFileSync(T + 'synth-publish.json', JSON.stringify(cur)); await sleep(12000);
    q('delete from login_challenges'); const A = await mk(b, W, H); await login(A, 'yonetici@demo.goverhub.test');
    await A.goto(URL + '/legislation'); await A.waitForTimeout(2500); await A.getByTestId('leg-scan').first().click(); await A.waitForTimeout(4000);
    await A.getByTestId('leg-quick-unowned').first().click(); await A.waitForTimeout(1200); await A.screenshot({ path: pn(PRE, '1-sabah-kuyruk-sahipsiz') });
    const id = rowId(); console.log('YENI KAYIT', id, q(`SELECT status||' '||coalesce(effective_from::text,'-')||' '||date_status FROM legislation_changes WHERE id='${id}'`));
    await A.getByTestId(`leg-row-${id}`).first().click(); await A.waitForTimeout(1800); await A.screenshot({ path: pn(PRE, '2-kaynak-ve-metin') });
    console.log('KAYNAK:', (await txt(A)).slice(0, 900));
    // kural yazarı (platform yöneticisi değildir) öneriyi yazar ve taslağı hazırlar — masaüstü akışının ön koşulu
    q('delete from login_challenges'); const Y = await mk(b, 1100, 900); await login(Y, 'yazar@demo.goverhub.test');
    const prop = { code: 'EX-ESTATE-DOSYA-AYLIK', title: 'Emlak dosya düzeni kontrolü (ÖRNEK)', kind: 'legal_requirement', isExample: true, provisionIds: [], ambiguityNote: null, condition: { all: [{ fact: 'activity.brokerage', op: 'eq', value: true }, { fact: 'activity.client_contracts', op: 'eq', value: true }] },
      obligationTitle: 'Yetki sözleşmesi dosyasını aylık kontrol et (ÖRNEK)', obligationSummary: 'Sentetik düzenleme: yetki sözleşmeli şubede dosya düzeni her ay kontrol edilir (ÖRNEK; gerçek mevzuat değildir).', effectiveFrom: '2026-12-02', effectiveTo: null, changeReason: 'Sentetik resmî yayın', requiredReviewAreas: ['consumer'],
      templates: [{ code: 'dosya', title: 'Dosya düzenini kontrol et (ÖRNEK)', instructions: 'Yetki sözleşmeli her mülk için imzalı örneğin dosyada olduğunu işaretle.', recurrence: { freq: 'monthly', day: 31, at: '10:00', basis: 'admin_choice', basisNote: 'Ayın son günü seçimi bir zamanlama tercihidir; hukuki zorunluluk değildir.' }, evidence: [{ kind: 'photo', min: 1 }], limits: [], severity: 'minor', hazardType: 'hygiene', emergencyInstruction: 'Eksik dosya varsa yöneticiye bildir.' }] };
    const pr = await api(Y, 'PUT', `/admin/legislation/changes/${id}/proposal`, prop); console.log('ONERI', pr.status, JSON.stringify(pr.body).slice(0, 400), 'TASLAK', JSON.stringify((await api(Y, 'POST', `/admin/legislation/changes/${id}/prepare`)).body).slice(0, 160));
    console.log('SONRA (taslak):', JSON.stringify(snap()));
    // yönetici: kaydı açar, atama panelini görür
    await A.goto(URL + '/legislation?sel=' + id); await A.waitForTimeout(3000); await A.getByTestId('leg-assign').first().scrollIntoViewIfNeeded(); await A.waitForTimeout(800);
    const cand = await A.getByTestId('leg-assign').first().innerText(); console.log('ATAMA PANELI:', cand.split('\n').join(' | ').slice(0, 900));
    await A.getByTestId('leg-asg-reason').first().fill('Tüketici alanı, emlak yayını: alan uzmanına atandı.'); await A.waitForTimeout(400);
    await A.screenshot({ path: pn(PRE, '3-atama-paneli') });
    const alanId = q(`SELECT id FROM users WHERE email='alan-uzmani@demo.goverhub.test'`);
    const roles0 = q('select count(*) from platform_roles') + '/' + q('select count(*) from reviewer_areas');
    await A.getByTestId(`leg-assign-${alanId}`).first().click(); await A.waitForTimeout(2200);
    console.log('ATANDI:', q(`SELECT assigned_to=(SELECT id FROM users WHERE email='alan-uzmani@demo.goverhub.test') FROM legislation_changes WHERE id='${id}'`), 'roller/alanlar önce', roles0, 'sonra', q('select count(*) from platform_roles') + '/' + q('select count(*) from reviewer_areas'));
    console.log('DENETIM:', q(`SELECT event_type||' '||payload::text FROM audit_events WHERE event_type='legislation.assigned' ORDER BY seq DESC LIMIT 1`).slice(0, 400));
    // yönetici onaylayamaz: sebebi düğmenin yanında
    await A.getByTestId('leg-decision').first().scrollIntoViewIfNeeded(); console.log('YONETICI KARAR (pasif nedenleri):', (await A.getByTestId('leg-decision').first().innerText()).split('\n').join(' | ').slice(0, 700));
    await A.screenshot({ path: pn(PRE, '4-yonetici-karar-pasif') });
    // inceleyici: ayrı oturum
    q('delete from login_challenges'); const R = await mk(b, 1440, 900); await login(R, 'alan-uzmani@demo.goverhub.test');
    await R.goto(URL + '/legislation'); await R.waitForTimeout(2500); await R.getByTestId('leg-quick-mine').first().click(); await R.waitForTimeout(1500);
    console.log('INCELEYICI BANA ATANAN:', (await R.getByTestId('desk-rows').first().innerText()).split('\n').join(' | ').slice(0, 300)); await R.screenshot({ path: pn('r', '1-bana-atanan'), });
    await R.getByTestId(`leg-row-${id}`).first().click(); await R.waitForTimeout(2000);
    const imp = await R.getByTestId('leg-impact').first(); await imp.scrollIntoViewIfNeeded(); await R.waitForTimeout(500);
    const impTxt = (await imp.innerText()).split('\n').join(' | '); console.log('ETKI ONIZLEME:', impTxt.slice(0, 1800)); fs.writeFileSync(T + 't8-preview.txt', impTxt);
    await R.screenshot({ path: pn('r', '2-etki-onizleme') });
    await R.getByTestId('leg-reason').first().fill('Resmî kaynak okundu; sözleşmeli emlak şubesi kapsamda, ayın son günü seçimi örnek senaryodur.'); await R.waitForTimeout(400);
    await R.getByTestId('leg-areas').first().scrollIntoViewIfNeeded(); await R.screenshot({ path: pn('r', '3-alan-incelemesi') });
    await R.getByTestId('leg-area-approve-consumer').first().click(); await R.waitForTimeout(2200);
    console.log('ALAN INCELEMESI:', q(`SELECT area||' '||decision FROM rule_area_reviews WHERE rule_version_id=(SELECT rule_version_id FROM legislation_changes WHERE id='${id}')`));
    await R.getByTestId('leg-approve').first().click(); await R.waitForTimeout(2500); await R.screenshot({ path: pn('r', '4-onaylandi') });
    console.log('KARAR SONRASI SIRA:', (await R.getByTestId('leg-next').first().innerText().catch(() => '?')), '| DURUM', q(`SELECT status||' apply_on='||coalesce(apply_on::text,'-') FROM legislation_changes WHERE id='${id}'`));
    console.log('ONAYDAN SONRA, YURURLUKTEN ONCE:', JSON.stringify(snap()));
    // yetkisiz ikinci hesaplar
    for (const em of ['pazar@demo.goverhub.test', 'moderator@demo.goverhub.test']) {
      q('delete from login_challenges'); const U = await mk(b, 1366, 768); await login(U, em); await U.goto(URL + '/legislation'); await U.waitForTimeout(2500);
      const rj = await api(U, 'POST', `/admin/legislation/changes/${id}/approve`, { reason: 'Yetkisiz deneme' }); const rj2 = await api(U, 'POST', `/admin/legislation/changes/${id}/assign`, { userId: alanId, reason: 'Yetkisiz deneme' });
      console.log('YETKISIZ', em, 'ekran:', (await txt(U)).slice(0, 120), '| onay', rj.status, '| atama', rj2.status); if (em.startsWith('pazar')) await U.screenshot({ path: pn('u', '1-yetkisiz') });
    }
    const Ya = await api(A, 'POST', `/admin/legislation/changes/${id}/approve`, { reason: 'Yönetici onay denemesi' }); console.log('YONETICI ONAY DENEMESI (rolü yok):', Ya.status, JSON.stringify(Ya.body).slice(0, 120));
    fs.writeFileSync(T + 't8-cid.txt', id);
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
