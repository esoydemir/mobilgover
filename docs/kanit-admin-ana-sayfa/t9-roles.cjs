const lib = require('./leg-lib.cjs'); const { chromium, OUT, q } = lib; const WEB = 'http://localhost:8100';
const V = (p, id) => p.locator(`[data-testid="${id}"]:visible`).first();
(async () => { const b = await chromium.launch();
  for (const [em, tag] of [['yonetici@demo.goverhub.test', 'yonetici'], ['moderator@demo.goverhub.test', 'moderator'], ['pazar@demo.goverhub.test', 'pazar']]) {
    q('delete from login_challenges'); const p = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
    await p.goto(WEB); await V(p, 'login-email').fill(em); await p.getByText('Kod gönder', { exact: true }).first().click(); await V(p, 'login-code').waitFor(); await p.getByText('Demo kutusundan kodu getir', { exact: true }).first().click(); await p.waitForTimeout(900); await p.getByText('Giriş yap', { exact: true }).first().click(); await p.waitForTimeout(2200);
    await p.goto(WEB + '/admin'); await p.waitForTimeout(3200);
    const st = {}; for (const a of ['legislation', 'market', 'moderation']) st[a] = (await p.locator(`[data-testid="home-forbidden-${a}"]:visible`).count()) ? 'YETKİ YOK' : (await p.locator(`[data-testid="home-error-${a}"]:visible`).count()) ? 'HATA' : (await p.locator(`[data-testid="home-zero-${a}"]:visible`).count()) ? 'YETKİLİ-BOŞ' : 'YETKİLİ-İŞ VAR';
    const rows = await p.evaluate(() => [...document.querySelectorAll('[data-testid^="home-row-"]')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.innerText.split('\n')[0]));
    console.log(tag, JSON.stringify(st), 'satır alanları:', [...new Set(rows)].join(','), '| toplam:', await V(p, 'home-total').innerText());
    if (tag === 'yonetici') await p.screenshot({ path: `${OUT}/t9-rol-yonetici-1366.png` });
    await p.close(); }
  await b.close(); })();
