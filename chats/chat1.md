# Mobile app design brief

_Started 2026-08-25 16:53 UTC_

---

## User

Design a mobile app for

## Assistant



## User

<artifact-content-authored-by-others/>
Answered — code_source: Yeni klasör (3); persona: Business owner (single location), Business owner (multi-location / HQ), Employee, Verified professional / service provider; screens: Onboarding + document scan/OCR, Home command center (today's actions), Task detail + evidence capture, Document vault, Compliance score + why-does-this-apply, Personnel, Equipment + QR scan, Find a p…; language: Both (TR primary); fidelity: Clickable prototype; tension: Making a 200-requirement platform feel like 3 taps a day, Explaining WHY an obligation applies without legalese, Evidence capture that a busy emp…

## Assistant

The spec is a full engineering build protocol; my side of this is the mobile design. A few calls before I start:

_[tool: ask_user]_

No answers came through — I'll decide and go. First, grounding in the Uyum mobile kit.

_[tool: list_files]_

_[tool: read_file]_

_[tool: view_image]_

Grounded. Building the prototype now — business-owner mobile, Turkish copy, Uyum dark/lime.

_[tool: dc_write]_

No local-file tools surfaced in this session, so I'm grounding in the design system (same source: tokens + the 14 product screenshots). Building the full clickable prototype — owner, HQ, employee and professional modes, TR primary with EN sublabels.

_[tool: dc_write]_

_[tool: tool_search_tool_bm25]_

_[tool: tool_search_tool_bm25]_

_[tool: ready_for_verification]_

A clickable GoverHub Business Mobile prototype, on Uyum's black/lime language. Four roles switch from the left rail; the phone is fully navigable.

What's in it: onboarding with document OCR (scan → confidence-scored fields → confirm), the home command center (today's counter, one critical card, score + penalty risk), task detail with mandatory evidence — entering 12 °C against a 4 °C limit blocks completion and opens a nonconformity that routes you to a verified technician, the document vault, the "Neden bana uygulanıyor?" sheet showing which of your own facts matched the rule, score breakdown, personnel, equipment QR, expert search with honest verification levels ("Oda kaydı: kontrol edilmedi"), assistant, and notifications.

Two notes: copy is Turkish-primary with English sublabels on screen titles and key affordances, not a full second locale. And the local codebase didn't expose file-browsing tools in this session, so I grounded in the design system's tokens and product screenshots rather than the source HTML — if you want exact parity with specific existing screens, re-attach and I'll match them.

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Fixed — the tab icons are now literal inline SVG instead of an injected HTML string, which was blanking the whole component. Everything should paint and navigate now.

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Narrowed the rails and tightened the gutters — the row now needs 908px, so nothing clips.

## User

ŞİMDİ DİĞER EKRANLARIDA TASARLA

## Assistant

Ekleyeceğim ekranlar: dinamik form motoru, uygunsuzluk/CAPA detayı, resmî süreç yol haritası, eğitim, teklif karşılaştırma, servis ziyareti + kanıt zinciri, bildirimler, ayarlar ve uzman içerik akışı.

_[tool: dc_html_str_replace]_

Now the logic for the nine new screens.

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

Now wiring the new screens into the "Daha" menu, the jump list and the existing entry points.

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Dokuz ekran eklendi — hepsi "Daha" sekmesinden ve soldaki listeden gezilebilir:

- **Dinamik form** — koşullu soru ("Evet" dediğin için eklendi), puanlama, sürüm kilidi (v4). "Hayır" yanıtı uygunsuzluk açıyor.
- **Uygunsuzluk / CAPA** — tespit → kontrol altına alma → düzeltici faaliyet → doğrulama → kapanış; küçük işletmede kısa, yüksek riskte uzun.
- **Resmî süreç yol haritası** — 7 süreç, alt kontrol listeleri, nerede alınır / ne kadar sürer, "bu süreci benim için yürüt".
- **Eğitim** — GoverHub katılım belgesi ile yetkili kurum sertifikası her kartta ayrı etiketli.
- **Teklif karşılaştırma** — aynı alanlar; "dahil değil" satırı kırmızı.
- **Servis ziyareti** — QR giriş/çıkış, karma zinciri, çok boyutlu değerlendirme.
- **Bildirimler** — kritik / işlem gerekli / bilgi / pazar yeri seviyeleri, her biri eyleme bağlı.
- **Ayarlar** — bildirim matrisi, tek el modu ve çalışan çevrimdışı/eşitleme durumu (denemek için düğmeye bas).
- **Uzman içerik akışı** — "GoverHub Onaylı İçerik" ile doğrulanmamış uzman yorumu görsel olarak ayrı.

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Yeni dokuz ekran kaydırılabilir alanın içine taşındı — başlık altındaki boşluk gitti, hepsi sonuna kadar kaydırılıyor.

