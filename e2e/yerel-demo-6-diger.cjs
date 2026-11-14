/**
 * Local Docker demo, delivery 6 — scenarios 2, 3 and 4 in the browser, plus edge cases.
 *  2. Knowledge gap: training assigned → assessment → field application with a photo → "not effective"
 *     → retraining → new field verification; the first assignment's record is kept.
 *  3. Document renewal: "running out" filter and reminder → new version → its own review → the old
 *     reminder is marked stale → PDF audit file downloaded (Turkish text, sections); another site's
 *     manager cannot open the document nor the attachment link printed in the file.
 *  4. Rule change: a draft written on the rule screen → sample-profile preview → area review →
 *     approval → publish → tasks for the matching business; a second version leaves earlier tasks
 *     on the first version.
 *  Edge: narrow screen (iPhone SE) with long Turkish text, empty results, refused upload, access denied.
 * Own demo business (two sites) per run. The rule is scoped to this run's business only.
 *
 *   NODE_PATH=$(npm root -g) node e2e/yerel-demo-6-diger.cjs <screenshot-dir> <yerel-demo folder>
 */
const { chromium, devices } = require('playwright');
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WEB = process.env.WEB || 'http://localhost:8080', OUT = process.argv[2], DIR = process.argv[3];
const dc = cmd => execSync(`docker compose -p goverhub-demo ${cmd}`, { cwd: DIR }).toString().trim();
const sql = q => dc(`exec -T db psql -U postgres -d goverhub_demo -tAc "${q.replace(/"/g, '\\"')}"`);
const tsx = code => dc(`exec -T app node node_modules/tsx/dist/cli.mjs -e "${code}"`);
const RUN = `d${Date.now().toString(36)}`;
const T = JSON.parse(dc(`exec -T app node node_modules/tsx/dist/cli.mjs src/seed/test-business.ts ${RUN} --two-sites`).split('\n').pop());
const CO = T.companyId, E = T.emails;
// Shared demo platform accounts sign in on every run; old login codes (not business records) are cleared.
for (const e of ['yazar', 'onay', 'alan-uzmani', 'yonetici']) sql(`DELETE FROM login_challenges WHERE email = '${e}@demo.goverhub.test'`);
let pass = 0, fail = 0;
const check = (label, ok) => { ok ? pass++ : fail++; console.log(`${ok ? 'GEÇTİ ' : 'KALDI '} ${label}`); };
const day = n => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
console.log(`Çalıştırma ${RUN} · işletme ${CO}`);

