/**
 * Delivery 6 — scenario 5 directly against the running local demo server (HTTP through the proxy,
 * no app screens): an unapproved specialist, a changed case draft, a withdrawn post, an outside
 * verifier whose grant was revoked, and a moderator without the right (or deciding their own case).
 *
 *   node e2e/sunucu-6.cjs <yerel-demo folder>
 */
const { execSync } = require('child_process');
const WEB = process.env.WEB || 'http://localhost:8080', DIR = process.argv[2];
const dc = cmd => execSync(`docker compose -p goverhub-demo ${cmd}`, { cwd: DIR }).toString().trim();
const sql = q => dc(`exec -T db psql -U postgres -d goverhub_demo -tAc "${q.replace(/"/g, '\\"')}"`);
const RUN = `h${Date.now().toString(36)}`;
const T = JSON.parse(dc(`exec -T app node node_modules/tsx/dist/cli.mjs src/seed/test-business.ts ${RUN}`).split('\n').pop());
const CO = T.companyId, E = T.emails, C = `/companies/${CO}`;
// Shared demo accounts sign in on every run; their old login codes (not business records) are cleared.
sql(`DELETE FROM login_challenges WHERE email = 'moderator@demo.goverhub.test'`);
let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'GEÇTİ ' : 'KALDI '} ${label}${ok ? '' : ` ${extra}`}`); };
const later = h => new Date(Date.now() + h * 3600_000).toISOString();

async function call(token, method, url, body) {
  const r = await fetch(`${WEB}/api${url}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : null };
}
async function login(email) {
  await call(null, 'POST', '/auth/email/start', { email });
  const mail = (await call(null, 'GET', `/dev/outbox/latest?email=${encodeURIComponent(email)}`)).body;
  const code = String(mail.body).match(/\b(\d{6})\b/)[1];
  const r = await call(null, 'POST', '/auth/email/verify', { email, code });
  return r.body.token;
}

