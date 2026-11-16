// AM-4 devamı: dosya akışları (8091): belgeye PDF/fotoğraf yükleme, belge aç/indir, vakada kanıt fotoğrafı açma, denetim PDF'i indirme.
// Öykünme: Chromium Pixel 7 ve WebKit iPhone 14. node akislar.cjs
const { chromium, webkit, devices } = require('playwright'); const fs = require('fs'); const path = require('path');
const { req, login, BASE } = require('./api.cjs');
const SRC = path.join(__dirname, '..', 'src', 'docs', 'kanit-kapanis', 'am2', 'ornekler');
const OUT = process.env.OUT || path.join(__dirname, '..', 'src', 'docs', 'kanit-kapanis', 'am4b'); fs.mkdirSync(OUT, { recursive: true });
const STATE = JSON.parse(fs.readFileSync(path.join(__dirname, '.qr-state.json'), 'utf8'));
const DEV = [[chromium, 'Pixel 7', 'chromium'], [webkit, 'iPhone 14', 'webkit']]; const res = []; const rep = {};
const ok = (ad, k, d) => { const s = `${k ? 'TAMAM' : 'BAŞARISIZ'}  ${ad}${d ? ' — ' + d : ''}`; res.push(s); console.log(s); return !!k; };
const dl = async (page, click) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), click()]); const p = await d.path(); return { name: d.suggestedFilename(), bytes: fs.readFileSync(p) }; };
// "Aç": yeni sekme (popup) ya da indirme yedeği; ikisinden biri içerik vermeli
const openOrFallback = async (page, ctx, click) => {
  const pop = ctx.waitForEvent('page', { timeout: 15000 }).then(p => ({ popup: p })).catch(() => null);
  const dn = page.waitForEvent('download', { timeout: 15000 }).then(d => ({ download: d })).catch(() => null);
  await click(); return Promise.race([pop, dn]);
};

