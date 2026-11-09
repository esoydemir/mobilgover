/**
 * Local Docker demo: nonconformity flow end to end in a phone-sized browser (33 checks).
 * Every run creates its OWN demo business and sign-in addresses (server/src/seed/test-business.ts),
 * so runs never share cases, notifications or counters; the existing demo business is only read (K).
 *
 *   NODE_PATH=$(npm root -g) node e2e/yerel-demo-akis.cjs <screenshot-dir> <yerel-demo folder>
 */
const { chromium, devices } = require('playwright');
const { execSync } = require('child_process');
const WEB = process.env.WEB || 'http://localhost:8080', OUT = process.argv[2], DIR = process.argv[3];
const dc = cmd => execSync(`docker compose -p goverhub-demo ${cmd}`, { cwd: DIR }).toString().trim();
const sql = q => dc(`exec -T db psql -U postgres -d goverhub_demo -tAc "${q.replace(/"/g, '\\"')}"`);
const RUN = `r${Date.now().toString(36)}`;
const T = JSON.parse(dc(`exec -T app node node_modules/tsx/dist/cli.mjs src/seed/test-business.ts ${RUN}`).split('\n').pop());
const CO = T.companyId, E = T.emails;
let pass = 0, fail = 0;
const check = (label, ok) => { ok ? pass++ : fail++; console.log(`${ok ? 'GEÇTİ ' : 'KALDI '} ${label}`); };
console.log(`Çalıştırma ${RUN} · işletme ${CO}`);

