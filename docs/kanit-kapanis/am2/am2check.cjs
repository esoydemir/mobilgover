// AM-2 uçtan uca: 8091 üzerinde dosya yükle -> ekranda "Yüklenen dosyadan oku" -> öneriler/kaynak metin -> onay. node am2check.cjs
const { chromium, webkit, devices } = require('playwright');
const ENGINE = process.env.ENGINE === 'webkit' ? webkit : chromium, DEV = process.env.DEVICE || 'Pixel 7', SUF = process.env.ENGINE === 'webkit' ? '-webkit' : '';
const crypto = require('crypto'); const fs = require('fs'); const path = require('path');
const { req, login, BASE } = require('./api.cjs');
const SRC = path.join(__dirname, '..', 'src', 'docs', 'kanit-kapanis', 'am2', 'ornekler');
const OUT = process.env.OUT || path.join(__dirname, '..', 'src', 'docs', 'kanit-kapanis', 'am2'); fs.mkdirSync(OUT, { recursive: true });
const res = []; const ok = (ad, k, d) => res.push(`${k ? 'TAMAM' : 'BAŞARISIZ'}  ${ad}${d ? ' — ' + d : ''}`);
const SF = path.join(__dirname, '.qr-state.json'); const STATE = JSON.parse(fs.readFileSync(SF, 'utf8'));

(async () => {
  const t = await login('mudur@demo.goverhub.test'); // belgeyi yükleyen; ekran oturumu .qr-state.json (mudur@)
  const cs = await req('GET', '/companies', { token: t }); const C = cs.find(c => c.sites?.length) ?? cs[0];
  const mk = async (file, mime, title) => {
    const bytes = fs.readFileSync(path.join(SRC, file));
    const d = await req('POST', `/companies/${C.id}/documents`, { token: t, body: { docType: 'other', title, siteId: C.sites[0].id } });
    const v = await req('POST', `/companies/${C.id}/documents/${d.id}/versions`, { token: t, body: { validFrom: null, validUntil: null, file: { mime, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length } } });
    await req('PUT', `/companies/${C.id}/evidence/${v.evidenceId}/content`, { token: t, bytes, mime });
    return d.id;
  };
  const stamp = Date.now() % 100000;
  const cases = [['metinli.pdf', 'application/pdf', 'pdf_text', 'metin-katmanli-pdf'], ['taranmis.pdf', 'application/pdf', 'ocr_pdf', 'taranmis-pdf'], ['fotograf.jpg', 'image/jpeg', 'ocr_image', 'turkce-fotograf']];
  const browser = await ENGINE.launch({ args: process.env.ENGINE === 'webkit' ? [] : ['--no-proxy-server'] });
  const ctx = await browser.newContext({ ...devices[DEV], storageState: STATE });
  const page = await ctx.newPage();
  for (const [file, mime, method, slug] of cases) {
    const id = await mk(file, mime, `AM2 ${slug} ${stamp}`);
    await page.goto(`${BASE}/documents/${id}`); await page.getByTestId('extract-file').waitFor({ timeout: 20000 });
    await page.getByTestId('extract-file').scrollIntoViewIfNeeded(); await page.getByTestId('extract-file').click();
    await page.getByTestId('extract-method').waitFor({ timeout: 90000 }).catch(() => { });
    const m = await page.getByTestId('extract-method').innerText().catch(() => '');
    const no = await page.getByTestId('extract-documentNo').inputValue().catch(() => '');
    const until = await page.getByTestId('extract-validUntil').inputValue().catch(() => '');
    await page.getByTestId('extract-source-toggle').click().catch(() => { });
    const src = await page.getByTestId('extract-source-text').innerText().catch(() => '');
    ok(`${slug}: alanlar dosyadan geldi (${method})`, no === 'RHS-2031-0457' && until === '2036-03-04' && /RHS-2031-0457/.test(src), `${m} | no=${no} bitiş=${until}`);
    await page.getByTestId('extract-method').scrollIntoViewIfNeeded().catch(() => { });
    await page.screenshot({ path: path.join(OUT, `${slug}${SUF}.png`), fullPage: false });
    if (slug === 'metin-katmanli-pdf') {
      // düzeltip onayla; sürüm incelendi sayılmaz
      await page.getByTestId('extract-documentNo').fill('RHS-2031-0458'); await page.getByTestId('extract-confirm').click(); await page.waitForTimeout(1500);
      const d = await req('GET', `/companies/${C.id}/documents/${id}`, { token: t });
      ok('Onay: düzeltilen alan kaydedildi, sürüm incelenmedi', d.documentNo === 'RHS-2031-0458' && d.versions[0].review_status === 'unreviewed', `no=${d.documentNo} durum=${d.versions[0].review_status}`);
    }
  }
  // Okunamayan örnek: açık hata + yeniden dene + elle giriş
  for (const [file, mime, slug] of [['bos.png', 'image/png', 'okunamayan-bos-gorsel'], ['bozuk.pdf', 'application/pdf', 'okunamayan-bozuk-pdf']]) {
    const id = await mk(file, mime, `AM2 ${slug} ${stamp}`);
    await page.goto(`${BASE}/documents/${id}`); await page.getByTestId('extract-file').waitFor({ timeout: 20000 });
    await page.getByTestId('extract-file').scrollIntoViewIfNeeded(); await page.getByTestId('extract-file').click();
    await page.getByTestId('extract-file-error').waitFor({ timeout: 60000 }).catch(() => { });
    const err = await page.getByTestId('extract-file-error').innerText().catch(() => '');
    ok(`${slug}: hata, yeniden deneme ve elle giriş yolu görünür`, /elle gir/.test(err) && (await page.getByTestId('extract-file-retry').count()) > 0 && (await page.getByTestId('extract-text').count()) > 0, err.replace(/\n/g, ' | ').slice(0, 110));
    await page.screenshot({ path: path.join(OUT, `${slug}${SUF}.png`) });
    if (slug === 'okunamayan-bozuk-pdf') {
      await page.getByTestId('extract-text').fill('İŞYERİ AÇMA RUHSATI\nBelge No: RHS-9-111\nGeçerlilik Bitişi: 01.01.2040\nelle yapıştırıldı'); await page.getByTestId('extract-propose').click();
      await page.getByTestId('extract-confirm').waitFor({ timeout: 15000 }).catch(() => { });
      ok('Okunamayan dosyada metin elle girilip öneri alındı', (await page.getByTestId('extract-confirm').count()) > 0);
    }
  }
  await browser.close();
  console.log(res.join('\n')); process.exit(res.some(r => r.startsWith('BAŞARISIZ')) ? 1 : 0);
})().catch(e => { console.log(res.join('\n')); console.error('HATA', e.message); process.exit(1); });
