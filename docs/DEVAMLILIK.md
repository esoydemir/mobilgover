# Devamlılık raporu — bu teslim ile önceki GoverHub projesi

Tarih: 31.10.2026. Karşılaştırılan iki kod tabanı:

| | Önceki proje | Bu teslim |
|---|---|---|
| Depo | GitHub `esoydemir/goverhub` (özel) | Yerel depo; GitHub'a gönderilmedi. Git paketi ve kaynak arşivi olarak teslim edildi. |
| Başlangıç | `fa9059d` "GoverHub v4.0 pre-transformation baseline" (25.08.2026) | `ae727a5` "Claude Design handoff" (30.10.2026) |
| En ileri dal | `feat/f1-closure-on-main`, `ed7dfb1` (30.10.2026), 241 commit. `main` dalı 212 commit. | `goverhub-mobile`, 16 commit |
| Yığın | npm workspaces monorepo: `apps/api` (kendi HTTP katmanı), `apps/web` ve `apps/admin` (Next.js), `apps/mobile` (Expo), `packages/*` | `server/` (Fastify), `mobile/` (Expo Router) |
| Test sayısı (kaynak) | Kendi raporuna göre 93 dosya / 2025 test (26.10.2026); E2E 25 test geçti, 1 test bilerek başarısız bırakıldı | 94 test (31 birim + 63 gerçek entegrasyon); arayüz kayıtları ayrıca |

## 1. İlişki: bu teslim ayrı bir yeniden geliştirmedir

**Bu teslim önceki projeden türemiyor.** Ortak commit, ortak dosya ya da kod taşıması yok. Bu oturum yalnızca Claude Design'dan dışa aktarılan mobil prototiple başladı ve önceki deponun varlığından habersizdi. Sunucu, veritabanı şeması ve mobil uygulama sıfırdan yazıldı. Bu yüzden:

- **246 → 16 commit:** İki ayrı geçmiş. 246 sayısı önceki projenin senin bilgisayarındaki durumuna ait. GitHub'daki en ileri dalda 241 commit görünüyor.
- **603e1a2:** GitHub'daki 33 dalın ve 1 etiketin hiçbirinde bu commit yok. Büyük olasılıkla yalnızca senin bilgisayarında, gönderilmemiş (yaklaşık 5) commit'in son halidir. Bu teslimle hiçbir bağı yok; içeriğini göremedim.
- **2206 → 94 test:** Farklı kod, farklı kapsam. Önceki projenin gönderilmiş son raporunda 2025 test geçiyor; 2206 rakamı muhtemelen 603e1a2'deki durum ve bunu doğrulayamadım. İki sayı aynı şeyi ölçmüyor:
  - Önceki projenin testlerinin çoğu altyapıyı denetliyor: geçiş, RLS, rol izolasyonu, hız sınırı, outbox, kanıt manifesti, erişilebilirlik, CI kapıları.
  - Bu teslimin testleri iş akışını denetliyor: kural, yükümlülük, görev, kanıt, CAPA, pazar yeri, çevrimdışı.

Önceki depoyu bu raporu hazırlamak için yalnızca okudum; hiçbir değişiklik yapmadım.

## 2. Özellik eşlemesi

### Önceki projede olup bu teslimde yeniden yazılanlar (karşılığı var, kod taşınmadı)

| Alan | Önceki proje | Bu teslim |
|---|---|---|
| Kiracı izolasyonu (RLS) | `db/migrations/0002, 0004, 0006`; ayrıca 0022 ile her rol için ayrı veritabanı girişi (3 bağlantı havuzu) | `001_core.sql`: `app_tenant_ok` + iki rol (tablo sahibi / uygulama) |
| Kimlik doğrulama | Telefon + SMS tek kullanımlık kodu (`auth/otp.ts`, `auth/sms`) | E-posta + tek kullanımlık kod; yöneticilerde ek olarak TOTP |
| Oturum | Yenileme jetonu döndürme; jeton yeniden kullanılırsa tüm oturum ailesi iptal edilir (`auth/sessions.ts`) | 12 saatlik oturum jetonu; listeleme ve iptal. **Yenileme jetonu ve yeniden kullanım tespiti yok.** |
| Yetki | Rol şablonları, işletmeye özel roller, politika motoru, yetki denetim kaydı (`authz/*`) | Sabit rol matrisi (`domain/permissions.ts`) + süreli erişim izinleri |
| Denetim / kanıt zinciri | `audit_log` + `proof_chain` (0010, 0011) | `audit_events` karma zinciri |
| Kural motoru | `packages/obligation-core` (koşul ağacı ve değerlendirme) | `domain/conditions.ts` (üç değerli mantık) + kural yaşam döngüsü |
| Mevzuat kaynak kaydı | `regulatory/source-registry.ts` (0020) | `legal_sources`, `source_versions`, `provisions` |
| Saklama süreleri | `privacy/retention.ts`, yasal saklama (0013) | `retention_policies` matrisi; hiçbir silme işi yok |
| İşlem tekrarı koruması (idempotency) | 0019 `request_idempotency` | `client_operations` |
| Hız sınırı | PostgreSQL'de tutuluyor, genel tavan dahil (0017, 0021) | Bellek içi; birden fazla sunucuda paylaşılmaz |
| Çevrimdışı | `packages/client-core/src/offline` (kuyruk, çakışma, medya, oturum dönemi) | `mobile/src/api/syncEngine.ts` |

