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

## Öneri sırası (onay beklemez)
1. GM-03, GM-09, GM-07 (küçük, arayüz); 2. GM-08, GM-19 (veri var, ekran yok); 3. GM-18, GM-21 (pazar derinliği); 4. GM-04, GM-14, GM-13; 5. OCR/AI/ödeme/SMS bağımlı olanlar (GM-01, 02, 10, 11, 15, 16) sağlayıcı kararı sonrası; GM-12 doğrulanmış ceza tablosu gelince; GM-17 fiziksel cihaz.
