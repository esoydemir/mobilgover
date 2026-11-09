/**
 * Scenario 6 — local upgrade with older-version data.
 *   node e2e/yukseltme-6.cjs yaz  <yerel-demo folder> <project>   (on the OLD version: create records, save snapshot)
 *   node e2e/yukseltme-6.cjs oku  <yerel-demo folder> <project>   (on the NEW version: open the same records, compare)
 * The snapshot is written next to the folder (yukseltme-onceki.json).
 */
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [MODE, DIR, PROJ] = process.argv.slice(2);
const WEB = process.env.WEB || 'http://localhost:8080';
const SNAP = path.join(DIR, '..', '..', 'yukseltme-onceki.json');
const dc = cmd => execSync(`docker compose -p ${PROJ} ${cmd}`, { cwd: DIR }).toString().trim();
const sql = q => dc(`exec -T db psql -U postgres -d goverhub_demo -tAc "${q.replace(/"/g, '\\"')}"`);
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'GEÇTİ ' : 'KALDI '} ${label}${ok ? '' : ` ${extra}`}`); };

async function call(token, method, url, body, raw) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (body && !raw) headers['content-type'] = 'application/json';
  if (raw) headers['content-type'] = 'image/jpeg';
  const r = await fetch(`${WEB}/api${url}`, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) return { status: r.status, body: await r.json(), headers: r.headers };
  return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()), headers: r.headers };
}
async function login(email) {
  sql(`DELETE FROM login_challenges WHERE email = '${email}'`);
  await call(null, 'POST', '/auth/email/start', { email });
  const mail = (await call(null, 'GET', `/dev/outbox/latest?email=${encodeURIComponent(email)}`)).body;
  const code = String(mail.body).match(/\b(\d{6})\b/)[1];
  return (await call(null, 'POST', '/auth/email/verify', { email, code })).body.token;
}
const COUNTS = `SELECT (SELECT count(*) FROM companies)||'|'||(SELECT count(*) FROM users)||'|'||(SELECT count(*) FROM tasks)||'|'||(SELECT count(*) FROM evidence)||'|'||(SELECT count(*) FROM nonconformities)||'|'||(SELECT count(*) FROM ncr_actions)||'|'||(SELECT count(*) FROM documents)||'|'||(SELECT count(*) FROM access_grants)||'|'||(SELECT count(*) FROM audit_events)||'|'||(SELECT count(*) FROM training_assignments)||'|'||(SELECT count(*) FROM network_posts)`;

async function read(snap) {
  const owner = await login(snap.owner), C = `/companies/${snap.companyId}`;
  const ncr = await call(owner, 'GET', `${C}/nonconformities/${snap.ncrId}`);
  const ev = await call(owner, 'GET', `${C}/evidence/${snap.evidenceId}/content`);
  const docs = await call(owner, 'GET', `${C}/documents`);
  const post = await call(owner, 'GET', `/network/posts/${snap.postId}`);
  const doc = await call(owner, 'GET', `${C}/documents/${snap.docId}`);
  const dfile = await call(owner, 'GET', `${C}/evidence/${snap.docEvidenceId}/content`);
  return {
    ncrStatus: ncr.status, ncrTitle: ncr.body?.title, ncrState: ncr.body?.status,
    evStatus: ev.status, evSha: ev.bytes ? crypto.createHash('sha256').update(ev.bytes).digest('hex') : null,
    docCount: Array.isArray(docs.body) ? docs.body.length : (docs.body?.items ?? docs.body?.documents ?? []).length,
    postStatus: post.status, postBody: post.body?.body ?? post.body?.post?.body,
    docStatus: doc.status, docTitle: doc.body?.title, docVersions: (doc.body?.versions ?? []).length,
    docFileSha: dfile.bytes ? crypto.createHash('sha256').update(dfile.bytes).digest('hex') : null,
    counts: sql(COUNTS),
    auditHead: sql(`SELECT count(*)||':'||max(id::text) FROM audit_events WHERE company_id = '${snap.companyId}'`),
    migrations: sql(`SELECT count(*) FROM schema_migrations`).trim(),
  };
}

(async () => {
  if (MODE === 'yaz') {
    const RUN = `y${Date.now().toString(36)}`;
    const T = JSON.parse(dc(`exec -T app node node_modules/tsx/dist/cli.mjs src/seed/test-business.ts ${RUN}`).split('\n').pop());
    const C = `/companies/${T.companyId}`;
    const owner = await login(T.emails.owner), manager = await login(T.emails.manager);
    const ncr = await call(manager, 'POST', `${C}/nonconformities`, { siteId: T.siteId, title: `Güncelleme öncesi kayıt ${RUN} — Şişli soğuk oda ığdır çöğüş`, description: 'Eski sürümde açıldı.', hazardType: 'cold_chain_temperature', severity: 'major', containment: 'Ürün taşındı.' });
    check('Eski sürümde uygunsuzluk açıldı', ncr.status === 201, JSON.stringify(ncr.body));
    const taskId = sql(`SELECT id FROM tasks WHERE company_id = '${T.companyId}' AND status IN ('open','due','overdue','in_progress') ORDER BY due_at LIMIT 1`);
    const jpg = fs.readFileSync(process.env.JPG);
    const sha = crypto.createHash('sha256').update(jpg).digest('hex');
    const ev = await call(owner, 'POST', `${C}/tasks/${taskId}/evidence`, { kind: 'photo', mime: 'image/jpeg', sha256: sha, sizeBytes: jpg.length });
    const up = ev.body?.id ? await call(owner, 'PUT', `${C}/evidence/${ev.body.id}/content`, jpg, true) : { status: 0 };
    check('Eski sürümde fotoğraf kanıtı yüklendi', ev.status === 201 && up.status === 200, JSON.stringify([ev.status, ev.body, up.status, up.body]));
    const doc = await call(owner, 'POST', `${C}/documents`, { docType: 'business_license', title: `İşyeri açma ruhsatı ${RUN} — çok uzun başlık ğüşiöç`, siteId: T.siteId, issuer: 'Şişli Belediyesi', documentNo: 'R-2024/118' });
    const ver = doc.body?.id ? await call(owner, 'POST', `${C}/documents/${doc.body.id}/versions`, { validFrom: '2024-01-01', validUntil: '2027-01-01', notes: 'Eski sürümde yüklendi.', file: { mime: 'image/jpeg', sha256: sha, sizeBytes: jpg.length } }) : {};
    const dup = ver.body?.evidenceId ? await call(owner, 'PUT', `${C}/evidence/${ver.body.evidenceId}/content`, jpg, true) : { status: 0 };
    check('Eski sürümde belge ve dosyası yüklendi', doc.status === 201 && ver.status === 201 && dup.status === 200, JSON.stringify([doc.body, ver.body, dup.body]));
    await call(owner, 'POST', '/network/profile', { displayName: `Ahmet ${RUN}`, city: 'İstanbul' });
    const post = await call(owner, 'POST', '/network/posts', { body: `Eski sürümde yazılmış gönderi ${RUN}.`, publish: true });
    check('Eski sürümde ağ gönderisi yayımlandı', post.status === 201, JSON.stringify(post.body));
    const snap = { run: RUN, companyId: T.companyId, owner: T.emails.owner, ncrId: ncr.body.id, evidenceId: ev.body.id, evidenceSha: sha, postId: post.body.id, docId: doc.body.id, docEvidenceId: ver.body.evidenceId };
    snap.before = await read(snap);
    fs.writeFileSync(SNAP, JSON.stringify(snap, null, 2));
    console.log(JSON.stringify(snap.before, null, 2));
  } else {
    const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8')), a = await read(snap), b = snap.before;
    console.log(JSON.stringify(a, null, 2));
    check(`Göç sayısı arttı (${b.migrations} → ${a.migrations})`, Number(a.migrations) > Number(b.migrations));
    check('Eski uygunsuzluk açılıyor, başlık ve durum aynı (Türkçe karakterler dahil)', a.ncrStatus === 200 && a.ncrTitle === b.ncrTitle && a.ncrState === b.ncrState, JSON.stringify([a.ncrTitle, a.ncrState]));
    check('Eski fotoğraf kanıtı iniyor, içerik özeti aynı', a.evStatus === 200 && a.evSha === snap.evidenceSha);
    check('Eski belge açılıyor; başlık, sürüm sayısı ve dosyası aynı', a.docStatus === 200 && a.docTitle === b.docTitle && a.docVersions === b.docVersions && a.docFileSha === snap.evidenceSha, JSON.stringify([a.docStatus, a.docVersions, a.docFileSha]));
    check('Belge sayısı aynı', a.docCount === b.docCount && a.docCount > 0, `${b.docCount} → ${a.docCount}`);
    check('Eski ağ gönderisi açılıyor, metin aynı', a.postStatus === 200 && a.postBody === b.postBody);
    check('Kayıt sayıları aynı (işletme|kullanıcı|görev|kanıt|uygunsuzluk|aksiyon|belge|izin|denetim|eğitim|gönderi)', a.counts === b.counts, `${b.counts} → ${a.counts}`);
    check('Denetim geçmişi değişmedi (sayı ve son kayıt)', a.auditHead === b.auditHead, `${b.auditHead} → ${a.auditHead}`);
  }
  console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı`);
  if (fail) process.exit(1);
})().catch(e => { console.error('HATA:', e.message); process.exit(1); });
