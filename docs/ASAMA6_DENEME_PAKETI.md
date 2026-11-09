# 6. aşama — tek deneme paketi

Her şey **örnek veridir**: kurallar doğrulanmamış taslak/örnek, eğitimler örnek içerik, kurum görünümü sentetiktir. Hiçbir ekran onaylı mevzuat, gerçek kurum bağlantısı, gerçek ödeme ya da gerçek bildirim kanalı değildir.

- **Dal:** `goverhub-mobile` (yalnız `esoydemir/mobilgover`)
- **Başlangıç referansı:** `1f66b5f`
- **Son commit ve CI bağlantısı:** teslim mesajında.
- **Başlangıç envanteri:** `docs/ASAMA6_ENVANTER.md`
- **Modül durumu:** `docs/KAPSAM_DURUMU.md`

## 1. Güncelleme adımları (kayıtlar silinmez)

1. `yerel-demo\durdur.cmd`
2. GitHub'dan `goverhub-mobile` dalının ZIP'ini indir ve **yeni bir klasöre** çıkar.
3. Yeni klasörde `yerel-demo\baslat.cmd`. İlk açılışta görüntüler yeniden derlenir; birkaç dakika sürebilir.
4. `durum.cmd` ile kayıt sayılarına bak; uygulamada eski uygunsuzluk ve belgelerini aç.

**Ne olur:**
- Açılışta 012–016 numaralı veritabanı değişiklikleri **eklenerek** uygulanır.
- Demo verisi yeniden yüklenmez.
- Kayıtlar Docker'ın `goverhub-demo_*` birimlerinde durur; yeni klasör aynı birimleri kullanır.
- `SIFIRLA-tum-demo-verisi.cmd` hiçbir güncellemede çalışmaz.

## 2. Demo hesapları

Giriş: e-posta yaz → **Kod gönder** → **Demo kutusundan kodu getir** → **Giriş yap**.

| Hesap | Ne için |
|---|---|
| `sahip@demo.goverhub.test` | İşletme sahibi: yönetici ekranı, vaka paylaşım izni ve geri çekme, PDF, belge incelemesi, şube ekleme |
| `mudur@demo.goverhub.test` | Şube yöneticisi: yalnız kendi şubesi; ilk işlem, aksiyon, doğrulama |
| `personel@demo.goverhub.test` | Personel: sorun bildirir, yalnız kendisine atananları görür |
| `uzman@demo.goverhub.test` | Onaylı soğutma teknisyeni: teklif, iş giriş kodu, rapor, revizyon |
| `danisman@demo.goverhub.test` | Süreli erişimli danışman |
| `moderator@demo.goverhub.test` | Ağ moderatörü: şikâyet kuyruğu ve itirazlar |
| `yazar@demo.goverhub.test` | Kural yazarı: yeni kural taslağı ve önizleme |
| `alan-uzmani@`, `onay@`, `yonetici@demo.goverhub.test` | Kural için alan incelemesi, onay ve yayın |
| `ben@demo.goverhub.test` (ya da herhangi bir yeni demo adresi) | Kendi işletmeni kurmak için |

Otomatik testler her çalıştırmada kendi işletmesini ve `<rol>.<çalıştırma>@demo.goverhub.test` adreslerini oluşturur; mevcut demo işletmesine yazmaz.

## 3. Hangi menüden ne denenir

