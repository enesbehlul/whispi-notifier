// whispi.io GraphQL API istemcisi.
// API'nin introspection'ı kapalı; bu sorgular giriş yapılmış oturumun
// ağ trafiğinden yakalanıp birebir kullanıldı.

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
  const headers = {
    "content-type": "application/json",
    // Apollo'nun CSRF korumasını karşılayan başlık (gerçek istemci de gönderiyor).
    "apollo-require-preflight": "true",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* gövde JSON değil */
  }

  if (!res.ok || !json) {
    throw new Error(`whispi API HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  if (Array.isArray(json.errors) && json.errors.length) {
    throw new Error(`whispi GraphQL hatası: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

/**
 * E-posta veya kullanıcı adı + şifre ile giriş yapar.
 * @returns {Promise<{accessToken: string, username: string}>}
 */
export async function login(identifier, password) {
  const data = await gqlRequest(LOGIN_MUTATION, {
    input: { identifier, password },
  });
  const result = data.login;
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
 * Gelen kutusundaki (henüz cevaplanmamış) soruları en yeniden eskiye döndürür.
 * @returns {Promise<Array<{id: string, content: string, createdAt: string}>>}
 */
export async function getQuestions(token, limit = 30) {
  const data = await gqlRequest(
    GET_QUESTIONS_QUERY,
    { sort: { order: "DESC" }, pagination: { limit, offset: 0 } },
    token,
  );
  return data.questions.edges;
}