## User

taSARIM DİLİMİZ DAHA ESTETİK OLMALI BEN ÖRNEKLER ATTIM ÖZEELİKLE KARTLAR ALT BAR VE ANA GİRİŞ EKRANI ÇOK ÇOK ÖNEMLİ

## Assistant

Referanslardaki dil net: yüzen kapsül alt bar, dairesel ikonlar, halka göstergeler ve daha yumuşak kartlar. Ana ekranı ve alt barı yeniden kuruyorum.

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: run_script]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Tasarım dili referanslara göre güncellendi:

**Alt bar** — ekrana yapışık çubuk gitti. Yüzen kapsül, blur'lu koyu zemin, dairesel ikonlar; aktif olan lime dolgulu ve halolu. Ortadaki "Tara" düğmesi daha büyük, referanstaki merkez aksiyon gibi.

**Ana giriş ekranı** — sayaç yerine 96px'lik lime ilerleme halkası, yanında kalan iş sayısı. Altında haftalık seri şeridi (tamamlanan günler lime dolgulu tik, bugün lime konturlu). Üstte selamlama + 44px marka tile, daha yumuşak dairesel aksiyon düğmeleri.

**Kartlar** — köşe yarıçapları büyütüldü (22→26, 28→32), yüzey #0F0F0F'ten #111111'e çıkarıldı, skor ve ceza riski kartları ikon rozeti + ilerleme çubuğu kazandı, kritik kart hafif kırmızı gradyan aldı. Onay kutuları 28px.

Uzmanlar sekmesi alt bardan çıkıp "Daha" menüsüne geçti — beş düğme kapsülde daha iyi soluk alıyor. Geri almamı istersen söyle.

## User

Found issues — fixing…

## Assistant

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

İki düzeltme yapıldı: hafta şeridi artık başlıktaki tarihle tutarlı (Pzt–Cmt tamam, Paz bugün) ve selamlamadaki emoji kaldırıldı.

## User

GOVERHUB ASİSTAN İŞARETİ GÜZEL DEĞİL VE apple assistive touch GİBİ ÇALIŞMALI

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Asistan düğmesi AssistiveTouch gibi çalışıyor: yuvarlak kare, yarı saydam gri kabuk, içinde halka ve lime nokta. Sürüklenebilir, bıraktığında en yakın kenara yumuşak geçişle yapışır, 2,6 saniye dokunulmazsa %42 opaklığa soluyor; dokununca netleşiyor. Sürükleme sonrası tıklama tetiklenmiyor, sadece gerçek dokunuşta asistan açılıyor.

## User

UYUM SKORUNA TIKLANINCA BELGE PERSONEL FORM GİBİ UYUM SÜREÇLERİMİZ BU ŞEKİLDE GÖZÜKEBİLİR

## Assistant

Uyum skoru ekranını referanstaki iç içe yay grafiğiyle yeniden kuruyorum.

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Uyum skoru ekranı referanstaki iç içe yay diline geçti: beş süreç (Belgeler, Personel, Formlar, İSG, Ekipman) dıştan içe halkalar, dolgu oranı o süreçteki tamamlanma. Renk kategori değil durum taşıyor — lime iyi, amber izle, kırmızı zayıf; en içteki Ekipman kırmızı ve en kısa yay, zayıf halka bir bakışta görünüyor.

Sol üstteki etiket kartları tıklanabilir: her biri kendi sürecine gidiyor (Belgeler → kasa, Personel → personel, Formlar → form, İSG → yol haritası, Ekipman → ekipman). Sağ üstteki "Nasıl hesaplanır" ağırlıkları açıklıyor — ekipman 30, belgeler 25, formlar 20, personel 15, İSG 10.

Altındaki kırılım listesi olduğu gibi duruyor; kaldırmamı istersen söyle.

## User

BİRAZ KARIŞIK OLDU SANKİ

## Assistant

Haklısın — etiketler yayların üstüne biniyordu. Grafiği temizleyip listeyi ayırıyorum.

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Sadeleştirildi: yaylar kendi kartının içinde, ortada 58/100, üstünde çakışan etiket yok. Beş süreç altta ayrı satırlar halinde — renk çubuğu, kısa durum notu, oran ve yüzde; her satır kendi ekranına gidiyor. Alttaki tekrar eden kırılım listesi kaldırıldı.

## User

YA BENİM İSTEDİĞİM TASARIM BU ÇOK KÖTÜ SENİN YAPTIĞIN

## Assistant

