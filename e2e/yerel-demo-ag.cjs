/**
 * Local Docker demo, delivery 5B.
 *  A. Training gaps: content published by one manager alone is labelled "no independent review";
 *     related training on the check screen; due soon / overdue / due change notices;
 *     "not effective in the field" keeps the record and starts a retraining.
 *  B. Professional network: create profile → specialties and experience → search an expert →
 *     follow → post → comment → service request from the profile (approved category only);
 *     an unapproved profile is findable but cannot get a request; contacts hidden by default.
 *  C. Case share with permission, preview and data check; draft → publish.
 *  D. Report → moderation queue → reasoned decision; block.
 * Own demo business per run; the shared demo specialist (uzman@) and moderator (moderator@) are used read-mostly.
 *
 *   NODE_PATH=$(npm root -g) node e2e/yerel-demo-ag.cjs <screenshot-dir> <yerel-demo folder>
 */
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WEB = process.env.WEB || 'http://localhost:8080', OUT = process.argv[2], DIR = process.argv[3];
const dc = cmd => execSync(`docker compose -p goverhub-demo ${cmd}`, { cwd: DIR }).toString().trim();
const sql = q => dc(`exec -T db psql -U postgres -d goverhub_demo -tAc "${q.replace(/"/g, '\\"')}"`);
// The app runs this every hour; here it is run once right away (current time, nothing simulated).
const scan = () => dc(`exec -T app node node_modules/tsx/dist/cli.mjs -e "(async()=>{const {loadConfig}=await import('./src/config.ts');const {Db}=await import('./src/db/pool.ts');const {scanDeadlines}=await import('./src/services/notifications.ts');const db=Db.connect(loadConfig().databaseUrl);console.log(JSON.stringify(await scanDeadlines(db)));await db.close();})()"`);
const RUN = `a${Date.now().toString(36)}`;
const T = JSON.parse(dc(`exec -T app node node_modules/tsx/dist/cli.mjs src/seed/test-business.ts ${RUN}`).split('\n').pop());
const CO = T.companyId, E = T.emails;
// Training part: a business with ONE manager (the owner), where the owner publishes alone.
const T1 = JSON.parse(dc(`exec -T app node node_modules/tsx/dist/cli.mjs src/seed/test-business.ts ${RUN}t --single`).split('\n').pop());
const CO1 = T1.companyId, E1 = T1.emails;
const UZMAN = sql(`SELECT id FROM users WHERE email = 'uzman@demo.goverhub.test'`);
const ZEYNEP = sql(`SELECT id FROM users WHERE email = 'danisman@demo.goverhub.test'`);
let pass = 0, fail = 0;
const check = (label, ok) => { ok ? pass++ : fail++; console.log(`${ok ? 'GEÇTİ ' : 'KALDI '} ${label}`); };
console.log(`Çalıştırma ${RUN} · işletme ${CO}`);

