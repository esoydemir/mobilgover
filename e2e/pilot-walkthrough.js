const { chromium } = require('playwright');
const OUT = process.argv[2];
const WEB = 'http://localhost:8099';
const API = 'http://localhost:3077';
let n = 0;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Europe/Istanbul', locale: 'tr-TR', recordVideo: { dir: OUT + '/video', size: { width: 390, height: 844 } } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const shot = async name => { n++; await p.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png` }); log('shot', name); };
  const id = t => p.getByTestId(t).first();
  const text = t => p.getByText(t, { exact: true }).first();
  const part = t => p.getByText(t, { exact: false }).first();
  const wait = ms => p.waitForTimeout(ms);

  async function login(email) {
    await p.goto(WEB + '/login'); await wait(1200);
    await id('login-email').fill(email);
    await text('Kod gönder').click(); await id('login-code').waitFor();
    await text('Demo kutusundan kodu getir').click(); await wait(800);
    await text('Giriş yap').click(); await wait(2500);
    log('logged in', email, p.url());
  }
  async function logout() {
    await p.goto(WEB + '/account'); await wait(1500);
    await id('logout').click(); await wait(1500);
  }
  async function goMore(testId) {
    await p.goto(WEB + '/more'); await wait(1200);
    await id(testId).click(); await wait(1800);
  }

  try {
    // ── 1. Owner: sign in, create the business, answer profile, equipment, tasks ──
    await login('ahmet@modakafe.test');
    await shot('kurulum-isletme');
    await id('setup-name').fill('Moda Kafe'); await id('setup-site').fill('Moda');
    await id('setup-create').click(); await id('profile-save').waitFor({ timeout: 15000 }); await wait(1000);
    await id('fact-activity.food_preparation-Evet').click();
    await id('fact-storage.cold-Evet').click();
    await id('fact-utility.lpg-Hayır').click();
    await id('fact-staff.count').fill('6');
    await id('fact-site.province').fill('İstanbul');
    await shot('kurulum-profil');
    await id('profile-save').click(); await id('eq-name').waitFor({ timeout: 15000 });
    await id('eq-name').fill('Buzdolabı · Mutfak arka'); await id('eq-add').click(); await wait(1500);
    await id('eq-type-thermometer').click(); await id('eq-name').fill('Dijital termometre'); await id('eq-cal').fill('2027-06-30'); await id('eq-add').click(); await wait(1500);
    await shot('kurulum-ekipman');
    await id('setup-equipment-next').click(); await wait(800);
    await id('setup-generate').click(); await part('görev oluşturuldu').waitFor({ timeout: 15000 });
    await shot('kurulum-gorevler');
    await id('setup-generate').click(); await wait(3000);
    await shot('ana-sayfa');

    // ── Obligation explanation ──
    await goMore('more-obligations'); await shot('yukumlulukler');
    await id('obl-EX-COLD-CHAIN').click(); await wait(2000); await shot('neden-bana-uygulaniyor');

    // ── Task with evidence; out-of-limit result ──
    await p.goto(WEB + '/'); await wait(2500);
    await text('Soğutucu sıcaklık kontrolü').click(); await wait(2500);
    await id('measure-value').fill('9');
    await shot('gorev-limit-disi-uyari');
    await id('measure-save').click(); await wait(1500);
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), id('photo-add').click()]);
    await fc.setFiles(process.argv[3]); await wait(2500);
    await id('note-text').fill('Kapı contası açık kalmış; ürünler yedek üniteye alındı.'); await id('note-save').click(); await wait(2000);
    await shot('gorev-kanitlar');
    await id('task-complete').click();
    await id('task-outcome').waitFor({ timeout: 20000 }); await wait(1000);
    await shot('gorev-yapildi-uygunsuz');
    await id('open-ncr').click(); await wait(2500);
    await shot('uygunsuzluk-acildi');

    // ── Service request from the nonconformity ──
    await text('Bu sorun için uzman hizmeti iste').click(); await wait(2000);
    await id('svc-desc').fill('Mutfak arkadaki buzdolabı 9 °C gösteriyor, kapı contası kapanmıyor.');
    await id('svc-cat-refrigeration_service').click(); await wait(1200);
    await shot('hizmet-talebi');
    await id('svc-submit').click(); await wait(2500);

    // ── Team: add a site manager ──
    await goMore('more-team');
    await id('team-email').fill('selin@modakafe.test'); await id('team-add').click(); await wait(2000);
    await shot('ekip');
    await logout();

    // ── 2. Provider: quote ──
    await login('murat@demo.goverhub.test');
    await p.goto(WEB + '/pro'); await wait(3000);
    await shot('uzman-profili');
    await id('quote-open').click(); await wait(500);
    await id('q-scope').fill('Termostat ve kapı contası kontrolü, gaz basıncı ölçümü');
    await id('q-excl').fill('Kompresör değişimi');
    await id('q-price').fill('850'); await id('q-mat').fill('Gerekirse conta'); await id('q-dur').fill('1–2 saat'); await id('q-war').fill('3 ay işçilik');
    await id('quote-submit').click(); await wait(2000);
    await shot('uzman-teklif-verdi');
    await logout();

    // ── 3. Owner: accept quote ──
    await login('ahmet@modakafe.test');
    await goMore('more-services');
    await part('Soğutucu sıcaklık kontrolü:').click(); await wait(2500);
    await shot('teklif-karsilastirma');
    await id('quote-accept').click(); await id('job-code').waitFor({ timeout: 15000 });
    const code = (await id('job-code').innerText()).trim();
    await shot('is-giris-kodu');
    await logout();

    // ── 4. Provider: check in + report ──
    await login('murat@demo.goverhub.test');
    await p.goto(WEB + '/pro'); await wait(3000);
    await id('pro-code').fill(code); await id('pro-checkin').click(); await wait(2000);
    await id('pro-report').fill('Kapı contası değiştirildi, termostat 3 °C\'ye ayarlandı. 30 dk sonra iç sıcaklık 3,2 °C ölçüldü.');
    await id('pro-report-submit').click(); await wait(2000);
    await shot('uzman-rapor-gonderdi');
    await logout();

    // ── 5. Owner: accept delivery ──
    await login('ahmet@modakafe.test');
    await goMore('more-services'); await part('Soğutucu sıcaklık kontrolü:').click(); await wait(2500);
    await id('job-note').fill('Rapor okundu, ölçüm tekrarlandı: 3,1 °C.'); await id('job-accept').click(); await wait(2500);
    await shot('teslim-kabul');
    await logout();

    // ── 6. Site manager: CAPA steps, cannot close own work ──
    await login('selin@modakafe.test');
    // Invited, not yet a member: the invitation is accepted before any access.
    await id('invite-accept').waitFor({ timeout: 15000 }); await shot('davet-kabul'); await id('invite-accept').click(); await wait(3000);
    await goMore('more-ncrs'); await part('Soğutucu sıcaklık kontrolü:').click(); await wait(2500);
    const steps = ['Ürünler yedek üniteye taşındı, sıcaklık 3 °C.', 'Kapı contası değiştirildi (uzman raporu).', 'Conta aşınmış; bakım planında conta kontrolü yoktu.', 'Conta kontrolü aylık bakım listesine eklendi.', 'Üç gün boyunca ölçümler 2–4 °C aralığında.'];
    for (const s of steps) { await id('ncr-step-notes').fill(s); await id('ncr-step-save').click(); await wait(3500); }
    await id('ncr-close-notes').waitFor({ timeout: 20000 });
    await shot('capa-adimlari');
    await id('ncr-close-notes').fill('Kontrol ettim.'); await id('ncr-close').click(); await wait(2000);
    await shot('kendi-isini-kapatamaz');
    await logout();

    // ── 7. Owner: independent closure + report ──
    await login('ahmet@modakafe.test');
    await p.goto(WEB + '/report'); await wait(3500);
    await shot('rapor-kritik-risk-acik');
    await goMore('more-ncrs'); await part('Soğutucu sıcaklık kontrolü:').click(); await wait(2500);
    await id('ncr-close-notes').fill('Ölçüm kayıtları, uzman raporu ve conta faturası incelendi.'); await id('ncr-close').click(); await wait(2500);
    await shot('uygunsuzluk-kapandi');
    await p.goto(WEB + '/report'); await wait(3500);
    await id('report-export').click(); await id('report-chain').waitFor({ timeout: 15000 }); await wait(800);
    await shot('rapor-ve-denetim-dosyasi');
    await p.mouse.wheel(0, 900); await wait(800); await shot('denetim-dosyasi-eksikler');

    // Offline sync is recorded separately in offline.js (the app must stay loaded while offline).
    log('page errors:', errs.length ? errs.slice(0, 5).join(' | ') : 'none');
  } catch (e) {
    log('FAILED:', e.message.split('\n')[0]);
    await p.screenshot({ path: `${OUT}/FAIL.png` });
  } finally {
    await ctx.close(); await b.close();
  }
})();