Referansın geometrisini birebir kuruyorum: sol kenardan çıkan etiket çubukları ve her birinin devamı olan iç içe yaylar.

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Referansın yapısı birebir kuruldu: beş etiket çubuğu sol kenardan çıkıyor, her biri kendi yayının başladığı yükseklikte duruyor ve renkli alt çizgisi yay olarak devam ediyor. Yaylar tepeden başlayıp sağdan aşağı, sola doğru %75'lik tur atıyor; dolu kısım o süreçteki tamamlanma, gri kısım eksik. Skor sağ altta büyük, altında "Nasıl hesaplanır?" bağlantısı ve en zayıf halkayı kapatmaya götüren tek aksiyon kartı.

Çubuklar tıklanabilir — her biri kendi sürecine gidiyor.

## User

HALA ÇOK KÖTÜ

## Assistant

Grafiği görmeden düzeltmeye çalışıyorum — bakayım.

_[tool: show_html]_

_[tool: show_html]_

_[tool: save_screenshot]_

Geometri hatalıydı — yaylar aşağı sola yığılıyordu. Yay açısını kısaltıp skoru boş alana alıyorum.

_[tool: run_script]_

_[tool: dc_js_str_replace]_

_[tool: save_screenshot]_

_[tool: show_html]_

_[tool: save_screenshot]_

Geometri düzeldi. Başlıktaki tekrarları temizliyorum.

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Sorun geometrideydi: yaylar 270° dönüp aşağı sola yığılıyordu. Şimdi 135°'lik yelpaze halinde sağa açılıyor — etiket çubukları solda kendi yayının hizasında, skor sol altta boş alanda büyük. Başlıktaki tekrar eden 58/100 satırı kaldırıldı.

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Görsel aynı kaldı; her çubuğun üstüne 44px yüksekliğinde şeffaf dokunma alanı eklendi, yay aralığı bozulmadı.

## User

Found issues — fixing…

## Assistant

_[tool: dc_html_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Çubuklar artık sadece grafik etiketi (tıklanmıyor), gezinme grafiğin altındaki 52px'lik beş satırda — çakışan dokunma alanı kalmadı.

## User

YAZILARIN OLDUĞU ÇERÇEVELER ÇOK KÖŞELİ DAİRENİN DEVAMI GİBİ OLMALI

## Assistant

_[tool: run_script]_

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

_[tool: get_webview_logs]_

_[tool: save_screenshot]_

_[tool: grep]_

`i` tanımsızdı — map indeksini ekliyorum.

_[tool: dc_js_str_replace]_

_[tool: ready_for_verification]_

Etiket çerçeveleri artık sağ tarafı tam yuvarlatılmış (999px) — yayın devamı gibi akıyor, köşeli görünüm gitti. Her satır içe doğru 4px kısalıyor, halkaların daralmasını takip ediyor.

## User

OLMADI TAM OLARAK OLMASI GEREKENİ EKLEDİM BİREBİR AYNI OLSUN

## Assistant

Referansı doğru okudum: etiket alt çizgisi yayın tepesinden başlayıp saat yönünde spiral gibi dönüyor. Grafiği o geometriyle yeniden kuruyorum.

_[tool: read_file]_

_[tool: run_script]_

_[tool: dc_js_str_replace]_

_[tool: show_html]_

_[tool: save_screenshot]_

_[tool: grep]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

Referanstaki spiral geometri oturdu: her etiketin alt çizgisi yayın tepesinden başlıyor, saat yönünde sağdan aşağı dönüp merkeze kıvrılıyor. Dolu kısım tamamlanan, koyu kısım eksik iş; sağ üstte "TAM UYUM", sol altta "EKSİK İŞ" eğri yazıları. Skor sağ üstte, halkalar bir bakışta okunuyor.

## User

HALKA GÜZEL OLDU SADECE BURASI UYUMSUZ VE SAYFA AÇILIRKEN HALKALAR ANİMASYONLU BİÇİMDE DOLSUN

## Assistant

_[tool: run_script]_

_[tool: dc_js_str_replace]_

_[tool: save_screenshot]_

Etiket bloğu düzeldi: sol renk çubuğu kalktı, satırlar arası 2px boşluk ve sağ üst köşe yuvarlatıldı — her satır kendi yayının uzantısı gibi okunuyor, tablo görünümü gitti. Halkalar sayfa açılırken sırayla, tepeden başlayıp saat yönünde dolarak animasyonla geliyor (1,05 s, 60 ms aralıklı).

## User

BAK OLMAYAN YER SADECE BURA KALDI BELGELERİN ALTINDAKİ ÇİZGİ KENDİ HALKASINA GELMELİ DİĞERLERİDE AYNI

## Assistant

_[tool: dc_js_str_replace]_

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: save_screenshot]_

