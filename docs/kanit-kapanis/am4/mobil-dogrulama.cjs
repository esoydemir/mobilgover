// AM-4 mobil doğrulama (8091): Chromium (Pixel 7) ve WebKit (iPhone 14, iPhone SE) dar ekran öykünmesi; hata durumları; çevrimdışından dönüş.
// BU, GERÇEK TELEFON DEĞİLDİR (öykünme). node mobil-dogrulama.cjs
const { chromium, webkit, devices } = require('playwright');
const { execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const { req, login, BASE } = require('./api.cjs');
const OUT = process.env.OUT || path.join(__dirname, '..', 'src', 'docs', 'kanit-kapanis', 'am4'); fs.mkdirSync(OUT, { recursive: true });
const STATE = JSON.parse(fs.readFileSync(path.join(__dirname, '.qr-state.json'), 'utf8'));
const res = []; const rep = { cihazlar: {} };
const ok = (ad, k, d) => { const s = `${k ? 'TAMAM' : 'BAŞARISIZ'}  ${ad}${d ? ' — ' + d : ''}`; res.push(s); console.log(s); return !!k; };
const ROUTES = ['/', '/tasks', '/documents', '/equipment', '/notifications', '/obligations', '/assistant', '/scan', '/market', '/more', '/sync', '/profile', '/board'];
const DEVICES = [['chromium', 'Pixel 7', chromium], ['webkit', 'iPhone 14', webkit], ['webkit', 'iPhone SE', webkit]];
const seed = run => JSON.parse(execFileSync('docker', ['exec', 'goverhub-pilotfix-app-1', 'node', 'node_modules/tsx/dist/cli.mjs', 'src/seed/test-business.ts', run]).toString().trim().split('\n').pop());

async function screens(page, tag, perDevice) {
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  const bad = []; const small = {}; let routesOk = 0;
  for (const r of ROUTES) {
    await page.goto(BASE + r, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
    const m = await page.evaluate(() => {
      const over = document.documentElement.scrollWidth > window.innerWidth + 1;
      const text = document.body.innerText.trim();
      const els = [...document.querySelectorAll('button,[role=button],[role=tab],a[href],input,textarea,[tabindex="0"]')].filter(e => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && b.top < window.innerHeight; });
      const tiny = els.map(e => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), t: (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || e.tagName).slice(0, 24).replace(/\n/g, ' ') }; }).filter(x => Math.min(x.w, x.h) < 40);
      return { over, len: text.length, crash: /Bir şey ters gitti|Unhandled|Application error/i.test(text), n: els.length, tiny };
    });
    if (m.over || m.crash || m.len < 15) bad.push(`${r}${m.over ? ' taşma' : ''}${m.crash ? ' çökme' : ''}${m.len < 15 ? ' boş' : ''}`); else routesOk++;
    if (m.tiny.length) small[r] = m.tiny.slice(0, 3);
    if (['/', '/tasks', '/documents', '/assistant'].includes(r)) await page.screenshot({ path: path.join(OUT, `${tag}-${r === '/' ? 'ana' : r.slice(1)}.png`) });
  }
  ok(`${tag}: ${ROUTES.length} ekran yatay taşma/çökme/boş ekran olmadan açıldı`, bad.length === 0, bad.length ? bad.join('; ') : `${routesOk}/${ROUTES.length}`);
  ok(`${tag}: sayfa hatası (JS) yok`, errs.length === 0, errs.slice(0, 2).join(' | '));
  const smallCount = Object.values(small).reduce((a, v) => a + v.length, 0);
  perDevice.kucukDokunmaHedefi = small; // bilgi: 40 px altı hedefler (kabul ölçütü değil, kayıt)
  const sa = await page.evaluate(() => ({ vf: /viewport-fit=cover/.test(document.querySelector('meta[name=viewport]')?.content || ''), env: [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => /safe-area-inset/.test(r.cssText)); } catch { return false; } }) || /safe-area-inset/.test(document.documentElement.outerHTML) }));
  const info = `BİLGİ     ${tag}: güvenli alan — safe-area-inset kullanılıyor: ${sa.env}; viewport-fit=cover: ${sa.vf} (çentik/ana çubuk davranışı yalnız fiziksel cihazda doğrulanır)`; res.push(info); console.log(info);
  perDevice.guvenliAlan = sa; perDevice.dokunmaUyarisi = smallCount;
}

async function errorStates(page, tag) {
  // 1) Geçersiz QR kodu
  await page.goto(BASE + '/scan'); await page.getByTestId('scan-input').fill('x'.repeat(30)); await page.getByRole('button', { name: 'Kaydı aç' }).click();
  await page.getByText('geçersiz, pasifleştirilmiş').waitFor({ timeout: 15000 }).catch(() => { });
  ok(`${tag}: geçersiz QR -> açık hata`, (await page.getByText('geçersiz, pasifleştirilmiş').count()) > 0);
  // 2) Olmayan belge
  await page.goto(BASE + '/documents/00000000-0000-4000-8000-000000000000'); await page.waitForTimeout(2500);
  const t2 = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  ok(`${tag}: olmayan belge -> anlaşılır mesaj, çökme yok`, /bulunamadı|erişim|yok|açılamadı|hata/i.test(t2) && !/Unhandled/.test(t2), t2.slice(0, 80));
  // 3) API ulaşılamaz -> hata kutusu; geri gelince toparlanır
  await page.goto(BASE + '/documents'); await page.waitForTimeout(1200);
  await page.route('**/api/**', r => r.abort());
  await page.goto(BASE + '/notifications'); await page.waitForTimeout(10500);
  const t3 = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  ok(`${tag}: sunucuya ulaşılamayınca ekran çökmüyor ve bekleme nedeni söyleniyor`, /Bağlantı yok ya da zayıf|bağlanılamadı|ulaşılamıyor|çevrimdışı/i.test(t3) && !/Unhandled/.test(t3), t3.slice(0, 120));
  await page.screenshot({ path: path.join(OUT, `${tag}-hata-durumu.png`) });
  await page.unroute('**/api/**'); await page.goto(BASE + '/notifications'); await page.waitForTimeout(2500);
  const t4 = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  ok(`${tag}: sunucu dönünce ekran toparlandı`, t4.length > 30, t4.slice(0, 60));
}

