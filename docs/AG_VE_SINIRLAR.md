# Ağ erişimi, vekil sunucu ve istek sınırları

## 1. API'ye kim ulaşabilir

```
İnternet ──443──▶ Caddy (HTTPS, aynı sunucu) ──127.0.0.1:3000──▶ API
İnternet ──3000──▶ ✗ (API dışarıda dinlemiyor; güvenlik duvarı da kapalı)
```

- **API yalnızca `127.0.0.1` üzerinde dinler.** Varsayılan budur. Pilot modunda (`DEMO_MODE=false`) başka bir adres verilirse uygulama **başlamayı reddeder**. Test: API yerel adreste dinlerken aynı makinenin başka bir ağ arabiriminden bağlanma denemesi `ECONNREFUSED` ile sonuçlanıyor.
- **Güvenlik duvarı ikinci katmandır:** Dışarıya yalnızca 80 ve 443 açılır; SSH yalnızca yönetici IP'lerinden kabul edilir (`deploy/README.md`).
- **Kurulumdan sonraki kontrol:** Başka bir makineden `curl http://<sunucu-IP>:3000/health` bağlanamamalı. Ayrıca `npm run pilot:check` şunları doğrular: `HOST` yerel adres mi, `TRUST_PROXY` yalnızca yerel vekili mi gösteriyor.

## 2. Hangi vekile güvenilir

`TRUST_PROXY` yalnızca **açıkça yazılmış IP adresleri ya da adres aralıkları** kabul eder (pilotta `127.0.0.1`). `true`, `*`, `all`, `loopback`, `0.0.0.0/0` ve alan adları reddedilir; uygulama başlamaz.

API, istemci adresini şöyle belirler:
- Bağlantı güvenilen vekilden (127.0.0.1) gelmiyorsa: `X-Forwarded-For` **tamamen yok sayılır** ve bağlantının kendi adresi kullanılır.
- Bağlantı güvenilen vekilden geliyorsa: `X-Forwarded-For` listesinde sağdan sola gidilir ve **güvenilmeyen ilk adres** alınır. Caddy, gelen isteğin gerçek adresini listenin sonuna eklediği için istemcinin listeye yazdığı uydurma değerler hiçbir zaman seçilmez.

Testler (`server/test/acceptance/production-guards.test.ts`):
- Vekil üzerinden, her istekte farklı sahte `X-Forwarded-For` gönderen istemci yine de 300 istekten sonra 429 alıyor. Aynı vekilin arkasındaki başka bir gerçek istemci etkilenmiyor.
- Vekili atlayıp doğrudan bağlanan bir istemci (ör. 198.51.100.7), başlığa ne yazarsa yazsın kendi adresiyle sınırlanıyor. Taklit ettiği adres etkilenmiyor.
- Bozma denemesi: uygulama "her vekile güven" moduna alınınca bu iki test başarısız oluyor.

## 3. Sınırlar nasıl birlikte çalışır

**IP adresi kullanıcı kimliği değildir.** Aynı işletme ağındaki herkes dışarıya tek bir adresten çıkabilir (NAT); tersine, bir kişi gün içinde farklı adreslerden bağlanabilir. Bu yüzden IP yalnızca **kimliksiz trafiğe kaba bir fren** olarak kullanılır. Hesapların korunması e-posta adresine ve oturuma bağlıdır.

| Sınır | Neye göre sayılır | Değer | Neyi korur |
|---|---|---|---|
| Kimliksiz istekler (giriş sayfası, kod isteme/doğrulama) | İstemci IP'si (vekil üzerinden gerçek adres) | Dakikada 300 | Sunucuyu aşırı yükten |
| Oturum açmış istekler | **Oturum** (Bearer anahtarının özeti), IP'den bağımsız | Dakikada 300 | Bir kişinin hatalı istemcisi diğerlerini etkilemesin |
| Giriş kodu isteme | **E-posta adresi**, IP'den bağımsız | 15 dakikada 5 kod | Bir adrese kod yağdırılmasını |
| Giriş kodu deneme | **Kod** (her kod ayrı) | Kod başına 5 deneme, sonra kilit; kod 10 dakika geçerli, tek kullanımlık | Kod tahminini |

**Aynı işletme ağındaki farklı kullanıcılar (test edildi):**
- **Oturum açmış iki çalışan:** Biri sınırına ulaşınca diğeri etkilenmiyor; sınırlar oturuma bağlı.
- **Giriş kodu:** Bir çalışanın e-posta adresi kod sınırına ulaşınca, aynı ağdaki bir meslektaşı yine kod alabiliyor. Sınıra ulaşan adres ise başka bir ağdan denese de sınırlı kalıyor; kural adrese bağlı, IP'ye değil.
- **Kimliksiz istekler** aynı ağda ortak bir bütçeyi paylaşır (dakikada 300). 20 kişilik bir işletmenin aynı anda giriş yapması bunun çok altında kalır. Aynı ağdaki biri bu bütçeyi bilerek tüketirse, diğerlerinin **giriş sayfası** en fazla bir dakika bekler; oturum açmış olanlar etkilenmez.

**Bilinen sınırlamalar:**
- **Sayaçlar bellekte tutuluyor.** Uygulama yeniden başlayınca sıfırlanır. Birden fazla uygulama sunucusunda paylaşılmaz; pilot tek sunucu.
- **Oturum başına sınır, kişi başına değil.** Bir kişi birden çok oturum açarak bütçesini çoğaltabilir. Ancak her yeni oturum bir e-posta kodu gerektirir ve adres başına 15 dakikada 5 kod sınırı bu çoğalmayı sınırlar.
