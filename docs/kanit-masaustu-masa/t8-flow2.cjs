// Devam: inceleyici onaylar; yetkisiz hesaplar ve yönetici (onay rolü yok) aynı kararı veremez. SENTETİK.
const { chromium, OUT, URL, q, login, api, txt } = require('./leg-lib.cjs'); const fs = require('fs'); const T = 'C:/Users/gkhno/AppData/Local/Temp/';
const ids = JSON.parse(fs.readFileSync(T + 't7-weekly.json')); const id = '1f912c99-ba68-477e-9dcd-62ff3a02ce2e'; const sites = { emlakA: ids.estate.A, emlakB: ids.estate.B, market: ids.market.S, elektrik: ids.elektrik.S };
const snap = () => { const o = {}; for (const [k, s] of Object.entries(sites)) o[k] = `gorev=${q(`SELECT count(*) FROM tasks WHERE site_id='${s}'`)} bildirim=${q(`SELECT count(*) FROM notifications WHERE site_id='${s}'`)}`; return o; };
const pn = (W, s) => `${OUT}/${W}-${s}.png`; const mk = async b => { const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(); p.on('pageerror', e => console.log('PAGEERROR', e.message)); return p; };
(async () => {
  const b = await chromium.launch(); const alanId = q(`SELECT id FROM users WHERE email='alan-uzmani@demo.goverhub.test'`);
  q('delete from login_challenges'); const R = await mk(b); await login(R, 'alan-uzmani@demo.goverhub.test'); await R.goto(URL + '/legislation'); await R.waitForTimeout(2500);
  await R.getByTestId('leg-quick-mine').first().click(); await R.waitForTimeout(1200); await R.getByTestId(`leg-row-${id}`).first().click(); await R.waitForTimeout(2000);
  await R.getByTestId('leg-reason').first().fill('Resmî kaynak okundu; sözleşmeli emlak şubesi kapsamda, ayın son günü seçimi örnek senaryodur.'); await R.waitForTimeout(500);
  await R.screenshot({ path: pn('r', '3b-gerekce-yazarken-karar-dugmesi-gorunur') });
  console.log('KARAR ONCESI:', (await R.getByTestId('leg-decision').first().innerText()).split('\n').join(' | ').slice(0, 500));
  await R.getByTestId('leg-approve').first().click(); await R.waitForTimeout(2800); await R.screenshot({ path: pn('r', '4-onaylandi') });
  console.log('DURUM:', q(`SELECT status||' apply_on='||coalesce(apply_on::text,'-')||' onaylayan='||(SELECT display_name FROM users WHERE id=approved_by) FROM legislation_changes WHERE id='${id}'`));
  console.log('KARAR SONRASI SIRA:', await R.getByTestId('leg-scheduled').first().innerText().catch(() => '?'));
  console.log('ONAYDAN SONRA, YURURLUKTEN ONCE:', JSON.stringify(snap()), '(onceki: emlakA gorev=8 bildirim=1, digerleri 0/0)');
  for (const em of ['pazar@demo.goverhub.test', 'moderator@demo.goverhub.test']) {
    q('delete from login_challenges'); const U = await mk(b); await login(U, em); await U.goto(URL + '/legislation'); await U.waitForTimeout(2500);
    const a1 = await api(U, 'POST', `/admin/legislation/changes/${id}/approve`, { reason: 'Yetkisiz deneme' }), a2 = await api(U, 'POST', `/admin/legislation/changes/${id}/assign`, { userId: alanId, reason: 'Yetkisiz deneme' }), a3 = await api(U, 'POST', '/admin/reviewer-areas', { userId: alanId, area: 'consumer', grant: true, reason: 'Yetkisiz deneme yetki', changeId: id });
    console.log('YETKISIZ', em, '| ekran:', (await txt(U)).slice(0, 110), '| onay', a1.status, '| atama', a2.status, '| alan yetkisi', a3.status); if (em.startsWith('pazar')) await U.screenshot({ path: pn('u', '1-yetkisiz') });
  }
  q('delete from login_challenges'); const A = await mk(b); await login(A, 'yonetici@demo.goverhub.test'); const Ya = await api(A, 'POST', `/admin/legislation/changes/${id}/approve`, { reason: 'Yönetici onay denemesi' }); console.log('YONETICI ONAY DENEMESI (onaylayıcı rolü yok):', Ya.status, JSON.stringify(Ya.body).slice(0, 140));
  console.log('YETKISIZ DENEMELER SONRASI DURUM:', q(`SELECT status FROM legislation_changes WHERE id='${id}'`), JSON.stringify(snap()));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
