const { chromium, OUT, URL, q, login, txt } = require('./leg-lib.cjs');
(async () => {
  const b = await chromium.launch(); const W = +(process.env.W || 1366), H = +(process.env.H || 768);
  q('delete from login_challenges'); const p = await (await b.newContext({ viewport: { width: W, height: H } })).newPage();
  p.on('pageerror', e => console.log('PAGEERROR', e.message)); p.on('console', m => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 200)));
  await login(p, process.env.WHO || 'yonetici@demo.goverhub.test');
  await p.goto(URL + '/legislation'); await p.waitForTimeout(2500);
  console.log((await txt(p)).slice(0, 700));
  await p.screenshot({ path: OUT + `/desk-${W}-liste.png` });
  const row = p.locator('[data-testid^="leg-row-"]').first(); await row.click(); await p.waitForTimeout(2000);
  await p.screenshot({ path: OUT + `/desk-${W}-kayit.png` });
  console.log((await txt(p)).slice(700, 2200));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