(async () => {
  const tmp = fs.mkdtempSync(path.join(OUT, 'dosya-'));
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  let n = 0; const shot = async name => { n++; await p.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png` }); };
  const id = t => p.getByTestId(t).first();
  const text = (t, exact = true) => p.getByText(t, { exact }).first();
  const wait = ms => p.waitForTimeout(ms);
  const body = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  const count = t => p.getByTestId(t).count();
  let overflowSeen = false;
  const look = async () => { if (await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) overflowSeen = true; };
  async function login(email) {
    await p.goto(WEB + '/login'); await id('login-email').waitFor();
    await id('login-email').fill(email); await text('Kod gönder').click(); await id('login-code').waitFor();
    await text('Demo kutusundan kodu getir').click(); await wait(700); await text('Giriş yap').click(); await wait(3500);
  }
  async function logout() { await p.goto(WEB + '/account'); await wait(1500); await id('logout').click(); await wait(1500); }
  const choose = async (trigger, file) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), trigger.click()]); await fc.setFiles(file); };
  const staffId = sql(`SELECT id FROM users WHERE email = '${E.staff}'`);
  const ownerId = sql(`SELECT id FROM users WHERE email = '${E.owner}'`);
  const staff1 = sql(`SELECT id FROM users WHERE email = '${E1.staff}'`);
  const owner1 = sql(`SELECT id FROM users WHERE email = '${E1.owner}'`);
  // A real (small) PNG for the profile photo.
  await p.setContent('<body style="margin:0"><div style="width:100vw;height:100vh;background:linear-gradient(135deg,#9be15d,#00a3a3)"></div></body>');
  const png = path.join(tmp, 'profil.png'); fs.writeFileSync(png, await p.screenshot({ clip: { x: 0, y: 0, width: 96, height: 96 } }));

  // ── A. Training gaps (single-manager business) ──
  await login(E1.owner);
  await p.goto(WEB + '/trainings'); await wait(2000);
  await id('tr-tab-courses').click(); await wait(1500);
  await id('tr-new').click(); await wait(1500);
  await id('tr-title').fill(`Açılış kontrolü ${RUN}`); await id('tr-summary').fill('Sabah açılışında yapılacaklar');
  await id('tr-bodytext').fill('Açılışta soğutucu kapılarını, contaları ve sıcaklıkları kontrol et; sapmayı hemen bildir.');
  await id('tr-link-cold_chain_temperature').click();
  await id('tr-add-q').click(); await id('tr-q-0').fill('Sapma görürsen?'); await id('tr-q-0-o-0').fill('Hemen bildiririm'); await id('tr-q-0-o-1').fill('Beklerim');
  await id('tr-save').click(); await wait(3000);
  await id('tr-submit').click(); await wait(2500);
  await id('tr-publish').click(); await wait(3000);
  const course = p.url().split('/training/')[1];
  let t = await body();
  check('Tek yöneticinin kendi yayımladığı içerik: "İşletme içi içerik · bağımsız inceleme yapılmadı"; ağda yayımlanmadığı yazıyor',
    t.includes('İşletme içi içerik · bağımsız inceleme yapılmadı') && t.includes('mesleki ağda ya da platform kütüphanesinde yayımlanmaz'));
  await shot('egitim-isletme-ici');
  check('Veritabanı: içerik bu işletmede; ağa paylaşım oluşmadı', sql(`SELECT company_id FROM training_courses WHERE id = '${course}'`) === CO1
    && sql(`SELECT count(*) FROM network_posts WHERE body LIKE '%${RUN}%'`) === '0');
  await p.goto(WEB + '/trainings'); await wait(2000); await id('tr-tab-courses').click(); await wait(2000);
  check('Listede de etiket var', (await count(`tr-inhouse-${course}`)) === 1 && (await id(`tr-inhouse-${course}`).innerText()).includes('BAĞIMSIZ İNCELEME YAPILMADI'));
  // Related training on a check.
  const task = sql(`SELECT id FROM tasks WHERE company_id = '${CO1}' AND template_code = 'fridge_temp' AND status = 'open' ORDER BY due_at LIMIT 1`);
  await p.goto(`${WEB}/task/${task}`); await wait(3000);
  t = await body();
  check('Kontrol ekranında İLGİLİ EĞİTİMLER: yeni içerik ve örnek eğitim', t.includes('İLGİLİ EĞİTİMLER') && t.includes(`Açılış kontrolü ${RUN}`) && (await count(`task-training-${course}`)) === 1);
  await shot('kontrol-ilgili-egitim');
  // Assign with a due date.
  await p.goto(`${WEB}/training/assign?courseId=${course}`); await wait(2500);
  await id(`person-${staff1}`).click(); await text('Yarın').click(); await id('tr-reason').fill('Açılış kontrolü eğitimi');
  await id('tr-assign-save').click(); await wait(3500);
  const asg = sql(`SELECT id FROM training_assignments WHERE company_id = '${CO1}' AND user_id = '${staff1}' ORDER BY assigned_at DESC LIMIT 1`);
  // Time passes (only this test assignment's due date moves): due in 3 h, then 1 h ago.
  sql(`UPDATE training_assignments SET due_at = now() + interval '3 hours' WHERE id = '${asg}'`); scan(); scan();
  sql(`UPDATE training_assignments SET due_at = now() - interval '1 hour' WHERE id = '${asg}'`); scan(); scan();
  check('Bildirimler bir kez: yaklaşan (personel), geciken (personel + atayan)',
    sql(`SELECT count(*) FROM notifications WHERE entity_id = '${asg}' AND kind = 'training_due_soon'`) === '1'
    && sql(`SELECT string_agg(user_id::text, ',' ORDER BY user_id) FROM notifications WHERE entity_id = '${asg}' AND kind = 'training_overdue'`) === [staff1, owner1].sort().join(','));
  await p.goto(WEB + '/notifications'); await wait(2500);
  check('Atayan kişide "Eğitim termini geçti" bildirimi', (await body()).includes('Eğitim termini geçti'));
  await p.goto(`${WEB}/training/a/${asg}`); await wait(2500);
  await id('tr-due-open').click(); await text('3 gün').click(); await id('tr-due-reason').fill('x');
  check('Gerekçesiz termin değişikliği kaydedilemiyor', await id('tr-due-save').isDisabled());
  await id('tr-due-reason').fill('Vardiya değişti'); await id('tr-due-save').click(); await wait(2500);
  check('Termin değişti; personele "Eğitim termini değişti" bildirimi', sql(`SELECT count(*) FROM notifications WHERE entity_id = '${asg}' AND kind = 'training_due_changed'`) === '1');
  await logout();
  await login(E1.staff);
  await p.goto(WEB + '/notifications'); await wait(2500);
  t = await body();
  check('Personelde yaklaşan, geciken ve değişen termin bildirimleri', t.includes('Eğitim termini yaklaşıyor') && t.includes('Eğitim termini geçti') && t.includes('Eğitim termini değişti'));
  await shot('personel-termin-bildirimleri');
  await p.goto(`${WEB}/training/a/${asg}`); await wait(2500);
  await id('tr-read').click(); await wait(2000); await id('tr-ans-0-0').click(); await id('tr-attempt').click(); await wait(2500); await id('tr-complete').click(); await wait(2500);
  await logout();
  await login(E1.owner);
  await p.goto(`${WEB}/training/a/${asg}`); await wait(2500);
  await id('tr-field-not').click(); await id('tr-field-notes').fill('Sahada kapı iki kez açık bulundu; uygulanmıyor.'); await id('tr-field-save').click(); await wait(3000);
  t = await body();
  check('"Etkili değil" kaydedildi; okuma/sınav/tamamlama kayıtları duruyor; yeniden eğitim seçeneği çıktı',
    t.includes('Etkili değil') && t.includes('SAHADA ETKİLİ DEĞİL · SONRAKİ ADIM') && t.includes('%100') && (await count('tr-retrain')) === 1);
  await shot('saha-etkili-degil');
  await id('tr-retrain-reason').fill('Sahada uygulanmadı; yeniden eğitim.'); await id('tr-retrain').click(); await wait(3500);
  const asg2 = p.url().split('/training/a/')[1];
  check('Yeni atama açıldı ve öncekine bağlı', asg2 !== asg && (await count('tr-previous')) === 1 && sql(`SELECT previous_assignment_id FROM training_assignments WHERE id = '${asg2}'`) === asg);
  await p.goto(`${WEB}/training/a/${asg}`); await wait(2500);
  check('Önceki atama korunuyor: tamamlandı, etkili değil, sonraki atamaya bağlantı; ikinci kez yeniden eğitim yok',
    (await count('tr-later')) === 1 && (await count('tr-retrain')) === 0 && sql(`SELECT (completed_at IS NOT NULL)::text || field_result FROM training_assignments WHERE id = '${asg}'`) === 'truenot_effective');
  await logout();
  // In a business with another manager, the author sees why they cannot publish (no dead button).
  await login(E.owner);
  await p.goto(WEB + '/training/edit'); await wait(2000);
  await id('tr-title').fill(`Kapanış kontrolü ${RUN}`); await id('tr-summary').fill('Akşam kapanışı');
  await id('tr-bodytext').fill('Kapanışta soğutucu kapılarını ve sıcaklıkları kontrol et.');
  await id('tr-save').click(); await wait(3000); await id('tr-submit').click(); await wait(2500);
  check('İkinci yöneticili işletmede yazar "Yayımla" düğmesi yerine açıklama görüyor', (await count('tr-publish')) === 0 && (await count('tr-publish-blocked')) === 1);
  await logout();

  // ── B0. Staff: a network profile and two posts (one presented like legislation) ──
  await login(E.staff);
  await p.goto(WEB + '/more'); await wait(1500);
  check('Daha menüsünde "Mesleki ağ" var', (await count('more-network')) === 1);
  await id('more-network').click(); await wait(2000);
  await id('net-create-profile').click(); await wait(2000);
  await id('net-name').fill(`Elif ${RUN}`); await id('net-city').fill('İstanbul'); await id('net-save').click(); await wait(2500);
  await p.goto(WEB + '/network/compose'); await wait(1500);
  await id('net-post-body').fill(`Kapı contasını her sabah kontrol etmek sıcaklık sapmalarını azaltıyor. ${RUN}`); await id('net-post-publish').click(); await wait(2500);
  const staffPost = p.url().split('/network/post/')[1];
  await p.goto(WEB + '/network/compose'); await wait(1500);
  await id('net-post-body').fill(`Bu kural yasal zorunluluktur, uymayan herkes kapatılır. ${RUN}`); await id('net-post-publish').click(); await wait(2500);
  const badPost = p.url().split('/network/post/')[1];
  await logout();

  // ── B. Owner: profile → specialties/experience → search → follow → post → comment → service request ──
  await login(E.owner);
  await p.goto(WEB + '/network'); await wait(2500);
  t = await body();
  check('Profil yokken ağ akışı kapalı; e-posta/telefon/belgelerin gizli kalacağı yazıyor', (await count('net-create-profile')) === 1 && t.includes('belge dosyaların ağda hiç gösterilmez'));
  await id('net-create-profile').click(); await wait(2000);
  await id('net-name').fill(`Ayşe ${RUN}`); await id('net-title').fill('İşletme sahibi · kafe'); await id('net-bio').fill('Kadıköy\'de küçük bir kafe işletiyorum; gıda güvenliği ve soğuk zincirle ilgileniyorum.');
  await id('net-city').fill('İstanbul'); await id('net-district').fill('Kadıköy');
  await id('net-spec-gıda güvenliği').click(); await id('net-spec-hijyen').click();
  await id('net-cat-food_safety_consulting').click();
  await id('net-phone').fill('0532 000 00 00');
  await shot('profil-olustur');
  await id('net-save').click(); await wait(3000);
  await choose(id('net-photo'), png); await wait(3000);
  await id('net-exp-role').fill('Kafe işletmecisi'); await id('net-exp-org').fill('Kendi işletmem'); await id('net-exp-start').fill('2019');
  await id('net-exp-desc').fill('Günlük hijyen ve sıcaklık kayıtları'); await id('net-exp-add').click(); await wait(2500);
  check('Profil, fotoğraf ve deneyim kaydedildi', sql(`SELECT (photo_key IS NOT NULL)::text || array_length(specialties,1) || show_phone::text FROM network_profiles WHERE user_id = '${ownerId}'`) === 'true2false'
    && sql(`SELECT count(*) FROM network_experience WHERE user_id = '${ownerId}'`) === '1');
  await id('net-view-profile').click(); await wait(3000); await look();
  t = await body();
  check('Profilde ayrı bölümler: KİŞİSEL BEYAN / KONTROL EDİLMİŞ BELGELER / HİZMET ONAYI / PLATFORMDA DOĞRULANMIŞ HİZMET GEÇMİŞİ',
    ['KİŞİSEL BEYAN', 'KONTROL EDİLMİŞ BELGELER', 'HİZMET ONAYI', 'PLATFORMDA DOĞRULANMIŞ HİZMET GEÇMİŞİ'].every(s => t.includes(s)) && t.includes('Kafe işletmecisi'));
  check('Ağ üyeliği onay değildir notu; telefon "ağa kapalı"; beyan kategorisi BEYAN (onaysız)',
    t.includes('hizmet verme onayı değildir') && t.includes('ağa kapalı') && t.includes('Gıda güvenliği danışmanlığı · BEYAN') && t.includes('Hizmet onayı yok.'));
  await shot('profil-bolumler');
  // Search.
  await p.goto(WEB + '/network'); await wait(2500);
  await id('net-search').click(); await wait(2500);
  await id('net-q-spec-soğutma').click(); await wait(1200);
  await id('net-q-cat-refrigeration_service').click(); await wait(2000);
  t = await body();
  check('Arama: uzmanlık + kategori; sıralama ölçütleri açıklanıyor, takipçi yalnız eşitlikte', (await count(`net-result-${UZMAN}`)) === 1 && t.includes('Takipçi sayısı yalnız eşitlikte kullanılır'));
  check('Sonuçta onay ve sıralama nedeni görünüyor', t.includes('ONAYLI · Soğutma teknik servisi') && t.includes('bu kategoride geçerli hizmet onayı'));
  await shot('uzman-ara');
  await id('net-q-spec-soğutma').click(); await id('net-q-cat-refrigeration_service').click(); await id('net-q').fill('Zeynep'); await wait(2000);
  check('Onaysız profil de bulunuyor', (await count(`net-result-${ZEYNEP}`)) === 1 && (await body()).includes('HİZMET ONAYI YOK'));
  await id('net-q-approved').click(); await wait(2000);
  check('"Yalnız hizmet onayı olanlar" filtresi onaysız profili çıkarıyor', (await count(`net-result-${ZEYNEP}`)) === 0);
  await id('net-q-approved').click(); await wait(1500);
  await id(`net-result-${ZEYNEP}`).click(); await wait(3000);
  t = await body();
  check('Onaysız profilden hizmet talebi başlatılamıyor (açıklamalı); e-posta gizli', (await count('net-request-unavailable')) === 1 && (await count('net-request-service')) === 0 && t.includes('E-posta: gizli'));
  // Follow the approved specialist.
  await p.goto(`${WEB}/network/p/${UZMAN}`); await wait(3000);
  await id('net-follow').click(); await wait(2500);
  check('Takip edildi', (await count('net-unfollow')) === 1 && sql(`SELECT count(*) FROM network_follows WHERE follower_id = '${ownerId}' AND followee_id = '${UZMAN}'`) === '1');
  t = await body();
  check('Uzman profili: hizmet onayı bölümünde kategori; belge dosyası yok; iletişim gizli', (await count('net-approval-refrigeration_service')) === 1 && t.includes('Belge dosyaları ağda gösterilmez') && t.includes('E-posta: gizli') && t.includes('Telefon: gizli'));
  await shot('uzman-profili-takip');
  // Post: draft → edit → publish.
  await p.goto(WEB + '/network/compose'); await wait(1500);
  check('Paylaşım ekranı: kullanıcı paylaşımı uyarısı', (await body()).includes('doğrulanmış mevzuat ya da platform onaylı içerik değildir'));
  await id('net-post-body').fill(`Yaz aylarında kapı contalarını haftalık kontrol ediyoruz. ${RUN}`); await id('net-post-draft').click(); await wait(2500);
  const myPost = p.url().split('/network/post/')[1];
  check('Taslak yalnız yazarına: TASLAK etiketi', (await body()).includes('TASLAK · yalnız sen görürsün'));
  await id('net-edit').click(); await id('net-edit-body').fill(`Yaz aylarında kapı contalarını haftalık kontrol ediyoruz; sapma yarıya indi. ${RUN}`); await id('net-edit-save').click(); await wait(2000);
  await id('net-publish-draft').click(); await wait(2500);
  check('Düzenlendi ve yayımlandı', sql(`SELECT status || ':' || (body LIKE '%yarıya indi%')::text FROM network_posts WHERE id = '${myPost}'`) === 'published:true');
  // Comment on the staff member's post.
  await p.goto(`${WEB}/network/post/${staffPost}`); await wait(2500);
  await id('net-comment-body').fill('Biz de aynısını yapıyoruz, conta değişimini kayda bağladık.'); await id('net-comment-send').click(); await wait(2500);
  t = await body();
  check('Yorum eklendi; gönderide "Kullanıcı paylaşımı" etiketi', t.includes('YORUMLAR (1)') && t.includes('conta değişimini kayda bağladık') && t.includes('Kullanıcı paylaşımı'));
  await shot('paylasim-yorum');
  // Feed tabs.
  await p.goto(WEB + '/network'); await wait(2500);
  check('Akışta paylaşımlar görünüyor', (await count(`net-post-${staffPost}`)) === 1 && (await count(`net-post-${myPost}`)) === 1);
  await id('net-tab-mine').click(); await wait(2000);
  check('"Benimkiler" yalnız kendi paylaşımlarım', (await count(`net-post-${myPost}`)) === 1 && (await count(`net-post-${staffPost}`)) === 0);
  // Service request from the specialist's profile.
  const before = sql(`SELECT count(*) FROM service_requests WHERE company_id = '${CO}'`);
  await p.goto(`${WEB}/network/p/${UZMAN}`); await wait(3000);
  await id('net-request-service').click(); await wait(3000);
  t = await body();
  check('Talep formu: yalnız bu uzmana gideceği, sipariş/ücret oluşmadığı yazıyor; yalnız onaylı kategori listede',
    (await count('svc-invited')) === 1 && t.includes('sipariş ya da ücretli işlem oluşturmaz') && (await count('svc-cat-refrigeration_service')) === 1 && (await count('svc-cat-gas_installation_check')) === 0);
  check('Formu açmak kayıt oluşturmadı', sql(`SELECT count(*) FROM service_requests WHERE company_id = '${CO}'`) === before);
  await shot('profilden-hizmet-talebi');
  await id('svc-desc').fill('Tezgâh altı soğutucu 9 °C gösteriyor, kapı contası yırtık.'); await id('svc-title').fill('Soğutucu contası');
  await id('svc-submit').click(); await wait(3500);
  const req = sql(`SELECT id || '|' || coalesce(invited_profile_id::text,'') FROM service_requests WHERE company_id = '${CO}' ORDER BY created_at DESC LIMIT 1`).split('|');
  check('Talep açıldı ve yalnız bu uzmana yönlendirildi; sipariş/iş oluşmadı', req[1] === sql(`SELECT id FROM professional_profiles WHERE user_id = '${UZMAN}'`)
    && sql(`SELECT count(*) FROM service_jobs j JOIN service_requests r ON r.id = j.request_id WHERE r.id = '${req[0]}'`) === '0');
  check('Uzmana "Profilin üzerinden sana hizmet talebi geldi" bildirimi', sql(`SELECT count(*) FROM notifications WHERE user_id = '${UZMAN}' AND entity_id = '${req[0]}' AND title = 'Profilin üzerinden sana hizmet talebi geldi'`) === '1');
  // Report the post presented as legislation.
  await p.goto(`${WEB}/network/post/${badPost}`); await wait(2500);
  await id('net-report-post').click(); await id('net-report-misleading').click(); await id('net-report-details').fill('Mevzuat gibi sunulmuş, kaynak yok.');
  await id('net-report-send').click(); await wait(2000);
  check('Şikâyet moderasyona iletildi', (await body()).includes('Şikâyet moderasyona iletildi') && sql(`SELECT status FROM network_reports WHERE target_id = '${badPost}'`) === 'open');
  await logout();

  // ── C. Case share: manager records a case; the owner previews, fixes and permits ──
  await login(E.manager);
  await p.goto(WEB + '/ncrs'); await wait(2500);
  await id('ncr-new').click(); await wait(2000);
  await id('ncr-new-title').fill(`Soğutucu sıcaklığı yüksek ${RUN}`); await id('ncr-new-desc').fill('Gün içinde 9 °C ölçüldü.');
  await text('Sıcaklık / soğuk zincir').click(); await id('ncr-new-sev-major').click();
  await id('ncr-new-containment').fill('Ürünler yedek üniteye taşındı.'); await id('ncr-new-save').click(); await wait(3500);
  const ncr = p.url().split('/ncr/')[1];
  check('Şube yöneticisinde vaka paylaşım düğmesi yok (izin sahip/merkezde)', (await count('ncr-share-case')) === 0);
  await logout();
  await login(E.owner);
  await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000);
  await id('ncr-share-case').click(); await wait(2000);
  await id('case-summary').fill('Elif kapıyı açık bıraktı, servis 1500 TL aldı; bilgi için 0532 123 45 67.');
  await id('case-preview').click(); await wait(2500);
  t = await body();
  check('Önizleme: kişi adı, fiyat ve telefon yakalandı; paylaş kapalı', (await count('case-issues')) === 1 && t.includes('kişi adı') && t.includes('telefon') && t.includes('fiyat / ticari tutar') && await id('case-share').isDisabled());
  check('Hiç paylaşılmayanlar listeleniyor', t.includes('işletme ve şube adı') && t.includes('fotoğraf ve kanıt dosyaları'));
  await shot('vaka-onizleme-uyari');
  await id('case-summary').fill('Conta yırtılınca sıcaklık hızla yükseliyor; haftalık conta kontrolü işe yaradı.');
  await id('case-preview').click(); await wait(2500);
  check('Temiz özet: uyarı yok; izin kutusu', (await count('case-clean')) === 1 && (await count('case-permit')) === 1 && await id('case-share').isDisabled());
  await id('case-permit').click(); await shot('vaka-onizleme-temiz');
  await id('case-share').click(); await wait(3000);
  const casePost = p.url().split('/network/post/')[1];
  t = await body();
  check('Vaka taslak olarak oluştu (anonim kutu); işletme/şube adı yok', t.includes('VAKA PAYLAŞIMI · ANONİM') && t.includes('TASLAK') && !t.includes('Test işletmesi') && !t.includes(RUN.toUpperCase()));
  await id('net-publish-draft').click(); await wait(2500);
  check('Vaka yayımlandı; denetim kaydında izin', sql(`SELECT status FROM network_posts WHERE id = '${casePost}'`) === 'published'
    && sql(`SELECT count(*) FROM audit_events WHERE event_type = 'nonconformity.case_shared' AND entity_id = '${ncr}'`) === '1');
  await logout();

  // ── D. Moderator: reasoned decision; then block ──
  await login('moderator@demo.goverhub.test');
  await p.goto(WEB + '/moderation'); await wait(3000);
  const rep = sql(`SELECT id FROM network_reports WHERE target_id = '${badPost}'`);
  check('Moderasyon kuyruğunda şikâyet görünüyor', (await count(`mod-submit-${rep}`)) === 1);
  await id(`mod-decision-hide-${rep}`).click(); await id(`mod-notes-${rep}`).fill('kısa');
  check('Gerekçesiz karar verilemiyor', await id(`mod-submit-${rep}`).isDisabled());
  await id(`mod-notes-${rep}`).fill('Kaynak gösterilmeden yasal zorunluluk gibi sunulmuş; gizlendi.');
  await shot('moderasyon');
  await id(`mod-submit-${rep}`).click(); await wait(2500);
  check('Karar kaydedildi ve denetim kaydına yazıldı', sql(`SELECT status || ':' || decision FROM network_reports WHERE id = '${rep}'`) === 'actioned:hide'
    && sql(`SELECT count(*) FROM audit_events WHERE event_type = 'network.moderation_decision' AND entity_id = '${badPost}'`) === '1');
  await id('mod-closed').click(); await wait(2000);
  check('Karara bağlananlarda gerekçe ve karar veren görünüyor', (await body()).includes('Gerekçe: Kaynak gösterilmeden'));
  await logout();
  await login(E.staff);
  await p.goto(`${WEB}/network/post/${badPost}`); await wait(2500);
  check('Yazar gizleme gerekçesini görüyor', (await body()).includes('Moderasyonla gizlendi. Gerekçe: Kaynak gösterilmeden'));
  await p.goto(`${WEB}/network/p/${ownerId}`); await wait(3000);
  await id('net-block').click(); await wait(2500);
  await p.goto(WEB + '/network'); await wait(2500);
  check('Engelledikten sonra engellenen kişinin paylaşımları görünmüyor', (await count(`net-post-${myPost}`)) === 0 && (await count(`net-post-${casePost}`)) === 0);
  await p.goto(WEB + '/network/search'); await wait(2500); await id('net-q').fill(`Ayşe ${RUN}`); await wait(2000);
  check('Engellenen kişi aramada da çıkmıyor', (await count(`net-result-${ownerId}`)) === 0);

  check('Yatay taşma yok', !overflowSeen);
  console.log('Sayfa hataları:', errs.length ? errs.slice(0, 5).join(' | ') : 'yok');
  console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı · işletme ${CO}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  await b.close();
})().catch(async e => { console.error('HATA:', e.message.split('\n').slice(0, 3).join(' | ')); console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı (yarıda kesildi)`); process.exit(1); });
