# 6. aşama — başlangıç envanteri (referans: `1f66b5f`)

Dal, başlangıç referansından ilerlememişti (09.11.2026). Bu tablo `docs/KAPSAM_DURUMU.md` ve kod karşılaştırılarak çıkarıldı.
**Hazır**: çalışıyor, korunur · **Eksik**: bu turda tamamlanır · **Bağımlı**: dış sağlayıcıya ya da ürün kararına bağlı.

## 6A — Uygunsuzluğun nedeninden kalıcı çözüme

| Madde | Durum | Not |
|---|---|---|
| Aşamalar (ilk müdahale, sorumlu/termin, ilk neden, aksiyonlar, kök neden, etkinlik, doğrulama) | Hazır | `domain/ncrflow.ts` `flow()`; ekranda adım listesi |
| "Sırada kim, ne yapacak", "kapanış için ne eksik" tek bakışta | Eksik | Eksik adımlar metin olarak var; sıradaki kişi ve kapanış listesi yok |
| Geçmişte adımların ayrı izlenmesi | Hazır | Denetim kaydı + adım/neden/aksiyon tabloları; tur (iteration) numarası tutuluyor |
| Neden türüne göre öneri, birden fazla neden → birden fazla öneri | Kısmen | Öneriler var; ekipman geçmişi önerisi yok; öneriyi gerekçeyle değiştirme/geçme yok |
| Eğitim / görev / belge / ekipman / hizmet / kanıt kayıtlarına vaka içinden gitme | Kısmen | Eğitim, görev, hizmet bağlantısı var; ekipman geçmişi ve belge bağlantısı yok |
| Geri dönüşte filtre ve ekran konumu | Hazır (gezinme yığını) | Expo Router önceki ekranı bellekte tutuyor; ayrıca kontrol edilecek |
| Eğitim geçildi ≠ saha kontrolü | Hazır (5A) | |
| Hizmet teslimi ≠ teknik etkinlik; yeni ölçümle kontrol | Eksik | Etkinlik kontrolü yalnız metin; ölçüm değeri ve limit karşılaştırması yok |
| Olumsuz etkinlik → yeni tur; önceki tur görünür; yeni turda bağımsızlık | Kısmen | Tur ve bağımsızlık sunucuda var; ekranda turlar ayrı gösterilmiyor |
| Rol bazlı görünüm, dış doğrulayıcının doğrudan bağlantıyla başka kayda erişememesi | Kısmen | Kayıt düzeyinde test var; kanıt dosyası ve belge için doğrudan bağlantı testi eksik |
| Kritik kayıtta yöneticinin ilk işlemi öne çıksın | Eksik | |

## 6B — Tekrarlayan sorunlar ve yönetici ekranı

| Madde | Durum | Not |
|---|---|---|
| Bugün müdahale edilecek işler ekranı (kritik, geciken aksiyon, doğrulama bekleyen, belge süresi, tekrar) | Eksik | `report.tsx` yalnız göstergeler |
| Filtreler: şube, tarih, konu, ekipman, sorumlu | Eksik | |
| Tekrar adayları + neden önerildiği + ilişkilendir / ilgisiz işaretle | Eksik | Yalnız `recurrence_count` (aynı ekipman + konu, 90 gün) |
| Göstergeler: yeniden görülme süresi, açık kalma süresi, etkinliği doğrulanmış aksiyon; payda/veri eksikliği | Eksik | |
| Merkez şube karşılaştırması; şube yöneticisi kendi şubesi; personel kendi işi | Kısmen | Yetki matrisi şube kapsamını destekliyor; **şube ekleme ucu yok**, demo işletmeleri tek şubeli |

## 6C — Mesleki ağdan doğru uzmana ve sonuç takibine

