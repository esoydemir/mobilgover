// AM-4 devamı: dokunma hedefleri (<44 px) ve güvenli alan denetimi — 8091, WebKit iPhone 14/SE + Chromium Pixel 7 (öykünme).
const { chromium, webkit, devices } = require('playwright'); const fs = require('fs'); const path = require('path');
const { BASE } = require('./api.cjs');
const OUT = process.env.OUT || path.join(__dirname, '..', 'src', 'docs', 'kanit-kapanis', 'am4b'); fs.mkdirSync(OUT, { recursive: true });
const STATE = JSON.parse(fs.readFileSync(path.join(__dirname, '.qr-state.json'), 'utf8'));
const ROUTES = ['/', '/tasks', '/documents', '/equipment', '/notifications', '/obligations', '/assistant', '/scan', '/market', '/more', '/sync', '/profile', '/board'];
const DEV = [[chromium, 'Pixel 7'], [webkit, 'iPhone 14'], [webkit, 'iPhone SE']]; const rep = {}; let fail = 0;
(async () => {
  for (const [bt, name] of DEV) {
    const b = await bt.launch({ args: bt === chromium ? ['--no-proxy-server'] : [] }); const ctx = await b.newContext({ ...devices[name], storageState: STATE, timezoneId: 'Europe/Istanbul', locale: 'tr-TR' }); const page = await ctx.newPage();
    const small = {}; const over = []; let n = 0;
    for (const r of ROUTES) {
      await page.goto(BASE + r, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
      const m = await page.evaluate(() => {
        const els = [...document.querySelectorAll('button,[role=button],[role=tab],a[href],input,textarea,[tabindex="0"]')].filter(e => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && b.bottom > 0 && b.top < window.innerHeight; });
        return { over: document.documentElement.scrollWidth > window.innerWidth + 1, n: els.length, tiny: els.map(e => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), t: (e.getAttribute('aria-label') || e.innerText || e.getAttribute('placeholder') || e.tagName).slice(0, 30).replace(/\n/g, ' ') }; }).filter(x => Math.min(x.w, x.h) < 43.5) };
      });
      n += m.n; if (m.over) over.push(r); if (m.tiny.length) small[r] = m.tiny;
    }
    // Alt gezinme çubuğu: ekran altından kopmuyor, tüm sekmeler görünür ve >=44
    await page.goto(BASE + '/tasks'); await page.waitForTimeout(1500);
    const bar = await page.evaluate(() => { const t = document.querySelector('[role=tablist]'); const r = t.getBoundingClientRect(); const tabs = [...t.querySelectorAll('[role=tab]')].map(e => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }); return { bottomGap: Math.round(window.innerHeight - r.bottom), left: Math.round(r.left), right: Math.round(window.innerWidth - r.right), tabs }; });
    const smallCount = Object.values(small).reduce((a, v) => a + v.length, 0);
    rep[name] = { motor: bt === chromium ? 'chromium' : 'webkit', denetlenenKontrol: n, kucuk44: small, tasmaEkrani: over, altCubuk: bar };
    const good = smallCount === 0 && over.length === 0 && bar.bottomGap >= 26 && bar.tabs.every(([w, h]) => w >= 44 && h >= 44);
    console.log(`${good ? 'TAMAM' : 'BAŞARISIZ'}  ${name}: ${n} kontrol, 44 px altı ${smallCount}, yatay taşma ${over.length}, alt çubuk boşluğu ${bar.bottomGap}px`); if (smallCount) console.log(JSON.stringify(small)); if (!good) fail++;
    await page.screenshot({ path: path.join(OUT, `${name.replace(/\s/g, '')}-gorevler.png`) }); await b.close();
  }
  // Güvenli alan: viewport-fit=cover sayfada var mı; env() okunabilir mi
  const b = await webkit.launch(); const c = await b.newContext({ ...devices['iPhone 14'] }); const p = await c.newPage(); await p.goto(BASE + '/login');
  const vf = await p.evaluate(() => /viewport-fit=cover/.test(document.querySelector('meta[name=viewport]').content)); await b.close();
  console.log(`${vf ? 'TAMAM' : 'BAŞARISIZ'}  viewport-fit=cover tanımlı (iPhone güvenli alanı için gerekli)`); if (!vf) fail++;
  rep.viewportFitCover = vf; rep.tarih = new Date().toISOString(); rep.not = 'Öykünme: çentik/ana çubuk değeri yalnız fiziksel cihazda ölçülür.';
  fs.writeFileSync(path.join(OUT, 'dokunma-guvenlialan.json'), JSON.stringify(rep, null, 2)); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HATA', e.message); process.exit(1); });
