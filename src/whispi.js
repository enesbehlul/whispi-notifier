// whispi.io GraphQL API istemcisi.
// API'nin introspection'ı kapalı; bu sorgular giriş yapılmış oturumun
// ağ trafiğinden yakalanıp birebir kullanıldı.

import { fetchWithTimeout, withRetry, makeError } from "./http.js";

const API_URL = "https://api.whispi.io/graphql";

const LOGIN_MUTATION = `mutation Login($input: LoginInput!) {
  login(input: $input) {
    accessToken
    account { id username email }
    errors { code }
  }
}`;

const GET_QUESTIONS_QUERY = `query GetQuestions($sort: SortInput!, $pagination: PaginationInput!) {
  questions(sort: $sort, pagination: $pagination) {
    edges { id content createdAt }
    pageInfo { total limit offset }
  }
}`;

async function gqlRequest(query, variables, token) {
  return withRetry(
    async () => {
      const headers = {
        "content-type": "application/json",
        // Apollo'nun CSRF korumasını karşılayan başlık (gerçek istemci de gönderiyor).
        "apollo-require-preflight": "true",
      };
      if (token) headers.authorization = `Bearer ${token}`;

      const res = await fetchWithTimeout(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      });

      if (!res.ok) {
        // Gövdeyi LOGLAMA (token/PII sızabilir) — yalnızca durum kodu.
        // 5xx ve 429 geçicidir → retry'a uygun.
        throw makeError(`whispi API HTTP ${res.status}`, {
          transient: res.status === 429 || res.status >= 500,
        });
      }

      let json = null;
      try {
        json = await res.json();
      } catch {
        throw makeError(`whispi API geçersiz JSON yanıtı (HTTP ${res.status})`, { transient: true });
      }

      if (Array.isArray(json.errors) && json.errors.length) {
        // GraphQL hataları genelde kalıcıdır (sorgu/yetki). Sadece kodları/mesajları logla.
        throw makeError(`whispi GraphQL hatası: ${JSON.stringify(json.errors)}`, { transient: false });
      }
      return json.data ?? {};
    },
    { label: "whispi API" },
  );
}

/**
 * E-posta veya kullanıcı adı + şifre ile giriş yapar.
 * @returns {Promise<{accessToken: string, username: string}>}
 */
export async function login(identifier, password) {
  const data = await gqlRequest(LOGIN_MUTATION, {
    input: { identifier, password },
  });
  const result = data?.login;
  if (!result) {
    throw new Error("Giriş başarısız: beklenmeyen API yanıtı (login alanı yok).");
  }
  if (Array.isArray(result.errors) && result.errors.length) {
    const codes = result.errors.map((e) => e.code).join(", ");
    throw new Error(`Giriş başarısız (${codes}). E-posta/kullanıcı adı ve şifreyi kontrol et.`);
  }
  if (!result.accessToken) {
    throw new Error("Giriş başarısız: accessToken alınamadı.");
  }
  return {
    accessToken: result.accessToken,
    username: result.account?.username ?? "",
  };
}

/**
 * Gelen kutusundaki (henüz cevaplanmamış) TÜM soruları sayfalayarak çeker.
 * Yoğun/birikmiş kutuda soru kaçırmayı önler; güvenlik için maxQuestions ile sınırlanır.
 * @returns {Promise<{questions: Array<{id, content, createdAt}>, total: number, truncated: boolean}>}
 */
export async function getQuestions(token, { pageSize = 50, maxQuestions = 500 } = {}) {
  const all = [];
  let offset = 0;
  let total = 0;

  while (all.length < maxQuestions) {
    const limit = Math.min(pageSize, maxQuestions - all.length);
    const data = await gqlRequest(
      GET_QUESTIONS_QUERY,
      { sort: { order: "DESC" }, pagination: { limit, offset } },
      token,
    );
    const conn = data?.questions;
    const edges = Array.isArray(conn?.edges) ? conn.edges : [];
    total = conn?.pageInfo?.total ?? all.length + edges.length;
    all.push(...edges);

    if (edges.length === 0 || all.length >= total) break;
    offset += edges.length;
  }

  return { questions: all, total, truncated: total > all.length };
}
