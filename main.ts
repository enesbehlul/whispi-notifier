// whispi.io gelen kutusuna yeni soru gelince Telegram'dan bildirim gönderir.
// Deno Deploy üzerinde Deno.cron ile periyodik çalışır; durum Deno KV'de tutulur.
//
// Gerekli ortam değişkenleri (Deno Deploy → app → Environment Variables):
//   WHISPI_EMAIL, WHISPI_PASSWORD, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
// İsteğe bağlı: REQUEST_TIMEOUT_MS, REQUEST_RETRIES, WHISPI_MAX_QUESTIONS

const WHISPI_API = "https://api.whispi.io/graphql";
const TG_API = "https://api.telegram.org";

const TIMEOUT_MS = Number(Deno.env.get("REQUEST_TIMEOUT_MS")) || 15000;
const RETRIES = Number(Deno.env.get("REQUEST_RETRIES")) || 3;
const MAX_QUESTIONS = Number(Deno.env.get("WHISPI_MAX_QUESTIONS")) || 500;
const MAX_CONTENT = 3500; // Telegram 4096 sınırı için pay

const kv = await Deno.openKv();
const STATE_KEY = ["whispi", "state"];
const TOKEN_KEY = ["whispi", "token"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TaggedError extends Error {
  transient?: boolean;
}
function fail(message: string, transient: boolean): TaggedError {
  const e = new Error(message) as TaggedError;
  e.transient = transient;
  return e;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ac.signal });
  } catch (err) {
    throw fail(`Ağ hatası: ${(err as Error).message}`, true);
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const e = err as TaggedError;
      if (attempt >= RETRIES || e.transient !== true) throw err;
      const delay = 1000 * 2 ** attempt;
      console.warn(`${label} başarısız (deneme ${attempt + 1}/${RETRIES + 1}), ${delay}ms sonra tekrar: ${e.message}`);
      await sleep(delay);
    }
  }
}

// ---- whispi GraphQL ----
const LOGIN = `mutation Login($input: LoginInput!) {
  login(input: $input) { accessToken account { username } errors { code } }
}`;
const GET_QUESTIONS = `query GetQuestions($sort: SortInput!, $pagination: PaginationInput!) {
  questions(sort: $sort, pagination: $pagination) {
    edges { id content createdAt }
    pageInfo { total }
  }
}`;

// deno-lint-ignore no-explicit-any
async function gql(query: string, variables: unknown, token?: string): Promise<any> {
  return await withRetry(async () => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "apollo-require-preflight": "true",
    };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetchWithTimeout(WHISPI_API, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw fail(`whispi API HTTP ${res.status}`, res.status === 429 || res.status >= 500);
    }
    // deno-lint-ignore no-explicit-any
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      throw fail(`whispi API geçersiz JSON (HTTP ${res.status})`, true);
    }
    if (Array.isArray(json.errors) && json.errors.length) {
      throw fail(`whispi GraphQL hatası: ${JSON.stringify(json.errors)}`, false);
    }
    return json.data ?? {};
  }, "whispi API");
}

async function login(identifier: string, password: string): Promise<{ accessToken: string; username: string }> {
  const data = await gql(LOGIN, { input: { identifier, password } });
  const r = data?.login;
  if (!r) throw new Error("Giriş başarısız: beklenmeyen yanıt.");
  if (Array.isArray(r.errors) && r.errors.length) {
    throw new Error(`Giriş başarısız (${r.errors.map((e: { code: string }) => e.code).join(", ")}).`);
  }
  if (!r.accessToken) throw new Error("Giriş başarısız: accessToken yok.");
  return { accessToken: r.accessToken, username: r.account?.username ?? "" };
}

function jwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

// Token'ı KV'de önbelleğe al; her dakika yeniden giriş yapma (whispi'yi yormayalım).
async function getAuth(identifier: string, password: string, forceLogin = false): Promise<{ token: string; username: string }> {
  const now = Math.floor(Date.now() / 1000);
  if (!forceLogin) {
    const cached = await kv.get<{ token: string; username: string; exp: number }>(TOKEN_KEY);
    if (cached.value && cached.value.exp - now > 3600) {
      return { token: cached.value.token, username: cached.value.username };
    }
  }
  const { accessToken, username } = await login(identifier, password);
  const exp = jwtExp(accessToken) ?? now + 6 * 24 * 3600;
  await kv.set(TOKEN_KEY, { token: accessToken, username, exp });
  return { token: accessToken, username };
}

interface Question {
  id: string;
  content: string;
  createdAt: string;
}

