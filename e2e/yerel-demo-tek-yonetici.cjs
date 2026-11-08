/**
 * Local Docker demo, delivery 4: a business with ONE manager (the owner) and an invited outside verifier.
 * Every run creates its own demo business (server/src/seed/test-business.ts --single) and addresses.
 *
 *   NODE_PATH=$(npm root -g) node e2e/yerel-demo-tek-yonetici.cjs <screenshot-dir> <yerel-demo folder>
 */
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WEB = process.env.WEB || 'http://localhost:8080', OUT = process.argv[2], DIR = process.argv[3];
const dc = cmd => execSync(`docker compose -p goverhub-demo ${cmd}`, { cwd: DIR }).toString().trim();
const sql = q => dc(`exec -T db psql -U postgres -d goverhub_demo -tAc "${q.replace(/"/g, '\\"')}"`);
const RUN = `t${Date.now().toString(36)}`;
const T = JSON.parse(dc(`exec -T app node node_modules/tsx/dist/cli.mjs src/seed/test-business.ts ${RUN} --single`).split('\n').pop());
const CO = T.companyId, E = T.emails;
let pass = 0, fail = 0;
const check = (label, ok) => { ok ? pass++ : fail++; console.log(`${ok ? 'GEÇTİ ' : 'KALDI '} ${label}`); };
console.log(`Çalıştırma ${RUN} · tek yöneticili işletme ${CO} · doğrulayıcı ${E.verifier}`);

