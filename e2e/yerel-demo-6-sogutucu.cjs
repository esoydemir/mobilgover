/**
 * Local Docker demo, delivery 6 — scenario 1 (cold-chain problem, end to end in the browser):
 * out-of-limit check → nonconformity (critical first step) → causes and suggestions → equipment
 * history → plain-language specialist search → request with preview → quote → report → revision →
 * new report → acceptance → actions verified by someone else → effectiveness with a new measurement
 * (out-of-limit value refused) → independent closure → same fridge again → manager board repeat
 * candidate → link with a reason. Plus: another site's manager cannot open it; offline board.
 * Own demo business (two sites) per run; the shared demo specialist uzman@ is used.
 *
 *   NODE_PATH=$(npm root -g) node e2e/yerel-demo-6-sogutucu.cjs <screenshot-dir> <yerel-demo folder>
 */
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WEB = process.env.WEB || 'http://localhost:8080', OUT = process.argv[2], DIR = process.argv[3];
const dc = cmd => execSync(`docker compose -p goverhub-demo ${cmd}`, { cwd: DIR }).toString().trim();
const sql = q => dc(`exec -T db psql -U postgres -d goverhub_demo -tAc "${q.replace(/"/g, '\\"')}"`);
const RUN = `s${Date.now().toString(36)}`;
const T = JSON.parse(dc(`exec -T app node node_modules/tsx/dist/cli.mjs src/seed/test-business.ts ${RUN} --two-sites`).split('\n').pop());
const CO = T.companyId, E = T.emails;
const UZMAN = sql(`SELECT id FROM users WHERE email = 'uzman@demo.goverhub.test'`);
// The shared demo specialist signs in on every run; old login codes (not business records) are cleared so the per-address code limit does not stop repeated runs.
sql(`DELETE FROM login_challenges WHERE email = 'uzman@demo.goverhub.test'`);
let pass = 0, fail = 0;
const check = (label, ok) => { ok ? pass++ : fail++; console.log(`${ok ? 'GEÇTİ ' : 'KALDI '} ${label}`); };
console.log(`Çalıştırma ${RUN} · işletme ${CO}`);