(async () => {
  const t = await login('mudur@demo.goverhub.test'); const cs = await req('GET', '/companies', { token: t }); const C = cs.find(c => c.sites?.length) ?? cs[0]; const SITE = C.sites[0].id;
  const stamp = (Date.now() % 1e6).toString(36);
  for (const [bt, name, eng] of DEV) {
    const tag = eng + '-' + name.replace(/\s/g, ''); console.log('\n== ' + tag + ' =='); rep[tag] = {};
    const b = await bt.launch({ args: eng === 'chromium' ? ['--no-proxy-server'] : [] });
    const ctx = await b.newContext({ ...devices[name], storageState: STATE, acceptDownloads: true, timezoneId: 'Europe/Istanbul', locale: 'tr-TR' }); const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message)); const id = x => page.getByTestId(x);
    try {
      // 1) Belgeye PDF ve fotoğraf yükleme (ekrandan), açma, indirme
      for (const [file, label] of [['metinli.pdf', 'PDF'], ['fotograf.jpg', 'fotoğraf']]) {
        const d = await req('POST', '/companies/' + C.id + '/documents', { token: t, body: { docType: 'other', title: 'Akış ' + label + ' ' + tag + ' ' + stamp, siteId: SITE } });
        await page.goto(BASE + '/documents/' + d.id); await page.waitForTimeout(2000);
        await id('doc-version-open').scrollIntoViewIfNeeded(); await id('doc-version-open').click();
        const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), id('doc-file-pick').click()]);
        await fc.setFiles(path.join(SRC, file)); await page.waitForTimeout(1200);
        await id('doc-version-save').scrollIntoViewIfNeeded(); await id('doc-version-save').click(); await page.waitForTimeout(3500);
        const stored = await req('GET', '/companies/' + C.id + '/documents/' + d.id, { token: t }); const v = stored.versions && stored.versions[0];
        ok(tag + ': ' + label + ' ekrandan yüklendi, sunucuda saklandı', v && v.file_status === 'stored', v ? 'sürüm ' + v.version + ', ' + v.mime + ', ' + v.file_status : 'sürüm yok');
        if (!(v && v.file_status === 'stored')) continue;
        await page.screenshot({ path: path.join(OUT, tag + '-belge-' + label + '-yuklendi.png'), fullPage: true });
        if (label === 'PDF') {
          // Başsız Chromium/WebKit'te PDF görüntüleyici yok: yeni sekmeye açılan blob PDF indirme olarak teslim edilir; içerik bayt bayt aynı olmalı.
          const f0 = await dl(page, () => id('doc-file-open-' + v.version).click());
          ok(tag + ': PDF "Aç" dosyayı sağlam teslim etti (başsızda indirme olarak; satır içi görüntüleme fiziksel Safari\'de)', Buffer.compare(f0.bytes, fs.readFileSync(path.join(SRC, file))) === 0, f0.bytes.length + ' bayt');
        } else {
        const r = await openOrFallback(page, ctx, () => id('doc-file-open-' + v.version).click());
        if (r && r.popup) { await r.popup.waitForLoadState().catch(() => { }); ok(tag + ': ' + label + ' "Aç" yeni sekmede açıldı', /^blob:/.test(r.popup.url()), r.popup.url().slice(0, 30)); await r.popup.close(); }
        else if (r && r.download) ok(tag + ': ' + label + ' "Aç" tarayıcı engelleyince indirmeye döndü (yedek yol)', true, r.download.suggestedFilename());
        else ok(tag + ': ' + label + ' "Aç"', false, 'ne sekme ne indirme');
        }
        const f = await dl(page, () => id('doc-file-download-' + v.version).click());
        const orig = fs.readFileSync(path.join(SRC, file)); ok(tag + ': ' + label + ' indirildi, bayt bayt aynı', Buffer.compare(f.bytes, orig) === 0, f.name + ' · ' + f.bytes.length + ' bayt');
      }
      // 2) Vakada kanıt fotoğrafı: ekrandan ekle, ekranda aç
      const n = await req('POST', '/companies/' + C.id + '/nonconformities', { token: t, body: { siteId: SITE, title: 'Akış vaka ' + tag + ' ' + stamp, description: 'Dosya akışı doğrulaması (sentetik).', hazardType: 'cold_chain_temperature', severity: 'minor', containment: 'Sentetik.' } });
      const a = await req('POST', '/companies/' + C.id + '/nonconformities/' + n.id + '/actions', { token: t, body: { kind: 'correction', description: 'Conta değiştirildi (sentetik)', evidenceRequired: 'photo' } });
      await page.goto(BASE + '/ncr/' + n.id); await page.waitForTimeout(2500);
      await id('action-evidence-add-' + a.id).scrollIntoViewIfNeeded();
      const [fc2] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), id('action-evidence-add-' + a.id).click()]); await fc2.setFiles(path.join(SRC, 'fotograf.jpg'));
      await page.waitForTimeout(3500);
      const nn = await req('GET', '/companies/' + C.id + '/nonconformities/' + n.id, { token: t }); const act = nn.actions.find(x => x.id === a.id); const ev = act.evidence.find(e => e.status === 'stored');
      ok(tag + ': vakaya kanıt fotoğrafı ekrandan eklendi', !!ev, ev ? ev.id : 'yok'); if (!ev) continue;
      await id('action-evidence-open-' + ev.id).scrollIntoViewIfNeeded(); await id('action-evidence-open-' + ev.id).click();
      await id('evidence-image-' + ev.id).waitFor({ timeout: 20000 }).catch(() => { });
      const nat = await page.evaluate(i => { const im = document.querySelector('[data-testid="evidence-image-' + i + '"]'); const el = im && (im.tagName === 'IMG' ? im : im.querySelector('img')); return el ? { w: el.naturalWidth, h: el.naturalHeight } : { bg: im ? getComputedStyle(im).backgroundImage.slice(0, 20) : null }; }, ev.id);
      ok(tag + ': kanıt fotoğrafı ekranda açıldı ve çözüldü', (nat.w > 0 && nat.h > 0) || /blob|url/.test(nat.bg || ''), JSON.stringify(nat));
      await page.screenshot({ path: path.join(OUT, tag + '-kanit-fotografi.png'), fullPage: true });
      // 3) Denetim dosyası PDF indirme
      await page.goto(BASE + '/report'); await page.waitForTimeout(2500); await id('report-pdf').scrollIntoViewIfNeeded();
      const f2 = await dl(page, () => id('report-pdf').click()); ok(tag + ': denetim dosyası PDF olarak indirildi', f2.bytes.slice(0, 5).toString() === '%PDF-' && f2.bytes.length > 1000, f2.name + ' · ' + f2.bytes.length + ' bayt');
      fs.writeFileSync(path.join(OUT, tag + '-denetim-dosyasi.pdf'), f2.bytes);
    } catch (e) { ok(tag + ': akış', false, e.message.split('\n')[0]); await page.screenshot({ path: path.join(OUT, tag + '-FAIL.png'), fullPage: true }).catch(() => { }); }
    ok(tag + ': sayfa hatası (JS) yok', errs.length === 0, errs.slice(0, 2).join(' | ')); await b.close();
  }
  rep.tarih = new Date().toISOString(); rep.not = 'Öykünme: gerçek telefon değildir. Dosya seçici Playwright filechooser ile karşılandı.'; rep.sonuclar = res;
  fs.writeFileSync(path.join(OUT, 'akislar.json'), JSON.stringify(rep, null, 2)); const fail = res.filter(r => r.startsWith('BAŞARISIZ')); console.log('\n' + (fail.length ? 'BAŞARISIZ: ' + fail.length : 'tüm akışlar tamam') + ' (' + res.length + ' denetim)'); process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('HATA', e.message); process.exit(1); });
