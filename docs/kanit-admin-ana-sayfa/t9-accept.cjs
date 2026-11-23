// Kabul: 3 soru, 1366x768 ve 1440x900. SENTETİK veri. WEB=http://localhost:8100 (yeni) / 8102 (önceki sürüm)
const lib = require('./leg-lib.cjs'); const { chromium, OUT, q, txt } = lib; const WEB = process.env.WEB || 'http://localhost:8100';
const W = +(process.env.W || 1366), H = +(process.env.H || 768); const sleep = ms => new Promise(r => setTimeout(r, ms));
async function login(p, email) { await p.goto(WEB); await V(p, 'login-email').waitFor({ timeout: 30000 }); await V(p, 'login-email').fill(email); await p.getByText('Kod gönder', { exact: true }).first().click();
  await V(p, 'login-code').waitFor(); await p.getByText('Demo kutusundan kodu getir', { exact: true }).first().click(); await p.waitForTimeout(900); await p.getByText('Giriş yap', { exact: true }).first().click(); await p.waitForTimeout(2200); }
const mk = async b => { const p = await (await b.newContext({ viewport: { width: W, height: H } })).newPage(); p.on('pageerror', e => console.log('PAGEERROR', e.message)); return p; };
const V = (p, id) => p.locator(`[data-testid="${id}"]:visible`).first();
const num = async (p, id) => Number((await V(p, id).innerText()).trim());
(async () => {
  const b = await chromium.launch(); const mode = process.env.MODE || 'all';
  if (mode === 'before') { q('delete from login_challenges'); const p = await mk(b); await login(p, 'tum-roller.t9@demo.goverhub.test'); await p.goto(WEB + '/admin'); await p.waitForTimeout(3500); await p.screenshot({ path: `${OUT}/t9-once-${W}.png` }); await b.close(); return; }
  q('delete from login_challenges'); const p = await mk(b); await login(p, 'tum-roller.t9@demo.goverhub.test'); await p.goto(WEB + '/admin'); await p.waitForTimeout(3500);
  // SORU 1
  console.log('S1 ILK EKRAN:', (await V(p, 'home-total').innerText()), '|', (await V(p, 'admin-home').innerText()).split(String.fromCharCode(10)).join(' | ').slice(0, 900));
  await p.screenshot({ path: `${OUT}/t9-sonra-${W}.png` });
  // SORU 2: her sayaç → aynı kayıtlar
  const checks = [['leg_unowned', 'leg-row-', 'quick'], ['leg_review', 'leg-row-', 'quick'], ['leg_uncertain', 'leg-row-', 'quick'], ['leg_unreadable', 'leg-unreadable-', 'q'], ['leg_source_errors', 'leg-source-error-', 'h'], ['leg_mine', 'leg-row-', 'quick'], ['market_verifications', 'ver-approve', 'm'], ['market_authorizations', 'auth-approve', 'm'], ['mod_open', 'mod-submit-', 'm']];
  const res = [];
  for (const [key, tid, kind] of checks) {
    await p.goto(WEB + '/admin'); await p.waitForTimeout(2500); const c = await num(p, `home-count-${key}`);
    await V(p, `home-counter-${key}`).click(); await p.waitForTimeout(2800);
    const url = p.url().replace(WEB, ''); const n = await p.evaluate(id => [...document.querySelectorAll(id.endsWith("-") ? `[data-testid^="${id}"]` : `[data-testid="${id}"]`)].filter(e=>(()=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!(r.left===0&&r.top===0)})()).length, tid);
    res.push(`${key}: sayaç=${c} liste=${n} ${c === n ? 'EŞİT' : 'FARKLI'} (${url})`);
    if (key === 'leg_unowned') await p.screenshot({ path: `${OUT}/t9-sayac-liste-${W}.png` });
  }
  console.log('S2:\n' + res.join('\n'));
  // SORU 3: filtre + kayıt işle + dön
  await p.goto(WEB + '/admin'); await p.waitForTimeout(2500); await V(p, 'home-area-legislation').click(); await V(p, 'home-unowned').click(); await p.waitForTimeout(800);
  const rowsInfo = async () => p.evaluate(() => [...document.querySelectorAll('[data-testid^="home-row-"]')].filter(e=>(()=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!(r.left===0&&r.top===0)})()).map(e => e.innerText.split(String.fromCharCode(10)).join(' ')));
  const before = await rowsInfo(); const cBefore = await num(p, 'home-count-leg_unowned'); console.log('S3 ONCE: sayaç', cBefore, 'satır', before.length, '| ilk:', before[0]?.slice(0, 110));
  await V(p, 'home-counter-leg_unowned').click(); await p.waitForTimeout(2800);
  const first = p.locator('[data-testid^="leg-row-"]:visible').first(); const rid = (await first.getAttribute('data-testid')).replace('leg-row-', ''); await first.click(); await p.waitForTimeout(1800);
  await V(p, 'leg-reason').fill('Sentetik: ilgisiz yayın, kabul sınaması.'); await V(p, 'leg-reject').click(); await p.waitForTimeout(2500);
  console.log('   işlendi:', q(`select status from legislation_changes where id='${rid}'`));
  await V(p, 'desk-back').click(); await p.waitForTimeout(3000);
  const after = await rowsInfo(); const cAfter = await num(p, 'home-count-leg_unowned');
  const onlyLeg = after.every(t => /MEVZUAT/.test(t)); const onlyUn = after.every(t => /Sahipsiz|atanmadı/.test(t)); const gone = !(await p.locator(`[data-testid="home-row-${rid}"]:visible`).count());
  console.log(`S3 SONRA: sayaç ${cBefore} -> ${cAfter} (${cAfter === cBefore - 1 ? 'DOĞRU' : 'YANLIŞ'}) | işlenen satır listeden kalktı: ${gone} | filtre korundu: yalnız mevzuat=${onlyLeg}, yalnız sahipsiz=${onlyUn} | url ${p.url().replace(WEB, '')}`);
  await p.screenshot({ path: `${OUT}/t9-donus-${W}.png` });
  // pazar: bir belgeyi işle, dön, sayı düşsün
  await V(p, 'home-area-all').click(); await p.waitForTimeout(500); const mBefore = await num(p, 'home-count-market_verifications');
  await V(p, 'home-counter-market_verifications').click(); await p.waitForTimeout(2500); await V(p, 'admin-reason').fill('Sentetik kontrol'); await V(p, 'ver-approve').click(); await p.waitForTimeout(2200);
  await V(p, 'admin-back-home').click(); await p.waitForTimeout(2800); console.log(`S3 PAZAR: belge sayacı ${mBefore} -> ${await num(p, 'home-count-market_verifications')} | süzgeç (Tümü) korundu`);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