async function offlineReturn(browserType, dev, tag, run) {
  const B = seed(run); const email = B.emails.staff;
  const ctx = await browserType.launch().then(b => b.newContext({ ...dev, timezoneId: 'Europe/Istanbul', locale: 'tr-TR' }).then(c => ({ b, c })));
  const { b, c } = ctx; const p = await c.newPage(); const id = t => p.getByTestId(t).first(); const text = t => p.getByText(t, { exact: true }).first();
  try {
    await p.goto(BASE + '/login'); await p.waitForTimeout(1200); await id('login-email').fill(email); await text('Kod gönder').click(); await id('login-code').waitFor();
    await text('Demo kutusundan kodu getir').click(); await p.waitForTimeout(800); await text('Giriş yap').click(); await p.waitForTimeout(3000);
    await p.getByRole('tab', { name: 'Görevler' }).click(); await p.waitForTimeout(2500);
    await text('Eldiven ve önlük kontrolü').click(); await p.waitForTimeout(2500);
    await c.setOffline(true);
    await id('check-gloves-pass').click(); await id('check-apron-pass').click(); await id('check-save').click(); await p.waitForTimeout(1500);
    await id('task-complete').click(); await p.waitForTimeout(2500);
    await p.screenshot({ path: path.join(OUT, `${tag}-cevrimdisi-bekliyor.png`) });
    const q = JSON.parse(await p.evaluate(() => localStorage.getItem('gh.queue.v1') || '{"ops":[]}'));
    ok(`${tag}: çevrimdışıyken yapılan işlem cihazda bekliyor`, q.ops.length >= 1, `${q.ops.length} bekleyen işlem`);
    await c.setOffline(false);
    // Ağ dönünce uygulama kendiliğinden eşitler; ekran durumu gösterir.
    await p.getByLabel(/Eşitleme durumu/).first().click().catch(() => p.getByRole('tab', { name: 'Daha' }).click()); await p.waitForTimeout(1500);
    if (!(await id('sync-summary').count()) && (await id('more-sync').count())) await id('more-sync').click().catch(() => { });
    await p.getByText('Tüm kayıtlar sunucuda').first().waitFor({ timeout: 40000 });
    const q2 = JSON.parse(await p.evaluate(() => localStorage.getItem('gh.queue.v1') || '{"ops":[]}'));
    await p.screenshot({ path: path.join(OUT, `${tag}-esitleme-tamam.png`) });
    const t = await login(email); const tasks = await req('GET', `/companies/${B.companyId}/tasks?siteId=${B.siteId}&from=${new Date(Date.now() - 2 * 864e5).toISOString()}&to=${new Date(Date.now() + 2 * 864e5).toISOString()}`, { token: t });
    const glove = tasks.find(x => /Eldiven/.test(x.title) && x.status !== 'open');
    ok(`${tag}: ağ dönünce eşitlendi, kuyruk boşaldı ve görev sunucuda tamamlandı`, q2.ops.length === 0 && !!glove, `kuyruk ${q2.ops.length}; görev ${glove ? glove.status : 'açık'}`);
  } catch (e) { ok(`${tag}: çevrimdışından dönüş`, false, e.message.split('\n')[0]); await p.screenshot({ path: path.join(OUT, `${tag}-FAIL-cevrimdisi.png`) }).catch(() => { }); }
  finally { await b.close(); }
}

(async () => {
  execFileSync('docker', ['exec', 'goverhub-pilotfix-db-1', 'psql', '-U', 'postgres', '-d', 'goverhub_demo', '-c', "DELETE FROM login_challenges WHERE email LIKE '%@demo.goverhub.test'"]);
  const stamp = (Date.now() % 1e6).toString(36);
  for (const [i, [eng, name, bt]] of DEVICES.entries()) {
    const dev = devices[name]; if (!dev) { ok(`${name} cihaz profili`, false, 'yok'); continue; }
    const tag = `${eng}-${name.replace(/\s/g, '')}`; rep.cihazlar[tag] = { motor: eng, profil: name, ekran: dev.viewport };
    console.log(`\n== ${tag} (${dev.viewport.width}x${dev.viewport.height}) ==`);
    const b = await bt.launch({ args: eng === 'chromium' ? ['--no-proxy-server'] : [] }); const ctx = await b.newContext({ ...dev, storageState: STATE, timezoneId: 'Europe/Istanbul', locale: 'tr-TR' }); const page = await ctx.newPage();
    await screens(page, tag, rep.cihazlar[tag]); await errorStates(page, tag); await b.close();
    await offlineReturn(bt, dev, tag, `mv${stamp}${i}`);
  }
  rep.tarih = new Date().toISOString(); rep.base = BASE; rep.not = 'Öykünme: gerçek telefon değildir.';
  fs.writeFileSync(path.join(OUT, 'mobil-dogrulama.json'), JSON.stringify(rep, null, 2));
  const fail = res.filter(r => r.startsWith('BAŞARISIZ')); console.log(`\n${fail.length ? 'BAŞARISIZ: ' + fail.length : 'tüm denetimler tamam'} (${res.length} denetim)`); process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('HATA', e.message); process.exit(1); });
