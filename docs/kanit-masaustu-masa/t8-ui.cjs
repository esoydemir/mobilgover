// Masaüstü kullanılabilirlik: klavye, odak, uzun başlık, süzgeç/seçim korunumu, gerekçe yazarken karar düğmesi. SENTETİK veri.
const { chromium, OUT, URL, q, login, txt } = require('./leg-lib.cjs'); const fs = require('fs'); const T = 'C:/Users/gkhno/AppData/Local/Temp/';
const W = +(process.env.W || 1366), H = +(process.env.H || 768); const DAY = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const LONG = 'Sentetik Gayrimenkul Aracılık Hizmeti Veren İşletmelerin Yetki Sözleşmesi Saklama, Mülk Sahibine Bilgilendirme ve Taşınmaz Ticareti Kayıt Esaslarına İlişkin Usul ve Esaslar Hakkında Uygulama Yönetmeliğinde Değişiklik Yapılmasına Dair Yönetmelik';
(async () => {
  const cur = JSON.parse(fs.readFileSync(T + 'synth-publish.json', 'utf8')); if (!cur.find(x => x.id === `${DAY}-96`)) { cur.push({ id: `${DAY}-96`, title: LONG, sayi: 99096, articles: ['Gayrimenkul aracılık hizmeti veren işletmeler yetki sözleşmelerini saklar.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] }); fs.writeFileSync(T + 'synth-publish.json', JSON.stringify(cur)); await new Promise(r => setTimeout(r, 12000)); }
  const b = await chromium.launch(); q('delete from login_challenges'); const p = await (await b.newContext({ viewport: { width: W, height: H } })).newPage(); p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await login(p, 'yonetici@demo.goverhub.test'); await p.goto(URL + '/legislation'); await p.waitForTimeout(2500); await p.getByTestId('leg-scan').first().click(); await p.waitForTimeout(4000);
  const rows = () => p.locator('[data-testid^="leg-row-"]'); const n0 = await rows().count(); console.log('SATIR', n0);
  await p.getByTestId('leg-quick-unowned').first().click(); await p.waitForTimeout(1000); await p.screenshot({ path: `${OUT}/ui-${W}-1-uzun-baslik-kuyruk.png` });
  // klavye: ilk satıra tıkla, ↓ ile ikinci satıra geç
  await rows().first().click(); await p.waitForTimeout(800); const sel = () => p.evaluate(() => { const d = document.querySelector('[data-testid="desk-detail"]'); const l = (d ? d.innerText : '').split(String.fromCharCode(10)).filter(x => /Yönetmeli|Tebliğ/.test(x)); return (l[0] || '-').slice(0, 48); });
  const s0 = await sel(); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(900); const s1 = await sel(); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(900); const s2 = await sel(); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(900); const s3 = await sel();
  console.log('KLAVYE secim:', s0, '->↓', s1, '->↓', s2, '->↑', s3, '| odaktaki:', await p.evaluate(() => document.activeElement?.getAttribute('data-testid')));
  const sy = await p.evaluate(() => { const e = document.activeElement; if (!e) return null; const c = getComputedStyle(e); return { outline: c.outlineStyle + ' ' + c.outlineWidth + ' ' + c.outlineColor }; }); console.log('ODAK HALKASI:', JSON.stringify(sy));
  await p.screenshot({ path: `${OUT}/ui-${W}-2-klavye-odak.png` });
  // uzun başlıklı kaydı aç: taşma var mı
  const longRow = p.locator(`[data-testid^="leg-row-"]`).filter({ hasText: 'Uygulama Yönetmeliğinde' }).first(); await longRow.click(); await p.waitForTimeout(1800);
  console.log('YATAY TASMA:', JSON.stringify(await p.evaluate(() => ({ docW: document.documentElement.scrollWidth, winW: innerWidth, detail: (() => { const e = document.querySelector('[data-testid="leg-detail-pane"]'); return e ? [e.scrollWidth, e.clientWidth] : null; })() }))));
  await p.screenshot({ path: `${OUT}/ui-${W}-3-uzun-baslik-kayit.png` });
  // gerekçe yazarken karar düğmesine erişim: kutuya yaz, düğmenin görünür alanda olduğunu ölç
  const id = (await longRow.getAttribute('data-testid')).replace('leg-row-', '');
  await p.getByTestId('leg-reason').first().click(); await p.keyboard.type('Gerekçe yazılırken karar düğmesi ekranda kalır.'); await p.waitForTimeout(500);
  console.log('KARAR DUGMESI GORUNUR ALANDA:', JSON.stringify(await p.evaluate(() => { const bt = document.querySelector('[data-testid="leg-reject"]'); const r = bt.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, inView: r.top >= 0 && r.bottom <= innerHeight }; })));
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); console.log('TAB ile odak:', await p.evaluate(() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.textContent?.slice(0, 30)));
  await p.screenshot({ path: `${OUT}/ui-${W}-4-gerekce-yazarken.png` });
  // süzgeç + seçim: Eşleşmesi belirsiz süz, arama yaz, kaydı seç, Yönetim'e git, geri dön
  await p.getByTestId('leg-quick-open').first().click(); await p.waitForTimeout(600); await p.locator('[data-testid="leg-search"]').fill('Aracılık'); await p.waitForTimeout(1200);
  await p.locator('[data-testid^="leg-row-"]').first().click(); await p.waitForTimeout(1200); const before = { rows: await rows().count(), url: p.url().replace(URL, '') };
  await p.getByTestId('desk-back').first().click(); await p.waitForTimeout(2500); console.log('YONETIM:', p.url().replace(URL, '')); await p.getByTestId('admin-legislation').first().click(); await p.waitForTimeout(2800);
  const after = { rows: await rows().count(), search: await p.locator('[data-testid="leg-search"]').inputValue(), url: p.url().replace(URL, ''), selected: await sel() };
  console.log('SUZGEC KORUNDU MU:', JSON.stringify(before), '->', JSON.stringify(after)); await p.screenshot({ path: `${OUT}/ui-${W}-5-geri-donus-suzgec.png` });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
