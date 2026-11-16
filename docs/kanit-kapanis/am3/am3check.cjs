// AM-3 uçtan uca (8091): gerçek yerel model (Ollama) üzerinden kaynaklı yanıt, yetersiz kaynak, çelişen kaynaklar, ceza tutarı reddi. node am3check.cjs
const { chromium, devices } = require('playwright');
const crypto = require('crypto'); const fs = require('fs'); const path = require('path');
const { req, login, BASE } = require('./api.cjs');
const OUT = process.env.OUT || path.join(__dirname, '..', 'src', 'docs', 'kanit-kapanis', 'am3'); fs.mkdirSync(OUT, { recursive: true });
const res = []; const ok = (ad, k, d) => res.push(`${k ? 'TAMAM' : 'BAŞARISIZ'}  ${ad}${d ? ' — ' + d : ''}`);
const STATE = JSON.parse(fs.readFileSync(path.join(__dirname, '.qr-state.json'), 'utf8'));
const log = {};

(async () => {
  const t = await login('mudur@demo.goverhub.test');
  const cs = await req('GET', '/companies', { token: t }); const C = cs.find(c => c.sites?.length) ?? cs[0];
  const stamp = Date.now() % 100000;
  const mkDoc = async (title, text) => {
    const d = await req('POST', `/companies/${C.id}/documents`, { token: t, body: { docType: 'other', title, siteId: C.sites[0].id } });
    const f = Buffer.from('%PDF-1.4 ' + title);
    const v = await req('POST', `/companies/${C.id}/documents/${d.id}/versions`, { token: t, body: { validFrom: null, validUntil: null, file: { mime: 'application/pdf', sha256: crypto.createHash('sha256').update(f).digest('hex'), sizeBytes: f.length } } });
    await req('POST', `/companies/${C.id}/documents/${d.id}/versions/${v.versionId}/extractions`, { token: t, body: { text, source: 'typed_text' } });
    return d.id;
  };
  const ask = async q => { const t0 = Date.now(); const r = await req('POST', `/companies/${C.id}/assistant/ask`, { token: t, body: { question: q } }); return { ...r, ms: Date.now() - t0 }; };
  const brief = r => ({ outcome: r.outcome, mode: r.mode, model: r.model, answer: r.answer, sources: r.sources.map(s => ({ n: s.n, title: s.title, locator: s.locator, cited: s.cited, route: s.route })), notes: r.notes, ms: r.ms });

  // 1) Kaynaklı soru
  const idClean = await mkDoc(`Temizlik planı ${stamp}`, 'Yüzeyler her vardiya sonunda dezenfekte edilir. Dezenfektan kaydı vardiya sorumlusu tarafından tutulur.');
  let r = await ask(`Yüzeyler ne zaman dezenfekte edilir ve kaydı kim tutar? ${stamp}`); log.sourced = brief(r);
  ok('Kaynaklı soru: gerçek model yanıtı, atıflı kaynak', r.mode === 'model' && r.outcome === 'answered' && r.sources.some(s => s.cited && s.route === `/documents/${idClean}`), `${r.model.name} · ${r.ms} ms · ${r.answer.slice(0, 90)}`);

  // 2) Yetersiz kaynak
  r = await ask(`Yüzeyler dezenfeksiyon kaydını hangi çalışan imzalar ${stamp}?`); log.insufficient = brief(r);
  ok('Kaynak yetersizken uydurma yok (yetersiz ya da model dışı kaynak listesi)', r.outcome === 'insufficient' || (r.mode === 'sources_only' && r.sources.length > 0), `${r.outcome}/${r.mode} · ${r.answer.slice(0, 90).replace(/\n/g, ' ')}`);
  r = await ask('Uzay istasyonunda kullanılacak roket yakıtı depolama standardı nedir?'); log.noSource = brief(r);
  ok('Hiç kaynak yok: yanıt üretilmedi, model çağrılmadı', r.outcome === 'insufficient' && r.model.status === 'skipped', r.answer.slice(0, 60));

  // 3) Çelişen iki kaynak
  const a = await mkDoc(`Gıda deposu talimatı A ${stamp}`, 'Donmuş ürün deposu sıcaklığı en fazla -18 °C olmalıdır.');
  const b = await mkDoc(`Gıda deposu talimatı B ${stamp}`, 'Donmuş ürün deposu sıcaklığı -12 °C’ye kadar çıkabilir.');
  r = await ask(`Donmuş ürün deposu sıcaklığı en fazla kaç derece olabilir? ${stamp}`); log.conflict = brief(r);
  const routes = r.sources.filter(s => s.cited).map(s => s.route);
  ok('Çelişen kaynaklar: çelişki bildirildi, iki kaynak da açılabilir', r.outcome === 'conflict' && routes.includes(`/documents/${a}`) && routes.includes(`/documents/${b}`), `${r.outcome} · ${r.answer.slice(0, 100)}`);

  // 4) Ceza tutarı
  r = await ask('Kayıt tutmazsam ne kadar para cezası öderim?'); log.fine = brief(r);
  ok('Ceza tutarı: reddedildi, model çağrılmadı, rakam yok', r.outcome === 'fine_declined' && !/\d+\s*(TL|₺|lira)/i.test(r.answer), r.answer.slice(0, 60));

  fs.writeFileSync(path.join(OUT, 'sonuc-8091.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, ...log }, null, 2));

  // Ekran: çelişki yanıtı
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });
  const ctx = await browser.newContext({ ...devices['Pixel 7'], storageState: STATE }); const page = await ctx.newPage();
  await page.goto(BASE + '/assistant'); await page.getByTestId('assistant-q').fill(`Donmuş ürün deposu sıcaklığı en fazla kaç derece olabilir? ${stamp}`);
  await page.getByTestId('assistant-ask').click(); await page.getByTestId('assistant-answer').waitFor({ timeout: 120000 });
  const mode = await page.getByTestId('assistant-mode').innerText(); const outc = await page.getByTestId('assistant-outcome').innerText();
  ok('Ekran: çelişki etiketi, model bilgisi ve kaynak bağlantıları', /ÇELİŞİYOR/.test(outc) && /dil modeli/.test(mode) && (await page.getByTestId('assistant-source-1').count()) > 0, `${outc} | ${mode}`);
  await page.screenshot({ path: path.join(OUT, 'asistan-celisen-kaynaklar.png'), fullPage: true });
  await browser.close();
  console.log(res.join('\n')); process.exit(res.some(x => x.startsWith('BAŞARISIZ')) ? 1 : 0);
})().catch(e => { console.log(res.join('\n')); console.error('HATA', e.message); process.exit(1); });
