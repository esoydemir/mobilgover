# Tasarım v2 · Ekran eşlemesi

Kaynak (2. tur, 14.11.2026): `GoverHub Mobile Standalone.dc.html` (görsel referans; çelişkide koyu tema + lime vurgusu esas; "…dc(2).html" ve "Yapıştırılan markdown…" adlı ekler diskte bulunamadı, ekli `dc.html` ile aynı) ve işlev gereksinimi olarak **`GoverHub_GoverUp_Hizmet_Ekosistemi_ve_CAPA_Master_Gereksinimleri.md`** (Downloads; §6 keşif, §7 uygunsuzluktan talebe, §8 teklif, §9 sıralama, §15 işletme mobil ekranları). Bu md'nin ayrı bir "Ceza ve Yasal Risk Merkezi" bölümü yoktur; Risk Merkezi referans HTML'deki "Ceza riski" kartından türetilmiştir. Referansta olup elde karşılığı olmayan her şey `TASARIM_V2_GELISTIRME_MADDELERI.md` içinde ayrı maddedir.
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