| Konu | Menü | Hesap | Beklenen |
|---|---|---|---|
| Kritik kayıtta ilk işlem | Daha → Uygunsuzluklar → Sorun bildir (önem: Kritik) | `personel@`, sonra `mudur@` | Üstte **ÖNCE BUNLAR** kutusu; öneriler sorumlu atanana kadar bekler |
| Aşama özeti | Uygunsuzluk ekranının başı | herkes | Aşama, sırada kim ne yapacak, kapanış için eksikler |
| Nedene göre öneriler | Uygunsuzluk → İlk değerlendirme (birden fazla neden) | `mudur@` | Bilgi → eğitim, ekipman → ekipman geçmişi ve servis kategorisi, süreç → sorumlu ve takip aksiyonu. **Bu öneri uymuyor · gerekçeyle değiştir** |
| İlgili kayıtlar | Uygunsuzluk → İLGİLİ KAYITLAR | `mudur@` | Eğitim, görev, belge, ekipman geçmişi, hizmet talebi, kanıt; geri dönünce aynı ekran |
| Etkinlikte yeni ölçüm | Uygunsuzluk → Etkinlik kontrolü | `mudur@` | Limit dışı değer etkili sayılmaz; yeni tur açılır, önceki tur görünür |
| Yönetici ekranı | Daha → Bugün · yönetici ekranı | `sahip@` / `mudur@` | Beş bölüm, her sayı kayıtlara açılır; filtreler; tekrar adayında **Aynı sorun · ilişkilendir** / **İlgisiz** |
| Personelin kendi işi | Daha → Bana atananlar | `personel@` | Yalnız kendi aksiyonları ve kontrolleri |
| İkinci şube | Daha → Ekip → Şube ekle; Daha'da şube seçici | `sahip@` | Şube karşılaştırması yönetici ekranında |
| Düz dille uzman arama | Daha → Mesleki ağ → Uzman ara → "dolabım soğutmuyor" | `sahip@` | "Soğutma teknik servisi" önerisi; sonuç yoksa kaldırılabilecek filtreler |
| Talep önizleme | Uygunsuzluk → hizmet iste | `sahip@` | Uzmanın göreceği bilgi; özel fotoğraf, personel, belge kapalı |
| Teklif karşılaştırma, revizyon | Daha → Hizmet talepleri → talep | `sahip@` + `uzman@` | Aynı sıra: kapsam, hariç, fiyat, süre, çıktı; **Gerekçeyle revizyon iste**; geçmiş |
| Vaka paylaşımı geri çekme | Uygunsuzluk → İşletmenin vaka paylaşımları | `sahip@` | Değişen metin yeniden izin ister; **Ağdan geri çek** erişimi kapatır |
| Şikâyet durumu, itiraz | Mesleki ağ → Şikâyetlerim; Daha → Ağ moderasyonu | herkes / `moderator@` | Karar gerekçeli; itirazı ilk karar veren alamaz |
| Belge filtreleri, kullanım amacı | Daha → Belge kasası | `sahip@` | Filtreler; belgede **NE İÇİN KULLANILIYOR** |
| Eğitimde kişiler | Daha → Eğitimler → içerik → KİŞİLER | `sahip@` | Atandı / tamamladı / geçti / sahada doğrulandı ayrı |
| PDF denetim dosyası | Ana sayfa uyum göstergesi → PDF DENETİM DOSYASI | `sahip@` / `mudur@` | Şube + tarih aralığı; örnek veri etiketi, kaynak, rol, zaman |
| Kural yazma | Daha → Yönetim → Yeni kural taslağı yaz | `yazar@` | Taslak, örnek profillerde önizleme, incelemeye gönder |
| Kurum görünümü | Daha → Kurum görünümü (sentetik demo) | herkes (demo) | Sentetik; küçük gruplar gizli, az veride yorum yok |

## 4. Doğrulama sonuçları

Sınıflar:
- **Gerçek cihaz:** bu turda yok.
- **Tarayıcı öykünmesi:** Chromium, Playwright telefon profili (Pixel 7; dar ekran için iPhone SE), yerel Docker demosu.
- **Otomatik sunucu testi:** gerçek PostgreSQL ile.
- **Denenmedi:** aşağıda ayrıca yazılı.

Son çalıştırma: 09.11.2026, son sürüm, yerel Docker demosu (güncellenmiş eski birimler üzerinde).

