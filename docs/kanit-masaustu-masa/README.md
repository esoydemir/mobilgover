# Masaüstü mevzuat masası — kabul kanıtı (SENTETİK veri)

Ortam: yalıtılmış sentetik ortam (`server/scripts/synthetic-legislation-env.ts`, kaynak `sentetik.test`); gerçek yayın, gerçek sunucu, ücretli hizmet yok. Betikler bu klasörde (`t8-*.cjs`, `t8-horizon.sh`).

## Uçtan uca (iki kullanıcı, ayrı tarayıcı oturumu)
1. Platform yöneticisi (`yonetici@…`) 1366×768: "Şimdi tara" → yeni sentetik emlak yayını kuyruğa düşer; "Sahipsiz" kısayolu (`a-1`). Kaynak bağlantısı, yayın kimliği, tarih ve metin tek ekranda.
2. Kural yazarı (API; platform yöneticisi değildir) öneriyi yazar ve taslağı hazırlar: aylık, ayın 31'i, dayanak "yönetici seçimi".
3. Yönetici atama panelinde alan uzmanını seçer, gerekçe yazar, atar (`a-3`). Rol ve alan yetkisi sayıları değişmez (6/4 → 6/4); denetim kaydı: atayan, atanan, kapsanan alan, gerekçe. Alanı olmayan kişi için atama kapalıdır; "alan yetkisi ver" AYRI işlem ve AYRI gerekçedir.
4. Alan inceleyicisi (`alan-uzmani@…`) 1440×900, ayrı oturum: "Bana atanan" → etki önizlemesi (`r-2`): Emlak A "neden uygulanıyor", Kahve Durağı "hangi yanıt gerekli", kapsam dışı örnekler "neden", takvim ve ay sonu notu → alan incelemesi → gerekçeli onay (`r-3b`, `r-4`).
5. Yetkisiz iki hesap ve onaylayıcı rolü olmayan yönetici aynı kararı veremez: onay/atama/alan yetkisi → 403 (`u-1`). Düğmelerin yanında pasif nedeni yazılıdır.
6. Yürürlük günü (test saati 02.12.2026) kayıt "uygulandı"; saatlik görev işi (`topUpAllSites`) test saatiyle çalıştırıldı.

## Önizlenen vade ↔ üretilen görev (Emlak A)
Önizleme: 31.12.2026, 31.01.2027, 28.02.2027, 31.03.2027, 30.04.2027, 31.05.2027.
Üretilen (test saati 24.12 / 26.01 / 20.02 / 26.03 / 20.04): 31.12.2026, 31.01.2027, 28.02.2027, 31.03.2027, 30.04.2027. Her çalıştırma ikinci kez çalıştırıldığında 0 yeni görev. Emlak B (koşul yok), market, elektrikçi: bu kuraldan 0 görev, 0 mevzuat bildirimi. Ay sonu seçimi bir zamanlama tercihidir, hukuki zorunluluk değildir.

## Çalışan
Sahip görevi çalışana atar → çalışan bildirimi ("ne değişti / hangi şube / ne zamana kadar") → görev ekranında "neden gerekli" (`m-53`).

## Kullanılabilirlik (1366×768 ve 1440×900)
Uzun resmî başlık (230+ karakter) satırda iki satıra kırpılır, kayıtta tam görünür, yatay taşma yok; ↑/↓ ile satır seçimi; odak halkası 2 px; gerekçe yazarken karar düğmesi ekranda sabit; Yönetim'e gidip dönünce süzgeç ve seçili kayıt korunur (`ui-*`).

## Telefon gerilemesi
Telefon genişliğinde `/legislation` eski liste düzeninde kalır; geniş pencerede platform dışı ekranlar telefon çerçevesinde kalır.
