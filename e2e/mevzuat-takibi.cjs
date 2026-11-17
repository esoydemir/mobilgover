/**
 * Mevzuat takibi — tarayıcı kabulü (AYRI, sentetik ortamda; 8091 ve 8080'e dokunmaz).
 *   1) node e2e/mevzuat-sentetik-kaynak.cjs 8199
 *   2) AYRI ortam: yerel-demo/ayri-ortam.yaml, LEGISLATION_RG_BASE=http://host.docker.internal:8199/rg, LEGISLATION_MEVZUAT_BASE=.../mv,
 *      LEGISLATION_MEVZUAT_WATCH=1:9001:5:Sentetik-Gida-Kanunu
 *   3) NODE_PATH=$(npm root -g) WEB=http://localhost:8098 node e2e/mevzuat-takibi.cjs <ekran-görüntüsü-klasörü> <yerel-demo klasörü> goverhub-mevzuat
 * Kaynak sentetiktir (resmî olmayan adres): tüm kayıtlar ÖRNEK sayılır.
 */
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const WEB = process.env.WEB || 'http://localhost:8098', SRC = process.env.SRC || 'http://localhost:8199';
const OUT = process.argv[2], DIR = process.argv[3], PROJ = process.argv[4] || 'goverhub-mevzuat';
const dc = cmd => execSync(`docker compose -p ${PROJ} -f compose.yaml -f ayri-ortam.yaml ${cmd}`, { cwd: DIR, env: { ...process.env, AYRI_PORT: '8098', AYRI_ALTAG: '172.30.81' } }).toString().trim();
const sql = q => dc(`exec -T db psql -U postgres -d goverhub_demo -tAc "${q.replace(/"/g, '\\"')}"`);
const num = q => Number(sql(q));
const evidence = [];
let pass = 0, fail = 0;
const check = (label, ok, extra) => { ok ? pass++ : fail++; evidence.push({ label, ok: !!ok, ...(extra !== undefined ? { extra } : {}) }); console.log(`${ok ? 'GEÇTİ ' : 'KALDI '} ${label}${extra !== undefined ? ' · ' + JSON.stringify(extra) : ''}`); };
const day = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(d);
const TODAY = day(new Date());
const plus = n => day(new Date(Date.now() + n * 86400000));
const compact = TODAY.replaceAll('-', '');
const wait = ms => new Promise(r => setTimeout(r, ms));
const ctl = (p, body) => fetch(SRC + p, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
const EM = { yazar: 'yazar@demo.goverhub.test', onay: 'onay@demo.goverhub.test', uzman: 'alan-uzmani@demo.goverhub.test', yonetici: 'yonetici@demo.goverhub.test', sahip: 'sahip@demo.goverhub.test', personel: 'personel@demo.goverhub.test' };

async function apiLogin(email) {
  await fetch(WEB + '/api/auth/email/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  const mail = await (await fetch(`${WEB}/api/dev/outbox/latest?email=${encodeURIComponent(email)}`)).json();
  const code = /\b(\d{6})\b/.exec(mail.body)[1];
  const r = await (await fetch(WEB + '/api/auth/email/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code }) })).json();
  return r.token || r.accessToken || r.session?.token;
}
const api = async (token, method, path, body) => {
  const r = await fetch(WEB + '/api' + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  let n = 0;
  async function session(email) {
    const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 520, height: 1100 }, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('SAYFA HATASI', e.message));
    const s = {
      p, ctx,
      id: t => p.getByTestId(t).first(),
      text: (t, exact = true) => p.getByText(t, { exact }).first(),
      body: async () => (await p.locator('body').innerText()).replace(/\s+/g, ' '),
      shot: async name => { n++; await p.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png`, fullPage: true }); },
    };
    await p.goto(WEB + '/login'); await s.id('login-email').waitFor();
    await s.id('login-email').fill(email); await s.text('Kod gönder').click(); await s.id('login-code').waitFor();
    await s.text('Demo kutusundan kodu getir').click(); await wait(800); await s.text('Giriş yap').click(); await wait(3500);
    s.open = async path => { await p.goto(WEB + path); await wait(2200); };
    s.has = async t => (await s.body()).includes(t);
    return s;
  }
  const changeId = title => sql(`select id from legislation_changes where doc_title ilike '%${title}%' order by detected_at desc limit 1`);
  const ruleTasks = (code, site) => num(`select count(*) from tasks t join task_templates tt on tt.id=t.template_id join rule_versions rv on rv.id=tt.rule_version_id join rules r on r.id=rv.rule_id where r.code='${code}' and t.site_id='${site}'`);
  const openTasks = (code, site) => num(`select count(*) from tasks t join task_templates tt on tt.id=t.template_id join rule_versions rv on rv.id=tt.rule_version_id join rules r on r.id=rv.rule_id where r.code='${code}' and t.site_id='${site}' and t.status='open'`);
  const notifs = (cid, site) => num(`select count(*) from notifications where entity_type='legislation_change' and entity_id='${cid}'${site ? ` and site_id='${site}'` : ''}`);
  const totals = () => ({ tasks: num('select count(*) from tasks'), notifs: num('select count(*) from notifications'), obl: num('select count(*) from obligations'), rules: num('select count(*) from rule_versions') });

  // ── Hazırlık: ikinci şube (LPG yok) — API ile ──
  const ownerTok = await apiLogin(EM.sahip);
  const companies = (await api(ownerTok, 'GET', '/companies')).body;
  const CO = companies[0].id;
  const siteA = sql(`select id from sites where company_id='${CO}' and name='Kadıköy Moda'`);
  let siteB = sql(`select id from sites where company_id='${CO}' and name like 'Beşiktaş%'`);
  if (!siteB) {
    await api(ownerTok, 'POST', `/companies/${CO}/sites`, { name: 'Beşiktaş (LPG yok)' });
    siteB = sql(`select id from sites where company_id='${CO}' and name like 'Beşiktaş%'`);
    for (const [key, value] of [['activity.food_preparation', true], ['storage.cold', false], ['utility.lpg', false], ['site.province', 'İstanbul']]) {
      await api(ownerTok, 'POST', `/companies/${CO}/profile/facts`, { siteId: siteB, key, value, source: 'user_declared', verification: 'user_confirmed' });
    }
  }
  check('Hazırlık: iki şube var (Kadıköy Moda, Beşiktaş LPG yok)', !!siteA && !!siteB && siteA !== siteB, { siteA, siteB });

  // ── 1) Boş durum ve ilk tarama ──
  const admin = await session(EM.yonetici);
  await admin.open('/legislation');
  await admin.shot('yonetim-bos-durum');
  check('Yönetim ekranı: son başarılı tarama yok, kaynaklar listeli', (await admin.body()).includes('Henüz başarılı tarama yok') && (await admin.body()).includes('Resmî Gazete'));

  // Mevzuat taban okuması için sentetik birleştirilmiş metin
  await ctl('/ctl/consolidated', { key: '1.5.9001', title: 'SENTETİK GIDA KANUNU', articles: { 1: 'Amaç: gıda güvenliği.', 2: 'Soğuk zincir kesintisiz sürdürülür.', 3: 'Eski madde.' } });
  const items = {
    lpg: { id: `${compact}-1`, category: 'YÖNETMELİKLER', title: 'Sentetik Gıda İşletmeleri LPG Güvenliği Yönetmeliği', sayi: 99001, articles: ['Gıda işletmelerinde LPG bağlantıları günlük kontrol edilir.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.', 'Bu Yönetmelik hükümlerini Sentetik Bakan yürütür.'] },
    uni: { id: `${compact}-2`, category: 'YÖNETMELİKLER', title: 'Sentetik Üniversitesi Gıda Uygulama ve Araştırma Merkezi Yönetmeliği', articles: ['Merkez kurulur.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] },
    belirsiz: { id: `${compact}-3`, category: 'YÖNETMELİKLER', title: 'Sentetik Gıda Hijyeni Ek Yönetmeliği', articles: ['Gıda işletmeleri çalışan sağlık kaydı tutar.', 'Bu Yönetmelik yayımını izleyen ayın başında yürürlüğe girer.'] },
    ret: { id: `${compact}-4`, category: 'TEBLİĞLER', title: 'Sentetik Gıda Etiketleme Tebliği', articles: ['Etiket bilgisi okunaklı olur.', 'Bu Tebliğ yayımı tarihinde yürürlüğe girer.'] },
  };
  for (const k of ['lpg', 'uni', 'belirsiz', 'ret']) await ctl('/ctl/publish', { day: TODAY, item: items[k] });
  const before = totals();
  await admin.open('/legislation');
  await admin.id('leg-scan').click(); await wait(4000);
  await admin.shot('tarama-sonrasi-kuyruk');
  const q1 = await admin.body();
  check('Tarama: sentetik yayın bulundu ve kuyruğa düştü; üniversite yönetmeliği kapsam dışı', q1.includes('Sentetik Gıda İşletmeleri LPG Güvenliği Yönetmeliği') && !q1.includes('Üniversitesi Gıda Uygulama'));
  check('Kuyruktaki kayıt ÖRNEK ve sentetik kaynak olarak işaretli', q1.includes('ÖRNEK') && q1.includes('SENTETİK KAYNAK'));
  check('Bekleyen sayacı 3 (LPG, belirsiz tarihli, etiket)', num('select count(*) from legislation_changes where status=\'pending\'') === 3 && (await admin.id('leg-pending-count').innerText()).trim() === '3');
  const after1 = totals();
  check('ONAY ÖNCESİ: hiçbir işletmenin görevi/bildirimi/yükümlülüğü/kural sürümü değişmedi', JSON.stringify(before) === JSON.stringify(after1), { before, after1 });
  check('Son başarılı tarama zamanı görünüyor', !(await admin.body()).includes('Henüz başarılı tarama yok'));

  // ── 2) Aynı yayın yeniden taranır ──
  const c0 = num('select count(*) from legislation_changes');
  await admin.id('leg-scan').click(); await wait(3500); await admin.id('leg-scan').click(); await wait(3500);
  check('Yeniden tarama: aynı yayın için ikinci kayıt oluşmadı', num('select count(*) from legislation_changes') === c0, { c0 });

  // ── 3) Yetkisiz kullanıcı ──
  const lpgId = changeId('LPG Güvenliği');
  const staffTok = await apiLogin(EM.personel);
  const yazarTok = await apiLogin(EM.yazar), onayTok = await apiLogin(EM.onay);
  check('Yetkisiz (personel) kuyruğu göremez', (await api(staffTok, 'GET', '/admin/legislation/overview')).status === 403);
  check('Yetkisiz (personel) onaylayamaz', (await api(staffTok, 'POST', `/admin/legislation/changes/${lpgId}/approve`, { reason: 'deneme' })).status === 403);
  check('Kural yazarı kendi önerisini onaylayamaz', (await api(yazarTok, 'POST', `/admin/legislation/changes/${lpgId}/approve`, { reason: 'yazar onayı' })).status === 403);

  // ── 4) Yazar: öneri ──
  const yazar = await session(EM.yazar);
  await yazar.open(`/legislation/${lpgId}`);
  await yazar.shot('inceleme-eski-yeni-metin');
  const d1 = await yazar.body();
  check('İnceleme: değişiklik türü, resmî kaynak bağlantısı, belge, yürürlük tarihi tek kayıtta', d1.includes('Yeni yayın') && d1.includes('http://host.docker.internal:8199') && d1.includes('Yürürlük tarihi'));
  check('İnceleme: eski/yeni metin yan yana bölümleri', d1.includes('ESKİ METİN') && d1.includes('YENİ METİN') && d1.includes('LPG bağlantıları'));
  check('Otomatik karşılaştırma "yalnız öneridir" diye işaretli', d1.includes('YALNIZ ÖNERİDİR'));
  await yazar.id('leg-suggest').click(); await wait(1500);
  await yazar.id('leg-p-code').fill('EX-LEG-LPG');
  await yazar.id('leg-p-title').fill('Sentetik LPG kontrolü (ÖRNEK)');
  await yazar.id('leg-p-ob-title').fill('LPG tüpü ve bağlantıları kontrol edilir (ÖRNEK)');
  await yazar.id('leg-p-ob-summary').fill('Sentetik düzenleme: LPG kullanan gıda işletmeleri bağlantıları kontrol eder.');
  await yazar.id('leg-p-from').fill(plus(-30));
  await yazar.id('leg-p-reason').fill('Sentetik resmî yayın');
  await yazar.id('leg-p-cond').fill(JSON.stringify({ all: [{ fact: 'utility.lpg', op: 'eq', value: true }, { fact: 'activity.food_preparation', op: 'eq', value: true }] }));
  await yazar.id('leg-t-title-0').fill('LPG bağlantı kontrolü');
  await yazar.id('leg-t-instr-0').fill('Tüp bağlantılarını kontrol et ve fotoğrafla.');
  await yazar.id('leg-p-save').click(); await wait(3000);
  await yazar.shot('oneri-ve-etki-onizlemesi');
  const d2 = await yazar.body();
  check('Etki önizlemesi onaydan ÖNCE Kadıköy şubesini YENİ YÜKÜMLÜLÜK olarak, kapsam dışı şubeyi sayıyla gösterir', d2.includes('Kadıköy Moda') && d2.includes('YENİ YÜKÜMLÜLÜK') && /1 şube kapsam dışı/.test(d2));
  check('Öneri kaydı sonrası hâlâ görev/bildirim yok', ruleTasks('EX-LEG-LPG', siteA) === 0 && notifs(lpgId) === 0);
  await yazar.id('leg-prepare').click(); await wait(3000);
  check('Kural taslağı hazırlandı ve incelemeye gönderildi', num(`select count(*) from rule_versions rv join rules r on r.id=rv.rule_id where r.code='EX-LEG-LPG' and rv.status='in_review'`) === 1);
  await yazar.shot('taslak-hazir-alan-incelemesi-bekliyor');

  // ── 5) Alan uzmanı onayı (mevcut yönetim ekranı) ──
  const uzman = await session(EM.uzman);
  await uzman.open('/admin');
  await uzman.id('admin-reason').fill('Gıda güvenliği açısından uygun (sentetik).');
  await uzman.text('food_safety alanında onayla (alan uzmanı)').click(); await wait(2500);
  check('Alan uzmanı incelemesi kaydedildi', num(`select count(*) from rule_area_reviews ra join rule_versions rv on rv.id=ra.rule_version_id join rules r on r.id=rv.rule_id where r.code='EX-LEG-LPG' and ra.decision='approved'`) === 1);

  // ── 6) Onay: gerekçe zorunlu; sonra uygulama ──
  const onay = await session(EM.onay);
  await onay.open(`/legislation/${lpgId}`);
  await onay.id('leg-approve').click(); await wait(800);
  check('Boş gerekçeyle onay engellendi', (await onay.body()).includes('Onaylamak için gerekçe yazmalısın'));
  check('Onay engelinde hiçbir şey uygulanmadı', ruleTasks('EX-LEG-LPG', siteA) === 0 && notifs(lpgId) === 0);
  await onay.shot('bos-gerekce-reddedildi');
  await onay.id('leg-reason').fill('Resmî kaynak okundu; yürürlük bugün; kapsam LPG kullanan gıda işletmeleri.');
  await onay.id('leg-approve').click(); await wait(5000);
  await onay.shot('onaylandi-ve-uygulandi');
  check('Yürürlük günü bugün: onayda uygulandı (UYGULANDI)', (await onay.id('leg-status').innerText()).includes('UYGULANDI'));
  check('Yalnız eşleşen şubede görev oluştu (Kadıköy), kapsam dışı şubede (Beşiktaş) görev yok', ruleTasks('EX-LEG-LPG', siteA) > 0 && ruleTasks('EX-LEG-LPG', siteB) === 0, { A: ruleTasks('EX-LEG-LPG', siteA), B: ruleTasks('EX-LEG-LPG', siteB) });
  check('Bildirim yalnız eşleşen şube için ve her alıcıya bir kez', notifs(lpgId, siteA) > 0 && notifs(lpgId, siteB) === 0 && num(`select count(*) from (select user_id, count(*) c from notifications where entity_id='${lpgId}' group by user_id having count(*)>1) x`) === 0);
  check('Kapsam dışı şubenin yükümlülük satırı yok', num(`select count(*) from obligations o join rules r on r.id=o.rule_id where r.code='EX-LEG-LPG' and o.site_id='${siteB}'`) === 0);
  const t1 = ruleTasks('EX-LEG-LPG', siteA), n1 = notifs(lpgId);
  await admin.open('/legislation'); await admin.id('leg-scan').click(); await wait(3500);
  await api(await apiLogin(EM.yonetici), 'POST', '/admin/legislation/apply-due');
  check('Yeniden tarama + uygulama tetikleme: görev ve bildirim ikilenmedi', ruleTasks('EX-LEG-LPG', siteA) === t1 && notifs(lpgId) === n1);
  check('Denetim izi: kim/ne/ne zaman/hangi gerekçe', num(`select count(*) from audit_events where entity_id='${lpgId}' and event_type in ('legislation.detected','legislation.proposal_saved','legislation.drafted','legislation.approved','legislation.applied')`) >= 5
    && sql(`select payload->>'reason' from audit_events where entity_id='${lpgId}' and event_type='legislation.approved'`).includes('Resmî kaynak okundu'));
  await onay.open(`/legislation/${lpgId}`);
  check('Geçmiş bölümü onaylayanı ve gerekçeyi gösterir', (await onay.body()).includes('gerekçe: Resmî kaynak okundu'));

  // ── 7) İşletme: tek ekran ──
  const sahip = await session(EM.sahip);
  await sahip.open('/notifications');
  await sahip.shot('isletme-bildirim-listesi');
  await sahip.id('note-legislation_change').click(); await wait(2500);
  await sahip.shot('isletme-tek-ekran');
  const bz = await sahip.body();
  check('İşletme ekranı: ne değişti / neden şubemde / ne yapmalıyım ve son tarih / kaynak ve kural sürümü', ['NE DEĞİŞTİ', 'NEDEN BENİM ŞUBEMDE', 'NE YAPMALISIN', 'İlk son tarih', 'KAYNAK VE KURAL SÜRÜMÜ', 'EX-LEG-LPG v1'].every(x => bz.includes(x)));
  check('İşletme ekranı ÖRNEK uyarısı taşır ve kapsam dışı şubeyi anmaz', bz.includes('ÖRNEK') && !bz.includes('Beşiktaş'));
  await sahip.ctx.close();

  // ── 8) Ret ──
  const retId = changeId('Etiketleme');
  const beforeRet = totals();
  await onay.open(`/legislation/${retId}`);
  await onay.id('leg-reject').click(); await wait(800);
  check('Boş gerekçeyle ret engellendi', (await onay.body()).includes('Reddetmek için gerekçe yazmalısın'));
  await onay.id('leg-reason').fill('Kafe ve restoran kapsamı dışında: ambalajlı ürün etiketi.');
  await onay.id('leg-reject').click(); await wait(3000);
  await onay.shot('reddedildi');
  check('Ret: durum REDDEDİLDİ, hiçbir işletme etkilenmedi', (await onay.id('leg-status').innerText()).includes('REDDEDİLDİ') && JSON.stringify(totals()) === JSON.stringify(beforeRet));
  await admin.open('/legislation'); await admin.id('leg-scan').click(); await wait(3500);
  check('Reddedilen yayın yeniden taramada tekrar kuyruğa girmedi', num(`select count(*) from legislation_changes where doc_title ilike '%Etiketleme%'`) === 1);

  // ── 9) Belirsiz tarih + ileri tarihli onay ──
  const bId = changeId('Hijyeni Ek');
  await yazar.open(`/legislation/${bId}`);
  await yazar.shot('belirsiz-tarih-engeli');
  check('Belirsiz tarih uyarısı gösterilir ve taslak hazırlama kapalı', (await yazar.body()).includes('BELİRSİZ') && (await yazar.body()).includes('Yürürlük tarihi belirsiz'));
  check('Belirsiz tarihli kayıt API ile de hazırlanamaz/onaylanamaz', (await api(await apiLogin(EM.yazar), 'POST', `/admin/legislation/changes/${bId}/prepare`)).status === 409 && (await api(await apiLogin(EM.onay), 'POST', `/admin/legislation/changes/${bId}/approve`, { reason: 'deneme' })).status === 409);
  await admin.open(`/legislation/${bId}`);
  await admin.id('leg-date').fill(plus(9)); await admin.id('leg-date-note').fill('Resmî Gazete ilanındaki "ayın başı" hükmü takvimden hesaplandı.');
  await admin.id('leg-date-save').click(); await wait(2500);
  await admin.shot('tarih-yonetici-tarafindan-cozuldu');
  check('Yönetici tarihi gerekçeyle çözdü', (await admin.body()).includes(plus(9).split('-').reverse().join('.')) && num(`select count(*) from audit_events where event_type='legislation.date_resolved' and entity_id='${bId}'`) === 1);
  await yazar.open(`/legislation/${bId}`);
  await yazar.id('leg-suggest').click(); await wait(1500);
  await yazar.id('leg-p-code').fill('EX-LEG-SAGLIK'); await yazar.id('leg-p-title').fill('Sentetik çalışan sağlık kaydı (ÖRNEK)');
  await yazar.id('leg-p-ob-title').fill('Çalışan sağlık kaydı tutulur (ÖRNEK)'); await yazar.id('leg-p-ob-summary').fill('Sentetik düzenleme: çalışan sağlık kayıtları güncel tutulur.');
  await yazar.id('leg-p-from').fill(plus(9)); await yazar.id('leg-p-reason').fill('Sentetik resmî yayın (ileri tarihli)');
  await yazar.id('leg-p-cond').fill(JSON.stringify({ fact: 'activity.food_preparation', op: 'eq', value: true }));
  await yazar.id('leg-p-save').click(); await wait(3000);
  await yazar.id('leg-prepare').click(); await wait(3000);
  await uzman.open('/admin'); await uzman.id('admin-reason').fill('Uygun (sentetik).');
  await uzman.text('food_safety alanında onayla (alan uzmanı)').click(); await wait(2500);
  const tBefore = ruleTasks('EX-LEG-SAGLIK', siteA), nBefore = notifs(bId);
  await onay.open(`/legislation/${bId}`);
  await onay.id('leg-reason').fill('Yürürlük tarihi yönetici tarafından belirlendi; kaynak kontrol edildi.');
  await onay.id('leg-approve').click(); await wait(4000);
  await onay.shot('ileri-tarihli-onay-bekliyor');
  check('İleri tarihli onay: durum "yürürlük günü bekliyor", metin kendiliğinden uygulanacağını söyler', (await onay.id('leg-scheduled').innerText()).includes(plus(9).split('-').reverse().join('.')));
  check('Yürürlük gününden önce hiçbir işletme görevi/bildirimi değişmedi; kural sürümü yalnız onaylı (yayında değil)', ruleTasks('EX-LEG-SAGLIK', siteA) === tBefore && notifs(bId) === nBefore
    && sql(`select rv.status from rule_versions rv join rules r on r.id=rv.rule_id where r.code='EX-LEG-SAGLIK'`) === 'approved');
  const due = await api(await apiLogin(EM.yonetici), 'POST', '/admin/legislation/apply-due');
  check('Gün gelmeden uygulama tetiklenirse de uygulanmaz', JSON.stringify(due.body?.applied ?? null) === '[]', due.body);

  // ── 10) Kaynak kesintisi ──
  await admin.open('/legislation');
  const lastOkBefore = await admin.id('leg-last-ok').innerText();
  const countBeforeOutage = num('select count(*) from legislation_changes');
  await ctl('/ctl/down', { down: true });
  await admin.id('leg-scan').click(); await admin.p.getByText('Hata (', { exact: false }).first().waitFor({ timeout: 120000 }); await wait(500);
  await admin.shot('kaynak-kesintisi-hata');
  const ob = await admin.body();
  check('Kaynak kesintisi: kaynak bazında hata görünür, "taban korunuyor, değişiklik yok demek değildir" der', ob.includes('Hata (') && ob.includes('taban olarak korunuyor'));
  check('Kesintide son başarılı tarama zamanı ve kuyruk korunur', (await admin.id('leg-last-ok').innerText()) === lastOkBefore && num('select count(*) from legislation_changes') === countBeforeOutage);
  await ctl('/ctl/down', { down: false });
  await admin.id('leg-scan').click(); await wait(4000);
  check('Kaynak dönünce bir sonraki taramada toparlanır (hata temizlenir)', !(await admin.body()).includes('Hata ('));

  // ── 10b) Kaynak ulaşılabilir ama kullanılamaz yanıt (PDF): ayrı hata türü, taban korunur ──
  const docHashBefore = sql("select content_sha256 from legislation_documents where doc_key='mv:1.5.9001'");
  await ctl('/ctl/fail', { mode: 'pdf' });
  await admin.id('leg-scan').click(); await admin.p.getByText('Beklenmeyen biçim', { exact: false }).first().waitFor({ timeout: 120000 }); await wait(500);
  await admin.shot('kaynak-sagligi-beklenmeyen-bicim');
  check('PDF/HTML-dışı yanıt: hata türü "Beklenmeyen biçim" olarak görünür; son sağlıklı metin tabanı değişmedi; kuyruk değişmedi', (await admin.body()).includes('Beklenmeyen biçim')
    && sql("select content_sha256 from legislation_documents where doc_key='mv:1.5.9001'") === docHashBefore && num('select count(*) from legislation_changes') === countBeforeOutage
    && sql("select last_error_kind from legislation_sources where code='mevzuat'") === 'unexpected_format');
  await ctl('/ctl/fail', { mode: null });
  await admin.id('leg-scan').click(); await wait(4000);
  check('Biçim sorunu geçince kaynak sağlığı temizlenir (son deneme/okunan belge sayısı görünür)', !(await admin.body()).includes('Hata (') && (await admin.id('leg-source-counts-mevzuat').innerText()).includes('Okunan belge: 1'));

  // ── 11) Mevzuat Bilgi Sistemi: madde değişikliği ──
  await admin.id('leg-scan').click(); await wait(3500);
  await ctl('/ctl/consolidated', { key: '1.5.9001', title: 'SENTETİK GIDA KANUNU', articles: { 1: 'Amaç: gıda güvenliği.', 2: 'Soğuk zincir 4 °C altında kesintisiz sürdürülür.', 4: 'Yeni madde: alerjen bilgisi verilir.' } });
  await admin.id('leg-scan').click(); await wait(4000);
  const mvId = sql(`select id from legislation_changes where source_code='mevzuat' and article_ref='2'`);
  check('Mevzuat Bilgi Sistemi: madde değişikliği, madde kaldırma ve yeni madde bulundu', num(`select count(*) from legislation_changes where source_code='mevzuat'`) === 3);
  await admin.open(`/legislation/${mvId}`);
  await admin.shot('madde-degisikligi-eski-yeni');
  const mb = await admin.body();
  check('Madde değişikliği: eski/yeni metin ve değişen sayı önerisi görünür; tarih belirsiz', mb.includes('Madde değişikliği') && mb.includes('Soğuk zincir kesintisiz') && mb.includes('4 °C') && mb.includes('BELİRSİZ'));

  // ── 12) Yürürlükten kaldırma ──
  const doneId = sql(`select t.id from tasks t join task_templates tt on tt.id=t.template_id join rule_versions rv on rv.id=tt.rule_version_id join rules r on r.id=rv.rule_id where r.code='EX-LEG-LPG' and t.site_id='${siteA}' and t.status='open' order by t.due_at limit 1`);
  const staffId = sql(`select id from users where email='${EM.personel}'`);
  sql(`update tasks set status='done', outcome='conforming', completed_by='${staffId}', completed_at=now() where id='${doneId}'`);
  const v1 = sql(`select rv.id from rule_versions rv join rules r on r.id=rv.rule_id where r.code='EX-LEG-LPG' and rv.version=1`);
  const openBefore = openTasks('EX-LEG-LPG', siteA);
  await ctl('/ctl/publish', { day: TODAY, item: { id: `${compact}-5`, category: 'YÖNETMELİKLER', title: 'Sentetik Gıda İşletmeleri LPG Güvenliği Yönetmeliğinin Yürürlükten Kaldırılmasına Dair Yönetmelik', articles: ['Sentetik LPG Yönetmeliği yürürlükten kaldırılmıştır.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] } });
  await admin.open('/legislation'); await admin.id('leg-scan').click(); await wait(4000);
  const rId = changeId('Yürürlükten Kaldırılmasına');
  await yazar.open(`/legislation/${rId}`);
  await yazar.id('leg-target').fill('EX-LEG-LPG'); await yazar.id('leg-suggest').click(); await wait(2000);
  await yazar.id('leg-p-save').click(); await wait(3000);
  await yazar.shot('yururlukten-kaldirma-onizleme');
  const rb = await yazar.body();
  check('Kaldırma önizlemesi: yükümlülük sona erer ve açık görevlere etkisi yazılı', rb.includes('YÜKÜMLÜLÜK SONA ERER') && rb.includes('açık görev kapanır'));
  await yazar.id('leg-prepare').click(); await wait(3000);
  await uzman.open('/admin'); await uzman.id('admin-reason').fill('Yürürlükten kaldırma uygun (sentetik).');
  await uzman.text('food_safety alanında onayla (alan uzmanı)').click(); await wait(2500);
  await onay.open(`/legislation/${rId}`);
  await onay.id('leg-reason').fill('Resmî kaynakta açıkça yürürlükten kaldırılmış.'); await onay.id('leg-approve').click(); await wait(5000);
  await onay.shot('kaldirma-uygulandi');
  check('Kaldırma: açık görevler kapandı, yeni görev üretilmez', openTasks('EX-LEG-LPG', siteA) === 0, { openBefore });
  check('Tamamlanmış görev ve kayıtları eski kural sürümüne bağlı kaldı', sql(`select t.status || ':' || (tt.rule_version_id='${v1}')::text from tasks t join task_templates tt on tt.id=t.template_id where t.id='${doneId}'`) === 'done:true');
  const tAfterRepeal = ruleTasks('EX-LEG-LPG', siteA);
  await api(await apiLogin(EM.yonetici), 'POST', '/admin/legislation/apply-due');
  check('Kaldırıldıktan sonra yeni görev oluşmadı', ruleTasks('EX-LEG-LPG', siteA) === tAfterRepeal);
  check('Kaldırmanın açık görevlere etkisi denetim kaydına yazıldı', sql(`select (payload->'sites'->0->>'openCancelled')::int + (payload->'sites'->0->>'openMissed')::int from audit_events where entity_id='${rId}' and event_type='legislation.applied_to_company'`) === String(openBefore));
  const sahip2 = await session(EM.sahip);
  await sahip2.open('/notifications'); await sahip2.shot('isletme-bildirim-kaldirma');
  await sahip2.id('note-legislation_change').click(); await wait(2500);
  await sahip2.shot('isletme-tek-ekran-kaldirma');
  check('İşletme ekranı kaldırmayı açıklar: yeni görev oluşmaz, geçmiş korunur', (await sahip2.body()).includes('yeni görev oluşmaz'));

  // ── Son: yönetim ekranı özeti ──
  await admin.open('/legislation');
  await admin.shot('yonetim-son-durum');
  fs.writeFileSync(`${OUT}/kabul-kanit.json`, JSON.stringify({ at: new Date().toISOString(), env: WEB, source: 'SENTETİK (sentetik kaynak sunucusu; resmî olmayan adres)', pass, fail, checks: evidence }, null, 2));
  console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
