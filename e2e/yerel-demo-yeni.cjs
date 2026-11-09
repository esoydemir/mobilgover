/**
 * Local Docker demo, delivery 3: action evidence and verification, document vault, service review.
 * Like yerel-demo-akis.cjs, every run creates its own demo business and sign-in addresses.
 * The demo provider (uzman@demo.goverhub.test) is shared; it only sends a quote and a report here.
 *
 *   NODE_PATH=$(npm root -g) node e2e/yerel-demo-yeni.cjs <screenshot-dir> <yerel-demo folder>
 */
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WEB = process.env.WEB || 'http://localhost:8080', API = WEB + '/api', OUT = process.argv[2], DIR = process.argv[3];
const dc = cmd => execSync(`docker compose -p goverhub-demo ${cmd}`, { cwd: DIR }).toString().trim();
const sql = q => dc(`exec -T db psql -U postgres -d goverhub_demo -tAc "${q.replace(/"/g, '\\"')}"`);
const RUN = `y${Date.now().toString(36)}`;
const T = JSON.parse(dc(`exec -T app node node_modules/tsx/dist/cli.mjs src/seed/test-business.ts ${RUN}`).split('\n').pop());
const CO = T.companyId, E = T.emails, PROVIDER = 'uzman@demo.goverhub.test';
let pass = 0, fail = 0;
const check = (label, ok) => { ok ? pass++ : fail++; console.log(`${ok ? 'GEÇTİ ' : 'KALDI '} ${label}`); };
console.log(`Çalıştırma ${RUN} · işletme ${CO}`);