(async () => {
  const b = await chromium.launch({ args: ['--no-proxy-server'] });
  const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  let n = 0; const shot = async name => { n++; await p.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png`, fullPage: false }); };
  const id = t => p.getByTestId(t).first();
  const text = (t, exact = true) => p.getByText(t, { exact }).first();
  const wait = ms => p.waitForTimeout(ms);
  const body = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  const overflow = async () => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  let overflowSeen = false;
  async function login(email) {
    await p.goto(WEB + '/login'); await id('login-email').waitFor();
    await id('login-email').fill(email); await text('Kod gönder').click(); await id('login-code').waitFor();
    await text('Demo kutusundan kodu getir').click(); await wait(700); await text('Giriş yap').click(); await wait(3000);
  }
  async function logout() { await p.goto(WEB + '/account'); await wait(1500); await id('logout').click(); await wait(1500); }
  const openNcr = async ncr => { await p.goto(`${WEB}/ncr/${ncr}`); await wait(3000); if (await overflow()) overflowSeen = true; };

  // ── A. Staff reports a problem ──
  await login(E.staff);
  await p.goto(WEB + '/ncrs'); await wait(2500);
  await id('ncr-new').click(); await wait(2000);
  await id('ncr-new-title').fill('Soğutucu kapısı tam kapanmıyor');
  await id('ncr-new-desc').fill('Mutfak arkadaki dolabın kapısı aralık kalıyor, conta yırtık görünüyor.');
  await text('Sıcaklık / soğuk zincir').click(); await id('ncr-new-sev-critical').click();
  await text('Buzdolabı · Mutfak arka').click();
  await id('ncr-new-containment').fill('Ürünleri yan dolaba taşıdım.');
  await shot('personel-sorun-bildir');
  await id('ncr-new-save').click(); await wait(3500);
  const ncr = p.url().split('/ncr/')[1];
  let t = await body();
  check('Personel elle uygunsuzluk açtı; risk yüksek, ilk müdahale kayıtlı', !!ncr && (t.includes('YÜKSEK') || t.includes('KRİTİK')) && t.includes('Ürünleri yan dolaba taşıdım.') && t.includes('Elle bildirildi'));
  await shot('uygunsuzluk-acildi');
  await id('cause-initial-open').click(); await id('cause-equipment').click(); await id('cause-knowledge').click();
  await id('cause-notes').fill('Conta yırtık; kapının kontrol edileceğini bilmiyordum.'); await id('cause-save').click(); await wait(3000);
  t = await body();
  // 6A: on a critical case the manager's first step comes first; support suggestions wait until it is done.
  check('İlk değerlendirme çoklu neden; kritik kayıtta önce ilk işlem, öneriler bekliyor',
    t.includes('İLK DEĞERLENDİRME') && t.includes('Ekipman eksikliği · Bilgi eksikliği') && t.includes('ÖNCE BUNLAR')
    && t.includes('ÖNERİLEN DESTEK') && !t.includes('Kişiye eğitim ata') && await p.getByTestId('support-waiting').count() === 1);
  await p.getByTestId('support-waiting').first().scrollIntoViewIfNeeded();
  await shot('destek-onerileri-bekliyor');
  await id('action-add-open').click(); await id('action-desc').fill('Contayı geçici bantla kapat, servisi bekle.');
  await text('4 saat').click(); await id('action-save').click(); await wait(3000);
  check('Personel kendine düzeltme aksiyonu ekledi', (await body()).includes('Contayı geçici bantla kapat'));
  await logout();

  // ── B. Owner: bell, assignment, due change with reason, support → service form (no request created) ──
  await login(E.owner);
  const badge = await p.getByTestId('home-bell').first().getAttribute('aria-label');
  check('Ana sayfa zilinde okunmamış bildirim sayısı', !!badge && /okunmamış/.test(badge));
  await shot('ana-sayfa-zil');
  await id('home-bell').click(); await wait(2500);
  t = await body();
  check('Bildirimlerde "Yeni uygunsuzluk" var', t.includes('Yeni uygunsuzluk: sorumlu ve termin bekliyor'));
  await shot('bildirimler-sahip');
  await p.getByTestId('note-ncr_reported').first().click(); await wait(3000);
  check('Bildirimden kayda gidildi', p.url().includes(`/ncr/${ncr}`));
  await id('ncr-assign-open').click(); await wait(1500);
  await text('Elif (personel) · Personel').click(); await text('Yarın').click(); await id('ncr-assign-save').click(); await wait(3000);
  await id('ncr-assign-open').click(); await wait(1500);
  await text('3 gün').click(); await wait(300);
  const reasonVisible = await p.getByTestId('ncr-due-reason').count();
  check('Termin sonradan değişince gerekçe isteniyor', reasonVisible > 0);
  await id('ncr-due-reason').fill('Yedek conta cuma geliyor.'); await id('ncr-assign-save').click(); await wait(3000);
  await p.reload(); await wait(3000);
  t = await body();
  check('Sorumlu ve termin kalıcı; geçmişte gerekçe görünüyor', t.includes('Elif (personel)') && t.includes('gerekçe: Yedek conta cuma geliyor.'));
  check('Sorumlu atanınca destek önerileri açıldı', t.includes('Kişiye eğitim ata') && await p.getByTestId('support-waiting').count() === 0);
  const before = sql(`SELECT count(*) FROM service_requests WHERE company_id = '${CO}'`);
  await id('support-go-service_request').click(); await wait(2500);
  t = await body();
  check('Destek önerisi talep formunu açtı; açıklama "Talebi aç"a basmadıkça oluşmaz diyor', p.url().includes('/service/new') && t.includes('basmadıkça talep oluşmaz'));
  await shot('hizmet-formu-oneri');
  check('Form açıldı ama talep oluşmadı', sql(`SELECT count(*) FROM service_requests WHERE company_id = '${CO}'`) === before);
  await logout();

  // ── C. Staff completes their action; effectiveness blocked until root cause verified ──
  await login(E.staff);
  await p.goto(WEB + '/notifications'); await wait(2500);
  check('Personel termin değişikliği bildirimini aldı (zaten sorumluydu)', (await body()).includes('Uygunsuzluk termini değişti'));
  await openNcr(ncr);
  await p.locator('[data-testid^="action-done-open-"]').first().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').first().fill('Bant yapıştırıldı, kapı kapanıyor.');
  await p.locator('[data-testid^="action-confirm-"]').first().click(); await wait(3000);
  t = await body();
  check('"Yapıldı" bir beyan: doğrulama bekliyor; etkinlik kontrolü için eksikler listeleniyor', t.includes('YAPILDI BEYANI · DOĞRULAMA BEKLİYOR') && t.includes('Önce tamamlanmalı') && t.includes('doğrulanmayı bekliyor'));
  check('Personel kök nedeni doğrulayamaz (düğme yok)', (await p.getByTestId('cause-verified-open').count()) === 0);
  await logout();

  // ── D. Site manager: corrective action + verified root cause ──
  await login(E.manager);
  await openNcr(ncr);
  await p.locator('[data-testid^="action-verify-open-"]').first().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').first().fill('Kapıyı kapatıp denedim, bant tutuyor.');
  await p.locator('[data-testid^="action-verify-ok-"]').first().click(); await wait(3000);
  await id('action-add-open').click(); await text('Düzeltici faaliyet').click();
  await id('action-desc').fill('Kapı contası açılış kontrol listesine eklensin.'); await id('action-save').click(); await wait(3000);
  await p.locator('[data-testid^="action-done-open-"]').last().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').last().fill('Açılış listesine eklendi.'); await p.locator('[data-testid^="action-confirm-"]').last().click(); await wait(3000);
  t = await body();
  const ownClaimBlocked = t.includes('DOĞRULANDI') && t.includes('payın var') && (await p.locator('[data-testid^="action-verify-open-"]').count()) === 0;
  await id('cause-verified-open').click(); await id('cause-process').click();
  await id('cause-notes').fill('Conta aşınmış; açılış kontrolünde kapı maddesi yoktu.'); await id('cause-save').click(); await wait(3000);
  t = await body();
  check('Müdür personelin beyanını doğruladı, kendi beyanını doğrulayamıyor; doğrulanmış kök neden ilk değerlendirmeden ayrı', ownClaimBlocked && t.includes('DOĞRULANMIŞ KÖK NEDEN') && t.includes('İLK DEĞERLENDİRME'));
  await shot('neden-ilk-ve-dogrulanmis');
  await logout();

  // ── D2. An independent HQ manager verifies the corrective action ──
  await login(E.hq);
  await openNcr(ncr);
  await p.locator('[data-testid^="action-verify-open-"]').first().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').first().fill('Açılış listesinde kapı maddesini gördüm.');
  await p.locator('[data-testid^="action-verify-ok-"]').first().click(); await wait(3000);
  await logout();

  // ── E. Staff: effectiveness check → verification requested ──
  await login(E.staff);
  await openNcr(ncr);
  await id('ncr-effectiveness-notes').fill('İki gün boyunca kapı kapalı, ölçümler 3 °C.'); await id('ncr-effectiveness-save').click(); await wait(4000);
  await p.reload(); await wait(3000);
  check('Durum: doğrulama bekliyor', (await body()).includes('DOĞRULAMA BEKLİYOR'));
  await logout();

  // ── F. Manager did this round's fix → cannot verify; owner: not effective → open, round 2 ──
  await login(E.manager);
  await openNcr(ncr);
  check('Bu turda düzeltici faaliyeti yapan yönetici kaydı doğrulayamıyor (açık uyarı)', (await body()).includes('payın var') && (await p.getByTestId('ncr-verify-ok').count()) === 0);
  await logout();
  await login(E.owner);
  await p.goto(WEB + '/notifications'); await wait(2500);
  check('Sahibe doğrulama isteği bildirimi geldi', (await body()).includes('Doğrulama isteği'));
  await openNcr(ncr);
  await id('ncr-verify-notes').fill('Bugünkü ölçüm 7 °C; kapı yine aralık kalıyor.'); await id('ncr-verify-fail').click(); await wait(3500);
  await p.reload(); await wait(3000);
  t = await body();
  check('Etkili değil → kayıt AÇIK kaldı, 2. tur, yeni aksiyon isteniyor', t.includes('AÇIK') && t.includes('2. TUR') && t.includes('yeni bir aksiyon'));
  await shot('dogrulama-basarisiz-acik');
  await logout();

  // ── G. Round 2: manager new corrective action + root cause again; staff check; owner verifies; reopen ──
  await login(E.manager);
  await openNcr(ncr);
  await id('action-add-open').click(); await text('Düzeltici faaliyet').click();
  await id('action-desc').fill('Kapı menteşesi ayarlansın.'); await id('action-save').click(); await wait(3000);
  await p.locator('[data-testid^="action-done-open-"]').last().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').last().fill('Menteşe ayarlandı, kapı kendiliğinden kapanıyor.'); await p.locator('[data-testid^="action-confirm-"]').last().click(); await wait(3000);
  await id('cause-verified-open').click(); await id('cause-notes').fill('Menteşe sarkmış; conta tek başına yetmedi.'); await id('cause-save').click(); await wait(3000);
  await logout();
  await login(E.hq);
  await openNcr(ncr);
  await p.locator('[data-testid^="action-verify-open-"]').first().click(); await wait(300);
  await p.locator('[data-testid^="action-notes-"]').first().fill('Menteşe ayarını yerinde kontrol ettim.');
  await p.locator('[data-testid^="action-verify-ok-"]').first().click(); await wait(3000);
  await logout();
  await login(E.staff);
  await openNcr(ncr);
  check('Personel doğrulama başarısızlığı bildirimini aldı', (await (async () => { await p.goto(WEB + '/notifications'); await wait(2000); return body(); })()).includes('Doğrulama başarısız'));
  await openNcr(ncr);
  await id('ncr-effectiveness-notes').fill('Üç gün boyunca 2–4 °C.'); await id('ncr-effectiveness-save').click(); await wait(4000);
  await logout();
  await login(E.owner);
  await openNcr(ncr);
  await id('ncr-verify-notes').fill('Ölçüm kayıtları ve menteşe ayarı incelendi.'); await id('ncr-verify-ok').click(); await wait(3500);
  await p.reload(); await wait(3000);
  check('Etkili → KAPALI', (await body()).includes('KAPALI'));
  await id('ncr-reopen-reason').fill('Sabah ölçümü 9 °C; kapı yine açık kalmış.'); await id('ncr-reopen').click(); await wait(3500);
  await p.reload(); await wait(3000);
  t = await body();
  check('Gerekçeli yeniden açma → AÇIK, 3. tur, 1 kez yeniden açıldı; geçmişte gerekçe', t.includes('1 KEZ YENİDEN AÇILDI') && t.includes('3. TUR') && t.includes('Yeniden açıldı: Sabah ölçümü 9 °C'));
  await shot('yeniden-acildi');
  check('Kapanış ve doğrulama kayıtları silinmedi', sql(`SELECT string_agg(result, ',' ORDER BY verified_at) FROM ncr_verifications WHERE ncr_id = '${ncr}'`) === 'not_effective,effective,reopened');

  // ── H. Mandatory obligation: "does not apply" → review; expert rejects ──
  await p.goto(WEB + '/obligations'); await wait(2500);
  await p.getByTestId('obl-EX-COLD-CHAIN').first().click(); await wait(3000);
  await id('override-open').click(); await wait(300);
  t = await body();
  check('Zorunlu yükümlülük: istek incelemeye gider açıklaması', t.includes('İNCELEMEYE GİDER') && t.includes('kontroller sürer'));
  await id('override-reason').fill('Dolap yalnızca içecek için; gıda saklanmıyor.');
  const saveDisabledWithoutFacts = await id('override-save').isDisabled();
  await id('dispute-storage.cold').click(); await wait(200);
  await id('override-basis').fill('Dolap içi fotoğrafları ve menü: soğukta gıda saklanmıyor.');
  await id('override-save').click(); await wait(3500);
  t = await body();
  check('Koşul seçilmeden istek gönderilemiyor; istek beklemede, itiraz edilen koşul ve dayanak görünüyor; sahip kendi isteğini inceleyemiyor',
    saveDisabledWithoutFacts && t.includes('İNCELEME BEKLİYOR') && t.includes('İTİRAZ EDİLEN KOŞULLAR') && t.includes('Soğuk depolama: şu an Evet → önerilen Hayır') && t.includes('Kendi isteğini inceleyemezsin'));
  await shot('uygulanmaz-istegi-beklemede');
  await logout();
  await login(E.expert);
  await p.goto(WEB + '/notifications'); await wait(2500);
  check('Danışmana inceleme bildirimi', (await body()).includes('"Uygulanmaz" isteği incelemeni bekliyor'));
  await p.getByTestId('note-obligation_review_requested').first().click(); await wait(3000);
  await id('review-notes').fill('Fotoğrafta dolapta süt ürünleri var; yükümlülük sürüyor.'); await id('review-reject').click(); await wait(3500);
  t = await body();
  check('Danışman reddetti; yükümlülük sürüyor', t.includes('Reddedildi · yükümlülük sürüyor'));
  await shot('inceleme-reddedildi');
  await logout();

  // ── I. Suspend staff → reassignment list (managers told once); then reactivate ──
  await login(E.owner);
  await p.goto(WEB + '/team'); await wait(2500);
  await p.getByPlaceholder('ör. İşten ayrıldı').fill('İzinli, bir hafta yok');
  const row = p.locator('div', { hasText: E.staff }).filter({ has: p.getByText('Pasifleştir', { exact: true }) }).last();
  await row.getByText('Pasifleştir', { exact: true }).click(); await wait(3000);
  await p.goto(WEB + '/ncrs'); await wait(3000);
  t = await body();
  check('Pasif personelin açık işleri yöneticinin yeniden atama listesinde', t.includes('YENİDEN ATAMA BEKLİYOR'));
  await id('reassign-open').click(); await wait(800);
  await shot('yeniden-atama-listesi');
  // One notification per suspension event: compare this run's manager's notifications with this run's suspensions.
  const suspensions = sql(`SELECT count(*) FROM audit_events WHERE company_id = '${CO}' AND event_type = 'member.suspend'`);
  const reassignNotes = sql(`SELECT count(*) FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = '${E.manager}' AND n.company_id = '${CO}' AND n.kind = 'reassignment_needed'`);
  console.log(`  pasifleştirme olayı: ${suspensions}, müdüre yeniden atama bildirimi: ${reassignNotes}`);
  check('Her pasifleştirme olayı için yöneticiye (müdür) tek "yeniden atama" bildirimi', suspensions === '1' && reassignNotes === suspensions);
  await p.goto(WEB + '/team'); await wait(2500);
  const row2 = p.locator('div', { hasText: E.staff }).filter({ has: p.getByText('Yeniden etkinleştir', { exact: true }) }).last();
  await row2.getByText('Yeniden etkinleştir', { exact: true }).click(); await wait(2500);

  // ── J. Equipment preview + retire/reactivate without duplicates ──
  await p.goto(WEB + '/equipment'); await wait(2500);
  await text('Buzdolabı · Mutfak arka', false).click(); await wait(2500);
  t = await body();
  check('Kaldırma önizlemesi: ileri kontroller iptal, saati geçmiş kontrol gecikmiş kalır, bugünkü kontrol açıklanıyor', t.includes('Kullanımdan kaldırırsan') && t.includes('silinmez') && t.includes('Bugünkü kontrol'));
  await shot('ekipman-onizleme');
  const countBefore = sql(`SELECT count(*) FROM tasks t JOIN equipment e ON e.id = t.equipment_id WHERE e.name = 'Buzdolabı · Mutfak arka' AND e.company_id = '${CO}'`);
  await p.locator('[data-testid^="eq-retire-reason-"]').first().fill('Conta değişimi için servise gitti');
  await p.locator('[data-testid^="eq-retire-"]:not([data-testid^="eq-retire-reason"]):not([data-testid^="eq-retire-preview"])').first().click(); await wait(3000);
  await p.goto(WEB + '/equipment'); await wait(2500);
  await text('Buzdolabı · Mutfak arka', false).click(); await wait(800);
  await p.locator('[data-testid^="eq-reactivate-"]').first().click(); await wait(1500);
  t = await body();
  check('Yeniden etkinleştirme mesajı: kontroller geri açıldı, ikinci kontrol oluşmaz', t.includes('geri açıldı') && t.includes('ikinci kontrol oluşmaz'));
  const dups = sql(`SELECT count(*) FROM (SELECT 1 FROM tasks t JOIN equipment e ON e.id = t.equipment_id WHERE e.name = 'Buzdolabı · Mutfak arka' AND e.company_id = '${CO}' AND t.status <> 'cancelled' GROUP BY t.equipment_id, t.template_code, t.period_key HAVING count(*) > 1) d`);
  const countAfter = sql(`SELECT count(*) FROM tasks t JOIN equipment e ON e.id = t.equipment_id WHERE e.name = 'Buzdolabı · Mutfak arka' AND e.company_id = '${CO}'`);
  check('Kaldır + yeniden etkinleştir yeni görev satırı üretmedi ve aynı gün için ikinci geçerli görev yok', dups === '0' && countAfter === countBefore);

  // ── K. Old (pre-update) case of the original demo business opens in the new screen (read only) ──
  await logout();
  await login('sahip@demo.goverhub.test');
  const v1 = sql(`SELECT n.id FROM nonconformities n JOIN companies c ON c.id = n.company_id WHERE c.name = 'Kahve Durağı (DEMO)' AND n.flow_version = 1 AND n.status = 'open' LIMIT 1`);
  await openNcr(v1);
  t = await body();
  check('Güncelleme öncesi açık kayıt yeni ekranda: eski düzeltme aksiyon olarak görünüyor', t.includes('Kapı ayarlandı (eski sürüm).') && t.includes('Ürünler yedek dolaba alındı (eski sürüm).'));
  await shot('eski-kayit-yeni-ekran');

  check('Yatay taşma yok', !overflowSeen && !(await overflow()));
  console.log('Sayfa hataları:', errs.length ? errs.slice(0, 5).join(' | ') : 'yok');
  console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı · uygunsuzluk ${ncr}`);
  await b.close();
})().catch(async e => { console.error('HATA:', e.message.split('\n')[0]); process.exit(1); });
