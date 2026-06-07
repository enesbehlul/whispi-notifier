# whispi-notifier

whispi.io gelen kutuna **yeni bir soru** geldiğinde sana **Telegram'dan** anında bildirim gönderir.

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

`.env.example`'ı `.env` olarak kopyalayıp doldurun, sonra:

```bash
npm run start:env
```

> `.env` dosyası `.gitignore`'da — repoya gönderilmez.

---

## Notlar

- **Kontrol sıklığı:** GitHub cron'unun en küçük etkili aralığı ~5 dakikadır ve yoğunlukta birkaç dakika gecikebilir. Daha sık istersen `.github/workflows/notify.yml` içindeki `cron` değerini düzenle (ama 5 dk'dan küçük genelde işe yaramaz).
- **Güvenlik:** Şifren yalnızca GitHub Secrets içinde şifreli durur, kodda/loglarda görünmez. İçin daha rahat olsun istersen whispi.io şifreni değiştirip yenisini secret olarak koyabilirsin.
- **Token süresi:** Her çalışmada yeniden giriş yapılır, bu yüzden token süresini takip etmeye gerek yok.
- **state.json:** "Görülen soru" geçmişini tutar; Actions her yeni soruda bunu repoya `[skip ci]` ile geri commit'ler (sonsuz tetikleme olmaz).
