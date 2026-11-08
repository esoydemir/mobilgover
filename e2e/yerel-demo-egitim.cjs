/**
 * Local Docker demo, delivery 5A: knowledge gap in a case → training assigned → staff reads, passes,
 * completes → field application evidence (their own action with a photo) → field effectiveness by
 * the manager; the case stays open. Plus: content authoring vs publishing, a verifier limited to
 * one case, and the attribution of an issuer check. Own demo business per run.
 *
 *   NODE_PATH=$(npm root -g) node e2e/yerel-demo-egitim.cjs <screenshot-dir> <yerel-demo folder>
 */
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WEB = process.env.WEB || 'http://localhost:8080', OUT = process.argv[2], DIR = process.argv[3];
const dc = cmd => execSync(`docker compose -p goverhub-demo ${cmd}`, { cwd: DIR }).toString().trim();
const sql = q => dc(`exec -T db psql -U postgres -d goverhub_demo -tAc "${q.replace(/"/g, '\\"')}"`);
const RUN = `e${Date.now().toString(36)}`;
const T = JSON.parse(dc(`exec -T app node node_modules/tsx/dist/cli.mjs src/seed/test-business.ts ${RUN}`).split('\n').pop());
const CO = T.companyId, E = T.emails;
let pass = 0, fail = 0;
const check = (label, ok) => { ok ? pass++ : fail++; console.log(`${ok ? 'GEÇTİ ' : 'KALDI '} ${label}`); };
console.log(`Çalıştırma ${RUN} · işletme ${CO}`);

