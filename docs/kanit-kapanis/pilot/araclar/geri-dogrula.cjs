// Geri yükleme tatbikatı: kaynak (8091) ile geri yüklenen ortamdan (8096) kanıt dosyalarını API'den indirip özetlerini karşılaştırır.
const crypto = require('crypto'); const { execSync } = require('child_process');
const mk = base => { process.env.WEB = base; };
const reqAt = async (base, m, p, token) => { const r = await fetch(base + '/api' + p, { method: m, headers: Object.assign({ 'content-type': 'application/json', 'idempotency-key': 'k-' + crypto.randomUUID() }, token ? { authorization: 'Bearer ' + token } : {}), body: m === 'POST' ? JSON.stringify(arguments[4] || {}) : undefined }); return r; };
const call = async (base, m, p, token, body) => fetch(base + '/api' + p, { method: m, headers: Object.assign({ 'idempotency-key': 'k-' + crypto.randomUUID() }, body ? { 'content-type': 'application/json' } : {}, token ? { authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
const login = async (base, email) => {
  await call(base, 'POST', '/auth/email/start', null, { email });
  const o = await (await call(base, 'GET', '/dev/outbox/latest?email=' + encodeURIComponent(email))).json();
  const code = (o.body.match(/\b\d{6}\b/) || [])[0];
  return (await (await call(base, 'POST', '/auth/email/verify', null, { email, code })).json()).token;
};
const sql = q => execSync(`docker exec goverhub-geri-db-1 psql -U postgres -d goverhub_demo -Atc "${q}"`).toString().trim().split('\n').filter(Boolean);
(async () => {
  const rows = sql("select e.id||'|'||e.company_id||'|'||e.sha256||'|'||coalesce(e.task_id::text,'')||'|'||coalesce(e.document_version_id::text,'') from evidence e where e.status='stored' order by e.created_at desc limit 60");
  // her işletme için sahibi bul
  const out = { ornek: 0, esit: 0, farkli: [], eksik: [], gorevAcildi: 0, belgeAcildi: 0 };
  const tok = {}; const owners = {};
  for (const r of rows) {
    const [id, comp, sha, task, dv] = r.split('|');
    if (!owners[comp]) { const o = sql(`select u.email from users u join memberships m on m.user_id=u.id where m.company_id='${comp}' and m.role='owner' and u.email like '%@demo.goverhub.test' limit 1`)[0]; owners[comp] = o; }
    if (!owners[comp]) continue;
    for (const [nm, base] of [['kaynak', 'http://localhost:8091'], ['geri', 'http://localhost:8096']]) { const k = nm + comp; if (!tok[k]) tok[k] = await login(base, owners[comp]); }
    out.ornek++;
    const get = async (base, t) => { const x = await call(base, 'GET', `/companies/${comp}/evidence/${id}/content`, t); if (!x.ok) return { status: x.status }; return { status: 200, h: crypto.createHash('sha256').update(Buffer.from(await x.arrayBuffer())).digest('hex') }; };
    const a = await get('http://localhost:8091', tok['kaynak' + comp]); const b = await get('http://localhost:8096', tok['geri' + comp]);
    if (b.status !== 200) out.eksik.push({ id, kaynak: a.status, geri: b.status });
    else if (b.h === sha && a.h === sha) out.esit++; else out.farkli.push({ id, kaynak: a.h, geri: b.h, kayit: sha });
    if (task && out.gorevAcildi < 5) { const t = await call('http://localhost:8096', 'GET', `/companies/${comp}/tasks/${task}`, tok['geri' + comp]); if (t.ok) out.gorevAcildi++; }
    if (dv && out.belgeAcildi < 5) { const d = sql(`select document_id from document_versions where id='${dv}'`)[0]; const t = await call('http://localhost:8096', 'GET', `/companies/${comp}/documents/${d}`, tok['geri' + comp]); if (t.ok) out.belgeAcildi++; }
  }
  console.log(JSON.stringify(out, null, 1));
  require('fs').writeFileSync(process.argv[2] || 'geri-dogrula.json', JSON.stringify(out, null, 1));
  process.exit(out.eksik.length || out.farkli.length || out.ornek === 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
