# Tasarım v2 · Ayrı geliştirme maddeleri

Referans HTML'de olup uygulamada karşılığı olmayan ya da kısmi olan her şey. Hiçbiri gizlenmedi; hiçbiri “tamam” sayılmadı.
Güncelleme 14.11.2026 (2. tur): işlev gereksinimi olarak `GoverHub_GoverUp_Hizmet_Ekosistemi_ve_CAPA_Master_Gereksinimleri.md` kullanıldı (ek dosyalar diskte bulunamadı). Sıra beklemeden çalışıldı; aşağıdaki sıra yalnız öneridir, onay gerektirmez.

| ID | Madde | Neden eksik / bağımlılık |
|---|---|---|
| GM-01 | Kurulumda belge okutma (OCR) ile profil önerisi | OCR sağlayıcısı ve veri koruma kararı yok (PILOT.md §6) |
| GM-02 | Belge kasasında OCR ile tarih/numara/kurum okuma | aynı |
| GM-03 | Belge kasası “Eksik” filtresi (dosyası yüklenmemiş belgeler) | küçük; sunucu `no_file` durumu var, filtre yok |
| GM-04 | QR: kamera ile okuma, ekipmana özgü QR üretimi, uzman giriş-çıkış QR'ı | kamera izni + cihaz testi gerekir; web'de https şartı |
| GM-05 | Dinamik form motoru (koşullu sorular, form sürümü, puan) | sunucu tarafında şema ve sürümleme yok |
| GM-06 | Resmî süreç yol haritası (kafe açılışı vb.) | doğrulanmış resmî süreç içeriği yok; uydurma adım gösterilmez |
| GM-07 | Eğitimde “GoverHub katılım belgesi ≠ resmî sertifika” ayrımının her kartta yazılması | metin denetimi |
| GM-08 | Servis ziyareti kanıt zincirinin (karma, saat) arayüzde görünmesi | sunucuda audit zinciri var; ekran yok |
| GM-09 | Bildirim satırında “Servis bul / Hatırlat / Görevi aç” eylemleri | küçük arayüz işi |
| GM-10 | Ayarlar: tema, tek el modu, kritik SMS, sabah özeti, bildirim matrisi | SMS sağlayıcısı yok; tercih saklama yok |
| GM-11 | Kaynaklı GoverHub AI Asistanı | kaynak göstermeyen cevap kesin hüküm üretebilir (zorunlu senaryo 12); henüz kapsam dışı |
| GM-12 | **Ceza tutarı** (₺) hesabı ve “toplam ceza riski” | doğrulanmış ceza tablosu/mevzuat içeriği yok; tutar uydurulmaz. Risk Merkezi kalem sayısı gösterir |
| GM-13 | Personel için “kendi belgelerim / portör muayenesi hatırlatması” | personel belge modeli yok |
| GM-14 | Merkez görünümü: şube sıralaması, karne, şablon çoğaltma (HQ) | `/board` karşılaştırma var; şablon ve karne yok |
| GM-15 | Uzman: paket/fiyat vitrini, hakediş, yetki belgesi yenileme uyarısı | ödeme/escrow yok |
| GM-16 | Platform: mevzuat tarayıcı, soru motoru, ödeme/escrow ekranları | ilgili sunucu özellikleri yok |
| GM-17 | iPhone Safari gerçek cihaz denemesi (fotoğraf, PDF, bağlantı kopması) | fiziksel cihaz erişimi yok |
| GM-18 | Uzman keşfi: serbest metin/doğal dil arama, bölge, dil, müsaitlik, uzaktan/yerinde filtreleri (md §6) | sağlayıcı verisinde bu alanlar ve arama uç noktası yok |
| GM-19 | Pazar içinde profesyonel akış önizlemesi ve uzman kartından profil sayfası (şu an yalnız “Teklif iste”) | işletme tarafı uzman kimliği ile ağ profili kimliği farklı; eşleme gerekir |
| GM-20 | Uzmana “Mesaj gönder” ve “Profil bildir” (md §6) | mesajlaşma yok; profil şikâyeti ağ tarafında var, pazar kartına bağlanmadı |
| GM-21 | Aynı talebi birden çok seçili sağlayıcıya göndermek; “açık pazara yayınla” ile “seçili sağlayıcıya gönder” ayrımı (md §8) | şu an ya tek uzman ya kategori geneli |
| GM-22 | Uzman kartında doğrulanmış değerlendirme sayısı/dağılımı ve yanıt süresi (md §6, §9) | veri modeli ve yeterli örneklem yok; uydurma gösterilmez |

