const { chromium, OUT, URL, q, login, txt } = require('./leg-lib.cjs'); const fs = require('fs'); const ids = JSON.parse(fs.readFileSync('C:/Users/gkhno/AppData/Local/Temp/t7-weekly.json'));
(async () => {
  const b = await chromium.launch(); q('delete from login_challenges');
  const p = await (await b.newContext({ viewport: { width: 412, height: 839 } })).newPage(); p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await login(p, ids.estate.owner); await p.goto(URL + '/'); await p.waitForTimeout(2500); console.log('TELEFON ANASAYFA:', (await txt(p)).slice(0, 260)); await p.screenshot({ path: `${OUT}/mobil-1-bugun.png` });
  await p.goto(URL + '/tasks'); await p.waitForTimeout(2500); const t = p.getByText(/Dosya düzenini kontrol et|Yetki sözleşmesi dosyalarını/).first(); await t.click().catch(() => {}); await p.waitForTimeout(2500);
  console.log('GOREV:', p.url().replace(URL, ''), '|', (await txt(p)).slice(0, 300)); await p.screenshot({ path: `${OUT}/mobil-2-gorev.png` });
  // telefonda mevzuat ekranı (platform hesabı) eski liste düzeninde kalmalı
  q('delete from login_challenges'); const m = await (await b.newContext({ viewport: { width: 412, height: 839 } })).newPage(); await login(m, 'yonetici@demo.goverhub.test'); await m.goto(URL + '/legislation'); await m.waitForTimeout(2500);
  console.log('TELEFON MEVZUAT:', (await txt(m)).slice(0, 160), '| masa var mı:', await m.getByTestId('leg-desk').count(), '| alt sekme:', await m.getByText('Bugün', { exact: true }).count()); await m.screenshot({ path: `${OUT}/mobil-3-mevzuat-telefon.png` });
  // geniş pencerede platform dışı ekran hâlâ telefon çerçevesinde
  q('delete from login_challenges'); const w = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage(); await login(w, ids.estate.owner); await w.goto(URL + '/'); await w.waitForTimeout(2500); await w.screenshot({ path: `${OUT}/mobil-4-genis-pencere-cerceve.png` });
  q('delete from login_challenges'); const a = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage(); await login(a, 'yonetici@demo.goverhub.test'); await a.goto(URL + '/admin'); await a.waitForTimeout(2500); await a.screenshot({ path: `${OUT}/mobil-5-admin-masaustu.png` });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
