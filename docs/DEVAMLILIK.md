# Proje kimliği ve bağımsızlık

**Bu proje bağımsızdır.** GitHub'daki `esoydemir/goverhub` deposu adı benzese de **başka bir projedir** ve bu projeyle birleştirilmeyecektir.

## Kurallar

- O depoya kod gönderilmez. Orada dosya değiştirilmez, dal açılmaz, merge ya da taşıma yapılmaz.
- O projenin şunları bu projeye karıştırılmaz: kodu, veritabanı şeması, migration'ları, kullanıcıları, ortam değişkenleri, test sayıları ve insan inceleme kayıtları.
- O projenin test sayıları ve inceleme kayıtları bu projenin kabul koşulu değildir. Bu projenin gereksinimleri ve testleri kendi içinde değerlendirilir: `KABUL.md`, `PILOT.md` §3.
- Bu projeye uzak depo bağlanacaksa **ayrı, yeni bir depo** kullanılır. `esoydemir/goverhub` adresi kullanılmaz.

## Bu projenin kaynağı

| | |
|---|---|
| Başlangıç | `ae727a5` — Claude Design'dan dışa aktarılan GoverHub Business Mobile prototipi (30.10.2026) |
| Devam noktası | `e9baa001b8f61594ac486d5aad1bde4c857f4f34` (`goverhub-mobile` dalı) |
| Bileşenler | `server/` (Fastify + PostgreSQL), `mobile/` (Expo), `e2e/`, `docs/` |
| Uzak depo | Yok. Kod, Git paketi ve kaynak arşivi olarak teslim edilir. |

## Yanlış depoya gönderime karşı korumalar

- Bu yerel depoda tanımlı uzak depo yok (`git remote -v` boş).
- Yerel `pre-push` kancası, adresinde `esoydemir/goverhub` geçen her gönderimi reddeder. Kanca Git paketiyle taşınmaz; yeni bir kopyada istenirse elle eklenir.
- Ayrı bir uzak depo bağlandığında ilk gönderimden önce `git remote -v` ile adres kontrol edilir.
