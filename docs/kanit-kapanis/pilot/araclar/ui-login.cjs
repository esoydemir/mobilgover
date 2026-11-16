// UI girişi (demo kutusundan kod) — betikler arası ortak yardımcı.
const { execFileSync } = require('child_process'); const { BASE } = require('./api.cjs');
async function uiLogin(page, email) {
  try { execFileSync('docker', ['exec', 'goverhub-pilotfix-db-1', 'psql', '-U', 'postgres', '-d', 'goverhub_demo', '-c', "DELETE FROM login_challenges WHERE email LIKE '%@demo.goverhub.test'"], { stdio: 'ignore' }); } catch { }
  await page.goto(BASE + '/login'); await page.waitForTimeout(1200);
  await page.getByTestId('login-email').first().fill(email); await page.getByText('Kod gönder', { exact: true }).first().click();
  await page.getByTestId('login-code').first().waitFor(); await page.getByText('Demo kutusundan kodu getir', { exact: true }).first().click(); await page.waitForTimeout(800);
  await page.getByText('Giriş yap', { exact: true }).first().click(); await page.waitForTimeout(3500);
}
module.exports = { uiLogin };
