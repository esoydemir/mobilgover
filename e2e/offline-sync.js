const { chromium } = require('playwright');
const OUT = process.argv[2];
const WEB = 'http://localhost:8099';
let n = 40;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
(async () => {
  const b = await chromium.launch();
  // DEVICE=<Playwright device name> runs the same flow in mobile-browser emulation (touch, mobile UA, device viewport).
  const { devices } = require('playwright');
  const dev = process.env.DEVICE ? devices[process.env.DEVICE] : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
  if (!dev) throw new Error('Unknown DEVICE ' + process.env.DEVICE);
  const ctx = await b.newContext({ ...dev, timezoneId: 'Europe/Istanbul', locale: 'tr-TR', recordVideo: { dir: OUT + '/video-offline', size: dev.viewport } });
  const p = await ctx.newPage();
  const shot = async name => { n++; await p.screenshot({ path: `${OUT}/${n}-${name}.png` }); log('shot', name); };
  const id = t => p.getByTestId(t).first();
  const text = t => p.getByText(t, { exact: true }).first();
  try {
    await p.goto(WEB + '/login'); await p.waitForTimeout(1200);
    await id('login-email').fill('selin@modakafe.test');
    await text('Kod gönder').click(); await id('login-code').waitFor();
    await text('Demo kutusundan kodu getir').click(); await p.waitForTimeout(800);
    await text('Giriş yap').click(); await p.waitForTimeout(3000);
    // Tasks tab is a client-side navigation; the app stays loaded from here on.
    await p.getByRole('tab', { name: 'Görevler' }).click(); await p.waitForTimeout(2500);
    await text('Eldiven ve önlük kontrolü').click(); await p.waitForTimeout(2500);
    await ctx.setOffline(true); log('offline');
    await id('check-gloves-pass').click(); await id('check-apron-pass').click(); await id('check-save').click(); await p.waitForTimeout(1500);
    await id('task-complete').click(); await p.waitForTimeout(2500);
    await shot('cevrimdisi-cihazda-bekliyor');
    await p.getByLabel(/Eşitleme durumu/).first().click().catch(() => p.getByRole('tab', { name: 'Daha' }).click()); await p.waitForTimeout(1500);
    if (!(await id('sync-summary').count())) { await id('more-sync').click(); await p.waitForTimeout(1500); }
    await shot('esitleme-ekrani-cevrimdisi');
    await ctx.setOffline(false); log('online');
    await id('sync-now').click(); await p.getByText('Tüm kayıtlar sunucuda').first().waitFor({ timeout: 30000 });
    await shot('esitleme-tamam');
    await p.getByRole('tab', { name: 'Görevler' }).click(); await p.waitForTimeout(2500);
    await shot('gorevler-cevrimdisi-kayit-sunucuda');
    await text('Eldiven ve önlük kontrolü').click(); await p.waitForTimeout(2500);
    await shot('gorev-cevrimdisi-kayit-sunucuda');
  } catch (e) {
    log('FAILED:', e.message.split('\n')[0]);
    await p.screenshot({ path: `${OUT}/FAIL-offline.png` });
  } finally { await ctx.close(); await b.close(); }
})();
