// İzole SENTETİK örnek veri: pazar başvuruları, moderasyon şikâyetleri, bir atanmış mevzuat kaydı, tüm rollü hesap.
const { chromium, q, login, api } = require('./leg-lib.cjs');
(async () => {
  const b = await chromium.launch(); const pg = async em => { q('delete from login_challenges'); const p = await (await b.newContext({ viewport: { width: 412, height: 839 } })).newPage(); await login(p, em); return p; };
  for (const [em, name, cat] of [['pro1.t9@demo.goverhub.test', 'Usta Ali (sentetik)', 'refrigeration_service'], ['pro2.t9@demo.goverhub.test', 'Gazcı Veli (sentetik)', 'gas_installation_check']]) {
    const p = await pg(em); console.log(name, (await api(p, 'POST', '/pro/profile', { kind: 'individual', displayName: name, headline: 'Teknik servis', city: 'İstanbul' })).status,
      (await api(p, 'POST', '/pro/verifications', { kind: 'identity', issuer: 'T.C. kimlik', documentRef: 'K-' + em.slice(0, 4) })).status, (await api(p, 'POST', '/pro/authorizations', { categoryCode: cat })).status);
  }
  const rep = await pg('sikayetci.t9@demo.goverhub.test'); void rep;
  const uid = q(`select id from users where email='sikayetci.t9@demo.goverhub.test'`);
  for (const [r, iv] of [['spam', '2 hours'], ['misleading', '1 day'], ['harassment', '3 days']]) q(`insert into network_reports (reporter_id, target_type, target_id, reason, details, created_at) values ('${uid}','post',gen_random_uuid(),'${r}','Sentetik şikâyet', now() - interval '${iv}')`);
  const all = await pg('tum-roller.t9@demo.goverhub.test'); void all; const tid = q(`select id from users where email='tum-roller.t9@demo.goverhub.test'`);
  for (const r of ['platform_admin', 'marketplace_reviewer', 'network_moderator']) q(`insert into platform_roles values ('${tid}','${r}') on conflict do nothing`);
  const alan = q(`select id from users where email='alan-uzmani@demo.goverhub.test'`); const one = q(`select id from legislation_changes where status='pending' order by detected_at limit 1`);
  q(`update legislation_changes set assigned_to='${alan}', assigned_at=now() where id='${one}'`);
  console.log('mevzuat acik', q(`select count(*) from legislation_changes where status in ('pending','drafted')`), 'sahipsiz', q(`select count(*) from legislation_changes where status in ('pending','drafted') and assigned_to is null`), 'rapor', q(`select count(*) from network_reports where status='open'`), 'pazar', q(`select (select count(*) from professional_verifications where status='pending')||'/'||(select count(*) from service_authorizations where status='pending')`));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