| Doğrulama | Sınıf | Sonuç |
|---|---|---|
| Sunucu birim ve kabul testleri (27 dosya) | Otomatik sunucu testi | 280/280 |
| CI: sunucu testleri, mobil tür kontrolü + web derlemesi, yerel Docker demosu | Otomatik (GitHub Actions) | 3/3 iş başarılı |
| Senaryo 1 — buzdolabı: sapma → vaka → uzman arama → talep → teklif → teslim → yeni ölçüm → bağımsız kapanış → aynı ekipmanda tekrar → yönetici ekranı; bağlantı kesilmesi | Tarayıcı öykünmesi (`e2e/yerel-demo-6-sogutucu.cjs`) | 27/27 |
| Senaryo 2–4 — bilgi eksikliği ve yeniden eğitim; belge yenileme, PDF ve yetkisiz şubenin ek bağlantısı; kural değişikliği ve eski görevlerin eski sürümde kalması; dar ekran, boş sonuç, erişim reddi, başarısız yükleme | Tarayıcı öykünmesi (`e2e/yerel-demo-6-diger.cjs`) | 23/23 |
| Senaryo 5 — onaysız uzman, değişen vaka taslağı, geri çekilen gönderi, izni kaldırılan doğrulayıcı, yetkisiz moderatör | Sunucuya doğrudan HTTP (`e2e/sunucu-6.cjs`) | 12/12 |
| Senaryo 6 — 5B sürümüyle (`1f66b5f`) ayrı birimlere yazılan veri, yeni klasörden aynı birimlerle açıldı: göçler 11 → 16; uygunsuzluk, fotoğraf, belge dosyası, ağ gönderisi, kayıt sayıları ve denetim geçmişi aynı | Docker + HTTP (`e2e/yukseltme-6.cjs`) | 4/4 yazma, 8/8 okuma |
| Önceki akışlar: uygunsuzluk + hizmet (`akis`) | Tarayıcı öykünmesi | 34/34 (kritik kayıtta "önce ilk işlem" davranışına göre güncellendi) |
| Önceki akışlar: doğrulama + belge (`yeni`) | Tarayıcı öykünmesi | 21/21 |
| Önceki akışlar: tek yönetici + dış doğrulayıcı (`tek-yonetici`) | Tarayıcı öykünmesi | 25/25 |
| Önceki akışlar: eğitim (`egitim`, 5A) | Tarayıcı öykünmesi | 23/23 |
| Önceki akışlar: mesleki ağ (`ag`, 5B) | Tarayıcı öykünmesi | 50/50 |
| PDF: Türkçe karakter, uzun metin, sayfa sonu | Otomatik sunucu testi + `pdftotext` | Geçti; telefonda indirme **denenmedi** |
| Gerçek telefon | — | **Denenmedi** |


## 5. Denenmeyenler ve açık konular

**Denenmeyenler:**
- **Gerçek telefon:** hiçbir 6. aşama akışı gerçek telefonda denenmedi. Bunlara PDF indirme, belge seçme/yükleme ve fotoğraf da dahil. Tarayıcı öykünmesindeki indirme gerçek telefon testi sayılmaz.
- **Windows'taki gerçek demo verisinin kopyası:** elimde yok. Güncelleme, 5B sürümüyle (`1f66b5f`) ayrı birimlere yazılmış veriyle ve buradaki uzun süredir kullanılan demo birimleriyle denendi.

**Dışa bağlı ya da karar bekleyenler (bu turda yapılmadı):**
- Gerçek kurum erişimi, işletme kimliği paylaşımı, gerçek veri aktarımı: ayrı aşama.
- Ödeme; SMS / push / e-posta bildirimleri: harcama ya da sağlayıcı gerektirir.
- Moderatör atama ekranı: moderatörün kim olacağı senin kararın. Rol şimdilik veritabanından verilir.
- Vaka paylaşımına dosya eki yok. Geri çekmede kapanan şey gönderi ve yorumlarıdır.
- Kural yayımlandığında kapsam dışı kalan şubeler için "uygulanmaz" yükümlülük satırları eklenir. Bu, platformun normal davranışıdır; görev oluşturmaz.
- Gerçek mevzuat içeriği: tüm kurallar örnek ya da doğrulanmamış taslak.
