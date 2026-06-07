// Ana akış: whispi.io'ya giriş yap → gelen kutusunu çek → daha önce
// görülmeyen (yeni) soruları bul → Telegram'a bildir → durumu kaydet.

import { login, getQuestions } from "./whispi.js";
import { sendTelegram } from "./telegram.js";
import { readState, writeState } from "./state.js";

// Ayarlanabilir sınırlar (env ile geçilebilir).
const MAX_QUESTIONS = Number(process.env.WHISPI_MAX_QUESTIONS) || 500;
const MAX_CONTENT_CHARS = 3500; // Telegram mesaj sınırı 4096; şablon + güvenlik payı.

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
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function formatQuestion(question, username) {
  const raw = question.content ? truncate(question.content, MAX_CONTENT_CHARS) : "(boş soru)";
  const content = escapeHtml(raw);
  const lines = [`💬 <b>Whispi'de yeni soru!</b>`, "", content];
  // username yalnızca güvenli karakter içeriyorsa link ekle.
  if (username) {
    const url = `https://whispi.io/@/${encodeURIComponent(username)}/questions`;
    lines.push("", `<a href="${url}">Cevaplamak için tıkla →</a>`);
  }
  return lines.join("\n");
}

async function main() {
  const identifier = requireEnv("WHISPI_EMAIL"); // e-posta VEYA kullanıcı adı olabilir
  const password = requireEnv("WHISPI_PASSWORD");
  const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const chatId = requireEnv("TELEGRAM_CHAT_ID");

  const { accessToken, username } = await login(identifier, password);
  const { questions, total, truncated } = await getQuestions(accessToken, { maxQuestions: MAX_QUESTIONS });
  console.log(`Gelen kutusunda ${questions.length} soru çekildi (toplam: ${total}).`);
  if (truncated) {
    console.warn(
      `UYARI: Gelen kutusunda ${total} soru var ama yalnızca ${questions.length} çekildi ` +
        `(MAX_QUESTIONS=${MAX_QUESTIONS}). En eski sorular gözden kaçabilir; WHISPI_MAX_QUESTIONS'ı artır.`,
    );
  }

  const state = await readState();
  const currentIds = new Set(questions.map((q) => q.id));

  // İlk çalışma: mevcut soruları "görüldü" kabul et, geçmiş için bildirim atma.
  if (!state.initialized) {
    await writeState({ initialized: true, seenIds: [...currentIds] });
    console.log(
      `İlk çalışma: ${currentIds.size} mevcut soru temel alındı. ` +
        `Bundan sonra gelen yeni sorular için bildirim gönderilecek.`,
    );
    return;
  }

  const seen = new Set(state.seenIds);
  // Yeni soruları createdAt'a göre eskiden yeniye sırala (API sıralamasına bağlı kalma).
  const fresh = questions
    .filter((q) => !seen.has(q.id))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  // seenIds'i her zaman gelen kutusunda HÂLÂ duran id'lerle sınırla:
  // - sınırsız büyümeyi önler, - cevaplanıp kutudan düşenleri temizler,
  // - hâlâ duran bir soruyu asla "görülmedi"ye düşürmez.
  const persist = async () => {
    const pruned = [...seen].filter((id) => currentIds.has(id));
    await writeState({ initialized: true, seenIds: pruned });
  };

  if (fresh.length === 0) {
    await persist(); // gerekiyorsa budamayı uygula
    console.log("Yeni soru yok.");
    return;
  }

  console.log(`${fresh.length} yeni soru bulundu, bildirim gönderiliyor...`);
  let sent = 0;
  try {
    for (const question of fresh) {
      await sendTelegram(botToken, chatId, formatQuestion(question, username));
      seen.add(question.id); // yalnızca BAŞARILI gönderimden sonra "görüldü" işaretle
      sent++;
      console.log(`  → bildirildi: ${question.id}`);
    }
  } finally {
    // Kısmi başarısızlıkta bile o ana kadar gönderilenleri kalıcılaştır (tekrar bildirmeyi önler).
    if (sent > 0) await persist();
  }
  console.log(`Tamamlandı (${sent}/${fresh.length} bildirim gönderildi).`);
}

main().catch((err) => {
  console.error("HATA:", err.message);
  process.exit(1);
});
