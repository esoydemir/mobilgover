# Tasarım v2 · Ekran eşlemesi

Kaynaklar (3. tur, 14.11.2026) — açılıp okunan dosyalar:
- Görsel referans: `C:UsersgkhnoOneDriveMasaüstücodexileGoverHub Mobile Standalone.dc.html` (253 556 B, 10 Kasım).
- İşlev gereksinimi: `C:UsersgkhnoDownloadsİşlev gereksinimleri — 14 Kasım.md` (23 695 B, 14 Kasım 14:41; "md §n" = bu dosyanın numaralı bölümleri). Önceki turdan `GoverHub_GoverUp_Hizmet_Ekosistemi_ve_CAPA_Master_Gereksinimleri.md` Pazar ayrıntıları için tamamlayıcıdır.
- **Ad uyuşmazlığı:** istekte geçen `GoverHub Mobile Standalone.dc(2).html` ve `Yapıştırılan markdown(20261114-102710).md` adlı dosyalar diskte **yok**; mesajda @ ile eklenen yukarıdaki iki dosya kullanıldı. "dc(2)"nin eklenen dc.html'den farklı bir sürüm olması hâlinde karşılaştırma o sürümle yinelenmelidir.
Risk Merkezi, md §1 "Ceza ve Yasal Risk Merkezi" ve referanstaki "Ceza riski" kartından türetilmiştir. Referansta/gereksinimde olup elde karşılığı olmayan her şey `TASARIM_V2_GELISTIRME_MADDELERI.md` içinde ayrı maddedir.
Dal: `feat/tasarim-v2-ilk-teslim` (PR #3, taban `fix/pilot-d21e647-bulgular` = PR #1). Test ortamı: 8091 yığını.

Durum: **TAMAM** = bu teslimde uygulandı/değişti · **VAR** = uygulamada zaten karşılığı var, referansla uyumlu · **KISMİ** = karşılık var, referanstan eksikleri var · **YOK** = karşılık yok (geliştirme maddesi).

## 1. İşletme sahibi / yönetici akışları (referansta 18 ekran)

| # | Referans ekranı | Uygulamadaki ekran | Rol | Kullanılan veri | Tıklama sonucu | Durum |
|---|---|---|---|---|---|---|
| 1 | Ana ekran · Komuta merkezi | `/` (`app/index.tsx`) | owner, hq_manager, site_manager (personel için sade sürüm) | `tasks` (ortak pencere −14…+15 gün), `indicators`, risk kalemleri (`features/risk.ts`), `obligations` (site müdüründe şubeye daraltılmış) | Üst başlık: işletme + **şube adı** (iki satır, dokununca Daha'da şube seçimi) · Halka → `/tasks?filter=today` · “GECİKENLERİ AÇ” → `/tasks?filter=late` · Uyum tile → `/report` · **Ceza ve yasal risk tile → `/risk`** · Kritik kart: Servis bul → `/service/new` (öntanımlı), Detay → kaydın kendisi · Bugünün görevleri TÜMÜ → `/tasks` · Profil eksik → `/profile` | **TAMAM** |
| 2 | Kurulum + OCR akışı | `/setup` | yeni kullanıcı | profil soruları, ekipman, görev üretimi | adım adım; belge okutma yok | KISMİ (OCR yok → GM-01) |
| 3 | Görev + kanıt yakalama | `/task/[id]` | herkes (atanan) | `tasks/:id`, ölçüm/fotoğraf/not kanıtları, çevrimdışı kuyruk | Ölçüm+fotoğraf → “Görevi tamamla”; limit dışı → uygunsuzluk açılır; **Geçmiş kartı eklendi** (aynı kontrolün son 14 günü) | **TAMAM** |
| 4 | Uygunsuzluk → servis köprüsü | `/task/[id]` → `/ncr/[id]` → `/service/new?ncrId=` | owner/manager | NCR + hizmet talebi | “Hizmet talebi aç / Servis bul” ncrId ile açılır | VAR (pazar girişi 2) |
| 5 | Belge kasası + OCR tarama | `/documents`, `/documents/[id]`, `/documents/new` | owner, hq, site_manager | `documents` (+ filtre) | Kart → detay; süresi dolan/eksik belgede **Servis bul** eklendi (pazar girişi 3) | KISMİ (OCR yok → GM-02; “Eksik” filtresi yok → GM-03) |
| 6 | Skor kırılımı (5 süreç) | `/report` | owner, hq, site_manager | `indicators` (zamanında, uygun sonuç, kanıt kapsamı) | gösterge → ayrıntı; PDF denetim dosyası | KISMİ (5 süreç yerine gerçek bileşenler; PILOT.md §5 kararı) |
| 7 | Ekipman QR | `/equipment`, `/equipment/[id]`; orta düğme “Sıradaki kontrol” (`/next`) | manager (liste), personel (sıradaki kontrol) | `equipment`, açık görevler | QR üretimi/okutma yok; en yakın açık görevi açar | KISMİ (QR → GM-04) |
| 8 | Uzman bul + doğrulama | `/services`, `/service/new`, `/network/search`, `/network/p/…` | owner, hq, site_manager | `service-requests`, `providers`, uzman profili (doğrulama durumu) | talep aç → teklifler | VAR (pazar girişi 4: Daha → Uzman bul) |
| 9 | Dinamik form motoru | — | — | — | — | YOK (GM-05) |
| 10 | Uygunsuzluk + CAPA | `/ncr/[id]`, `/ncrs`, `/ncr/new` | owner/manager | `nonconformities` | 7 aşamalı akış, doğrulama | VAR |
| 11 | Resmî süreç yol haritası | — | — | — | — | YOK (GM-06) |
| 12 | Eğitim + sertifika ayrımı | `/trainings`, `/training/[id]` | herkes | `training` | atanan eğitimler | VAR (katılım belgesi ≠ resmî sertifika metni kontrol edilecek → GM-07) |
| 13 | Teklif karşılaştırma | `/service/[id]` | owner/manager | teklifler | “Bu teklifi kabul et” | VAR |
| 14 | Servis ziyareti + kanıt zinciri | `/service/[id]` (giriş kodu, rapor, teslim kabul) | owner, uzman | iş, check-in, rapor | rapor → teslim kabul | KISMİ (karma zinciri ekranda görünmüyor → GM-08) |
| 15 | Bildirimler | `/notifications` (+ ana ekran zili) | herkes | `notifications` | satır → ilgili kayıt | KISMİ (satır içi Servis bul/Hatırlat yok → GM-09) |
| 16 | Ayarlar + çevrimdışı | `/account`, `/sync` | herkes | oturum, kuyruk | çıkış, ek doğrulama, eşitleme | KISMİ (tema/tek el/SMS/sabah özeti anahtarları yok → GM-10) |
| 17 | Uzman içerik akışı | `/network` | herkes | `network/posts` | profil, takip, yorum | VAR |
| 18 | GoverHub AI Asistan | — (düğme kaldırılmıştı) | — | — | — | YOK (GM-11; kaynaklı asistan kararı) |
| — | **Ceza ve Yasal Risk Merkezi** (referansta ana ekran kartı “CEZA RİSKİ ₺29k · 2 açık kalem”) | **`/risk`** | owner, hq, site_manager (personel göremez) | açık uygunsuzluk + gecikmiş görev + belge + bilgi eksik yükümlülük | Kalem → kaydın kendisi; “Servis bul”; filtreler = kart sayıları | **TAMAM** (₺ tutarı hesaplanmaz → GM-12) |

## 2. Rol bazlı gezinme (alt çubuk)

| Rol | Sekmeler | Not |
|---|---|---|
| owner / hq_manager / site_manager | Ana Sayfa · Görevler · Sıradaki kontrol (orta) · **Belgeler** · Daha | Rapor, Risk, Uzman bul Daha'da |
| staff (personel) | Ana Sayfa · Görevler · Sıradaki kontrol · **Eğitim** · Daha | Referanstaki “kendi belgelerim” için personel belge ekranı yok → GM-13 |
| uzman (işletmesiz) | **Uzman alanı · Ağ · Hesap** | |
| platform yetkilisi (işletmesiz) | **Yönetim · Daha** | giriş artık `/admin`'e iner |

Not: Risk Merkezi açıkken alt çubukta **Ana Sayfa** seçili görünür (ekrana ana ekran kartından girilir); önceki sürümde “Daha” seçiliydi (düzeltildi).
| dış doğrulayıcı | Doğrulama · Bildirimler | önceki turdan |

## 3. Pazarın üç girişi

1. **Ana ekran kritik kart / Risk Merkezi → “Servis bul”** (`/service/new?title=…`, uygunsuzlukta `ncrId` ile).
2. **Uygunsuzluk detayı → hizmet talebi** (`/ncr/[id]` → `/service/new?ncrId=…`; önceden vardı).
3. **Belge detayı (süresi dolan/yaklaşan/eksik/reddedilen) → “Servis bul”**.
   Ek: Daha → “Uzman bul · hizmet talepleri” (`/services`).

## 4. QR · Belge kasası · AI eşlemesi

| Referans başlığı | Elde olan işlev | Eksik (geliştirme maddesi) |
|---|---|---|
| QR (Tara) | “Sıradaki kontrol” en yakın açık görevi açar; ekipman kartı | Kamera ile QR okuma, ekipmana özgü QR üretimi, uzman giriş QR'ı (GM-04) |
| Belge kasası | Tam belge kasası: sürüm, inceleme, süre hatırlatması, paylaşım | OCR ile tarih/numara okuma (GM-02), “Eksik” filtresi (GM-03) |
| AI Asistan | Yok | Kaynaklı asistan (GM-11) |

## 5. Pazar (referans: Uzman bul · Teklifler · İçerik akışı; md §6–§9) — `/market`

“Servis bul” kısayollarından (görev, uygunsuzluk, belge) **ayrı** bölüm. Giriş: Daha → Pazar.

| Bölüm | Referans ekranı | Uygulamadaki ekran | Rol | Kullanılan veri | Tıklama sonucu | Durum |
|---|---|---|---|---|---|---|
| Uzmanlar / Servisler | Uzman bul (arama, uzman kartları) | `/market` → Uzmanlar sekmesi | owner, hq, site_manager | `/service-categories`, `/companies/:id/providers?category=` (yalnız geçerli onayı olan uzmanlar) | Kategori → uzman kartı (doğrulanmış yeterlilik sayısı, şehir) → “Bu uzmandan teklif iste” → `/service/new` (yalnız o uzmana) · “Herkese açık talep aç” | KISMİ: **fiyat/mesafe/geliş saati gösterilmez** (referanstakiler uydurma; md §6 “tahmini fiyat bağlayıcı gibi gösterilmez”); serbest metin arama, bölge/dil/müsaitlik filtresi yok (GM-18) |
| Teklifler | Teklif karşılaştırma + Daha “Teklifler (3 yanıt bekliyor)” | `/market` → Teklifler sekmesi → `/service/[id]` | owner, hq, site_manager | `service-requests` (+ teklif sayısı) | “N talepte teklif karşılaştırmayı bekliyor” → liste → karşılaştırma → “Bu teklifi kabul et” → iş + giriş kodu | **TAMAM** (zincir gerçek hesapla çalıştırıldı) |
| Profesyonel akış | Uzman içerik akışı | `/market` → Profesyonel akış → `/network`, `/network/search` | herkes (profilli) | `network/feed` | akış / uzman ara | VAR (akış önizlemesi Pazar içinde yok → GM-19) |

## 6. Daha menüsü karşılaştırması (işletme sahibi)

| Referans satırı | Uygulama |
|---|---|
| Personel | Ekip (`/team`) |
| Ekipman & bakım | Ekipmanlar (`/equipment`) |
| Formlar | YOK (GM-05) |
| Uygunsuzluklar | Uygunsuzluklar (`/ncrs`) |
| Eğitim | Eğitimler (`/trainings`) |
| Resmî süreç yol haritası | YOK (GM-06) |
| Teklifler | **Pazar → Teklifler** |
| Servis geçmişi | Pazar → Teklifler (tamamlanan işler); kanıt zinciri görünümü GM-08 |
| Uzman içerikleri | Pazar → Profesyonel akış |
| Rapor al | Rapor ve denetim dosyası (`/report`) |
| Ayarlar | Hesap ve güvenlik (`/account`) |

## 7. 3. tur: değişiklik → referans bölümü bağı

| Değişiklik | Referans (dc.html) | Gereksinim (md) | Kod | Doğrulama |
|---|---|---|---|---|
| Ana ekranda **Kritik görev / Yapılacak / Servis bekleyen** sayaçları, her biri aynı filtreyle liste açar | Ana ekran · "BUGÜNÜN GÖREVLERİ" + sayaç kartları | md §1 "Kalan görevler", §2 "Kritik görevler: 4 neden 4?" | `app/index.tsx`, `features/work.ts` | sayaç = liste satırı sayısı (senaryo S1) |
| Görevler: **Bugün · Yapılacaklar · Kritik · Gecikmiş · Yaklaşan · Servis bekleyen · Tamamlanan**; her listenin anlamı yazılı; Kritik'te her satırda "neden kritik / ne zaman çıkar" | Görev listesi (Görevler sekmesi) | md §2 tablo (Yapılacaklar, Kritik, Tamamlananlar, Yaklaşan, Servis bekleyenler) | `app/tasks.tsx`, `features/work.ts` | S1 |
| Kritik tanımı: gecikmiş **veya bugün yapılması gereken kritik**; ileri tarihli kritik kontroller sayıyı şişirmez (önce 17, sonra gerçek) | — | md §2 "bu sayı rastgele oluşturulmamalı" | `features/work.ts` | önce/sonra ekran görüntüsü |
| Görev detayı: **Neden gerekli, yasal dayanak, son tamamlanma / son tarih / sonraki kontrol, sorumlu, yapılacaklar, tamamlanmazsa risk, servis** | Görev detayı ("Bunu neden yapmam gerekiyor?", KANIT, GEÇMİŞ) | md §1 görev detayı listesi | `app/task/[id].tsx`, sunucu `taskDetail` | S2 |
| Görev → **Servis bul** artık talebe görevi bağlar (`taskId`); görevde "Servis" kartı, listede "Servis bekleyen" | Uygunsuzluk → servis köprüsü | md §2 "görev, servis, belge, bildirim ve risk ekranları birbirine bağlı", §11 | migration 017, `marketplace.createRequest`, `app/service/new.tsx` | S2, sunucu testi `task-context.test.ts` |
| Risk Merkezi: **Kesinleşmiş ceza / Potansiyel risk / Eksik belge** ayrı; kesinleşmiş ceza kaydı yok → 0 ve açıklama; işletme profiline göre hazırlandığı satırı | "Ceza riski" kartı | md §1 "kesinleşmiş ceza, potansiyel ceza riski ve eksik belge birbirinden ayrılmalı", "işletmeye özel" | `app/risk.tsx`, `features/risk.ts` | S3 |
| Ceza tutarı | "₺29k" | md §6 "ceza tutarlarını uydurmamalı" + `PILOT.md` §5 | `PENALTY_NOTE` | S3 (tutar yok, not var) |
| Pazar **üç ayrı bölüm**: Uzmanlar · Servisler ve Teklifler · Profesyonel Akış | Uzman bul · Teklifler · İçerik akışı | md §3 "Pazar sayfasında üç temel alan" | `app/market.tsx` | S4 |
| Uzmanlar: kart → **Profili aç** → profil (hakkında, bölge, doğrulanmış belgeler, onaylı kategoriler, hizmet geçmişi/değerlendirme) → **Bu uzmandan teklif iste** (gerçek talep) | Uzman profili | md §3 "Uzman profili gerçekten açılmalı" | `app/pro.tsx`, `app/market.tsx` | S4 |
| Servisler ve Teklifler: özet (açık, karşılaştır, iş verildi, tamamlanan), yeni talep, talep listesi → karşılaştırma → kabul | Teklif karşılaştırma | md §3 | `app/market.tsx` | S4 |
| Profesyonel Akış **Pazar içinde**: akış, takip ettiklerim, paylaş, uzman ara, gönderi → tam içerik/yorum/profil | Uzman içerik akışı | md §3 | `app/market.tsx`, `features/network.tsx` | S4 |
| "Servis bul" kısayolları (görev, uygunsuzluk, belge, ana ekran/Risk) **ayrı tutuldu** ve Pazar'dan farklı: kayda bağlı ön dolu talep açar | Kritik kart "Servis bul" | md §3 "servis talebi... ilgili görevden veya pazardan" | `features/risk.ts`, `task/[id]`, `documents/[id]` | S2, S4 |
