const { chromium, OUT, URL, q, login } = require('./leg-lib.cjs');
(async () => {
  const b = await chromium.launch(); q('delete from login_challenges'); const p = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  await login(p, 'yonetici@demo.goverhub.test'); await p.goto(URL + '/legislation'); await p.waitForTimeout(2000);
  await p.locator('[data-testid^="leg-row-"]').first().click(); await p.waitForTimeout(1500);
  console.log(await p.evaluate(() => { const r = id => { const e = document.querySelector(`[data-testid="${id}"]`); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; }; return JSON.stringify({ doc: document.documentElement.scrollHeight, bar: r('leg-decision-bar'), dec: r('leg-decision'), desk: r('leg-desk'), pane: r('leg-detail-pane') }); }));
  await b.close();
})();