(async () => {
  const tmp = fs.mkdtempSync(path.join(OUT, 'dosya-'));
  const pdf = path.join(tmp, 'ruhsat.pdf'); fs.writeFileSync(pdf, Buffer.from(`%PDF-1.4\nruhsat ${RUN}\n%%EOF\n`));
  const limit = (await (await fetch(WEB + '/api/env')).json()).upload.maxBytes;
  const big = path.join(tmp, 'buyuk.pdf'); fs.writeFileSync(big, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(limit + 1024, 65)]));
  const txt = path.join(tmp, 'not.txt'); fs.writeFileSync(txt, 'düz metin');

  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'tr-TR', timezoneId: 'Europe/Istanbul', acceptDownloads: true });
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
  async function newCase(title, sev) {
    await p.goto(WEB + '/ncrs'); await wait(2500);
    await id('ncr-new').click(); await wait(2000);
    await id('ncr-new-title').fill(title); await id('ncr-new-desc').fill('Tek yöneticili işletmede test kaydı.');
    await text('Temizlik').click(); await id(`ncr-new-sev-${sev}`).click();
    await id('ncr-new-containment').fill('Alan kapatıldı.');
    await id('ncr-new-save').click(); await wait(3500);
    const ncr = p.url().split('/ncr/')[1];
    await id('ncr-assign-open').click(); await wait(1200);
    await text('Ahmet (işletme sahibi) · İşletme sahibi').click(); await text('Yarın').click(); await id('ncr-assign-save').click(); await wait(2500);
    await id('cause-initial-open').click(); await id('cause-process').click(); await id('cause-notes').fill('Temizlik listesinde eksik madde.'); await id('cause-save').click(); await wait(2500);
    return ncr;
  }
  async function addAndDeclare(kind, desc, done) {
    await id('action-add-open').click(); await wait(400);
    if (kind) await text(kind).click();
    await id('action-desc').fill(desc); await id('action-save').click(); await wait(2500);
    await p.locator('[data-testid^="action-done-open-"]').last().click(); await wait(300);
    await p.locator('[data-testid^="action-notes-"]').last().fill(done); await p.locator('[data-testid^="action-confirm-"]').last().click(); await wait(2500);
  }

  // ── A. Low risk: the only manager self-verifies, with a reason; it is labelled ──
  await login(E.owner);
  const low = await newCase('Depo rafı tozlu', 'minor');
  await addAndDeclare(null, 'Rafı sil, temizlik listesine ekle.', 'Raf silindi, listeye eklendi.');
  let t = await body();
  check('Düşük risk: politika metni ve "Öz doğrulama yap" seçeneği görünüyor; bağımsız doğrulama düğmesi yok',
    t.includes('Düşük risk') && (await p.locator('[data-testid^="action-self-verify-open-"]').count()) === 1 && (await p.locator('[data-testid^="action-verify-open-"]').count()) === 0);
  await p.locator('[data-testid^="action-self-verify-open-"]').first().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').first().fill('Kısa gerekçe');
  const okBtn = p.locator('[data-testid^="action-verify-ok-"]').first();
  const disabledShort = await okBtn.isDisabled();
  await p.locator('[data-testid^="action-notes-"]').first().fill('Tek yöneticiyiz; rafı fotoğraftaki hâliyle karşılaştırdım, toz yok.');
  const disabledUnconfirmed = await okBtn.isDisabled();
  await p.locator('[data-testid^="action-self-confirm-"]').first().click();
  await shot('oz-dogrulama-formu');
  await okBtn.click(); await wait(3000);
  t = await body();
  check('Öz doğrulama: kısa gerekçe ve onay işareti olmadan kaydedilmiyor; kayıt "ÖZ DOĞRULAMA" etiketli; roller ayrı yazıyor',
    disabledShort && disabledUnconfirmed && t.includes('DOĞRULANDI · ÖZ DOĞRULAMA') && t.includes('Sorumlu: Ahmet') && t.includes('Beyan eden: Ahmet'));
  await id('ncr-effectiveness-notes').fill('Bir hafta raflar temiz.'); await id('ncr-effectiveness-save').click(); await wait(3500);
  await p.reload(); await wait(3000);
  await id('ncr-verify-notes').fill('Tek yöneticiyiz; bir haftalık temizlik kayıtları tam ve raflar temiz.');
  await id('ncr-self-confirm').click(); await id('ncr-verify-ok').click(); await wait(3500);
  await p.reload(); await wait(3000);
  t = await body();
  check('Düşük riskli kayıt öz doğrulama ile kapandı ve kapanış etiketli', t.includes('KAPALI') && t.includes('ÖZ DOĞRULAMA'));
  await shot('dusuk-risk-oz-dogrulama-kapali');

  // ── B. High risk: no self-verification; invite an outside verifier ──
  const high = await newCase('Dondurucu alarmı çalışmıyor', 'critical');
  await addAndDeclare(null, 'Alarm pilini değiştir.', 'Pil değişti, alarm çalıyor.');
  t = await body();
  check('Yüksek risk: öz doğrulama yok; "dış doğrulayıcı" gerekçesi ve davet düğmesi var',
    (await p.locator('[data-testid^="action-self-verify-open-"]').count()) === 0 && t.includes('dış doğrulayıcı doğrulamalı') && (await p.locator('[data-testid^="action-invite-verifier-"]').count()) === 1);
  await shot('yuksek-risk-dis-dogrulayici-gerekli');
  await p.locator('[data-testid^="action-invite-verifier-"]').first().click(); await wait(2500);
  await id('verifier-email').fill(E.verifier); await id('verifier-days-30').click(); await id('verifier-documents').click();
  await id('verifier-note').fill('Tek yöneticiliyiz; yüksek riskli kayıtları bağımsız doğrulaması için.');
  await shot('dis-dogrulayici-davet');
  await id('verifier-invite').click(); await wait(3000);
  t = await body();
  check('Davet: sınırlı kapsam (şube, süre, doğrulama + belge inceleme) ile ETKİN izin listede', t.includes(E.verifier) && t.includes('ETKİN') && t.includes('doğrulama + belge inceleme'));
  await logout();

  // ── C. The outside verifier ──
  await login(E.verifier);
  check('Doğrulayıcı girişte doğrulama listesine yönleniyor', p.url().includes('/verify-queue'));
  t = await body();
  check('Listede bekleyen aksiyon beyanı var ve doğrulayabilir', t.includes('AKSİYON BEYANI') && t.includes('Alarm pilini değiştir.') && t.includes('Doğrulayabilirsin'));
  await shot('dogrulayici-listesi');
  await p.goto(WEB + '/notifications'); await wait(2500);
  check('Doğrulayıcıya davet bildirimi geldi', (await body()).includes('Dış doğrulayıcı olarak davet edildin'));
  await p.goto(`${WEB}/ncr/${high}`); await wait(3000); await look();
  check('Doğrulayıcı aksiyon ekleyemiyor, sorumlu atayamıyor (düğmeler yok)', (await p.getByTestId('action-add-open').count()) === 0 && (await p.getByTestId('ncr-assign-open').count()) === 0);
  await p.locator('[data-testid^="action-verify-open-"]').first().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').first().fill('Alarmı test butonuyla denedim, çalıyor.');
  await p.locator('[data-testid^="action-verify-ok-"]').first().click(); await wait(3000);
  check('Doğrulayıcı düzeltmeyi doğruladı (dış doğrulayıcı etiketi)', (await body()).includes('DOĞRULANDI · DIŞ DOĞRULAYICI'));
  await logout();

  // ── D. Owner: corrective action and root cause; cannot close own work ──
  await login(E.owner);
  await p.goto(`${WEB}/ncr/${high}`); await wait(3000);
  await addAndDeclare('Düzeltici faaliyet', 'Alarm testini haftalık listeye ekle.', 'Haftalık listeye eklendi.');
  await logout();
  await login(E.verifier);
  await p.goto(`${WEB}/ncr/${high}`); await wait(3000);
  await p.locator('[data-testid^="action-verify-open-"]').first().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').first().fill('Haftalık listede alarm maddesini gördüm.');
  await p.locator('[data-testid^="action-verify-ok-"]').first().click(); await wait(3000);
  await logout();
  await login(E.owner);
  await p.goto(`${WEB}/ncr/${high}`); await wait(3000);
  await id('cause-verified-open').click(); await id('cause-equipment').click();
  await id('cause-notes').fill('Pil ömrü takip edilmiyordu; listede alarm yoktu.'); await id('cause-save').click(); await wait(2500);
  await id('ncr-effectiveness-notes').fill('İki hafta alarm testleri başarılı.'); await id('ncr-effectiveness-save').click(); await wait(3500);
  await p.reload(); await wait(3000);
  t = await body();
  check('Sahip kendi işini kapatamıyor: öz doğrulama yok, dış doğrulayıcı daveti öneriliyor',
    (await p.getByTestId('ncr-verify-ok').count()) === 0 && t.includes('payın var') && (await p.getByTestId('ncr-invite-verifier').count()) === 1);
  await shot('sahip-kapatamaz');
  await logout();
  await login(E.verifier);
  await p.goto(WEB + '/verify-queue'); await wait(2500);
  check('Doğrulayıcının listesinde kapanış bekliyor', (await body()).includes('KAPANIŞ'));
  await p.goto(`${WEB}/ncr/${high}`); await wait(3000);
  await id('ncr-verify-notes').fill('Test kayıtları ve alarm denemesi yerinde incelendi.'); await id('ncr-verify-ok').click(); await wait(3500);
  await p.reload(); await wait(3000);
  t = await body();
  check('Yüksek riskli kayıt dış doğrulayıcı tarafından kapatıldı (etiketli)', t.includes('KAPALI') && t.includes('dış doğrulayıcı'));
  await shot('dis-dogrulayici-kapatti');
  const closeRow = sql(`SELECT verification_mode || '/' || verified_via FROM ncr_verifications WHERE ncr_id = '${high}' AND result = 'effective'`);
  check('Veritabanında kapanış "bağımsız / dış izin" olarak kayıtlı', closeRow === 'independent/grant');
  await logout();

  // ── E. Documents: type and size rules, upload, internal review (by the verifier), issuer check, download ──
  await login(E.owner);
  await p.goto(WEB + '/documents/new'); await wait(2000);
  await id('doc-type-business_license').click(); await id('doc-title').fill('İşyeri açma ruhsatı'); await id('doc-create').click(); await wait(3000);
  const docUrl = p.url();
  await id('doc-version-open').click(); await wait(300);
  t = await body();
  check('Dosya türü ve boyut sınırı seçmeden önce yazıyor', t.includes('Kabul edilen türler: PDF, JPEG, PNG') && t.includes(`En fazla ${Math.round(limit / 1048576)}`));
  await choose(id('doc-file-pick'), txt); await wait(800);
  const typeErr = (await body()).includes('Bu dosya türü kabul edilmiyor');
  await choose(id('doc-file-pick'), big); await wait(1500);
  const sizeErr = (await body()).includes('Dosya çok büyük');
  check('Desteklenmeyen tür ve büyük dosya açık hatayla reddediliyor', typeErr && sizeErr);
  await choose(id('doc-file-pick'), pdf); await wait(800);
  check('Seçilen dosyanın adı, türü ve boyutu görünüyor', (await body()).includes('ruhsat.pdf · PDF'));
  await id('doc-version-save').click(); await wait(3500);
  t = await body();
  check('Yüklendi: "İNCELENMEDİ" ve resmî doğrulama olmadığı açıklaması', t.includes('İNCELENMEDİ') && t.includes('geçerli olduğu anlamına gelmez'));
  const [dl] = await Promise.all([p.waitForEvent('download'), id('doc-file-download-1').click()]);
  check('Dosya indirilebiliyor (aynı bayt)', fs.readFileSync(await dl.path()).equals(fs.readFileSync(pdf)));
  await shot('belge-incelenmedi');
  await logout();
  await login(E.verifier);
  await p.goto(docUrl); await wait(3000);
  await id('doc-review-open-1').click(); await wait(300);
  await id('doc-review-notes-1').fill('Ruhsat aslıyla karşılaştırıldı.'); await id('doc-review-ok-1').click(); await wait(3500);
  t = await body();
  check('Kurum içi incelendi; resmî doğrulama olmadığı yazıyor', t.includes('KURUM İÇİ İNCELENDİ') && t.includes('düzenleyen kurumun resmî doğrulaması değildir'));
  await logout();
  await login(E.owner);
  await p.goto(docUrl); await wait(3000);
  await id('doc-issuer-open-1').click(); await wait(300);
  await id('doc-issuer-ref-1').fill('Barkod 4455-6677'); await id('doc-issuer-save-1').click(); await wait(3500);
  t = await body();
  check('Kurum doğrulaması yöntem ve referansla kayıtlı: "DÜZENLEYEN KURUMDAN DOĞRULANDI"', t.includes('DÜZENLEYEN KURUMDAN DOĞRULANDI') && t.includes('ref. Barkod 4455-6677'));
  await shot('belge-kurumdan-dogrulandi');

  // ── F. Revoke: the verifier sees nothing any more ──
  await p.goto(WEB + '/verifiers'); await wait(2500);
  await id(`verifier-revoke-${E.verifier}`).click(); await wait(2500);
  check('İzin kaldırıldı', (await body()).includes('KALDIRILDI'));
  await logout();
  await login(E.verifier);
  await p.goto(`${WEB}/ncr/${high}`); await wait(3000);
  t = await body();
  check('İzni kaldırılan doğrulayıcı kaydı göremiyor', !t.includes('Dondurucu alarmı çalışmıyor'));

  check('Yatay taşma yok', !overflowSeen);
  console.log('Sayfa hataları:', errs.length ? errs.slice(0, 5).join(' | ') : 'yok');
  console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı · düşük risk ${low} · yüksek risk ${high}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  await b.close();
})().catch(async e => { console.error('HATA:', e.message.split('\n')[0]); console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı (yarıda kesildi)`); process.exit(1); });
