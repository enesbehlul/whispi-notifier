// Telegram Bot API üzerinden bildirim gönderir.
// Bot token'ı @BotFather'dan, chat ID'yi README'deki adımlarla alınır.

import { fetchWithTimeout, withRetry, makeError } from "./http.js";

const API_BASE = "https://api.telegram.org";

/**
 * Telegram'a bir mesaj gönderir (geçici hatalarda retry'lı).
 * @param {string} botToken - @BotFather'dan alınan bot token'ı
 * @param {string|number} chatId - mesajın gideceği sohbet ID'si
 * @param {string} text - HTML biçimli mesaj metni (<= 4096 karakter)
 */
export async function sendTelegram(botToken, chatId, text) {
  return withRetry(
    async () => {
      const res = await fetchWithTimeout(`${API_BASE}/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        // 5xx/429 geçici; 4xx (ör. hatalı chat_id/format) kalıcı.
        throw makeError(`Telegram API hatası (${res.status}): ${body}`, {
          transient: res.status === 429 || res.status >= 500,
        });
      }
      return res.json();
    },
    { label: "Telegram gönderimi" },
  );
}
