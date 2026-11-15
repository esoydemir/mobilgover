// AM-1 test düzeneği: Chromium sahte kamera akışına gerçek bir QR görüntüsü verilir. node qr-kamera.cjs
// Bu, gerçek telefon kamerasıyla okutma DEĞİLDİR; uygulamanın kamera -> çözme -> yönlendirme zincirini doğrular.
const { chromium, devices } = require('playwright');
const fs = require('fs'); const path = require('path');
const { req, login, BASE } = require('./api.cjs');
const OUT = process.env.OUT || path.join(__dirname, '..', 'kanit-am1'); fs.mkdirSync(OUT, { recursive: true });
const res = []; const ok = (ad, k, d) => { res.push(`${k ? 'TAMAM' : 'BAŞARISIZ'}  ${ad}${d ? ' — ' + d : ''}`); };

async function qrJpeg(browser, dataUrl, file) {
  const p = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await p.setContent(`<body style="margin:0;background:#fff;display:flex;align-items:center;justify-content:center;height:480px"><img src="${dataUrl}" style="width:420px;height:420px"></body>`);
  const jpg = await p.screenshot({ type: 'jpeg', quality: 90 }); await p.close();
  fs.writeFileSync(file, Buffer.concat(Array.from({ length: 40 }, () => jpg))); // .mjpeg: art arda JPEG kareleri
}
async function uiLogin(page, email) {
  if (STATE) return;
  await page.goto(BASE + '/login'); await page.getByRole('textbox').first().fill(email);
  await page.getByRole('button', { name: 'Kod gönder' }).click();
  await page.getByText('Demo kutusundan kodu getir').click();
  await page.getByRole('button', { name: 'Giriş yap' }).click(); await page.waitForTimeout(2500); STATE = await page.context().storageState(); fs.writeFileSync(SF, JSON.stringify(STATE));
}
const SF = path.join(__dirname, '.qr-state.json'); let STATE = fs.existsSync(SF) ? JSON.parse(fs.readFileSync(SF, 'utf8')) : null; // oturum bir kez açılır; giriş denemesi sınırına takılmamak için diğer bağlamlar aynı oturumu kullanır
const newCtx = async (browser, mjpeg, { allow }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], permissions: allow ? ['camera'] : [], ...(STATE ? { storageState: STATE } : {}) });
  await ctx.addInitScript(() => { window.__streams = []; const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async c => { try { const s = await g(c); window.__streams.push(s); return s; } catch (e) { window.__gumError = e.name + ': ' + e.message; throw e; } }; });
  return ctx;
};

