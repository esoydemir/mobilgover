// Pilot kapanış 3: ana ekran kartları -> liste tutarlılığı, rol bazlı gezinme, sayfa yenileme, 320 px düzen (8091). node pk-ui.cjs
const { chromium, webkit, devices } = require('playwright'); const fs = require('fs'); const path = require('path');
const { BASE } = require('./api.cjs'); const { uiLogin } = require('./ui-login.cjs');
const OUT = path.join(__dirname, '..', 'src', 'docs', 'kanit-kapanis', 'pilot'); fs.mkdirSync(OUT, { recursive: true });
const res = []; const ok = (ad, k, d) => { const s = (k ? 'TAMAM' : 'BAŞARISIZ') + '  ' + ad + (d ? ' — ' + d : ''); res.push(s); console.log(s); return !!k; };
const DEV = [[chromium, 'Pixel 7', 'chromium-Pixel7'], [webkit, 'iPhone 14', 'webkit-iPhone14'], [webkit, 'iPhone SE', 'webkit-iPhoneSE']];
const visibleRows = page => page.evaluate(() => [...document.querySelectorAll('[data-testid]')].filter(e => /^task-[0-9a-f]{8}-/.test(e.getAttribute('data-testid')) && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none' && !e.closest('[aria-hidden="true"]')).length);
const SDIR = path.join(OUT); const lastRun = JSON.parse(fs.readFileSync(path.join(SDIR, fs.readdirSync(SDIR).filter(f => /^senaryo-.*.json$/.test(f)).map(f => [f, fs.statSync(path.join(SDIR, f)).mtimeMs]).sort((a, b) => b[1] - a[1])[0][0]), 'utf8')).run;
const num = s => Number((s.match(/\d+/) || [NaN])[0]);

(async () => {
  for (const [bt, name, tag] of DEV) {
    console.log('\n== ' + tag + ' ==');
    const b = await bt.launch({ args: bt === chromium ? ['--no-proxy-server'] : [] });
    const mk = async () => { const c = await b.newContext({ ...devices[name], timezoneId: 'Europe/Istanbul', locale: 'tr-TR' }); return [c, await c.newPage()]; };
    // 1) Müdür: ana ekran kartı -> aynı işletme/şube/filtre, sayı = chip = görünür satır
    let [c, p] = await mk(); await uiLogin(p, 'mudur@demo.goverhub.test'); await p.waitForTimeout(1500);
    const ctxHome = ((await p.getByTestId('header-context').innerText()) + ' ' + (await p.getByTestId('header-site').innerText())).replace(/\n/g, ' ');
    for (const [cardId, filter] of [['home-count-critical', 'critical'], ['home-count-todo', 'todo'], ['home-count-service', 'service'], ['home-late', 'late']]) {
      await p.goto(BASE + '/'); await p.waitForTimeout(2500);
      const txt = (await p.getByTestId(cardId).first().innerText()).replace(/\n/g, ' '); await p.getByTestId(cardId).first().click(); await p.waitForTimeout(2500);
      const url = new URL(p.url()); const chip = (await p.getByTestId('tasks-filter-' + filter).innerText()).replace(/\n/g, ' ');
      const rows = await visibleRows(p); const ctxList = (await p.locator('body').innerText()).replace(/\n/g, ' ');
      const cardN = cardId === 'home-late' ? null : num(txt);
      ok(tag + ': "' + txt.slice(0, 22) + '" -> /tasks?filter=' + filter + '; aynı işletme ve şube', url.searchParams.get('filter') === filter && ctxHome.split(' ').filter(w => w.length > 3).some(w => ctxList.includes(w)), url.pathname + url.search);
      ok(tag + ': ' + filter + ' sayısı tutarlı (kart ' + (cardN ?? 'GECİKENLER') + ', çip ' + num(chip) + ', listedeki satır ' + rows + ')', num(chip) === rows && (cardN === null || cardN === rows), chip);
    }
    // 2) Sayfa yenileme: görev detayı ve filtre korunuyor
    await p.goto(BASE + '/tasks?filter=late'); await p.waitForTimeout(2500); const before = await visibleRows(p);
    await p.reload(); await p.waitForTimeout(3500); const after = await visibleRows(p);
    ok(tag + ': sayfa yenilenince filtre ve liste korunuyor', before === after && before > 0, before + ' -> ' + after);
    const first = p.locator('[data-testid^="task-"]').filter({ hasNotText: 'Neden kritik' }).first(); await first.click(); await p.waitForTimeout(2500);
    const detailUrl = p.url(); const dtxt = (await p.locator('body').innerText()).replace(/\n+/g, ' | ');
    const needs = { neden: /Neden|Bu görev neden|kural|Kural/.test(dtxt), termin: /Termin|termin|Son tarih|son tarih|\d\d\/\d\d/.test(dtxt), sorumlu: /Sorumlu|personel|Elif|atanmad/.test(dtxt), kanit: /Kanıt|kanıt|Ölçüm|Fotoğraf|kontrol listesi|Kontrol listesi/.test(dtxt) };
    ok(tag + ': görev detayı: neden/kural, termin, sorumlu ve gerekli kanıt anlaşılır', Object.values(needs).every(Boolean), JSON.stringify(needs));
    await p.reload(); await p.waitForTimeout(3500); ok(tag + ': görev detayı yenilenince aynı kayıt açık', p.url() === detailUrl && (await p.locator('body').innerText()).length > 100, detailUrl.slice(-40));
    if (tag === 'chromium-Pixel7') await p.screenshot({ path: path.join(OUT, tag + '-gorev-detayi.png'), fullPage: true });
    // 3) Alt gezinme çubuğu içeriği kapatmıyor: listenin son öğesi çubuğun üstüne kaydırılabiliyor
    await p.goto(BASE + '/tasks?filter=todo'); await p.waitForTimeout(2500);
    const ov = await p.evaluate(() => { const sc = [...document.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 40 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY)).sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; if (sc) sc.scrollTop = sc.scrollHeight; const rows = [...document.querySelectorAll('[data-testid]')].filter(e => /^task-[0-9a-f]{8}-/.test(e.getAttribute('data-testid')) && e.getBoundingClientRect().width > 0); const last = rows[rows.length - 1]; const bar = document.querySelector('[role=tablist]').getBoundingClientRect(); return { lastBottom: Math.round(last.getBoundingClientRect().bottom), barTop: Math.round(bar.top), h: window.innerHeight }; });
    ok(tag + ': alt çubuk son satırı kapatmıyor (satır altı ' + ov.lastBottom + ' <= çubuk üstü ' + ov.barTop + ')', ov.lastBottom <= ov.barTop + 1, JSON.stringify(ov));
    // 4) Yan yana kontroller: filtre çipleri arasında örtüşme yok
    await p.goto(BASE + '/tasks'); await p.waitForTimeout(2500);
    const overlap = await p.evaluate(() => { const els = [...document.querySelectorAll('[data-testid^="tasks-filter-"]')].filter(e => e.getBoundingClientRect().width > 0 && !/note/.test(e.getAttribute('data-testid'))).map(e => e.getBoundingClientRect()); let n = 0; for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], c = els[j]; if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) n++; } return { n, count: els.length, minGap: els.length }; });
    ok(tag + ': 44 px çipler birbirinin üstüne binmiyor', overlap.n === 0, overlap.count + ' çip');
    await p.screenshot({ path: path.join(OUT, tag + '-gorevler.png') }); await c.close();

    // 5) Rol bazlı gezinme (sekme etiketleri)
    const roles = [['personel@demo.goverhub.test', 'personel', ['Ana Sayfa', 'Görevler', 'Eğitim']], ['uzman@demo.goverhub.test', 'uzman', ['Uzman alanı']], ['dogrulayici.' + lastRun + 'b@demo.goverhub.test', 'dış doğrulayıcı', ['Doğrulama', 'Bildirimler']], ['yonetici@demo.goverhub.test', 'platform yöneticisi', ['Yönetim']]];
    for (const [email, rol, labels] of roles) {
      [c, p] = await mk(); await uiLogin(p, email); await p.waitForTimeout(1500);
      const tabs = await p.evaluate(() => [...document.querySelectorAll('[role=tab]')].map(e => e.getAttribute('aria-label')));
      const crash = /Bir şey ters gitti|Unhandled/.test(await p.locator('body').innerText());
      ok(tag + ': ' + rol + ' gezinmesi ' + JSON.stringify(labels) + ' ve çökme yok', labels.every(l => tabs.includes(l)) && !crash, tabs.join(', '));
      if (tag === 'chromium-Pixel7') await p.screenshot({ path: path.join(OUT, tag + '-rol-' + rol.replace(/\s/g, '-') + '.png') });
      await c.close();
    }
    await b.close();
  }
  const fail = res.filter(r => r.startsWith('BAŞARISIZ')); fs.writeFileSync(path.join(OUT, 'pk-ui.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, not: 'Öykünme (gerçek telefon değil).', sonuclar: res }, null, 2));
  console.log('\n' + (fail.length ? 'BAŞARISIZ: ' + fail.length : 'tüm denetimler tamam') + ' (' + res.length + ')'); process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('HATA', e.message); process.exit(1); });
