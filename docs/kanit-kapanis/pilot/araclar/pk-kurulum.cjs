// Temiz kurulum doğrulaması (ayrı ortam, WEB=http://localhost:8095): demo girişi + ilk işletmeyi ekrandan kurma. node pk-kurulum.cjs
const { chromium, devices } = require('playwright'); const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const BASE = process.env.WEB || 'http://localhost:8095'; const PROJ = process.env.PROJ || 'goverhub-temiz';
const OUT = path.join(__dirname, '..', 'src', 'docs', 'kanit-kapanis', 'pilot', 'kurulum'); fs.mkdirSync(OUT, { recursive: true });
const res = []; const ok = (ad, k, d) => { const s = (k ? 'TAMAM' : 'BAŞARISIZ') + '  ' + ad + (d ? ' — ' + d : ''); res.push(s); console.log(s); return !!k; };
const psql = q => execFileSync('docker', ['exec', PROJ + '-db-1', 'psql', '-U', 'postgres', '-d', 'goverhub_demo', '-Atc', q]).toString().trim();
(async () => {
  const h = await (await fetch(BASE + '/api/health')).json(); ok('Sağlık', h.ok === true, BASE);
  const mig = psql("select count(*) from schema_migrations"); ok('Migrasyonlar uygulanmış', Number(mig) >= 24, mig + ' migrasyon');
  const b = await chromium.launch({ args: ['--no-proxy-server'] }); const c = await b.newContext({ ...devices['Pixel 7'], locale: 'tr-TR' }); const p = await c.newPage();
  const login = async email => { await p.goto(BASE + '/login'); await p.waitForTimeout(1200); await p.getByTestId('login-email').first().fill(email); await p.getByText('Kod gönder', { exact: true }).first().click(); await p.getByTestId('login-code').first().waitFor(); await p.getByText('Demo kutusundan kodu getir', { exact: true }).first().click(); await p.waitForTimeout(800); await p.getByText('Giriş yap', { exact: true }).first().click(); await p.waitForTimeout(3500); };
  await login('sahip@demo.goverhub.test'); const t1 = await p.locator('body').innerText(); ok('Demo hesabıyla giriş (sahip@), ana ekran açıldı', /Kahve Durağı/.test(t1), t1.replace(/\n+/g, ' | ').slice(0, 90));
  await p.screenshot({ path: path.join(OUT, PROJ + '-demo-ana.png') });
  // İlk işletme: yeni kullanıcı, işletmesiz
  const ctx2 = await b.newContext({ ...devices['Pixel 7'], locale: 'tr-TR' }); const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/login'); await p2.waitForTimeout(1200); await p2.getByTestId('login-email').first().fill('ilk.isletme@demo.goverhub.test'); await p2.getByText('Kod gönder', { exact: true }).first().click(); await p2.getByTestId('login-code').first().waitFor(); await p2.getByText('Demo kutusundan kodu getir', { exact: true }).first().click(); await p2.waitForTimeout(800); await p2.getByText('Giriş yap', { exact: true }).first().click(); await p2.waitForTimeout(3500);
  const hasSetup = (await p2.getByTestId('setup-name').count()) > 0; ok('İşletmesiz yeni kullanıcı kurulum ekranını görüyor', hasSetup);
  if (hasSetup) {
    await p2.getByTestId('setup-name').fill('Temiz Kurulum Kafe'); await p2.getByTestId('setup-site').fill('Merkez'); await p2.getByTestId('setup-create').click(); await p2.waitForTimeout(3000);
    console.log((await p2.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 400)); await p2.screenshot({ path: path.join(OUT, PROJ + '-kurulum-adim2.png') });
  }
  const cnt = psql("select count(*) from companies where name='Temiz Kurulum Kafe'"); ok('İlk işletme veritabanında oluştu', cnt === '1', cnt);
  await b.close();
  fs.writeFileSync(path.join(OUT, PROJ + '-kurulum.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, sonuclar: res }, null, 2));
  process.exit(res.some(x => x.startsWith('BAŞARISIZ')) ? 1 : 0);
})().catch(e => { console.log(res.join('\n')); console.error('HATA', e.message); process.exit(1); });
