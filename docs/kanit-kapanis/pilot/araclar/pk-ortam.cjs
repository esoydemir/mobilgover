// Pilot kapanış 1: sağlık, giriş, OCR bağımlılığı, model bağlantısı (açık/kapalı davranışı). node pk-ortam.cjs [acik|kapali]
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { req, login, BASE } = require('./api.cjs');
const MODE = process.argv[2] || 'acik'; const res = [];
const ok = (ad, k, d) => { const s = (k ? 'TAMAM' : 'BAŞARISIZ') + '  ' + ad + (d ? ' — ' + d : ''); res.push(s); console.log(s); };
(async () => {
  const h = await req('GET', '/health'); ok('Sağlık', h.ok === true, JSON.stringify(h));
  const env = await req('GET', '/env'); ok('Ortam: demo kipi, örnek kurallar açık, e-posta üretime hazır değil', env.mode === 'demo' && env.mailProductionReady === false, JSON.stringify({ mode: env.mode, mail: env.mailTransport }));
  const roles = ['sahip', 'mudur', 'personel'].map(x => x); let loggedIn = 0;
  const t = await login('mudur@demo.goverhub.test'); loggedIn++; ok('Demo hesabıyla giriş', !!t);
  const o = await req('GET', '/ocr/status', { token: t }); ok('OCR bağımlılığı (Türkçe) hazır', o.available === true, JSON.stringify(o).slice(0, 200));
  const cs = await req('GET', '/companies', { token: t }); const C = cs.find(c => c.sites?.length) ?? cs[0];
  const stamp = Date.now() % 1e6;
  const d = await req('POST', '/companies/' + C.id + '/documents', { token: t, body: { docType: 'other', title: 'Ortam kontrolü ' + stamp, siteId: C.sites[0].id } });
  const f = Buffer.from('%PDF-1.4 ortam ' + stamp); const v = await req('POST', '/companies/' + C.id + '/documents/' + d.id + '/versions', { token: t, body: { validFrom: null, validUntil: null, file: { mime: 'application/pdf', sha256: crypto.createHash('sha256').update(f).digest('hex'), sizeBytes: f.length } } });
  await req('POST', '/companies/' + C.id + '/documents/' + d.id + '/versions/' + v.versionId + '/extractions', { token: t, body: { text: 'Yüzeyler her vardiya sonunda dezenfekte edilir. Dezenfektan kaydı vardiya sorumlusu tarafından tutulur.', source: 'typed_text' } });
  const r = await req('POST', '/companies/' + C.id + '/assistant/ask', { token: t, body: { question: 'Yüzeyler ne zaman dezenfekte edilir ve kaydı kim tutar?' } });
  const out = { mod: MODE, outcome: r.outcome, mode: r.mode, model: r.model, answer: r.answer.slice(0, 300), notes: r.notes, kaynak: r.sources.map(s => ({ title: s.title, route: s.route })) };
  console.log(JSON.stringify(out, null, 1));
  if (MODE === 'acik') ok('Model açık: model yanıtı, kaynak bağlantısı belgeyi açıyor', r.mode === 'model' && r.model.status === 'used' && r.sources.some(s => s.route === '/documents/' + d.id), r.model.name);
  else ok('Model kapalı: çökme yok, kaynaklar gösteriliyor, neden yazıyor', r.mode === 'sources_only' && r.sources.length > 0 && r.model.status !== 'used' && (r.notes.join(' ') + r.answer).length > 20, r.model.status + ' · ' + r.notes.join(' | ').slice(0, 160));
  const fine = await req('POST', '/companies/' + C.id + '/assistant/ask', { token: t, body: { question: 'Kayıt tutmazsam ne kadar para cezası öderim?' } });
  ok('Ceza tutarı üretilmiyor, model çağrılmıyor', fine.outcome === 'fine_declined' && !/\d+\s*(TL|₺|lira)/i.test(fine.answer), fine.answer.slice(0, 80));
  const OUT = path.join(__dirname, '..', 'src', 'docs', 'kanit-kapanis', 'pilot'); fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'ortam-' + MODE + '.json'), JSON.stringify({ at: new Date().toISOString(), base: BASE, health: h, env, ocr: o, asistan: out, sonuc: res }, null, 2));
  process.exit(res.some(x => x.startsWith('BAŞARISIZ')) ? 1 : 0);
})().catch(e => { console.error('HATA', e.message); process.exit(1); });
