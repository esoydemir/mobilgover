/**
 * SENTETİK resmî-gibi kaynak sunucusu (yalnız doğrulama içindir; hiçbir gerçek mevzuat içermez).
 * Resmî Gazete biçiminde fihrist/belge sayfaları ve Mevzuat biçiminde birleştirilmiş metin sunar.
 * Adresi resmî olmadığı için sunucu bu kaynaktan gelen her kaydı ÖRNEK sayar.
 *
 *   node e2e/mevzuat-sentetik-kaynak.cjs 8199
 * Denetim uçları (yalnız bu yerel süreç): POST /ctl/publish {day,item}, POST /ctl/down {down:true|false}, POST /ctl/consolidated {key,title,articles}
 */
const http = require('http');
const days = new Map(); // day -> items
const consolidated = new Map(); // "tur.tertip.no" -> {title, articles}
let down = false;
let fail = null; // null | 'pdf' | 'robot' | 'blocked' | 'empty'
const port = Number(process.argv[2] || 8199);

const page = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); };
http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/ctl/')) {
    let raw = ''; req.on('data', c => (raw += c)); req.on('end', () => {
      const b = raw ? JSON.parse(raw) : {};
      if (url.pathname === '/ctl/publish') days.set(b.day, [...(days.get(b.day) ?? []), b.item]);
      else if (url.pathname === '/ctl/down') down = !!b.down;
      else if (url.pathname === '/ctl/fail') fail = b.mode || null;
      else if (url.pathname === '/ctl/consolidated') consolidated.set(b.key, { title: b.title, articles: b.articles });
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, down }));
    });
    return;
  }
  if (down) { res.destroy(); return; }
  if (fail === 'pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end('%PDF-1.7 ' + 'x'.repeat(400)); return; }
  if (fail === 'robot') return page(res, '<html><body><h1>Access Denied</h1><p>Request blocked. ' + 'x '.repeat(80) + '</p></body></html>');
  if (fail === 'blocked') return page(res, 'yasak', 403);
  if (fail === 'empty') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(); return; }
  const idx = /^\/rg\/fihrist$/.exec(url.pathname);
  if (idx) {
    const items = days.get(url.searchParams.get('tarih')) ?? [];
    const by = new Map();
    for (const it of items) by.set(it.category, [...(by.get(it.category) ?? []), it]);
    const body = [...by].map(([cat, xs]) => `<div class="card-title html-title" tabindex='0'> YÜRÜTME VE İDARE BÖLÜMÜ </div><div class="html-subtitle" tabindex='0'> ${cat} </div>` +
      xs.map(x => `<div class="fihrist-item mb-1"><a href="${url.origin}/rg/eskiler/${x.id}.htm" data-modal="True">${x.title}</a></div>`).join('')).join('');
    return page(res, `<div id="gunluk-akis"><div id="html-content" class="html-content">${body}</div></div>`);
  }
  const det = /^\/rg\/eskiler\/([\w-]+)\.htm$/.exec(url.pathname);
  if (det) {
    for (const items of days.values()) {
      const it = items.find(x => x.id === det[1]);
      if (it) return page(res, `<html><body><div>Resmî Gazete</div><div>Sayı : ${it.sayi ?? 99001}</div><div>YÖNETMELİK</div><div>Sentetik Bakanlığından:</div><div>${it.title}</div>` + it.articles.map((a, i) => `<p>MADDE ${i + 1}- ${a}</p>`).join('') + '</body></html>');
    }
    return page(res, 'yok', 404);
  }
  if (url.pathname.startsWith('/mv') || url.pathname.includes('MevzuatMetin')) {
    const q = url.searchParams;
    const d = consolidated.get(`${q.get('MevzuatTur')}.${q.get('MevzuatTertip')}.${q.get('MevzuatNo')}`);
    if (!d) return page(res, 'yok', 404);
    return page(res, `<body><p><b>${d.title}</b></p>` + Object.entries(d.articles).map(([id, t]) => `<p><b>MADDE ${id}-</b> ${t}</p>`).join('') + '</body>');
  }
  page(res, 'yok', 404);
}).listen(port, '0.0.0.0', () => console.log(`Sentetik kaynak ${port} portunda`));