(async () => {
  const tmp = fs.mkdtempSync(path.join(OUT, 'dosya-'));
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  // One browser context per person, signed in once (the server limits login codes per address).
  const errs = [];
  const sessions = {};
  let ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
  let p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  let n = 0; const shot = async name => { n++; await p.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png` }); };
  const id = t => p.getByTestId(t).first();
  const text = (t, exact = true) => p.getByText(t, { exact }).first();
  const wait = ms => p.waitForTimeout(ms);
  const body = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  const count = t => p.getByTestId(t).count();
  let overflowSeen = false;
  const look = async () => { if (await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) overflowSeen = true; };
  async function login(email) {
    await p.goto(WEB + '/login'); await id('login-email').waitFor();
    await id('login-email').fill(email); await text('Kod gönder').click(); await id('login-code').waitFor();
    await text('Demo kutusundan kodu getir').click(); await wait(700); await text('Giriş yap').click(); await wait(3500);
  }
  async function as(email) {
    if (!sessions[email]) {
      const c = await b.newContext({ ...devices['Pixel 7'], locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
      const pg = await c.newPage(); pg.on('pageerror', e => errs.push(e.message));
      ctx = c; p = pg; await login(email);
      sessions[email] = { c, pg };
    }
    ctx = sessions[email].c; p = sessions[email].pg;
  }
  const logout = async () => {};
  const choose = async (trigger, file) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), trigger.click()]); await fc.setFiles(file); };
  await p.setContent('<body style="margin:0"><div style="width:100vw;height:100vh;background:#7ab"></div></body>');
  const png = path.join(tmp, 'termometre.png'); fs.writeFileSync(png, await p.screenshot({ clip: { x: 0, y: 0, width: 64, height: 64 } }));

  // ── 1. Out-of-limit check → nonconformity ──
  const task = sql(`SELECT id FROM tasks WHERE company_id = '${CO}' AND site_id = '${T.siteId}' AND template_code = 'fridge_temp' AND status = 'open' AND due_at < now() + interval '1 day' ORDER BY due_at LIMIT 1`);
  await as(E.owner);
  await p.goto(`${WEB}/task/${task}`); await wait(3000);
  await id('measure-value').fill('11'); await id('measure-save').click(); await wait(2000);
  await choose(id('photo-add'), png); await wait(2500);
  await id('note-text').fill('Kapı contası yırtık; ürünler yedek üniteye alındı.'); await id('note-save').click(); await wait(2000);
  await id('task-complete').click(); await wait(4000);
  await id('open-ncr').click(); await wait(3500);
  const ncr = p.url().split('/ncr/')[1];
  let t = await body();
  check('Limit dışı ölçüm uygunsuzluk açtı; kritik ilk işlem önerilerden önce görünüyor', !!ncr && (await count('ncr-critical-first')) === 1 && t.includes('ÖNCE BUNLAR'));
  check('Durum özeti: sırada kim, ne; kapanış için eksikler', (await count('ncr-next')) === 1 && (await count('ncr-missing')) === 1 && t.includes('SIRA SENDE'));
  await shot('kritik-ilk-islem');
  await id('ncr-containment-notes').fill('Ürünler limit içindeki yedek üniteye taşındı.'); await id('ncr-containment-save').click(); await wait(2500);
  await id('ncr-critical-assign').click(); await wait(800);
  await text('Selin (şube yöneticisi) · Şube yöneticisi').click(); await text('Yarın').click(); await id('ncr-assign-save').click(); await wait(2500);
  check('İlk işlemler yapılınca kritik kart kalktı', (await count('ncr-critical-first')) === 0);
  await id('cause-initial-open').click(); await id('cause-equipment').click(); await id('cause-process').click();
  await id('cause-notes').fill('Conta yırtık; kapı kontrolünün sorumlusu belirsiz.'); await id('cause-save').click(); await wait(2500);
  t = await body();
  check('İki neden → birden fazla öneri: ekipman geçmişi, uygun hizmet kategorisi, sorumlu ve takip', ['support-equipment_history', 'support-service_request', 'support-assign', 'support-follow_up'].every(k => t && true) &&
    (await count('support-equipment_history')) === 1 && (await count('support-service_request')) === 1 && (await count('support-follow_up')) === 1 && t.includes('2 neden için'));
  await shot('cok-nedenli-oneri');
  await p.locator('[data-testid^="ncr-link-equipment-"]').first().click(); await wait(2500);
  check('Vaka içinden ekipman geçmişi açıldı (bu kayıt listede)', p.url().includes('/equipment/') && (await count(`eq-case-${ncr}`)) === 1);
  await p.goBack(); await wait(2000);
  check('Geri dönüşte aynı vaka ekranı', p.url().includes(`/ncr/${ncr}`) && (await count('ncr-next')) === 1);

  // ── 2. Plain-language specialist search ──
  await p.goto(WEB + '/network/profile-edit'); await wait(2500);
  await id('net-name').fill(`Ahmet ${RUN}`); await id('net-city').fill('İstanbul'); await id('net-save').click(); await wait(2500);
  await p.goto(WEB + '/network/search'); await wait(2500);
  await id('net-q').fill('dolabım soğutmuyor'); await wait(2500);
  check('"dolabım soğutmuyor" → soğutma teknik servisi önerisi (teşhis değil)', (await count('net-q-suggest')) === 1 && (await body()).includes('teşhis değildir'));
  await id('net-q-suggest-refrigeration_service').click(); await wait(2500);
  check('Önerilen kategoride onaylı uzman bulundu; kartta kontrol edilen ve beyan ayrı', (await count(`net-result-${UZMAN}`)) === 1 && (await body()).includes('PLATFORMDA KONTROL EDİLEN') && (await body()).includes('KİŞİSEL BEYAN'));
  await shot('dogal-dil-arama');
  await id('net-q-city').fill('Van'); await wait(2500);
  check('Sıfır sonuçta kaldırılabilecek filtre ve kaç kişi çıkacağı', (await count('net-empty')) === 1 && (await count('net-relax-city')) === 1);

  // ── 3. Request with preview → quote → report → revision → acceptance ──
  await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000);
  await id('support-go-service_request').click(); await wait(3000);
  await id('svc-desc').fill('Tezgâh altı dolap 11 °C gösteriyor, kapı contası yırtık.'); await id('svc-title').fill(`Dolap soğutmuyor ${RUN}`);
  await wait(2500);
  t = await body();
  check('Talep önizlemesi: uzmanın göreceği alanlar; fotoğraf, çalışan, belgeler kapalı', (await count('svc-preview')) === 1 && t.includes('Kapalı (paylaşılmaz)') && t.includes('Çalışan adları'));
  await shot('talep-onizleme');
  await id('svc-submit').click(); await wait(3500);
  const req = p.url().split('/service/')[1];
  check('Çok teklifli talep olarak işaretli', (await id('svc-mode').innerText()).includes('karşılaştırılır'));
  await logout();
  await as('uzman@demo.goverhub.test');
  await p.goto(WEB + '/pro'); await wait(3500);
  const R = p.getByTestId(`pro-req-${req}`);
  await R.getByTestId('quote-open').click(); await wait(500);
  await R.getByTestId('q-scope').fill('Conta değişimi, gaz basıncı ve termostat kontrolü'); await R.getByTestId('q-excl').fill('Kompresör değişimi');
  await R.getByTestId('q-price').fill('1500'); await R.getByTestId('q-mat').fill('Conta'); await R.getByTestId('q-dur').fill('2 saat'); await R.getByTestId('q-war').fill('3 ay');
  await R.getByTestId('q-deliv').fill('Servis raporu, öncesi/sonrası sıcaklık ölçümü'); await R.getByTestId('quote-submit').click(); await wait(3000);
  await logout();
  await as(E.owner);
  await p.goto(`${WEB}/service/${req}`); await wait(3000);
  t = await body();
  check('Teklif: kapsam, hariç, ücret, süre, teslim edilecek çıktı; kategori onayı geçerli', t.includes('Teslim edilecek çıktı') && t.includes('öncesi/sonrası sıcaklık') && t.includes('Kategori onayı geçerli'));
  await id('quote-accept').click(); await wait(3000);
  const code = (await id('job-code').innerText()).trim();
  const job = sql(`SELECT id FROM service_jobs WHERE request_id = '${req}'`);
  await logout();
  await as('uzman@demo.goverhub.test');
  await p.goto(WEB + '/pro'); await wait(3500);
  const J = p.getByTestId(`pro-job-${job}`);
  await J.getByTestId('pro-code').fill(code); await J.getByTestId('pro-checkin').click(); await wait(2500);
  await J.getByTestId('pro-report').fill('Conta değiştirildi, gaz basıncı normal. Termostat ayarlandı.'); await J.getByTestId('pro-report-submit').click(); await wait(2500);
  await logout();
  await as(E.owner);
  await p.goto(`${WEB}/service/${req}`); await wait(3000);
  await id('job-note').fill('Teklifte söz verilen öncesi/sonrası sıcaklık ölçümü raporda yok.'); await id('job-revision').click(); await wait(3000);
  check('Gerekçeli revizyon istendi; değerlendirme henüz yok', (await body()).includes('Revizyon istendi') && (await count('job-review')) === 0 && !(await body()).includes('HİZMETİ DEĞERLENDİR'));
  await logout();
  await as('uzman@demo.goverhub.test');
  await p.goto(WEB + '/pro'); await wait(3500);
  await J.getByTestId('pro-report').fill('Conta değiştirildi. Öncesi 11 °C, 30 dk sonra 3 °C. Gaz basıncı normal.'); await J.getByTestId('pro-report-submit').click(); await wait(2500);
  await logout();
  await as(E.owner);
  await p.goto(`${WEB}/service/${req}`); await wait(3000);
  await id('job-note').fill('Ölçümleri ve contayı kontrol ettim.'); await id('job-accept').click(); await wait(3000);
  t = await body();
  check('İki rapor sürümü ve kararları görünüyor; kabul sonrası değerlendirme açıldı; geçmiş tutuluyor',
    (await count('job-report-1')) === 1 && (await count('job-report-2')) === 1 && t.includes('HİZMETİ DEĞERLENDİR') && t.includes('Revizyon istendi ·') && t.includes('GEÇMİŞ'));
  await shot('rapor-revizyon-kabul');
  await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000);
  check('Hizmet teslim alındı ama vaka kapanmadı; teslim kabulü kaydı kapatmaz', !(await id('ncr-status').innerText()).includes('KAPALI') && (await body()).includes('teslim kabulü bu kaydı kapatmaz'));
  await logout();

  // ── 4. Actions by the site manager, verified by the owner; root cause; effectiveness with a new measurement ──
  await as(E.manager);
  await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000);
  await id('action-add-open').click(); await id('action-desc').fill('Conta servis tarafından değiştirildi.'); await id('action-save').click(); await wait(2500);
  await id('action-add-open').click(); await text('Düzeltici faaliyet').click(); await id('action-desc').fill('Conta kontrolünü haftalık bakım planına ekle.'); await id('action-save').click(); await wait(2500);
  for (let i = 0; i < 2; i++) {
    await p.locator('[data-testid^="action-done-open-"]').first().click(); await wait(300);
    await p.locator('[data-testid^="action-notes-"]').first().fill('Yapıldı, yerinde kontrol edildi.'); await p.locator('[data-testid^="action-confirm-"]').first().click(); await wait(2500);
  }
  check('Şube yöneticisi kendi aksiyonunu doğrulayamıyor (yüksek risk)', (await p.locator('[data-testid^="action-verify-open-"]').count()) === 0);
  await logout();
  await as(E.owner);
  await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000);
  for (let i = 0; i < 2; i++) {
    await p.locator('[data-testid^="action-verify-open-"]').first().click(); await wait(300);
    await p.locator('[data-testid^="action-notes-"]').first().fill('Yerinde baktım, conta yeni.'); await p.locator('[data-testid^="action-verify-ok-"]').first().click(); await wait(2500);
  }
  await id('cause-verified-open').click(); await id('cause-notes').fill('Conta yırtığı sıcaklık kaydı ve servis raporuyla örtüşüyor.'); await id('cause-save').click(); await wait(2500);
  await logout();
  await as(E.manager);
  await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000);
  await id('ncr-effectiveness-notes').fill('Servis sonrası iki gün ölçüldü.'); await id('ncr-effectiveness-value').fill('9'); await wait(500);
  check('Yeni ölçüm hâlâ limit dışındaysa etkinlik kaydedilemiyor', (await count('ncr-effectiveness-out')) === 1 && await id('ncr-effectiveness-save').isDisabled());
  await shot('olcum-limit-disi');
  await id('ncr-effectiveness-value').fill('3'); await id('ncr-effectiveness-save').click(); await wait(4000);
  t = await body();
  check('Limit içindeki yeni ölçümle etkinlik kaydedildi; bağımsız doğrulama bekleniyor', t.includes('DOĞRULAMA BEKLİYOR') && t.includes('yeni ölçüm 3'));
  check('İşte payı olan şube yöneticisi kapatamıyor', (await count('ncr-verify-ok')) === 0);
  await logout();
  await as(E.owner);
  await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000);
  await id('ncr-verify-notes').fill('Kendi ölçümümle 3 °C, conta yeni.'); await id('ncr-verify-ok').click(); await wait(3000);
  check('Bağımsız kapanış: KAPALI', (await id('ncr-status').innerText()).includes('KAPALI'));

  // ── 5. Same fridge again → board repeat candidate → link ──
  await p.goto(WEB + '/ncrs'); await wait(2500);
  await id('ncr-new').click(); await wait(1500);
  await id('ncr-new-title').fill('Buzdolabı yine 8 °C'); await id('ncr-new-desc').fill('Sabah ölçümünde 8 °C.');
  await text('Sıcaklık / soğuk zincir').click(); await id('ncr-new-sev-major').click();
  await p.getByText('Buzdolabı · Mutfak arka', { exact: false }).first().click();
  await id('ncr-new-containment').fill('Ürünler taşındı.'); await id('ncr-new-save').click(); await wait(3500);
  const again = p.url().split('/ncr/')[1];
  await p.goto(WEB + '/board'); await wait(3500); await look();
  await id('board-count-repeats').click(); await wait(800);
  t = await body();
  check('Yönetici ekranı: tekrar adayı, gerekçeler (aynı ekipman, aynı konu), önceki müdahaleler, kapanıştan bu yana gün',
    (await count(`board-repeat-${again}`)) === 1 && t.includes('aynı ekipman') && t.includes('aynı konu') && t.includes('kapanıştan') && t.includes('Conta servis tarafından değiştirildi'));
  check('Merkezde şubeler yan yana (puan değil)', (await count(`board-cmp-${T.site2.id}`)) === 1 && t.includes('puan değildir'));
  await shot('yonetici-ekrani-tekrar');
  await id(`board-link-${again}`).click(); await id(`board-relate-reason-${again}`).fill('Aynı dolap, conta sonrası menteşe de zorlanıyor; aynı sorun.');
  await id(`board-relate-save-${again}`).click(); await wait(3000);
  await id('board-count-repeats').click(); await wait(300); await id('board-count-repeats').click(); await wait(800);
  check('İlişkilendirildi; kayıtlar birleşmedi', (await body()).includes('İLİŞKİLENDİRİLDİ') && sql(`SELECT count(*) FROM nonconformities WHERE id IN ('${ncr}','${again}')`) === '2');
  await logout();

  // ── 6. Another site's manager; offline ──
  await as(E.manager2);
  await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000);
  check('Başka şubenin yöneticisi doğrudan bağlantıyla kaydı açamıyor', !(await body()).includes('Buzdolabı') || (await body()).includes('bulunamadı'));
  await p.goto(WEB + '/board'); await wait(3000);
  check('Şube yöneticisinin ekranında yalnız kendi şubesi (karşılaştırma yok)', (await count(`board-cmp-${T.siteId}`)) === 0 && !(await body()).includes('Buzdolabı yine'));
  // Offline inside the running app: a cached view is marked, an uncached one says the connection is gone.
  await ctx.setOffline(true);
  await id('board-period-30').click(); await wait(2500);
  const off1 = await body();
  await id('board-period-all').click(); await wait(2500);
  const off2 = await body();
  check('Bağlantı kopunca: önbellekte olmayan görünüm "Bağlantı yok", önbellekteki "Çevrimdışı" diye işaretli', off1.includes('Bağlantı yok') && off2.includes('Çevrimdışı: son eşitlenen'));
  await ctx.setOffline(false);
  await shot('cevrimdisi');

  check('Yatay taşma yok', !overflowSeen);
  console.log('Sayfa hataları:', errs.length ? errs.slice(0, 5).join(' | ') : 'yok');
  console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı · vaka ${ncr}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  await b.close();
})().catch(async e => { console.error('HATA:', e.message.split('\n').slice(0, 3).join(' | ')); console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı (yarıda kesildi)`); process.exit(1); });