(async () => {
  console.log(`Çalıştırma ${RUN} · işletme ${CO}`);
  const owner = await login(E.owner), manager = await login(E.manager), staff = await login(E.staff);
  const mod = await login('moderator@demo.goverhub.test');

  // 1. Unapproved specialist: a professional profile without a category approval.
  await call(staff, 'POST', '/pro/profile', { kind: 'individual', displayName: `Onaysız Usta ${RUN}`, headline: 'Soğutma', city: 'İstanbul', bio: 'Onayı yok.' });
  const pp = sql(`SELECT pp.id FROM professional_profiles pp JOIN users u ON u.id = pp.user_id WHERE u.email = '${E.staff}'`);
  const direct = await call(owner, 'POST', `${C}/service-requests`, { siteId: T.siteId, categoryCode: 'refrigeration_service', title: 'Dolap', description: 'Dolap soğutmuyor.', city: 'İstanbul', invitedProfileId: pp });
  check('Onaysız uzmana doğrudan talep sunucuda reddediliyor', direct.body?.error?.code === 'PROVIDER_NOT_APPROVED_FOR_CATEGORY', JSON.stringify(direct.body));
  const open = (await call(owner, 'POST', `${C}/service-requests`, { siteId: T.siteId, categoryCode: 'refrigeration_service', title: 'Dolap', description: 'Dolap soğutmuyor.', city: 'İstanbul' })).body.id;
  const q = await call(staff, 'POST', `/pro/requests/${open}/quotes`, { scope: 'Bakım yapılır', exclusions: 'Parça', priceNet: 100, vatRate: 20, materials: 'Yok', durationText: '1 saat', warrantyText: '1 ay', validUntil: later(48), deliverable: 'Rapor' });
  check('Onaysız uzman teklif veremiyor (talep onu için yok sayılıyor)', q.status === 404, JSON.stringify(q.body));

  // 2–3. Case share: changed draft needs a new permission; withdrawal closes it.
  await call(owner, 'POST', '/network/profile', { displayName: `Ahmet ${RUN}`, city: 'İstanbul' });
  await call(mod, 'POST', '/network/profile', { displayName: 'Moderatör', city: 'İstanbul' });
  const ncr = (await call(manager, 'POST', `${C}/nonconformities`, { siteId: T.siteId, title: 'Soğutucu sıcak', description: 'Test kaydı.', hazardType: 'cold_chain_temperature', severity: 'major', containment: 'Ürün taşındı.' })).body.id;
  const post = (await call(owner, 'POST', `${C}/nonconformities/${ncr}/share`, { fields: ['hazard', 'risk'], summary: 'Conta yırtılınca sıcaklık hızla yükseliyor; haftalık kontrol işe yaradı.', permit: true })).body.postId;
  await call(owner, 'POST', `/network/posts/${post}`, { op: 'publish' });
  check('Yayımlanan vaka başkasına açık', (await call(mod, 'GET', `/network/posts/${post}`)).status === 200);
  await call(owner, 'POST', `/network/posts/${post}`, { body: 'Conta yırtılınca sıcaklık hızla yükseliyor; haftalık kontrol ve yedek conta işe yaradı.' });
  check('Metni değişen vaka ağdan kalktı', (await call(mod, 'GET', `/network/posts/${post}`)).status === 404);
  const re = await call(owner, 'POST', `/network/posts/${post}`, { op: 'publish' });
  check('Yeniden onay olmadan yayımlanamıyor', re.body?.error?.code === 'CASE_REAPPROVAL_NEEDED', JSON.stringify(re.body));
  check('Şube yöneticisi yeniden onay veremiyor', (await call(manager, 'POST', `${C}/network/case-posts/${post}/approve`, { permit: true })).status === 403);
  await call(owner, 'POST', `${C}/network/case-posts/${post}/approve`, { permit: true });
  await call(owner, 'POST', `/network/posts/${post}`, { op: 'publish' });
  await call(owner, 'POST', `${C}/network/case-posts/${post}/withdraw`, { reason: 'Kayıt yeniden açıldı; paylaşım erken.' });
  check('Geri çekilen yayına ağdan erişim kapalı (gönderi, yorum)', (await call(mod, 'GET', `/network/posts/${post}`)).status === 404
    && (await call(mod, 'POST', `/network/posts/${post}/comments`, { body: 'Teşekkürler' })).status === 404);

  // 4. Outside verifier whose grant is revoked.
  await call(owner, 'POST', `${C}/verifiers`, { email: E.verifier, days: 7, note: 'Yalnız bu kayıt', ncrIds: [ncr] });
  const ver = await login(E.verifier);
  check('Davetli dış doğrulayıcı kendi kaydını açıyor', (await call(ver, 'GET', `${C}/nonconformities/${ncr}`)).status === 200);
  const g = (await call(owner, 'GET', `${C}/verifiers`)).body.find(x => (x.email ?? x.user_email) === E.verifier) ?? (await call(owner, 'GET', `${C}/verifiers`)).body[0];
  await call(owner, 'POST', `${C}/verifiers/${g.id}/revoke`, { reason: 'Doğrulama tamamlandı.' });
  check('İzni kaldırılan doğrulayıcı aynı oturumla kayda erişemiyor', (await call(ver, 'GET', `${C}/nonconformities/${ncr}`)).status === 404);

  // 5. Moderator rights.
  check('Moderatör olmayan şikâyet kuyruğunu göremiyor', (await call(staff, 'GET', '/network/moderation/reports')).status === 403);
  const bad = (await call(owner, 'POST', '/network/posts', { body: `Bu kural yasal zorunluluktur ${RUN}.`, publish: true })).body.id;
  const rep = (await call(mod, 'POST', '/network/reports', { targetType: 'post', targetId: bad, reason: 'misleading', details: 'Kaynak yok.' })).body.id;
  const self = await call(mod, 'POST', `/network/moderation/reports/${rep}`, { decision: 'hide', notes: 'Kendi şikâyetimi karara bağlıyorum.' });
  check('Moderatör kendi şikâyetini karara bağlayamıyor', self.status === 403, JSON.stringify(self.body));
  const own = sql(`SELECT count(*) FROM network_reports WHERE id = '${rep}' AND status = 'open'`);
  check('Şikâyet açık kaldı', own === '1');

  console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı`);
  if (fail) process.exit(1);
})().catch(e => { console.error('HATA:', e.message); console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı (yarıda kesildi)`); process.exit(1); });
