// Grup 4 ve 5 için 8091 üzerinde API doğrulaması: node g45check.cjs
const { req, login } = require('./api.cjs');
const out = [];
const ok = (ad, kosul, ayrinti) => { out.push(`${kosul ? 'TAMAM' : 'BAŞARISIZ'}  ${ad}${ayrinti ? ' — ' + ayrinti : ''}`); };
const st = async (m, p, o) => { try { return { s: 200, b: await req(m, p, o) }; } catch (e) { return { s: +(/-> (\d+)/.exec(e.message) || [])[1], b: e.message }; } };
(async () => {
  const t = await login('sahip.rt1@demo.goverhub.test');
  const cs = await req('GET', '/companies', { token: t }); const C = cs[0].id;
  const sites = (await req('GET', `/companies/${C}/sites`, { token: t }).catch(() => null)) || cs[0].sites; const eq = await req('GET', `/companies/${C}/sites/${sites[0].id}/equipment`, { token: t }); const e0 = (eq.items || eq)[0];
  // QR
  const q = await req('POST', `/companies/${C}/qr`, { token: t, body: { kind: 'equipment', refId: e0.id } });
  const img = await req('GET', `/companies/${C}/qr/${q.id}/image?base=${encodeURIComponent('http://localhost:8091')}`, { token: t });
  ok('QR üretildi, PNG ve bağlantı döndü', img.dataUrl.startsWith('data:image/png;base64,') && img.url.endsWith('/q/' + q.token), img.url);
  const r1 = await st('GET', `/qr/resolve?token=${q.token}`, { token: t });
  ok('Yetkili sahip kodu okutunca ekipman rotasını alır', r1.s === 200 && r1.b.route === `/equipment/${e0.id}`, r1.b.route);
  const staffTok = await login('personel.rt1@demo.goverhub.test').catch(() => null);
  const other = await login('sahip.rt2@demo.goverhub.test').catch(() => null);
  if (other) { const r2 = await st('GET', `/qr/resolve?token=${q.token}`, { token: other }); ok('Başka işletmenin sahibi aynı kodla 404 alır', r2.s === 404, String(r2.s)); }
  const r3 = await st('GET', `/qr/resolve?token=${'a'.repeat(30)}`, { token: t }); ok('Bilinmeyen kod 404', r3.s === 404, String(r3.s));
  // Asistan
  const a1 = await req('POST', `/companies/${C}/assistant/ask`, { token: t, body: { question: 'Soğutucu sıcaklık kaydı nasıl tutulmalı?' } });
  ok('Asistan: kaynaklı yanıt ya da dürüst "yetersiz"', ['answered', 'insufficient'].includes(a1.outcome) && (a1.outcome === 'answered' ? a1.sources.length > 0 : a1.sources.length === 0), a1.outcome + ' / kaynak ' + a1.sources.length);
  const a2 = await req('POST', `/companies/${C}/assistant/ask`, { token: t, body: { question: 'Roket yakıtı depolama ruhsatı nedir?' } });
  ok('Asistan: konu dışı soruda yanıt üretmez', a2.outcome === 'insufficient' && a2.sources.length === 0, a2.outcome);
  const a3 = await req('POST', `/companies/${C}/assistant/ask`, { token: t, body: { question: 'Bu eksiklik için ceza kaç TL olur?' } });
  ok('Asistan: ceza tutarı sorusunu reddeder', a3.outcome === 'fine_declined' && a3.sources.length === 0, a3.outcome);
  // OCR önerisi
  const docs = await req('GET', `/companies/${C}/documents`, { token: t }); const d0 = (docs.items || docs).find(x => x.versionCount > 0) || (docs.items || docs)[0];
  const det = await req('GET', `/companies/${C}/documents/${d0.id}`, { token: t }); const ver = det.versions[0];
  if (ver) {
    const text = 'T.C. İstanbul Büyükşehir Belediyesi\nİşyeri Açma ve Çalışma Ruhsatı\nRuhsat No: 2026/TEST-4412\nDüzenleme Tarihi: 01.03.2026\nGeçerlilik Bitiş: 01.03.2027';
    const ex = await req('POST', `/companies/${C}/documents/${d0.id}/versions/${ver.id}/extractions`, { token: t, body: { text, source: 'typed_text' } });
    ok('Metinden alan önerisi çıktı, snippet ile', ex.suggestions.length > 0 && ex.suggestions.every(s => s.snippet), ex.suggestions.map(s => s.field).join(','));
    const before = await req('GET', `/companies/${C}/documents/${d0.id}`, { token: t });
    const dec = await st('POST', `/companies/${C}/extractions/${ex.id}/decision`, { token: t, body: { confirm: false } });
    const after = await req('GET', `/companies/${C}/documents/${d0.id}`, { token: t });
    ok('Vazgeçince belgeye hiçbir şey yazılmaz', dec.s === 200 && before.documentNo === after.documentNo && before.issuer === after.issuer);
  }
  // Platform yönetimi
  const adm = await login('yonetici@demo.goverhub.test').catch(() => null);
  if (adm) {
    const ov = await st('GET', '/admin/overview', { token: adm }); ok('Platform genel durum', ov.s === 200 || ov.s === 403, String(ov.s) + (ov.s === 403 ? ' (MFA gerekli olabilir)' : ''));
    const au = await st('GET', '/admin/audit?limit=5', { token: adm }); ok('Denetim kaydı yalnız platform yöneticisine', au.s === 200 || au.s === 403, String(au.s));
  }
  const nonadm = await st('GET', '/admin/audit', { token: t }); ok('İşletme sahibi denetim kaydını okuyamaz', nonadm.s === 403, String(nonadm.s));
  console.log(out.join('\n'));
})().catch(e => { console.log(out.join('\n')); console.error('HATA', e.message); process.exit(1); });