(async () => {
  const tmp = fs.mkdtempSync(path.join(OUT, 'dosya-'));
  const jpg = path.join(tmp, 'kapi.jpg'); fs.writeFileSync(jpg, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`kapi-${RUN}`)]));
  const pdf = path.join(tmp, 'ruhsat.pdf'); fs.writeFileSync(pdf, Buffer.from(`%PDF-1.4\nruhsat ${RUN}\n%%EOF\n`));
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  let n = 0; const shot = async name => { n++; await p.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png` }); };
  const id = t => p.getByTestId(t).first();
  const text = (t, exact = true) => p.getByText(t, { exact }).first();
  const wait = ms => p.waitForTimeout(ms);
  const body = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
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

  // ── A. Manager: case with a knowledge gap → assign training from the suggestion ──
  await login(E.manager);
  await p.goto(WEB + '/ncrs'); await wait(2500);
  await id('ncr-new').click(); await wait(2000);
  await id('ncr-new-title').fill('Personel soğutucu kapısını açık bırakıyor');
  await id('ncr-new-desc').fill('Gün içinde iki kez kapı aralık bulundu.');
  await text('Sıcaklık / soğuk zincir').click(); await id('ncr-new-sev-major').click();
  await id('ncr-new-containment').fill('Kapı kapatıldı, ürünler kontrol edildi.');
  await id('ncr-new-save').click(); await wait(3500);
  const ncr = p.url().split('/ncr/')[1];
  await id('ncr-assign-open').click(); await wait(1200);
  await text('Elif (personel) · Personel').click(); await text('Yarın').click(); await id('ncr-assign-save').click(); await wait(2500);
  await id('cause-initial-open').click(); await id('cause-knowledge').click();
  await id('cause-notes').fill('Personel kapının her açılıştan sonra kontrol edileceğini bilmiyordu.'); await id('cause-save').click(); await wait(2500);
  let t = await body();
  check('Bilgi eksikliğinde "Kişiye eğitim ata" önerisi var (artık "henüz yok" değil)', t.includes('Kişiye eğitim ata') && !t.includes('HENÜZ YOK'));
  await id('support-go-training').click(); await wait(3000);
  t = await body();
  check('Atama ekranı uygunsuzluğu ve konuyla ilgili örnek eğitimi gösteriyor', t.includes('Personel soğutucu kapısını açık bırakıyor') && t.includes('BU KONUYLA İLGİLİ') && t.includes('ÖRNEK İÇERİK'));
  await text('Soğutucu kapısı ve sıcaklık kontrolü (ÖRNEK)').click();
  await id(`person-${staffId}`).click(); await text('3 gün').click();
  await shot('egitim-ata');
  await id('tr-assign-save').click(); await wait(3500);
  t = await body();
  check('Uygunsuzlukta EĞİTİM kartı: ATANDI; "kaydı kapatmaz" açıklaması', p.url().includes(`/ncr/${ncr}`) && t.includes('EĞİTİM') && t.includes('ATANDI') && t.includes('bu kaydı kapatmaz'));
  // Field application: an action for the learner that asks for a photo.
  check('Atamadan sonra aynı kayıt ekranına dönüldü (üst üste ikinci ekran yok)', (await p.getByTestId('action-add-open').count()) === 1);
  await id('action-add-open').click(); await id('action-desc').fill('Açılışta kapı ve conta kontrolünü uygula.');
  await text('Elif (personel) · Personel').click(); await id('action-evidence-photo').click(); await id('action-save').click(); await wait(2500);

  // A second, unrelated case (the limited verifier must not see it).
  await p.goto(WEB + '/ncrs'); await wait(2500);
  await id('ncr-new').click(); await wait(2000);
  await id('ncr-new-title').fill('Depo rafı tozlu (başka kayıt)'); await id('ncr-new-desc').fill('Raf temizliği atlanmış.');
  await text('Temizlik').click(); await id('ncr-new-sev-minor').click(); await id('ncr-new-save').click(); await wait(3500);
  const otherNcr = p.url().split('/ncr/')[1];

  // ── B. Authoring and publishing are separate ──
  await p.goto(WEB + '/trainings'); await wait(2000);
  await id('tr-tab-courses').click(); await wait(2000);
  await id('tr-new').click(); await wait(1500);
  await id('tr-title').fill('Açılış kontrol listesi'); await id('tr-summary').fill('Sabah açılışında yapılacaklar');
  await id('tr-bodytext').fill('Açılışta soğutucu kapılarını, contaları ve sıcaklıkları kontrol et; sapmayı hemen bildir.');
  await id('tr-link-cold_chain_temperature').click();
  await id('tr-add-q').click(); await id('tr-q-0').fill('Sapma görürsen?'); await id('tr-q-0-o-0').fill('Hemen bildiririm'); await id('tr-q-0-o-1').fill('Beklerim');
  await id('tr-save').click(); await wait(3000);
  await id('tr-submit').click(); await wait(2500);
  t = await body();
  check('Şube yöneticisi taslağı incelemeye gönderdi; yayımlayamıyor (ayrı yetki)', t.includes('İNCELEMEDE') && t.includes('İçerik yazma ve yayımlama ayrı yetkilerdir') && (await p.getByTestId('tr-publish').count()) === 0);
  const courseUrl = p.url();
  await logout();
  await login(E.owner);
  await p.goto(courseUrl); await wait(3000);
  await id('tr-publish').click(); await wait(3000);
  check('İşletme sahibi yayımladı (sürüm 1 YAYIMLANDI)', (await body()).includes('YAYIMLANDI · SÜRÜM 1'));
  await shot('icerik-yayimlandi');
  await logout();

  // ── C. Staff: read → assessment (wrong, then right) → complete ──
  await login(E.staff);
  await p.goto(WEB + '/notifications'); await wait(2500);
  check('Personele "Sana bir eğitim atandı" bildirimi', (await body()).includes('Sana bir eğitim atandı'));
  await p.getByTestId('note-training_assigned').first().click(); await wait(3000); await look();
  t = await body();
  check('Atama ekranı: dört ayrı durum; katılım kaydının resmî sertifika olmadığı yazıyor; örnek etiketi var',
    t.includes('Okundu / izlendi') && t.includes('Tamamlandı') && t.includes('Değerlendirmeyi geçti') && t.includes('Sahada etkinliği doğrulandı') && t.includes('resmî sertifika') && t.includes('ÖRNEK İÇERİK'));
  check('Okumadan değerlendirme ve tamamlama yok', (await p.getByTestId('tr-attempt').count()) === 0 && (await p.getByTestId('tr-complete').count()) === 0);
  await id('tr-read').click(); await wait(2500);
  await id('tr-ans-0-0').click(); await id('tr-ans-1-1').click(); await id('tr-ans-2-0').click();
  await id('tr-attempt').click(); await wait(2500);
  check('Yanlış cevapla geçemedi (puan ve geçme puanı gösteriliyor)', (await body()).includes('geçme puanı'));
  await id('tr-ans-0-1').click(); await id('tr-ans-1-0').click(); await id('tr-ans-2-0').click();
  await id('tr-attempt').click(); await wait(2500);
  await id('tr-complete').click(); await wait(2500);
  t = await body();
  check('Okundu, geçti ve tamamlandı ayrı kayıtlı; sahada doğrulama bekliyor', t.includes('%100') && (await p.getByTestId('tr-complete').count()) === 0 && t.includes('Sahada etkinliği doğrulandı'));
  await shot('personel-tamamladi');
  check('Personel kendi eğitimini sahada doğrulayamıyor (form yok)', (await p.getByTestId('tr-field-save').count()) === 0);
  // Field application: the learner does the action with a photo.
  await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000);
  await choose(p.locator('[data-testid^="action-evidence-add-"]').first(), jpg); await wait(3000);
  await p.locator('[data-testid^="action-done-open-"]').first().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').first().fill('Açılışta kapıyı ve contayı kontrol ettim, kapalı.');
  await p.locator('[data-testid^="action-confirm-"]').first().click(); await wait(2500);
  check('Personel sahada uygulamayı fotoğraflı aksiyonla bildirdi', (await body()).includes('YAPILDI BEYANI'));
  await logout();

  // ── D. Manager: field effectiveness, pointing to the learner's action; the case stays open ──
  await login(E.manager);
  await p.goto(WEB + '/notifications'); await wait(2500);
  check('Yöneticiye "Eğitim tamamlandı: sahada etkinliğini doğrula" bildirimi', (await body()).includes('Eğitim tamamlandı: sahada etkinliğini doğrula'));
  await p.getByTestId('note-training_completed').first().click(); await wait(3000);
  await p.locator('[data-testid^="tr-field-action-"]').first().click();
  await id('tr-field-notes').fill('Üç açılışta kapıyı kapalı ve contayı kontrol edilmiş gördüm; fotoğraf da var.');
  await shot('saha-dogrulama');
  await id('tr-field-save').click(); await wait(3000);
  t = await body();
  check('Sahada etkinlik kaydedildi (etkili, kim, uygulama kanıtı)', t.includes('SAHADA ETKİNLİK') && t.includes('uygulama kanıtı: bağlı aksiyon'));
  await id('tr-open-ncr').click(); await wait(3000);
  t = await body();
  check('Uygunsuzluk hâlâ açık; eğitim kartında "SAHADA ETKİLİ"; geçmişte eğitim kayıtları', t.includes('SAHADA ETKİLİ') && !t.includes('KAPALI') && t.includes('Eğitimin sahadaki etkinliği kaydedildi'));
  check('Veritabanı: uygunsuzluk açık; atamada dört ayrı zaman', sql(`SELECT status FROM nonconformities WHERE id = '${ncr}'`) === 'open'
    && sql(`SELECT (read_at IS NOT NULL)::text || (completed_at IS NOT NULL)::text || (passed_at IS NOT NULL)::text || field_result FROM training_assignments WHERE ncr_id = '${ncr}'`) === 'truetruetrueeffective');
  await shot('uygunsuzluk-acik-egitim-etkili');
  await logout();

  // ── E. Verifier limited to this one case ──
  await login(E.owner);
  await p.goto(`${WEB}/verifiers?ncrId=${ncr}`); await wait(2500);
  await id('verifier-email').fill(E.verifier); await id('verifier-days-7').click();
  await id('verifier-note').fill('Yalnız bu kaydın bağımsız doğrulaması için.');
  check('Davet ekranı "Yalnız seçili kayıtlar" ile açıldı; belge yetkisi seçeneği yok', (await body()).includes('Yalnız seçili kayıtlar') && (await p.getByTestId('verifier-documents').count()) === 0);
  await shot('kayda-ozel-davet');
  await id('verifier-invite').click(); await wait(3000);
  check('İzin listesinde kayıt adıyla görünüyor', (await body()).includes('Yalnız: Personel soğutucu kapısını açık bırakıyor'));
  await logout();
  await login(E.verifier);
  await p.goto(WEB + '/ncrs'); await wait(3000);
  t = await body();
  check('Doğrulayıcı listesinde yalnız bu kayıt var', t.includes('Personel soğutucu kapısını açık bırakıyor') && !t.includes('Depo rafı tozlu'));
  await p.goto(`${WEB}/ncr/${otherNcr}`); await wait(2500);
  check('Başka bir kaydı açamıyor', !(await body()).includes('Depo rafı tozlu'));
  await logout();

  // ── F. Issuer check: who recorded it, how, with which reference ──
  await login(E.owner);
  await p.goto(WEB + '/documents/new'); await wait(2000);
  await id('doc-type-business_license').click(); await id('doc-title').fill('İşyeri açma ruhsatı'); await id('doc-create').click(); await wait(3000);
  const doc = p.url();
  await id('doc-version-open').click(); await choose(id('doc-file-pick'), pdf); await wait(800); await id('doc-version-save').click(); await wait(3500);
  await logout();
  await login(E.manager);
  await p.goto(doc); await wait(3000);
  await id('doc-review-open-1').click(); await id('doc-review-notes-1').fill('Aslıyla karşılaştırıldı.'); await id('doc-review-ok-1').click(); await wait(3000);
  await id('doc-issuer-open-1').click(); await id('doc-issuer-ref-1').fill('Belediye e-sorgu 2026/77'); await id('doc-issuer-save-1').click(); await wait(3000);
  t = await body();
  check('Kurum doğrulaması: "uygulama sorgulamadı", kaydeden kişi, yöntem ve referans görünüyor',
    t.includes('KURUMDAN DOĞRULANDI · KİŞİ KAYDI') && t.includes('Uygulama sorgulamadı · Selin (şube yöneticisi) kaydetti') && t.includes('Barkod / doğrulama kodu sorgusu') && t.includes('ref. Belediye e-sorgu 2026/77'));
  await shot('kurum-dogrulamasi-kim-kaydetti');

  check('Yatay taşma yok', !overflowSeen);
  console.log('Sayfa hataları:', errs.length ? errs.slice(0, 5).join(' | ') : 'yok');
  console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı · uygunsuzluk ${ncr}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  await b.close();
})().catch(async e => { console.error('HATA:', e.message.split('\n').slice(0, 3).join(' | ')); console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı (yarıda kesildi)`); process.exit(1); });
