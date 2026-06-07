// Ortak HTTP yardımcıları: timeout'lu fetch + geçici hatalarda retry.
// whispi ve Telegram istemcileri bunu paylaşır.

const DEFAULT_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 15000;
const DEFAULT_RETRIES = Number(process.env.REQUEST_RETRIES) || 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Geçici (yeniden denenebilir) bir hata oluşturur.
 */
export function makeError(message, { transient = false } = {}) {
  const err = new Error(message);
  err.transient = transient;
  return err;
}

/**
 * fetch'i bir zaman aşımıyla sarar; süre dolarsa istek iptal edilir.
 * Ağ/abort hataları "geçici" işaretlenir (retry'a uygun).
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    // Ağ hatası / zaman aşımı → geçici kabul et.
    throw makeError(`Ağ hatası: ${err.message}`, { transient: true });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verilen fonksiyonu, yalnızca err.transient === true olan hatalarda
 * artan beklemeyle (exponential backoff) birkaç kez yeniden dener.
 */
export async function withRetry(fn, { retries = DEFAULT_RETRIES, baseDelay = 1000, label = "istek" } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || err?.transient !== true) throw err;
      const delay = baseDelay * 2 ** attempt;
      console.warn(
        `${label} başarısız (deneme ${attempt + 1}/${retries + 1}), ${delay}ms sonra tekrar denenecek: ${err.message}`,
      );
      await sleep(delay);
    }
  }
}