| GM-23 | QR yönetimi: kart detayı, oluşturma, önizleme, içerik bağlama, düzenleme, yazdırma, aktif/pasif, benzersiz bağlantı (md §5/§6) | QR modeli ve ekranları yok |
| GM-24 | Personel QR okutma: kamera ekranı, izin isteği, geçersiz QR (md §8) | GM-04 ile birlikte; cihaz gerekir |
| GM-25 | Smart Vault: yüklenen belgeden OCR ile tür/firma/tarih çıkarma, kullanıcı doğrulayınca görev ve hatırlatma (md §5/§7) | GM-02; doğrulamasız kesin kabul edilmez |
| GM-26 | AI asistan: soruyu anlayan, profile ve doğrulanmış mevzuata dayanan, kaynaklı yanıt; sabit yanıt yok (md §6) | GM-11; kaynak/doğrulama altyapısı ve onay akışı gerekir |
| GM-27 | Çok şubeli: şube detay ekranı, toplu/şubeye özel görev atama, Şubeler Arası Risk Radarı (md §7/§9) | GM-14 ile; `/board` karşılaştırma var |
| GM-28 | Uzman paneli: ana sayfa, bölgesel talep detayı, tekliflerim, işlerim, takvim, belgeler, mesajlar (md §9/§11) | yalnız talepler/işler var (`/pro`); takvim ve mesaj yok |
| GM-29 | Süper admin: ayrı mimari (işletmeler, kullanıcılar, mevzuat merkezi, uzman doğrulama, kural motoru, pazar yönetimi, analitik) (md §10/§12) | bugün yalnız `/admin` kural/pazar incelemesi |
| GM-30 | ~~Servis raporunun işletmenin belge kasasına kaydı ve görevin güncellenmesi~~ **TAMAMLANDI** (md §2/§3/§11) | Uzman rapor dosyası belge kasasında "İnceleme bekliyor" olarak açılır (şube, görev, servis talebi iki ekranda görünür); revizyonda son sürüm işaretli, önceki sürüm geçmişte; teslim kabulü dosyayı doğrulamaz, görev dosya incelenene kadar açık kalır; aynı rapor ikinci belge üretmez; yalnız belge okuma yetkili roller görür. Kalan: doğrulanmış raporun görevin 'belge' kanıtı yerine geçmesi ve görevin otomatik kapanması YOK (görevin kendi kanıt kuralları geçerli); dosya içeriği okunmaz (OCR yok) |
| GM-31 | Akışta mevzuat paylaşımına "İşletmenizi etkileyebilir" analizi (md §3) | mevzuat-gönderi eşlemesi yok |
| GM-32 | Gönderide "faydalı bul" ve "kaydet" (md §3) | yorum/takip var; bu iki eylem yok |
| GM-33 | Uzman profili: fotoğraf, deneyim yılı, hizmet bölgeleri listesi, önceki hizmet başlıkları (md §3) | profil modelinde yalnız ad, başlık, şehir/ilçe, tanıtım |
| GM-34 | Randevu planlama (teklif kabulünden sonra tarih seçimi) (md §3) | iş "planlandı" durumda; takvim yok |
| GM-35 | Kurulum sorularının işletme türüne göre dinamik değişmesi; Ayarlar → İşletme Profili'nde yeniden değerlendirme ve pasifleştirme gerekçesi (md §4) | profil soruları sabit listeden; tür seçimi yok |

## Öneri sırası (onay beklemez)
1. GM-03, GM-09, GM-07 (küçük, arayüz); 2. GM-08, GM-19 (veri var, ekran yok); 3. GM-18, GM-21 (pazar derinliği); 4. GM-04, GM-14, GM-13; 5. OCR/AI/ödeme/SMS bağımlı olanlar (GM-01, 02, 10, 11, 15, 16) sağlayıcı kararı sonrası; GM-12 doğrulanmış ceza tablosu gelince; GM-17 fiziksel cihaz.
