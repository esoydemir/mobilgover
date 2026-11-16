# GoverHub pilot kapanışı — kayıt

> Bu dosya oturum kesilirse kaldığın yerden devam etmek için tutulur. Her aşama: sonuç, kanıt, commit, sonraki adım.
> Tüm veri **sentetiktir**; ceza tutarı üretilmez; örnek kurallar doğrulanmış mevzuat değildir. Ayrıntılı önceki kayıt: `docs/KALAN_KAPSAM_ILERLEME.md`.
> Mobil/ortam kanıtları: `docs/kanit-kapanis/pilot/`. Araçlar: `tools/` (repo dışı çalışma klasörü) ve `docs/kanit-kapanis/*/` içindeki kopyaları.

## Başlangıç doğrulaması (16.11.2026)
- GitHub'dan doğrulandı: PR #4 açık, taban `goverhub-mobile`, son commit `e26aa28`, `MERGEABLE/CLEAN`, üç zorunlu kontrol (Mobil, Sunucu, Yerel demo) **geçti** (koşu 43704726917). Depoda dal koruması yok (ücretsiz plan, API 403); zorunlu inceleme engeli yok. Önceki birleştirmeler "merge commit" idi, aynısı uygulandı.
- **PR #4 birleştirildi:** birleşen commit `b967168` (`goverhub-mobile`). `e26aa28` ile ağaç farkı yok (`git diff e26aa28 b967168` boş), yani CI'ın sınadığı içerik birleşen içerikle aynı. Birleşme sonrası dal CI'ı: bkz. "Kapanış PR'ı".
- 8091 birleşen sürümle yeniden kuruldu (`docker compose -p goverhub-pilotfix … up -d --build --no-deps app proxy`); birimler (`goverhub-pilotfix_veritabani/_kanit/_ayar`) ve demo kayıtları korundu. Veritabanı konteyneri 2+ gündür kesintisiz.

## Aşama 1 — ortam doğrulaması (`tools/pk-ortam.cjs`)
- Sağlık, demo girişi, `/ocr/status` (Tesseract Türkçe, yerel: hazır), model **açık**: gerçek yerel Ollama `qwen2.5-coder:7b` yanıtı, kaynak bağlantısı belgeyi açıyor; model **ulaşılamaz**: çökme yok, kaynaklar listeleniyor ve "Dil modeline ulaşılamadı; ilgili kaynaklar olduğu gibi listelendi" yazıyor; ceza sorusunda tutar üretilmiyor.
- **Bulunan hata (giderildi):** model yanıtında `[1, 2]` biçiminde gruplu atıf varsa denetim bunu "kaynaklarda olmayan sayı: 1,2" sayıp yanıtı reddediyordu (kullanıcı model yerine yalnız kaynak listesi görüyordu). `llm.ts` artık gruplu atıfı atıf sayar; birim testi eklendi (`assistant-model.test.ts` 19/19). 8091'de yeniden doğrulandı.
- Kanıt: `docs/kanit-kapanis/pilot/ortam-acik.json`, `ortam-model-ulasilamaz.json`. Commit: bkz. git geçmişi ("fix(assistant): gruplu atıf").
- "Model yapılandırılmamış" durumu otomatik testle (`assistant-model.test.ts`) doğrulanır; canlıda "ulaşılamaz" durumu denendi, sonra model bağlantısı geri açıldı (8091 şu an model **açık**).