### Önceki projede olup bu teslime taşınmayanlar

- Next.js web ve yönetim (admin) uygulamaları; tasarım sistemi paketi; i18n paketi.
- Rıza ve gizlilik modülü (`privacy/consent.ts`, 0012) ve okuma erişim denetimi (PRIV-009).
- Outbox ve kuyruk dağıtımı (0015, 0016, 0018).
- Her rol için ayrı veritabanı girişi (R-38 düzeltmesi).
- Gereksinim matrisi (617 satır), kanıt manifesti, kontrol betikleri (`check:*`), CI kapıları, geri alma (rollback) kitabı, WCAG ölçümü.
- Eski v4 uygulaması (`legacy/v4-qatar`).

### Bu teslimde olup önceki projede olmayanlar (yeni yazıldı)

- **Kural yaşam döngüsü:** Taslak, alan uzmanı incelemesi, onay ve yayın aşamaları. Yayınlanınca işletmeler yeniden değerlendirilir.
- **Yükümlülükler:** "Neden bana uygulanıyor?" açıklaması dahil.
- **Görevler:** Takvim, ölçüm, limit ve kanıt; kanıt dosyası iki aşamada yüklenir ve parmak iziyle doğrulanır.
- **Uygunsuzluk ve CAPA:** Bağımsız kapanış, risk derinliği.
- **Rapor ve göstergeler:** Gösterge puanı ve denetim dosyası.
- **Uzman ağı ve hizmet pazarı.**
- **İşletme kurulum akışı.**
- **Bu iş akışlarına bağlı mobil ekranlar.**

Önceki projenin API'sinde HTTP üzerinden yalnızca şu uçlar açık: `health`, `version`, `auth/otp`, `auth/organizations`, `locations`. Bu iş akışları orada yok.

## 3. Güvenlik kontrollerinin karşılıkları

| Kontrol | Önceki proje (kod · test) | Bu teslim (kod · test) | Fark |
|---|---|---|---|
| Çalışan daveti | `IdentityService.createInvitedMembership`, `activateMembership` · `auth-flow.test.ts`, `identity-rls.test.ts`. HTTP ucu yok. | `services/companies.ts` `addMember` → `invited`, 7 gün geçerli; `acceptInvitation`, `cancel_invite` · `members.test.ts` "invitations" (2 test) | Davetle gelen kişi kabul edene kadar erişemez; başkası kabul edemez; süresi dolan davet kabul edilemez (410). |
| Rol sınırları | Politika motoru, `grantRole`/`revokeAssignment` · `authz-escalation.test.ts`, `security-ceiling.test.ts`, `authz-matrix.test.ts` | `RANK` + `managerRank` (`companies.ts`), `ROLE_MATRIX` · `members.test.ts` "role ceilings" (3 test), `core.test.ts` yetki matrisi | Kimse kendi rolüne eşit ya da daha yüksek bir rol veremez ve değiştiremez; sahiplik verilemez; şube yöneticisi kişi yönetemez. Önceki projedeki özel rol ve politika esnekliği yok. |
| Pasifleştirme | `memberships.status = 'suspended'` · `access-context.test.ts`, `gj006-tenant-isolation.test.ts` | `setMemberStatus` suspend/reactivate (gerekçe zorunlu, denetim kaydına yazılır) · `members.test.ts` "suspension" | Erişim bir sonraki istekte kapanır; telefonda kuyrukta bekleyen yazma reddedilir (404). |
| Oturum iptali | `SessionService.revokeFamily`, yeniden kullanım tespiti · `auth-flow.test.ts`, `access-context.test.ts` | `listSessions`, `revokeSession`, `revokeOtherSessions`; çıkış kaydı siler yerine iptal eder · `members.test.ts` "sessions" | **Yenileme jetonu ailesi ve yeniden kullanım tespiti yok.** Oturum 12 saatte biter. |
| İşletmeler arası izolasyon | RLS + 12 kanal / 7 korelasyon matrisi · `gj006-tenant-isolation.test.ts`, `sec003-endpoint-sweep.test.ts`, `rls.test.ts`, `role-isolation*.test.ts` | RLS + uygulamada `company()` kapısı · `slice.test.ts` izolasyon testleri, `members.test.ts` "cross-company isolation", `marketplace.test.ts` (başka işletme, uzman probu) | Bu teslimde tüm uçları tarayan otomatik bir test yok; testler uçları tek tek seçiyor. |