async function getQuestions(token: string): Promise<{ questions: Question[]; total: number; truncated: boolean }> {
  const all: Question[] = [];
  let offset = 0;
  let total = 0;
  const pageSize = 50;
  while (all.length < MAX_QUESTIONS) {
    const limit = Math.min(pageSize, MAX_QUESTIONS - all.length);
    const data = await gql(GET_QUESTIONS, { sort: { order: "DESC" }, pagination: { limit, offset } }, token);
    const conn = data?.questions;
    const edges: Question[] = Array.isArray(conn?.edges) ? conn.edges : [];
    total = conn?.pageInfo?.total ?? all.length + edges.length;
    all.push(...edges);
    if (edges.length === 0 || all.length >= total) break;
    offset += edges.length;
  }
  return { questions: all, total, truncated: total > all.length };
}

// ---- Telegram ----
function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
function formatQuestion(q: Question, username: string): string {
  const raw = q.content ? truncate(q.content, MAX_CONTENT) : "(boş soru)";
  const lines = ["💬 <b>Whispi'de yeni soru!</b>", "", escapeHtml(raw)];
  if (username) {
    lines.push("", `<a href="https://whispi.io/@/${encodeURIComponent(username)}/questions">Cevaplamak için tıkla →</a>`);
  }
  return lines.join("\n");
}
async function sendTelegram(botToken: string, chatId: string, text: string): Promise<void> {
  await withRetry(async () => {
    const res = await fetchWithTimeout(`${TG_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw fail(`Telegram API hatası (${res.status}): ${body}`, res.status === 429 || res.status >= 500);
    }
    return await res.json();
  }, "Telegram gönderimi");
}

// ---- durum (Deno KV) ----
async function readState(): Promise<{ initialized: boolean; seenIds: string[] }> {
  const res = await kv.get<{ initialized: boolean; seenIds: string[] }>(STATE_KEY);
  return res.value ?? { initialized: false, seenIds: [] };
}
async function writeState(seenIds: string[]): Promise<void> {
  await kv.set(STATE_KEY, { initialized: true, seenIds: seenIds.slice(-500) });
}

// ---- ana iş ----
async function check(): Promise<void> {
  const identifier = Deno.env.get("WHISPI_EMAIL");
  const password = Deno.env.get("WHISPI_PASSWORD");
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!identifier || !password || !botToken || !chatId) {
    console.error("Eksik ortam değişkeni: WHISPI_EMAIL / WHISPI_PASSWORD / TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID");
    return;
  }

  // Önbellekteki token'la dene; geçersizse bir kez yeniden giriş yap.
  let auth = await getAuth(identifier, password);
  let result;
  try {
    result = await getQuestions(auth.token);
  } catch (_err) {
    auth = await getAuth(identifier, password, true); // token bayatlamış olabilir
    result = await getQuestions(auth.token);
  }
  const { questions, total, truncated } = result;
  console.log(`Gelen kutusu: ${questions.length} çekildi (toplam ${total}).`);
  if (truncated) {
    console.warn(`UYARI: ${total} sorudan ${questions.length} çekildi; WHISPI_MAX_QUESTIONS artırılmalı.`);
  }

  const state = await readState();
  const currentIds = new Set(questions.map((q) => q.id));

  if (!state.initialized) {
    await writeState([...currentIds]);
    console.log(`İlk çalışma: ${currentIds.size} mevcut soru temel alındı, bildirim gönderilmedi.`);
    return;
  }

  const seen = new Set(state.seenIds);
  const fresh = questions
    .filter((q) => !seen.has(q.id))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const persist = () => writeState([...seen].filter((id) => currentIds.has(id)));

  if (fresh.length === 0) {
    await persist();
    console.log("Yeni soru yok.");
    return;
  }

  console.log(`${fresh.length} yeni soru bulundu, bildiriliyor...`);
  let sent = 0;
  try {
    for (const q of fresh) {
      await sendTelegram(botToken, chatId, formatQuestion(q, auth.username));
      seen.add(q.id);
      sent++;
      console.log(`  → bildirildi: ${q.id}`);
    }
  } finally {
    if (sent > 0) await persist();
  }
  console.log(`Tamamlandı (${sent}/${fresh.length} bildirim).`);
}

// Deno Deploy bu tanımı otomatik algılar ve her dakika çalıştırır.
Deno.cron("whispi-check", "* * * * *", async () => {
  try {
    await check();
  } catch (err) {
    console.error("HATA:", (err as Error).message);
  }
});

// Platformun bir HTTP sunucusu beklediği durumlar için minimal sağlık ucu.
// Asıl iş yukarıdaki cron ile yapılır; burası sadece "ayakta mı?" cevabı verir.
Deno.serve(() =>
  new Response("whispi-notifier çalışıyor ✓ (kontrol her dakika cron ile yapılır)\n", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  })
);