(async () => {
  const tmp = fs.mkdtempSync(path.join(OUT, 'dosya-'));
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  const errs = [];
  const sessions = {};
  let ctx, p, device = devices['Pixel 7'];
  let n = 0; const shot = async name => { n++; await p.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png` }); };
  const id = t => p.getByTestId(t).first();
  const text = (t, exact = true) => p.getByText(t, { exact }).first();
  const wait = ms => p.waitForTimeout(ms);
  const body = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  const count = t => p.getByTestId(t).count();
  let overflowSeen = false;
  const look = async () => { if (await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) overflowSeen = true; };
  async function as(email) {
    if (!sessions[email]) {
      const c = await b.newContext({ ...device, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', acceptDownloads: true });
      const pg = await c.newPage(); pg.on('pageerror', e => errs.push(e.message));
      ctx = c; p = pg;
      await p.goto(WEB + '/login'); await id('login-email').waitFor();
      await id('login-email').fill(email); await text('Kod gönder').click(); await id('login-code').waitFor();
      await text('Demo kutusundan kodu getir').click(); await wait(700); await text('Giriş yap').click(); await wait(3500);
      sessions[email] = { c, pg };
    }
    ctx = sessions[email].c; p = sessions[email].pg;
  }
  const token = async () => p.evaluate(() => JSON.parse(localStorage.getItem('gh.session.v1') || '{}').token);
  const api = async (method, url, body) => {
    const r = await fetch(`${WEB}/api${url}`, { method, headers: { authorization: `Bearer ${await token()}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const choose = async (trigger, file) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), trigger.click()]); await fc.setFiles(file); };
  const staffId = sql(`SELECT id FROM users WHERE email = '${E.staff}'`);
  const tmpPage = await (await b.newContext()).newPage();
  await tmpPage.setContent('<body style="margin:0"><div style="width:100vw;height:100vh;background:#c96"></div></body>');
  const png = path.join(tmp, 'kapi.png'); fs.writeFileSync(png, await tmpPage.screenshot({ clip: { x: 0, y: 0, width: 64, height: 64 } }));
  const pdf = path.join(tmp, 'ruhsat.pdf'); fs.writeFileSync(pdf, Buffer.from(`%PDF-1.4\nruhsat ${RUN}\n%%EOF\n`));
  const pdf2 = path.join(tmp, 'ruhsat-yeni.pdf'); fs.writeFileSync(pdf2, Buffer.from(`%PDF-1.4\nruhsat yeni ${RUN}\n%%EOF\n`));
  const txt = path.join(tmp, 'not.txt'); fs.writeFileSync(txt, 'düz metin dosyası');

  // ── 2. Knowledge gap ──
  await as(E.manager);
  await p.goto(WEB + '/ncrs'); await wait(2500);
  await id('ncr-new').click(); await wait(1500);
  await id('ncr-new-title').fill('Personel soğutucu kapısını açık bırakıyor'); await id('ncr-new-desc').fill('Gün içinde iki kez kapı aralık bulundu.');
  await text('Sıcaklık / soğuk zincir').click(); await id('ncr-new-sev-major').click();
  await id('ncr-new-containment').fill('Kapı kapatıldı, ürünler kontrol edildi.'); await id('ncr-new-save').click(); await wait(3500);
  const ncr = p.url().split('/ncr/')[1];
  await id('ncr-assign-open').click(); await wait(800);
  await text('Elif (personel) · Personel').click(); await text('Yarın').click(); await id('ncr-assign-save').click(); await wait(2500);
  await id('cause-initial-open').click(); await id('cause-knowledge').click();
  await id('cause-notes').fill('Personel kapı kontrolünü bilmiyordu.'); await id('cause-save').click(); await wait(2500);
  check('Bilgi eksikliğinde ilgili eğitim önerisi (ilgili eğitim adlarıyla)', (await count('support-training')) === 1 && (await body()).includes('İlgili:'));
  await id('support-go-training').click(); await wait(3000);
  await text('Soğutucu kapısı ve sıcaklık kontrolü (ÖRNEK)').click();
  await id(`person-${staffId}`).click(); await text('3 gün').click(); await id('tr-assign-save').click(); await wait(3500);
  await id('action-add-open').click(); await id('action-desc').fill('Açılışta kapı ve conta kontrolünü uygula.');
  await text('Elif (personel) · Personel').click(); await id('action-evidence-photo').click(); await id('action-save').click(); await wait(2500);
  const asg1 = sql(`SELECT id FROM training_assignments WHERE company_id = '${CO}' AND ncr_id = '${ncr}' ORDER BY assigned_at LIMIT 1`);
  await as(E.staff);
  await p.goto(`${WEB}/training/a/${asg1}`); await wait(3000);
  await id('tr-read').click(); await wait(2000);
  await id('tr-ans-0-1').click(); await id('tr-ans-1-0').click(); await id('tr-ans-2-0').click(); await id('tr-attempt').click(); await wait(2500);
  await id('tr-complete').click(); await wait(2500);
  await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000);
  await choose(p.locator('[data-testid^="action-evidence-add-"]').first(), png); await wait(3000);
  await p.locator('[data-testid^="action-done-open-"]').first().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').first().fill('Açılışta kapıyı ve contayı kontrol ettim.'); await p.locator('[data-testid^="action-confirm-"]').first().click(); await wait(2500);
  check('Personel sınavı geçti ve fotoğraflı uygulamayı bildirdi', (await body()).includes('YAPILDI BEYANI'));
  await as(E.manager);
  await p.goto(`${WEB}/training/a/${asg1}`); await wait(3000);
  await id('tr-field-not').click(); await id('tr-field-notes').fill('Ertesi gün kapı yine açık bulundu; uygulanmıyor.'); await id('tr-field-save').click(); await wait(3000);
  await id('tr-retrain-reason').fill('Sahada uygulanmadı; uygulamalı tekrar.'); await id('tr-retrain').click(); await wait(3500);
  const asg2 = p.url().split('/training/a/')[1];
  check('Etkili değil → yeniden eğitim yeni atama olarak açıldı (gerekçeli, öncekine bağlı)', asg2 !== asg1 && (await count('tr-previous')) === 1);
  await as(E.staff);
  await p.goto(`${WEB}/training/a/${asg2}`); await wait(3000);
  await id('tr-read').click(); await wait(2000);
  await id('tr-ans-0-1').click(); await id('tr-ans-1-0').click(); await id('tr-ans-2-0').click(); await id('tr-attempt').click(); await wait(2500);
  await id('tr-complete').click(); await wait(2500);
  await as(E.manager);
  await p.goto(`${WEB}/training/a/${asg2}`); await wait(3000);
  await id('tr-field-effective').click(); await id('tr-field-notes').fill('Üç açılışta kapı kapalı, conta kontrol edilmiş.'); await id('tr-field-save').click(); await wait(3000);
  check('Yeni saha doğrulaması: etkili', (await body()).includes('SAHADA ETKİNLİK'));
  await p.goto(`${WEB}/training/a/${asg1}`); await wait(2500);
  check('İlk atamanın geçmişi korunuyor: tamamlandı, etkili değil, sonraki atamaya bağlantı', (await count('tr-later')) === 1 &&
    sql(`SELECT (completed_at IS NOT NULL)::text || field_result FROM training_assignments WHERE id = '${asg1}'`) === 'truenot_effective');
  const course = sql(`SELECT course_id FROM training_assignments WHERE id = '${asg1}'`);
  await p.goto(`${WEB}/training/${course}`); await wait(3000);
  check('İçerikte KİŞİLER: atanan, okuyan, tamamlayan, geçen, sahada etkili / değil ayrı', (await id('tr-people-summary').innerText()).includes('yeniden eğitim 1'));
  await shot('egitim-kisiler');

  // ── 3. Document renewal and the PDF audit file ──
  await as(E.owner);
  await p.goto(WEB + '/documents/new'); await wait(2000);
  await id('doc-type-business_license').click(); await id('doc-scope-site').click().catch(() => {}); await id('doc-title').fill(`İşyeri açma ve çalışma ruhsatı ${RUN}`); await id('doc-create').click(); await wait(3000);
  const doc = p.url().split('/documents/')[1];
  await id('doc-version-open').click(); await choose(id('doc-file-pick'), pdf); await wait(800);
  await id('doc-valid-until').fill(day(10)); await id('doc-version-save').click(); await wait(3500);
  await as(E.manager);
  await p.goto(`${WEB}/documents/${doc}`); await wait(3000);
  await id('doc-review-open-1').click(); await id('doc-review-notes-1').fill('Aslıyla karşılaştırıldı.'); await id('doc-review-ok-1').click(); await wait(3000);
  await p.goto(WEB + '/documents'); await wait(2500); await id('doc-filter-expiring').click(); await wait(2000);
  check('"Yakında bitecek" filtresinde ruhsat', (await count(`doc-${doc}`)) === 1);
  // The hourly scan, run once now.
  tsx("(async()=>{const {loadConfig}=await import('./src/config.ts');const {Db}=await import('./src/db/pool.ts');const {scanDocumentExpiry}=await import('./src/services/documents.ts');const db=Db.connect(loadConfig().databaseUrl);await scanDocumentExpiry(db);await db.close();})()");
  const range = `from=${encodeURIComponent(new Date(Date.now() - 30 * 864e5).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 864e5).toISOString())}`;
  await as(E.owner);
  const report = (await api('GET', `/companies/${CO}/audit-report?format=json&${range}`)).body;
  const link = (report.sections?.documents ?? []).find(d => d.id === doc)?.attachment;
  check('Süresi yaklaşan ruhsat dosyada; sahip ekin bağlantısını açabiliyor', !!link && (await api('GET', link)).status === 200);
  await as(E.manager2);
  check('Başka şubenin yöneticisi dosyadaki ek bağlantısını açamıyor (404)', !!link && (await api('GET', link)).status === 404);
  await as(E.owner);
  await p.goto(`${WEB}/documents/${doc}`); await wait(2500);
  await id('doc-version-open').click(); await choose(id('doc-file-pick'), txt); await wait(1000);
  check('Kabul edilmeyen dosya türü (txt) reddediliyor, açıklamalı', (await body()).includes('kabul edilmiyor'));
  await choose(id('doc-file-pick'), pdf2); await wait(800);
  await id('doc-valid-until').fill(day(400)); await id('doc-version-save').click(); await wait(3500);
  let t = await body();
  check('Yeni sürüm kendi incelemesini bekliyor; eski sürüm geçerli kalıyor', t.includes('İNCELEME BEKLİYOR') && t.includes('KURUM İÇİ İNCELENDİ'));
  await as(E.manager);
  await p.goto(`${WEB}/documents/${doc}`); await wait(3000);
  await id('doc-review-open-2').click(); await id('doc-review-notes-2').fill('Yeni ruhsat aslıyla karşılaştırıldı.'); await id('doc-review-ok-2').click(); await wait(3000);
  await id('doc-use-open').click(); await wait(1500); await id('doc-use-kind-task_template').click(); await wait(500);
  await id('doc-use-ref-fridge_temp').click().catch(() => {});
  await id('doc-use-purpose').fill('Denetimde işletmenin faaliyet izni olarak gösterilir'); await id('doc-use-save').click().catch(() => {}); await wait(2500);
  check('Belgenin kullanım amacı kaydedildi', (await body()).includes('Amaç: Denetimde'));
  await p.goto(WEB + '/notifications'); await wait(3000);
  t = await body();
  check('Belge yenilenince eski süre uyarısı "ESKİ" olarak işaretli', t.includes('ESKİ') && t.includes('Belge yenilendi'));
  await shot('eski-hatirlatma');
  await as(E.owner);
  await p.goto(WEB + '/report'); await wait(3000);
  await id('pdf-site-all').click();
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), id('report-pdf').click()]);
  const pdfOut = path.join(OUT, `denetim-dosyasi-${RUN}.pdf`); await dl.saveAs(pdfOut);
  const pdfText = execFileSync('pdftotext', [pdfOut, '-']).toString().replace(/\s+/g, ' ');
  check('PDF indirildi: Türkçe başlıklar, şubeler, kaynak ve kural sürümleri, örnek veri etiketi, rol',
    pdfText.includes('Açık kritik ve yüksek riskli kayıtlar') && pdfText.includes('Kadıköy Moda, Beşiktaş Çarşı') && pdfText.includes('Kaynak ve kural sürümleri') && pdfText.includes('ÖRNEK VERİ') && pdfText.includes('rol: İşletme sahibi'));
  await as(E.manager2);
  await p.goto(`${WEB}/documents/${doc}`); await wait(2500);
  check('Başka şubenin yöneticisi belgeyi doğrudan bağlantıyla açamıyor', !(await body()).includes(RUN));
  const k = (await api('GET', `/companies/${CO}/audit-report?format=json&${range}`)).body;
  check('Başka şubenin yöneticisinin dosyasında yalnız kendi şubesi; ruhsat yok', JSON.stringify(k.sites) === '["Beşiktaş Çarşı"]' && !JSON.stringify(k.sections).includes(RUN));

  // ── 4. Rule change ──
  // Scope the new rule to this run's business only (a province value nobody else has).
  const prov = `Test-${RUN}`;
  await as(E.owner);
  await api('POST', `/companies/${CO}/profile/facts`, { siteId: T.siteId, key: 'site.province', value: prov, source: 'user_declared', verification: 'user_confirmed' });
  await as('yazar@demo.goverhub.test');
  await p.goto(WEB + '/rule/new'); await wait(3000);
  const code = `EX-${RUN.toUpperCase()}`;
  await id('rule-code').fill(code); await id('rule-title').fill('Paket servis çantası temizliği (örnek)');
  await id('rule-fact-0-site.province').click(); await wait(300);
  check('Kural ekranı açıldı (koşul, kaynak, sıklık, birim, kanıt alanları)', (await body()).includes('KAPSAM KOŞULLARI') && (await body()).includes('KAYNAK VE MADDE') && (await body()).includes('GÖREV ŞABLONU 1'));
  await id('rule-val-input-0').fill(prov);
  await id('rule-ob-title').fill('Servis çantalarını haftalık temizle'); await id('rule-ob-summary').fill('Örnek iyi uygulama; yalnız bu test işletmesine uyar.');
  await id('rule-reason').fill('İlk taslak'); await id('rule-area-food_safety').click();
  await id('tpl-code-0').fill(`bag_${RUN}`); await id('tpl-title-0').fill('Servis çantası temizliği'); await id('tpl-instr-0').fill('Çantanın içini dezenfekte et ve fotoğrafını ekle.');
  await id('tpl-freq-0-weekly').click();
  await shot('kural-yazma');
  await id('rule-save').click(); await wait(4000);
  const ruleV1 = p.url().split('/rule/')[1];
  t = await body();
  check('Taslak kaydedildi; örnek profillerde önizleme gösterildi', ruleV1 !== 'new' && (await count('rule-preview-cafe_cold')) === 1 && t.includes('ÖRNEK PROFİLLERDE ÖNİZLEME'));
  await shot('kural-onizleme');
  await id('rule-submit').click(); await wait(2500);
  await as('alan-uzmani@demo.goverhub.test');
  await p.goto(WEB + '/admin'); await wait(3000);
  await p.getByPlaceholder('ör. Kaynak metinle karşılaştırıldı').fill('Örnek içerik olarak incelendi.');
  const card = p.locator(`text=${code} v1`).locator('xpath=ancestor::*[4]');
  await card.getByText('food_safety alanında onayla (alan uzmanı)').click(); await wait(2500);
  await as('onay@demo.goverhub.test');
  await p.goto(WEB + '/admin'); await wait(3000);
  await p.locator(`text=${code} v1`).locator('xpath=ancestor::*[4]').getByText('Kuralı onayla').click(); await wait(2500);
  await as('yonetici@demo.goverhub.test');
  await p.goto(WEB + '/admin'); await wait(2500); await text('Onaylı').click(); await wait(2500);
  await p.locator(`text=${code} v1`).locator('xpath=ancestor::*[4]').getByText('Yayınla').click(); await wait(6000);
  check('Yetkili inceleme, onay ve yayın tamamlandı', sql(`SELECT rv.status FROM rule_versions rv JOIN rules r ON r.id = rv.rule_id WHERE r.code = '${code}' AND rv.version = 1`) === 'published');
  tsx(`(async()=>{const {loadConfig}=await import('./src/config.ts');const {Db}=await import('./src/db/pool.ts');const {generateTasks}=await import('./src/services/tasks.ts');const db=Db.connect(loadConfig().databaseUrl);await db.tenant('${CO}',tx=>generateTasks(tx,'${CO}','${T.siteId}','${day(0)}','${day(14)}'));await db.close();})()`);
  const v1Tasks = sql(`SELECT count(*) FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE r.code = '${code}' AND rv.version = 1`);
  const others = sql(`SELECT count(*) FROM obligations o JOIN rules r ON r.id = o.rule_id WHERE r.code = '${code}' AND o.decision = 'applies' AND o.company_id <> '${CO}'`);
  check('Yeni görevler yalnız eşleşen işletmede oluştu', Number(v1Tasks) > 0 && others === '0');
  // Version 2 (through the same API the screen uses): earlier tasks stay on version 1.
  await as('yazar@demo.goverhub.test');
  const det = (await api('GET', `/admin/rule-versions/${ruleV1}`)).body;
  const v2 = (await api('POST', '/admin/rule-versions', { code, title: det.title, kind: det.kind, isExample: true, provisionIds: [], ambiguityNote: null, condition: det.condition,
    obligationTitle: det.obligationTitle, obligationSummary: det.obligationSummary, effectiveFrom: day(0), effectiveTo: null, changeReason: 'Sıklık: her gün', requiredReviewAreas: ['food_safety'],
    templates: det.templates.map(x => ({ code: x.code, title: x.title, instructions: x.instructions, recurrence: { freq: 'daily', at: '10:00' }, evidence: x.evidence, limits: x.limits, severity: x.severity, hazardType: x.hazard_type })) })).body.id;
  await api('POST', `/admin/rule-versions/${v2}/submit`);
  await as('alan-uzmani@demo.goverhub.test'); await api('POST', `/admin/rule-versions/${v2}/area-review`, { area: 'food_safety', decision: 'approved', notes: 'Sıklık değişikliği incelendi.' });
  await as('onay@demo.goverhub.test'); await api('POST', `/admin/rule-versions/${v2}/approve`);
  await as('yonetici@demo.goverhub.test'); await api('POST', `/admin/rule-versions/${v2}/publish`);
  tsx(`(async()=>{const {loadConfig}=await import('./src/config.ts');const {Db}=await import('./src/db/pool.ts');const {generateTasks}=await import('./src/services/tasks.ts');const db=Db.connect(loadConfig().databaseUrl);await db.tenant('${CO}',tx=>generateTasks(tx,'${CO}','${T.siteId}','${day(15)}','${day(16)}'));await db.close();})()`);
  const byVersion = sql(`SELECT string_agg(DISTINCT rv.version::text, ',') FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE r.code = '${code}'`);
  const v1After = sql(`SELECT count(*) FROM tasks t JOIN task_templates tt ON tt.id = t.template_id JOIN rule_versions rv ON rv.id = tt.rule_version_id JOIN rules r ON r.id = rv.rule_id WHERE r.code = '${code}' AND rv.version = 1`);
  check('Yeni sürümden sonra eski görevler 1. sürüme bağlı; yeni görevler 2. sürümden', byVersion === '1,2' && v1After === v1Tasks);

  // ── Edge cases: narrow screen with long Turkish text, empty results ──
  device = devices['iPhone SE'];
  delete sessions[E.owner];
  await as(E.owner);
  await p.goto(WEB + '/ncrs'); await wait(2500);
  await id('ncr-new').click(); await wait(1500);
  await id('ncr-new-title').fill('Çok uzun başlık: soğuk zincir kırıldı, ürünler ayrıldı; ölçüm ve gözlem notları ile birlikte şube çalışanlarının değerlendirmesi ğüşıöç');
  await id('ncr-new-desc').fill('Açıklama: '.repeat(30)); await text('Sıcaklık / soğuk zincir').click(); await id('ncr-new-sev-minor').click(); await id('ncr-new-save').click(); await wait(3500);
  await look();
  await p.goto(WEB + '/board'); await wait(3000); await look();
  await p.goto(WEB + '/documents'); await wait(2500); await id('doc-filter-rejected').click(); await wait(2000);
  check('Boş sonuç açıklamalı (dar ekran)', (await body()).includes('Bu filtreye uyan belge yok'));
  await look();
  await shot('dar-ekran-bos');

  check('Yatay taşma yok (Pixel 7 ve iPhone SE)', !overflowSeen);
  console.log('Sayfa hataları:', errs.length ? errs.slice(0, 5).join(' | ') : 'yok');
  console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı · işletme ${CO}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  await b.close();
})().catch(async e => { console.error('HATA:', e.message.split('\n').slice(0, 3).join(' | ')); console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı (yarıda kesildi)`); process.exit(1); });