(async () => {
  const t = await login('mudur@demo.goverhub.test'); const cs = await req('GET', '/companies', { token: t }); const C = cs.find(c => c.sites?.length) ?? cs[0];
  const eq = await req('GET', `/companies/${C.id}/sites/${C.sites[0].id}/equipment`, { token: t }); const e0 = (eq.items || eq)[0];
  const mk = async (kind, refId) => (await req('POST', `/companies/${C.id}/qr`, { token: t, body: { kind, refId } }));
  const img = async q => (await req('GET', `/companies/${C.id}/qr/${q.id}/image?base=${encodeURIComponent(BASE)}`, { token: t })).dataUrl;
  const qEq = await mk('equipment', e0.id); const imgEq = await img(qEq);
  const docs = await req('POST', `/companies/${C.id}/documents`, { token: t, body: { docType: 'other', title: 'Kamera testi belgesi', siteId: C.sites[0].id } });
  const qDoc = await mk('document', docs.id); const imgDoc = await img(qDoc);
  await req('POST', `/companies/${C.id}/qr/${qDoc.id}/active`, { token: t, body: { active: false, reason: 'Kamera testi: pasif kod.' } });

  const flags = f => ['--no-proxy-server', '--use-fake-device-for-media-stream', ...(f ? ['--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${f}`] : [])];
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'qr-')); const fEq = path.join(tmp, 'eq.mjpeg'), fDoc = path.join(tmp, 'doc.mjpeg');
  const b0 = await chromium.launch({ args: ['--no-proxy-server'] }); await qrJpeg(b0, imgEq, fEq); await qrJpeg(b0, imgDoc, fDoc); await b0.close();

  // 1) Geçerli kod: kamera -> okunur -> ekipman açılır, tek yönlendirme, yayın durur
  let b = await chromium.launch({ args: flags(fEq) }); let ctx = await newCtx(b, fEq, { allow: true }); let page = await ctx.newPage();
  let resolves = 0; page.on('request', r => { if (r.url().includes('/qr/resolve')) resolves++; });
  await uiLogin(page, 'mudur@demo.goverhub.test'); await page.goto(BASE + '/scan'); await page.getByRole('button', { name: 'Kamerayla okut' }).click();
  await page.waitForURL(`**/equipment/${e0.id}`, { timeout: 20000 }).catch(() => { });
  await page.waitForTimeout(3500); // aynı kod karelerde tekrar görülse bile ikinci istek olmamalı
  ok('Geçerli QR kamerayla okundu, ekipman kaydı açıldı', page.url().endsWith(`/equipment/${e0.id}`), page.url().replace(BASE, ''));
  ok('Aynı kod arka arkaya algılansa da tek çözümleme isteği', resolves === 1, `istek sayısı ${resolves}`);
  const live = await page.evaluate(() => window.__streams.flatMap(s => s.getTracks()).filter(t => t.readyState === 'live').length);
  ok('Ekran kapanınca kamera yayını durdu', live === 0, `canlı iz ${live}`);
  await page.screenshot({ path: path.join(OUT, '1-ekipman-acildi.png') });
  await b.close();

  // 2) Pasif kod: anlaşılır hata, yönlendirme yok
  b = await chromium.launch({ args: flags(fDoc) }); ctx = await newCtx(b, fDoc, { allow: true }); page = await ctx.newPage();
  await uiLogin(page, 'mudur@demo.goverhub.test'); await page.goto(BASE + '/scan'); await page.getByRole('button', { name: 'Kamerayla okut' }).click();
  await page.getByText('geçersiz, pasifleştirilmiş').waitFor({ timeout: 20000 }).catch(() => { });
  ok('Pasif QR: anlaşılır hata, kayıt açılmadı', (await page.getByText('geçersiz, pasifleştirilmiş').count()) > 0 && page.url().endsWith('/scan'), page.url().replace(BASE, ''));
  await page.screenshot({ path: path.join(OUT, '2-pasif-kod-hatasi.png') }); await b.close();

  // 3) İzin reddedildi: mesaj + kod girişi çalışır
  b = await chromium.launch({ args: flags(null) }); ctx = await newCtx(b, null, { allow: false }); page = await ctx.newPage();
  await ctx.grantPermissions([], { origin: BASE });
  await uiLogin(page, 'mudur@demo.goverhub.test'); await page.goto(BASE + '/scan'); await page.getByRole('button', { name: 'Kamerayla okut' }).click();
  await page.getByTestId('scan-camera-problem').waitFor({ timeout: 15000 }).catch(() => { });
  const msg = await page.getByTestId('scan-camera-problem').innerText().catch(() => '');
  const gum = await page.evaluate(() => window.__gumError || null);
  ok('Kamera erişimi yokken (izin verilmedi/kamera yok) açıklama gösterildi', /izin|bulunamadı|erişim|desteklemiyor/i.test(msg), `${gum} → ${msg.slice(0, 70)}`);
  await page.getByTestId('scan-input').fill(`${BASE}/q/${qEq.token}`); await page.getByRole('button', { name: 'Kaydı aç' }).click();
  await page.waitForURL(`**/equipment/${e0.id}`, { timeout: 15000 }).catch(() => { });
  ok('Kamera olmadan kod girişiyle kayıt açıldı', page.url().endsWith(`/equipment/${e0.id}`), page.url().replace(BASE, ''));
  await page.screenshot({ path: path.join(OUT, '3-kod-girisi-devam.png') }); await b.close();

  // 4) İzin reddi BENZETİMİ (headless Chromium gerçek izin istemini göstermez; getUserMedia NotAllowedError ile reddedilir): NotAllowedError -> izin mesajı
  b = await chromium.launch({ args: ['--no-proxy-server', '--use-fake-device-for-media-stream', '--deny-permission-prompts'] }); ctx = await newCtx(b, null, { allow: false }); await ctx.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; window.__gumError = 'NotAllowedError (benzetim)'; throw e; }; }); page = await ctx.newPage();
  await page.goto(BASE + '/scan'); await page.getByRole('button', { name: 'Kamerayla okut' }).click();
  await page.getByTestId('scan-camera-problem').waitFor({ timeout: 15000 }).catch(() => { });
  const msg4 = await page.getByTestId('scan-camera-problem').innerText().catch(() => ''); const gum4 = await page.evaluate(() => window.__gumError || null);
  ok('Kamera izni reddedilince izin mesajı ve kod girişi görünür', /Kamera izni verilmedi/.test(msg4) && (await page.getByTestId('scan-input').count()) > 0, `${gum4}`);
  await page.screenshot({ path: path.join(OUT, '4-izin-reddedildi.png') }); await b.close();

  console.log(res.join('\n')); process.exit(res.some(r => r.startsWith('BAŞARISIZ')) ? 1 : 0);
})().catch(e => { console.log(res.join('\n')); console.error('HATA', e.message); process.exit(1); });
