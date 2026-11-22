const { chromium, OUT, URL, q, login, api, txt } = require('./leg-lib.cjs'); const fs = require('fs'); const T = 'C:/Users/gkhno/AppData/Local/Temp/'; const ids = JSON.parse(fs.readFileSync(T + 't7-weekly.json')); const CID = fs.readFileSync(T + 't8-cid.txt', 'utf8');
const TASK = q(`SELECT t.id FROM tasks t JOIN rules r ON r.id=t.rule_id WHERE r.code='EX-ESTATE-DOSYA-AYLIK' ORDER BY t.due_at LIMIT 1`);
(async () => {
  q('delete from login_challenges'); const b = await chromium.launch(); const mk = async () => (await b.newContext({ viewport: { width: 412, height: 900 } })).newPage();
  const O = await mk(); await login(O, ids.estate.owner); await O.goto(URL + '/notifications'); await O.waitForTimeout(2500); await O.screenshot({ path: `${OUT}/m-50-sahip-bildirimler.png`, fullPage: true });
  console.log('SAHIP BILDIRIMLER:', (await txt(O)).slice(0, 400));
  await O.getByText(/Mevzuat değişti/).first().click(); await O.waitForTimeout(2500); console.log('SAHIP BILDIRIMDEN ACILAN:', O.url().replace(URL, ''), '|', (await txt(O)).slice(0, 900)); await O.screenshot({ path: `${OUT}/m-51-sahip-degisiklik-ekrani.png`, fullPage: true });
  const wid = q(`SELECT id FROM users WHERE email='${ids.estate.worker}'`); console.log('ATAMA', (await api(O, 'POST', `/companies/${ids.estate.C}/tasks/${TASK}/assign`, { userId: wid })).status);
  q('delete from login_challenges'); const W = await mk(); await login(W, ids.estate.worker); await W.goto(URL + '/notifications'); await W.waitForTimeout(2500); await W.screenshot({ path: `${OUT}/m-52-calisan-bildirimler.png`, fullPage: true });
  console.log('CALISAN BILDIRIMLER:', (await txt(W)).slice(0, 500));
  const link = W.getByText(/görev|Görev|atandı/).first(); await link.click().catch(() => {}); await W.waitForTimeout(2500); console.log('CALISAN ACILAN:', W.url().replace(URL, ''), 'beklenen task', TASK);
  if (!W.url().includes(TASK)) { await W.goto(URL + '/task/' + TASK); await W.waitForTimeout(2500); }
  const t = await txt(W); console.log('CALISAN GOREV:', t.slice(0, 1500)); await W.screenshot({ path: `${OUT}/m-53-calisan-gorev-neden.png`, fullPage: true });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
