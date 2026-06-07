// Ana akış: whispi.io'ya giriş yap → gelen kutusunu çek → daha önce
// görülmeyen (yeni) soruları bul → Telegram'a bildir → durumu kaydet.

import { login, getQuestions } from "./whispi.js";
import { sendTelegram } from "./telegram.js";
import { readState, writeState } from "./state.js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`HATA: Eksik ortam değişkeni: ${name}`);
    process.exit(1);
  }
  return value;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatQuestion(question, username) {
  const content = escapeHtml(question.content || "(boş soru)");
  const url = `https://whispi.io/@/${username}/questions`;
  return (
    `💬 <b>Whispi'de yeni soru!</b>\n\n` +
    `${content}\n\n` +
    `<a href="${url}">Cevaplamak için tıkla →</a>`
  );
}

async function main() {
  const identifier = requireEnv("WHISPI_EMAIL"); // e-posta VEYA kullanıcı adı olabilir
  const password = requireEnv("WHISPI_PASSWORD");
  const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const chatId = requireEnv("TELEGRAM_CHAT_ID");

  const { accessToken, username } = await login(identifier, password);
  const questions = await getQuestions(accessToken, 30);
  console.log(`Gelen kutusunda ${questions.length} soru görüldü.`);

  const state = await readState();

  // İlk çalışma: mevcut soruları "görüldü" kabul et, geçmiş için bildirim atma.
  if (!state.initialized) {
    const ids = questions.map((q) => q.id);
    await writeState({ initialized: true, seenIds: ids });
    console.log(
      `İlk çalışma: ${ids.length} mevcut soru temel alındı. ` +
        `Bundan sonra gelen yeni sorular için bildirim gönderilecek.`,
    );
    return;
  }

  const seen = new Set(state.seenIds);
  // API en yeniden eskiye döndürüyor; bildirimleri eskiden yeniye sırayla atalım.
  const fresh = [...questions].reverse().filter((q) => !seen.has(q.id));

  if (fresh.length === 0) {
    console.log("Yeni soru yok.");
    await writeState({ initialized: true, seenIds: [...seen] });
    return;
  }

  console.log(`${fresh.length} yeni soru bulundu, bildirim gönderiliyor...`);
  for (const question of fresh) {
    await sendTelegram(botToken, chatId, formatQuestion(question, username));
    seen.add(question.id);
    console.log(`  → bildirildi: ${question.id}`);
  }

  await writeState({ initialized: true, seenIds: [...seen] });
  console.log("Tamamlandı.");
}

main().catch((err) => {
  console.error("HATA:", err.message);
  process.exit(1);
});