| Madde | Durum | Not |
|---|---|---|
| Meslek adı bilmeden arama ("dolabım soğutmuyor" → kategori önerisi) | Eksik | Arama ad/unvan/uzmanlıkta metin eşleşmesi |
| Sıfır sonuçta kaldırılabilecek filtreler | Eksik | |
| Uzman kartı: onaylı kategori, bölge, doğrulama, paylaşımına izin verilmiş iş geçmişi; beyan ayrı | Kısmen (5B) | Profilde ayrı; arama kartında doğrulama durumu ve iş geçmişi kısmen |
| Talep açarken uzmana gösterilecek vaka bilgisinin önizlemesi; özel fotoğraf/çalışan/belge kapalı | Kısmen | Yalnız "başlık, risk, tür paylaş" kutusu; önizleme yok |
| Teklif karşılaştırması: kapsam, hariç, ücret, süre, çıktı aynı sırada | Kısmen | "Teslim edilecek çıktı" alanı yok; yan yana karşılaştırma yok |
| Doğrudan tek uzmana talep ≠ çok teklifli talep | Kısmen | Veri var (`invited_profile_id`), ekranda ayrım yok |
| Teklif gönderme ve kabulde kategori onayı | Hazır | Sunucu kontrol ediyor |
| Onayı sonradan biten/askıya alınan uzmanın teklif ve işinin durumu | Eksik | Kabulde reddediliyor ama ekranda açıklama yok |
| Rapor → kabul ya da gerekçeli revizyon; geçmiş | Kısmen | "İtiraz" var ama uzman yeni rapor veremiyor (iş takılı kalıyor); iptal yok |
| Değerlendirme yalnız kabul edilmiş işe | Hazır (3. teslim) | |
| Vaka paylaşım onayının önizlenen sürüme bağlanması; değişince yeniden onay; yetkilinin geri çekmesi | Eksik | 5B: düzenlemede yalnız veri kontrolü yeniden çalışıyor |
| Şikâyet edenin durumu görmesi; itirazın ilk kararı verene atanmaması; moderatör erişiminin şikâyet edilen içerikle sınırı | Eksik / kısmen | Durum ekranı ve itiraz yok; moderatör yalnız kuyruktaki içeriği yönetebiliyor |
| **Bulunan hata:** demo sıfırlama, vaka paylaşımı olan demo işletmesini silerken yabancı anahtar nedeniyle hata verebilir | Eksik | `network_posts.case_company_id` |

## 6D — Belge kasası, eğitim ve denetim çıktısı

| Madde | Durum | Not |
|---|---|---|
| Belge filtreleri: yakında bitecek / süresi doldu / inceleme bekliyor / reddedildi | Kısmen | Durum hesaplanıyor; filtre yok |
| Yenilemede eski sürümün geçmişte kalması; yeni dosyanın önceki incelemeyi taşımaması | Hazır (3.–4. teslim) | Test edilecek |
| Belgenin görev / ekipman / yükümlülük için kullanım amacı | Eksik | Yalnız ekipman bağı var, amaç yok |
| Kurum içi inceleme ≠ kurumdan doğrulama kaydı | Hazır (4.–5A teslim) | |
| Bildirimden doğru kayda gitme | Hazır | |
| Termin değişince eski hatırlatmanın güncel gibi görünmemesi; tekrar bildirim olmaması | Kısmen | Tekrar yok; eski hatırlatma "geçersiz" işaretlenmiyor |
| Eğitimde yönetici/atanan/tamamlayan/geçen/sahada doğrulanan ayrı | Kısmen | Atama listesi var; kişi bazlı özet yok |
| Yeni sürümde eski tamamlamaların eski sürüme bağlı kalması | Hazır | Atama `version_id` taşıyor |
| PDF denetim dosyası (şube, tarih aralığı, kaynak/kural sürümü, örnek etiketi, oluşturma zamanı, rol; erişilemeyen kayıt/ek yok) | Eksik | Bugün JSON denetim dışa aktarımı var |

## 6E — Kural yazma ve kurum görünümü

| Madde | Durum | Not |
|---|---|---|
| Kural taslağı oluşturma, inceleme, alan incelemesi, onay, yayın | Hazır (sunucu) | Ekran yalnız inceleme/onay/yayın; taslak yazma ekranı yok |
| Taslağı düzenleme | Eksik | Taslak yalnız yeniden oluşturulabiliyor |
| Yayından önce örnek işletme profillerinde önizleme | Eksik | Gerçek şubeler üzerinde etki analizi var |
| Kaynağı doğrulanmamış kural örnek/taslak kalır | Hazır | Sunucu kuralı |
| Yeni sürüm geçmiş görevlerin kural bağını değiştirmez | Hazır | Görev, sürüme ait şablona bağlı; test edilecek |
| Kurum görünümü (sentetik, küçük grup gizleme) | Eksik | Gerçek kurum erişimi, işletme kimliği paylaşımı ve gerçek veri aktarımı **ayrı aşama (bağımlı)** |

## Dışa bağlı / karar gerektiren (bu turda yapılmaz)
- Gerçek kurum bağlantısı ve gerçek veri aktarımı (ürün kararı + hukuki çerçeve).
- Ödeme, gerçek SMS / push / e-posta sağlayıcısı (harcama).
- Moderatörlerin kim olacağı ve itiraz süresi (ürün kararı; ilk sürümde varsayılan uygulandı).
- Gerçek telefon testi (cihaz ve senin denemen gerekir).
