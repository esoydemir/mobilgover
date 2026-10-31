# Native derleme ve mağaza dağıtımı — gereksinimler

Mobil web testi bu listeyi beklemez (bkz. `TELEFON_TESTI.md`). Aşağıdakiler yalnızca iOS ve Android uygulama paketleri ile mağaza dağıtımı içindir. Ücretler ve kurallar değişebilir; başvurmadan önce Apple ve Google sayfalarından güncel hallerini kontrol et. Bu belge yazılırken o sayfalara erişemedim.

## 1. Hesaplar (senden)

| Gereksinim | Neden | Not |
|---|---|---|
| Apple Developer Program üyeliği | TestFlight ve App Store | Yıllık ücretli. Şirket adına açılacaksa D-U-N-S numarası gerekir. |
| Google Play Console hesabı | Dahili test ve Play Store | Tek seferlik kayıt ücreti. Yeni kişisel hesaplarda yayından önce kapalı test zorunluluğu olabilir. |
| Expo hesabı (EAS Build) | Bulutta iOS ve Android derlemesi | Ücretsiz katman sınırlı. Mac olmadan iOS derlemesi için pratik yol bu. |

## 2. Uygulama tarafında yapılacaklar

Hesaplar açılınca bunları ben yaparım:

- `app.json`: paket kimlikleri (`ios.bundleIdentifier`, `android.package`), sürüm numaraları, simge ve açılış ekranı. Kimlikler bir kez seçilince değiştirilemez; adı senin onaylaman gerekir.
- Kamera ve fotoğraf izin metinleri (iOS `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`). Türkçe ve amacı açık olmalı.
- `eas.json`: demo ve pilot için ayrı derleme profilleri; her biri kendi `EXPO_PUBLIC_API_URL` değeriyle.
- Güvenli oturum saklama: oturum jetonu şu an AsyncStorage'da. Native sürümde Keychain/Keystore (`expo-secure-store`) kullanılmalı.
- Gerçek cihaz testi: kamera, arka plana alma, uygulamanın kapatılıp açılması, zayıf şebeke, düşük depolama.

## 3. Mağaza başvurusunda istenecekler

- **Gizlilik politikası ve KVKK aydınlatma metni:** Herkese açık bir adreste olmalı. İçeriği hukuk görüşüyle yazılmalı.
- **Veri beyanları:** Apple "App Privacy" ve Google "Data safety" formları. Toplanan veriler e-posta, fotoğraf ve konum dışı işletme kayıtları. Kart verisi toplanmıyor.
- **İnceleme hesabı:** Mağaza ekibinin uygulamaya girebilmesi gerekiyor. Giriş e-posta koduyla yapıldığı için ya ayrı bir inceleme hesabı ve kodu iletme yolu ya da demo ortamı gerekir.
- **Hesap silme yolu:** Apple, hesap oluşturulan uygulamalarda uygulama içinden hesap silme istiyor. Saklama matrisi onaylanmadan silme yapılmadığı için bunun hukuken uygun bir biçimi kararlaştırılmalı.
- Ekran görüntüleri, kısa ve uzun açıklama, destek adresi, yaş derecelendirmesi.

## 4. Sıra

1. Hesaplar açılır.
2. Paket kimlikleri ve uygulama adı onaylanır.
3. EAS ile dahili derlemeler alınır: iOS'ta TestFlight, Android'de dahili test kanalı.
4. Gerçek cihaz kontrol listesi uygulanır.
5. Gizlilik metinleri hazırlanır.
6. Mağaza başvurusu yapılır.

Pilot için mağazaya çıkmak şart değil. TestFlight ve dahili test kanalıyla sınırlı sayıda kullanıcıya dağıtılabilir.
