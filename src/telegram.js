// Telegram Bot API üzerinden bildirim gönderir.
// Bot token'ı @BotFather'dan, chat ID'yi README'deki adımlarla alırsın.

const API_BASE = "https://api.telegram.org";

/**
 * Telegram'a bir mesaj gönderir.
 * @param {string} botToken - @BotFather'dan alınan bot token'ı
 * @param {string|number} chatId - mesajın gideceği sohbet ID'si
 * @param {string} text - HTML biçimli mesaj metni
 */
export async function sendTelegram(botToken, chatId, text) {
  const res = await fetch(`${API_BASE}/bot${botToken}/sendMessage`, {
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
    throw new Error(`Telegram API hatası (${res.status}): ${body}`);
  }
  return res.json();
}
