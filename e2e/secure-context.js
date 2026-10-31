// Usage: ORIGINS=http://localhost:8099,http://<lan-ip>:8098 node secure-context.js <out-dir>
// Opens the same task page from a secure (localhost) and an insecure (LAN http) origin.
const { chromium, devices } = require('playwright');
const API = 'http://localhost:3077';
const j = async (m, p, body, token) => { const r = await fetch(API + p, { method: m, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
(async () => {
  const email = 'telefon' + Date.now() + '@test.goverhub';
  await j('POST', '/auth/email/start', { email });
  const code = /(\d{6})/.exec((await j('GET', '/dev/outbox/latest?email=' + email)).body)[1];
  const { token } = await j('POST', '/auth/email/verify', { email, code });
  const me = await j('GET', '/me', null, token);
  const c = await j('POST', '/companies', { name: 'Telefon Testi Kafe', siteName: 'Merkez' }, token);
  for (const [key, value] of [['activity.food_preparation', true], ['storage.cold', true]]) await j('POST', `/companies/${c.companyId}/profile/facts`, { siteId: c.siteId, key, value, source: 'user_declared', verification: 'user_confirmed' }, token);
  await j('POST', `/companies/${c.companyId}/equipment`, { siteId: c.siteId, type: 'refrigerator', name: 'Dolap' }, token);
  const day = new Date().toISOString().slice(0, 10);
  await j('POST', `/companies/${c.companyId}/tasks/generate`, { siteId: c.siteId, fromDay: day, toDay: day }, token);
  const tasks = await j('GET', `/companies/${c.companyId}/tasks?siteId=${c.siteId}`, null, token);
  const t = tasks.find(x => (x.title || '').toLowerCase().includes('soğut')) || tasks[0];
  console.log('task', t && t.title, tasks.length);
  const b = await chromium.launch();
  for (const origin of (process.env.ORIGINS || 'http://localhost:8099').split(',')) {
    const ctx = await b.newContext({ ...devices['iPhone 14'], locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
    await ctx.addInitScript(([s]) => localStorage.setItem('gh.session.v1', s), [JSON.stringify({ token, companyId: c.companyId, userId: me.userId })]);
    const p = await ctx.newPage();
    await p.goto(`${origin}/task/${t.id}`); await p.waitForTimeout(4000);
    const secure = await p.evaluate(() => window.isSecureContext && !!crypto.subtle);
    const warn = await p.getByTestId('insecure-web').count();
    const photo = await p.getByTestId('photo-add').count();
    console.log(origin, { secureContext: secure, photoCard: photo, insecureWarning: warn });
    await p.screenshot({ path: process.argv[2] + '/secure-' + (origin.includes('localhost') ? 'localhost' : 'lan') + '.png' });
    await ctx.close();
  }
  await b.close();
})();