/** API sign-in through the demo outbox (demo deployments only). */
async function apiLogin(email) {
  const j = async (method, p, body, token) => {
    const r = await fetch(API + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); const x = t ? JSON.parse(t) : null;
    if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${t}`);
    return x;
  };
  await j('POST', '/auth/email/start', { email });
  const mail = await j('GET', `/dev/outbox/latest?email=${encodeURIComponent(email)}`);
  const code = (mail.body.match(/\b(\d{6})\b/) || [])[1];
  const v = await j('POST', '/auth/email/verify', { email, code });
  return (method, p, body) => j(method, p, body, v.token);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(OUT, 'dosya-'));
  const jpg = path.join(tmp, 'conta.jpg'); fs.writeFileSync(jpg, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`conta-${RUN}`)]));
  const pdf = path.join(tmp, 'kalibrasyon.pdf'); fs.writeFileSync(pdf, Buffer.from(`%PDF-1.4\nkalibrasyon ${RUN}\n%%EOF\n`));

  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  let n = 0; const shot = async name => { n++; await p.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png` }); };
  const id = t => p.getByTestId(t).first();
  const text = (t, exact = true) => p.getByText(t, { exact }).first();
  const wait = ms => p.waitForTimeout(ms);
  const body = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  const overflow = async () => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  let overflowSeen = false;
  const look = async () => { if (await overflow()) overflowSeen = true; };
  async function login(email) {
    await p.goto(WEB + '/login'); await id('login-email').waitFor();
    await id('login-email').fill(email); await text('Kod gönder').click(); await id('login-code').waitFor();
    await text('Demo kutusundan kodu getir').click(); await wait(700); await text('Giriş yap').click(); await wait(3000);
  }
  async function logout() { await p.goto(WEB + '/account'); await wait(1500); await id('logout').click(); await wait(1500); }
  const choose = async (trigger, file) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), trigger.click()]); await fc.setFiles(file); };

  // ── A. Action with required photo: claim → reject → evidence → claim → independent verification ──
  const mgr = await apiLogin(E.manager);
  const C = `/companies/${CO}`;
  const staffId = sql(`SELECT id FROM users WHERE email = '${E.staff}'`);
  const ncr = (await mgr('POST', `${C}/nonconformities`, { siteId: T.siteId, title: 'Bulaşık alanında kırık fayans', description: 'Lavabo önünde kırık fayans, su birikiyor.',
    hazardType: 'cleaning', severity: 'minor', containment: 'Alan ıslak zemin uyarısıyla kapatıldı.' })).id;
  await mgr('POST', `${C}/nonconformities/${ncr}/assignment`, { ownerId: staffId, dueAt: new Date(Date.now() + 86400000).toISOString() });
  await mgr('POST', `${C}/nonconformities/${ncr}/causes`, { stage: 'initial', categories: ['equipment'], notes: 'Fayans eskimiş, çatlamış.' });

  await login(E.manager);
  await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000);
  await id('action-add-open').click(); await id('action-desc').fill('Kırık fayansı değiştir.');
  await text('Elif (personel) · Personel').click(); await id('action-evidence-photo').click();
  await shot('aksiyon-kanit-sarti');
  await id('action-save').click(); await wait(3000);
  check('Yönetici aksiyonu "fotoğraf kanıtı gerekli" olarak açtı', (await body()).includes('fotoğraf kanıtı gerekli'));
  await logout();

  await login(E.staff);
  await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000); await look();
  const doneBtn = p.locator('[data-testid^="action-done-open-"]').first();
  check('Kanıt eklenmeden "Yapıldı" bildirilemiyor (düğme kapalı, açıklama var)', await doneBtn.isDisabled() && (await body()).includes('önce fotoğraf kanıtını ekle'));
  await choose(p.locator('[data-testid^="action-evidence-add-"]').first(), jpg); await wait(3500);
  check('Fotoğraf yüklendi ve sunucuda özeti doğrulandı', (await body()).includes('FOTOĞRAF 1 · AÇ'));
  await doneBtn.click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').first().fill('Fayans değiştirildi, derz kurudu.');
  await p.locator('[data-testid^="action-confirm-"]').first().click(); await wait(3000);
  let t = await body();
  check('"Yapıldı" beyanı doğrulama bekliyor; akışta sonuç sayılmıyor', t.includes('YAPILDI BEYANI · DOĞRULAMA BEKLİYOR') && t.includes('doğrulanmayı bekliyor'));
  await shot('beyan-dogrulama-bekliyor');
  await logout();

  await login(E.manager);
  await p.goto(WEB + '/notifications'); await wait(2500);
  check('Yöneticiye "doğrulaman bekleniyor" bildirimi', (await body()).includes('Aksiyon "yapıldı" olarak bildirildi'));
  await p.getByTestId('note-action_declared').first().click(); await wait(3000);
  await p.locator('[data-testid^="action-verify-open-"]').first().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').first().fill('Fotoğrafta derz boşlukları açık, su yine girer.');
  await p.locator('[data-testid^="action-verify-reject-"]').first().click(); await wait(3000);
  t = await body();
  check('Reddedilen beyan aksiyonu yeniden açtı; gerekçe görünüyor', t.includes('BEYAN REDDEDİLDİ · AÇIK') && t.includes('Reddedildi: Fotoğrafta derz boşlukları açık'));
  await shot('beyan-reddedildi');
  // The manager adds better evidence and claims it again, so someone else must verify.
  await choose(p.locator('[data-testid^="action-evidence-add-"]').first(), jpg.replace('conta', 'conta')); await wait(3000);
  await p.locator('[data-testid^="action-done-open-"]').first().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').first().fill('Derzler dolduruldu, fotoğraf eklendi.');
  await p.locator('[data-testid^="action-confirm-"]').first().click(); await wait(3000);
  t = await body();
  check('Kanıt veren ve beyan eden yönetici kendi beyanını doğrulayamıyor', t.includes('payın var') && (await p.locator('[data-testid^="action-verify-open-"]').count()) === 0);
  await logout();
  await login(E.hq);
  await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000);
  await p.locator('[data-testid^="action-verify-open-"]').first().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').first().fill('Yerinde baktım, derzler dolu.');
  await p.locator('[data-testid^="action-verify-ok-"]').first().click(); await wait(3000);
  t = await body();
  check('Bağımsız merkez yöneticisi doğruladı; aksiyon aşaması tamam', t.includes('DOĞRULANDI') && !t.includes('doğrulanmayı bekliyor'));
  await shot('aksiyon-dogrulandi');

  // ── B. Document vault ──
  await logout();
  await login(E.manager);
  await p.goto(WEB + '/more'); await wait(2000);
  await id('more-documents').click(); await wait(2500); await look();
  await id('doc-new').click(); await wait(2000);
  await id('doc-type-calibration_certificate').click(); await id('doc-scope-equipment').click(); await wait(1500);
  await p.locator('[data-testid^="doc-eq-"]').first().click();
  await id('doc-title').fill('Buzdolabı termometresi kalibrasyonu'); await id('doc-issuer').fill('Örnek Kalibrasyon Lab.');
  await id('doc-create').click(); await wait(3000);
  check('Belge ekipmana bağlı oluşturuldu; dosya yok', (await body()).includes('DOSYA YOK') && (await body()).includes('Ekipman: Buzdolabı · Mutfak arka'));
  const until = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await id('doc-version-open').click(); await wait(300);
  await choose(id('doc-file-pick'), pdf); await wait(800);
  await id('doc-valid-from').fill(new Date(Date.now() - 355 * 86400000).toISOString().slice(0, 10));
  await id('doc-valid-until').fill(until);
  await id('doc-version-save').click(); await wait(4000);
  t = await body();
  check('Yüklenen belge "incelenmedi" (geçerli sayılmaz); yükleyen inceleyemiyor', t.includes('İNCELENMEDİ') && t.includes('geçerli olduğu anlamına gelmez') && t.includes('Belgeyi sen yükledin'));
  await shot('belge-inceleme-bekliyor');
  const docUrl = p.url();
  await logout();

  await login(E.owner);
  await p.goto(WEB + '/notifications'); await wait(2500);
  check('Sahibe "yeni belge sürümü incelemeni bekliyor" bildirimi', (await body()).includes('Yeni belge sürümü incelemeni bekliyor'));
  await p.getByTestId('note-doc_review_needed').first().click(); await wait(3000);
  check('Bildirim belgeye götürdü', p.url() === docUrl);
  await id('doc-review-open-1').click(); await wait(300);
  await id('doc-review-notes-1').fill('Seri no ve bitiş tarihi belgeyle aynı.');
  await id('doc-review-ok-1').click(); await wait(3500);
  t = await body();
  check('Kurum içi incelendikten sonra geçerlilik hesaplanıyor: süresi yaklaşıyor (resmî doğrulama değil)', t.includes('KURUM İÇİ İNCELENDİ') && t.includes('SÜRESİ YAKLAŞIYOR') && t.includes('İncelenen sürüme göre'));
  await shot('belge-suresi-yaklasiyor');
  // The hourly scan also runs at API start; restart to trigger it now.
  dc('restart app'); await wait(20000);
  await p.goto(WEB + '/notifications'); await wait(3000);
  check('Süre hatırlatması: "Belgenin süresi 30 gün içinde doluyor" (bir kez)', (await body()).includes('Belgenin süresi 30 gün içinde doluyor')
    && sql(`SELECT count(*) FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = '${E.owner}' AND n.kind = 'doc_expiring'`) === '1');
  await p.goto(WEB + '/documents'); await wait(2500);
  check('Belge listesinde durum görünüyor', (await body()).includes('SÜRESİ YAKLAŞIYOR') && (await body()).includes('Buzdolabı termometresi kalibrasyonu'));
  await shot('belge-kasasi');

  // ── C. Service: quote and report notifications, review only after acceptance, profile history ──
  const pro = await apiLogin(PROVIDER);
  await p.goto(WEB + '/services'); await wait(2000);
  await id('service-new').click(); await wait(2500);
  await id('svc-desc').fill('Soğutucunun yıllık bakımı ve gaz kontrolü.'); await id('svc-title').fill(`Yıllık bakım ${RUN}`);
  await id('svc-cat-refrigeration_service').click(); await id('svc-submit').click(); await wait(3500);
  const reqId = p.url().split('/service/')[1];
  await pro('POST', `/pro/requests/${reqId}/quotes`, { scope: 'Bakım ve gaz kontrolü', exclusions: 'Yedek parça', priceNet: 400, vatRate: 20,
    materials: 'Yok', durationText: '1 saat', warrantyText: '1 ay', deliverable: 'Servis raporu', validUntil: new Date(Date.now() + 3 * 86400000).toISOString() });
  await p.goto(WEB + '/notifications'); await wait(2500);
  check('İşletmeye "Yeni teklif geldi" bildirimi', (await body()).includes('Yeni teklif geldi'));
  await p.getByTestId('note-quote_received').first().click(); await wait(3000);
  await id('quote-accept').click(); await wait(3000);
  const code = (await id('job-code').innerText()).trim();
  const job = JSON.parse(sql(`SELECT json_build_object('id', id) FROM service_jobs WHERE request_id = '${reqId}'`)).id;
  check('Teslim alınmamış iş değerlendirilemez (form yok)', (await p.getByTestId('review-save').count()) === 0);
  await pro('POST', `/pro/jobs/${job}/check-in`, { code });
  await pro('POST', `/pro/jobs/${job}/report`, { report: 'Kondenser temizlendi, gaz basıncı normal, iç sıcaklık 3 °C ölçüldü.' });
  await p.goto(WEB + '/notifications'); await wait(2500);
  check('İşletmeye "Hizmet raporu teslim edildi" bildirimi', (await body()).includes('Hizmet raporu teslim edildi'));
  await p.getByTestId('note-service_report_delivered').first().click(); await wait(3000);
  await id('job-note').fill('Rapor okundu, sıcaklık 3 °C.'); await id('job-accept').click(); await wait(3000);
  for (const k of ['quality', 'timeliness', 'communication']) await id(`review-${k}-${k === 'timeliness' ? 4 : 5}`).click();
  await id('review-comment').fill('Zamanında geldi, temiz çalıştı.'); await id('review-show').click();
  await shot('hizmet-degerlendirme');
  await id('review-save').click(); await wait(3000);
  t = await body();
  check('Kabul edilen iş değerlendirildi (bir kez; form kayboldu)', t.includes('DEĞERLENDİRMEN') && (await p.getByTestId('review-save').count()) === 0);
  await p.getByText('Murat Yıldız', { exact: true }).first().click(); await wait(3000);
  t = await body();
  check('Uzman profilinde izin verilen doğrulanmış hizmet geçmişi; işletme adı yok', t.includes('DOĞRULANMIŞ HİZMET GEÇMİŞİ') && t.includes('Zamanında geldi') && !t.includes(`Test işletmesi ${RUN}`));
  await shot('uzman-hizmet-gecmisi'); await look();

  check('Yatay taşma yok', !overflowSeen);
  console.log('Sayfa hataları:', errs.length ? errs.slice(0, 5).join(' | ') : 'yok');
  console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı`);
  fs.rmSync(tmp, { recursive: true, force: true });
  await b.close();
})().catch(async e => { console.error('HATA:', e.message.split('\n')[0]); console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı (yarıda kesildi)`); process.exit(1); });
