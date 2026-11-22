const { chromium, OUT, URL, q, login, txt } = require('./leg-lib.cjs');
(async () => { const b = await chromium.launch(); q('delete from login_challenges'); const p = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage(); await login(p, 'yonetici@demo.goverhub.test');
  await p.goto(URL + '/legislation'); await p.waitForTimeout(2500); await p.getByTestId('desk-health-toggle').first().click(); await p.waitForTimeout(800);
  console.log((await p.getByTestId('desk-health').first().innerText()).split(String.fromCharCode(10)).join(' | ')); await p.getByTestId('leg-quick-unreadable').first().click(); await p.waitForTimeout(800); await p.screenshot({ path: OUT + '/health-1366.png' }); await b.close(); })();