Her etiketin alt çizgisi artık kendi halkasının tepe noktasına (x=182) kadar uzanıyor — beşi de aynı hizada bitip yayın yuvarlak ucunun altına giriyor, boşluk kalmadı. "EKİPMAN" yazımı da düzeltildi.

## User

HALA OLMADI LÜTFEN DÜZGÜN YAP

## Assistant

_[tool: dc_js_str_replace]_

_[tool: save_screenshot]_

_[tool: ready_for_verification]_

Şimdi oldu: her etiketin alt çizgisi kendi halkasının üst kenarıyla aynı hizada — yay, etiketin sağ köşesinden çıkıp kıvrılıyor, referanstaki gibi. Beş satırın beşi de kendi halkasına bağlı.

## User

DAHA KÖTÜ OLDU DALGAMI GEÇİYORSUN

## Assistant

_[tool: run_script]_

_[tool: dc_js_str_replace]_

_[tool: save_screenshot]_

_[tool: ready_for_verification]_

Şimdi referansla aynı yapı: etiketler bitişik blok halinde, her satırın renkli alt çizgisi tam sağ kenarında kendi yayına bağlanıyor — BELGELER en dış lime halkaya, EKİPMAN en iç kırmızıya. Yaylar kalınlaştı (24px), aralıklar sıkılaştı ve açılışta sırayla dolma animasyonu duruyor.

## User

YA BU SEFERDE AYIRMIŞSIN  BU ŞEKİL OLACAK EKLEDİM

## Assistant

_[tool: run_script]_

_[tool: dc_js_str_replace]_

_[tool: save_screenshot]_

_[tool: ready_for_verification]_

Renkli çizgi satırın üstüne alındı — referanstaki gibi her satırın üst çizgisi kendi halkasının tepe hizasında ve sağ üst köşeden kıvrılıp yayına bağlanıyor. Satırlar arasında boşluk yok, tek blok halinde.

## User

İYİCE BOZDUN GİT GİDE DAHA KÖTÜ YAPIYORSUN

## Assistant

Sorun yayların 270° dönüp sola kıvrılması — o yüzden karışıyor. Referansta yaylar 180°, sadece sağa açılıyor.

_[tool: run_script]_

_[tool: dc_js_str_replace]_

_[tool: save_screenshot]_

_[tool: ready_for_verification]_

Yaylar artık 270° yerine 180° — tepeden başlıyor, sağdan aşağı iniyor, sola dönüp etiket bloğuna girmiyor. Karışıklığın sebebi buydu. Her satırın üst çizgisi kendi yayının başlangıç hizasında, yaylar sağa doğru temiz bir yelpaze halinde açılıyor.

## User

YAZIKARI DÜZELTMEDİN ÜSTÜNE HALKAYIDA BOZDUN

## Assistant

_[tool: run_script]_

_[tool: dc_js_str_replace]_

_[tool: save_screenshot]_

_[tool: ready_for_verification]_

İki düzeltme: satırların üst çizgisi artık halkanın çizgi kalınlığının tam üst kenarına oturuyor (11,5px kaymayı giderdim), yani her renkli çizgi kendi yayının başladığı yerde. Yazılarda da rakam ve yüzde sütunları sabit genişlikte sağa hizalandı, sol boşluk eklendi — kolonlar düzgün.

## User

HALKARI BOZDUN DÜZELT BU HALDE OLACAK HALKALAR

## Assistant

Anlaşıldı — halkalar 270° olacak. Etiket hizasını koruyup yayları geri getiriyorum.

_[tool: run_script]_

_[tool: dc_js_str_replace]_

_[tool: save_screenshot]_

_[tool: ready_for_verification]_

Halkalar istediğin hale döndü — 270°'lik tam süpürme, sağdan aşağı dönüp sola kıvrılıyor, "TAM UYUM" sağ üstte, "EKSİK İŞ" sol altta. Etiket satırlarının hizası ve kolon düzeni korundu.

## User

Save as standalone HTML: `GoverHub Mobile.dc.html`

## Assistant

_[tool: grep]_

Only the fonts link and support.js — both bundler-visible. Adding the thumbnail to a copy.

_[tool: run_script]_

_[tool: super_inline_html]_

_[tool: show_html]_

_[tool: get_webview_logs]_

All fonts and the runtime inlined cleanly, no console errors.

_[tool: present_fs_item_for_download]_

Tek dosya, 711 KB — fontlar dahil çevrimdışı çalışır. Yukarıdaki karttan indirebilirsin.