Pasifleştirme ve oturum iptali bu turda eklendi. Önceki teslimde üyeler eklendikleri anda etkin oluyordu; pasifleştirme ve oturum listesi yoktu.

## 4. Önceki dört insan inceleme kaydı

Kayıtlar önceki projede, `docs/evidence-manifest.json` içinde duruyor: ADM-003, UX-003, UX-004 ve UX-005. Dördü de kayıt RC-007'ye bağlı ve aynı bilgileri taşıyor:

- İnceleyen: Emre (ürün sahibi)
- Tarih: 29.08.2026
- Commit: `2649efd`
- Karar: PASS

Neyi inceledikleri:

- **ADM-003:** Yönetim (admin) ekranında masaüstü düzeninin öncelikli olması.
- **UX-003:** Altı sıfat (yüksek teknoloji, güven, sakin, premium, net, profesyonel).
- **UX-004:** Beş anti-örnek (devlet yazılımı, jenerik Bootstrap admin, ucuz şablon, kripto dashboard, aşırı yüklü ERP).
- **UX-005:** Telif incelemesi (hukuki görüş değil).

Durumları:

1. **Önceki projede bayat.** Son commit `ed7dfb1` (30.10.2026) `apps/admin/app/globals.css` dosyasını değiştirdi. Commit mesajı dört kaydın BAYAT olduğunu, yeniden insan incelemesi gerektiğini ve `check:evidence` kontrolünün o zamana kadar kırmızı kalacağını yazıyor. Önceki projenin karar paketi (`F1_HUMAN_REVIEW_PACKS.md` §8) masaüstü görüntülerin piksel piksel aynı kaldığını ölçmüş. Yeniden kaydı yalnızca sen yazabilirsin.
2. **Bu teslime aktarılmadı ve aktarılamaz.** Kayıtlar önceki projenin Next.js web ve yönetim ekranlarını inceliyor. Bu teslimde o ekranlar yok; mobil arayüz Claude Design prototipinden geliyor. Bu teslimin arayüzü için yapılmış bir insan incelemesi yok; ben de senin adına inceleme kaydı yazmadım.

## 5. Önerim ve karar gerektiren nokta

İki kod tabanı birbirini tamamlıyor:

- **Önceki proje:** Altyapı, yönetişim ve güvenlik derinliği daha fazla. İş akışları yok.
- **Bu teslim:** Uçtan uca çalışan iş akışları var; altyapısı daha basit.

İkisini paralel sürdürmek, iki ayrı güvenlik modeli ve iki ayrı kanıt zinciri demek.

**Önerim:** Bu teslimin iş alanı modüllerini önceki deponun altyapısının üzerine taşımak. Önceki deponun geçmişi, inceleme kayıtları ve CI kapıları korunur.

- Saf mantık neredeyse olduğu gibi taşınır: koşullar, takvim, limitler, risk, gösterge, kuyruk motoru.
- Servis katmanı ve şema, önceki deponun RLS, yetki ve kimlik yapısına göre yeniden bağlanır.
- Bu teslimin 94 testi ve 4 arayüz kaydı, taşınan modüllerin kabul ölçütü olur.

**Daha hızlı seçenek:** Kontrollü pilotu bu teslimle yapmak ve önceki projeden şu güvenlik parçalarını bu tarafa taşımak:

- Yenileme jetonu ve yeniden kullanım tespiti
- PostgreSQL'de tutulan hız sınırı
- Rol başına ayrı veritabanı girişi
- Rıza ve gizlilik modülü

Bu yolda iki proje ayrı kalır.
