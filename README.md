# whispi-notifier

whispi.io gelen kutuna **yeni bir soru** geldiğinde sana **Telegram'dan** bildirim gönderir.

GitHub Actions üzerinde ücretsiz çalışır — bilgisayarın kapalı olsa bile her ~5 dakikada bir kontrol eder. Kurulum tamamen bir kerelik.

## Nasıl çalışır?

1. GitHub Actions cron'u her ~5 dakikada bir `src/index.js`'i çalıştırır.
2. Betik whispi.io GraphQL API'sine **giriş yapar** (`Login` mutation → `accessToken`).
3. **Gelen kutusunu** çeker (`GetQuestions` sorgusu → cevaplanmamış sorular).
4. `state.json`'daki "daha önce görülenler" listesiyle karşılaştırır.
5. **Yeni** soru varsa Telegram botuyla sana mesaj atar ve `state.json`'u günceller (repoya geri commit'ler).

> Ekran kazıma (scraping) yok — sitenin kendi resmî API'si kullanılıyor, bu yüzden güvenilir.

---

## Kurulum

### 1) Telegram botu oluştur

1. Telegram'da **[@BotFather](https://t.me/BotFather)**'a yaz.
2. `/newbot` gönder → bota bir **isim** ve **kullanıcı adı** ver (kullanıcı adı `bot` ile bitmeli).
3. BotFather sana bir **token** verir: `123456789:ABCdefGhIJKlm… ` → bunu sakla (`TELEGRAM_BOT_TOKEN`).
4. Yeni oluşturduğun bota Telegram'dan **bir mesaj at** (örn. "merhaba"). Bu, botun seninle konuşabilmesi için gerekli.

### 2) Chat ID'ni bul

Botuna mesaj attıktan sonra, tarayıcında şu adresi aç (TOKEN yerine kendi token'ını koy):

```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

Dönen JSON içinde `"chat":{"id":123456789,...}` kısmındaki sayı senin **`TELEGRAM_CHAT_ID`**'in.

### 3) Kodu GitHub'a yükle

Bu klasörü kendi (tercihen **private**) GitHub reponuza yükleyin:

```bash
git init
git add .
git commit -m "whispi telegram bildirim botu"
git branch -M main
git remote add origin https://github.com/<kullanici>/<repo>.git
git push -u origin main
```

### 4) Secrets (gizli değişkenler) ekle

GitHub repo sayfasında: **Settings → Secrets and variables → Actions → New repository secret**. Şu 4 secret'ı ekle:

| Secret adı            | Değer                                              |
| --------------------- | -------------------------------------------------- |
| `WHISPI_EMAIL`        | whispi.io **e-postan veya kullanıcı adın**         |
| `WHISPI_PASSWORD`     | whispi.io şifren                                   |
| `TELEGRAM_BOT_TOKEN`  | BotFather'dan aldığın token                        |
| `TELEGRAM_CHAT_ID`    | 2. adımda bulduğun chat ID                         |

### 5) Çalıştır

1. Repo'da **Actions** sekmesine git, Actions'ı etkinleştir (gerekiyorsa).
2. **"whispi bildirim"** workflow'unu seç → **Run workflow** ile elle bir kez tetikle.
3. İlk çalışma mevcut soruları "temel" alır ve bildirim **göndermez** (geçmiş sorular için spam olmasın diye). Bundan sonra gelen **yeni** her soru için Telegram'a mesaj düşer.

Sonrası otomatik: cron her ~5 dakikada bir kontrol eder.

---

## Yerel test (opsiyonel)

**Node 20.6+** gerekir (`--env-file` desteği için). `.env.example`'ı `.env` olarak kopyalayıp doldurun, sonra:

```bash
npm run start:env
```

> `.env` dosyası `.gitignore`'da — repoya gönderilmez.

---

## İsteğe bağlı ayarlar (env / secret)

Hepsi opsiyoneldir; GitHub secret'ı veya yerel `.env` olarak ayarlanabilir:

| Değişken               | Varsayılan | Açıklama                                              |
| ---------------------- | ---------- | ----------------------------------------------------- |
| `WHISPI_MAX_QUESTIONS` | 500        | Her turda çekilecek azami soru sayısı (sayfalama tavanı). |
| `REQUEST_TIMEOUT_MS`   | 15000      | Her HTTP isteği için zaman aşımı (ms).                |
| `REQUEST_RETRIES`      | 3          | Geçici hatada yeniden deneme sayısı.                  |
| `STATE_MAX_SEEN`       | 500        | `state.json`'da tutulacak azami "görülen" ID sayısı.  |

---

## Notlar

- **Kontrol sıklığı:** Varsayılan **5 dakika** (`.github/workflows/notify.yml` içindeki `cron`). GitHub cron'u best-effort'tur; yoğunlukta birkaç dakika gecikebilir. Public repoda Actions sınırsız ücretsizdir; repoyu private yaparsan ücretsiz ~2000 dk/ay kotası için aralığı ~30 dk'ya çıkarman gerekir.
- **Başarısızlık bildirimi:** Bir çalışma hata verirse (ör. şifre değişti, API erişilemedi) Telegram'a "çalışma başarısız" uyarısı gönderilir. Ayrıca GitHub, üst üste başarısız olan zamanlanmış workflow'ları ~60 gün sonra otomatik devre dışı bırakır — Actions e-posta bildirimlerini açık tutman önerilir.
- **Güvenlik:** Şifren/token'ın yalnızca GitHub Secrets içinde şifreli durur; kodda ve loglarda görünmez. (Public repoda Actions logları herkese açıktır, ama betik soru **içeriğini** değil yalnızca soru ID'lerini loglar.) İçin daha rahat olsun istersen whispi.io şifreni değiştirip yenisini secret yapabilirsin.
- **Gizlilik (public repo):** `state.json` ve commit geçmişi herkese açıktır; içinde soru **içeriği yok**, yalnızca soru ID'leri (UUID) ve commit zaman damgaları var — bu da "ne zaman kaç soru geldiği" gibi kaba bir meta veriyi ifşa eder. Rahatsız ederse repoyu private yap.
- **Sağlamlık:** Tüm ağ istekleri zaman aşımlı ve geçici hatalarda otomatik yeniden denenir. Telegram gönderimi sırada kısmen başarısız olursa, gönderilenler kaydedilir; kalanlar sonraki turda denenir (tekrar bildirim olmaz).
- **Token süresi:** Her çalışmada yeniden giriş yapılır, token süresini takip etmeye gerek yok.
- **state.json:** "Görülen soru" geçmişini tutar; Actions her değişiklikte bunu repoya `[skip ci]` ile geri commit'ler. Push reddedilirse `git pull --rebase` ile tekrar denenir.
