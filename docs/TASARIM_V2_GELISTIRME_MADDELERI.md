# Tasarım v2 · Ayrı geliştirme maddeleri

Referans HTML'de olup uygulamada karşılığı olmayan ya da kısmi olan her şey. Hiçbiri gizlenmedi; hiçbiri “tamam” sayılmadı.
Kaynak gereksinim dosyası bulunamadığından öncelik ve kapsam **sahibinin onayını bekler**.

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
