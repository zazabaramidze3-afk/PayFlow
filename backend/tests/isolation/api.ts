// backend/tests/isolation/api.ts
//
// წვრილი wrapper login-ისთვის და ავტორიზებული request-ებისთვის
// (supertest-ის თავზე) — რომ ტესტ-ფაილში თავად token/header-ების
// მართვა არ გამეორდეს ყოველ endpoint-ზე.

import request from 'supertest';

export interface LoginResult {
  readonly token: string;
  readonly userId: string;
}

// 🏢 Roadmap "24.08.2026" — STEP 7-lite (company slug login) — POST
// /login ახლა `slug`-საც მოითხოვს (migration 016-ის `users.name`
// per-org uniqueness-ის გამო, org-ის ცალსახად დასადგენად). `slug`
// პარამეტრი `username`-ის წინ დაემატა, რომ call-site-ებზეც იგივე
// თანმიმდევრობა (org → ვინ → რითი) აისახოს, რასაც Login.tsx-ის
// ორსაფეხურიანი UI მიჰყვება.
export async function login(apiBaseUrl: string, slug: string, username: string, password: string): Promise<LoginResult> {
  const response = await request(apiBaseUrl).post('/api/login').send({ slug, username, password });

  if (response.status !== 200) {
    throw new Error(
      `Login ჩავარდა (slug=${slug}, ${username}): HTTP ${response.status} — ${JSON.stringify(response.body)}. ` +
        `დარწმუნდი, რომ backend გაშვებულია TEST_API_URL-ზე (${apiBaseUrl}) და ტესტ-DB seed-ი წარმატებით შესრულდა.`
    );
  }

  return { token: response.body.token as string, userId: response.body.user?.id as string };
}

// 🏢 STEP 2, ტიერი 5 (Roadmap "23.08.2026") — `extraHeaders` არასავალდებულო
// პარამეტრი დაემატა (backward-compatible, ძველი call-ები ხელუხლებელია) —
// sales.ts-ის register-დამოკიდებულ route-ებს (POST /shifts/open, POST
// /payments) X-Register-Id/X-Register-Token headers სჭირდება.
export function authorizedGet(apiBaseUrl: string, path: string, token: string, extraHeaders?: Record<string, string>) {
  let req = request(apiBaseUrl).get(path).set('Authorization', `Bearer ${token}`);
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) req = req.set(key, value);
  }
  return req;
}

// 🏢 STEP 2, ტიერი 2 (Roadmap "23.08.2026") — POST /users/POST /products-ის
// write-blocker fix-ის ტესტებისთვის (organization_id INSERT-ში).
export function authorizedPost(
  apiBaseUrl: string,
  path: string,
  token: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>
) {
  let req = request(apiBaseUrl).post(path).set('Authorization', `Bearer ${token}`);
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) req = req.set(key, value);
  }
  return req.send(body);
}

// 🏢 STEP 2, ტიერი 3 (Roadmap "23.08.2026") — PUT/PATCH/DELETE by-id
// route-ების (IDOR fix) ტესტებისთვის.
export function authorizedPut(apiBaseUrl: string, path: string, token: string, body: Record<string, unknown>) {
  return request(apiBaseUrl).put(path).set('Authorization', `Bearer ${token}`).send(body);
}

export function authorizedPatch(apiBaseUrl: string, path: string, token: string, body: Record<string, unknown>) {
  return request(apiBaseUrl).patch(path).set('Authorization', `Bearer ${token}`).send(body);
}

export function authorizedDelete(apiBaseUrl: string, path: string, token: string) {
  return request(apiBaseUrl).delete(path).set('Authorization', `Bearer ${token}`);
}

// 🏢 STEP 2, ტიერი 4/5-ის შემდეგ, "დისციპლინის დარღვევის გაცნობიერებული
// უარი" პუნქტების fix-ის ტესტებისთვის (Roadmap "23.08.2026") — `GET
// /payments/export/excel`/`/pdf` არ იყენებს `authenticateToken`-ს
// (Authorization header-ის ნაცვლად token-ს `?token=` query param-იდან
// კითხულობს, ბრაუზერში პირდაპირ გახსნადი ბმულებისთვის).
export function tokenQueryGet(apiBaseUrl: string, path: string, token: string) {
  return request(apiBaseUrl).get(path).query({ token });
}

// 🏢 Multi-Tenant SaaS STEP 3 (Roadmap "23.08.2026") — POST
// /organizations/register ავტორიზაციის გარეშეა ხელმისაწვდომი (თავად
// ორგანიზაცია/ადმინი ჯერ არ არსებობს, ვინ დაარეგისტრირებდა ტოკენით) —
// ამიტომ authorizedPost-ისგან განსხვავებით token/header არ სჭირდება.
export function registerOrganization(apiBaseUrl: string, body: Record<string, unknown>) {
  return request(apiBaseUrl).post('/api/organizations/register').send(body);
}

// 🏢 Roadmap "24.08.2026" — STEP 7-lite — ნეგატიური სცენარების
// (არარსებული/გამოტოვებული slug, არასწორი პაროლი) ტესტებისთვის საჭიროა
// raw HTTP პასუხი (სტატუს-კოდი + error-ტექსტი) — login()-ის
// throw-on-non-200 ქცევის გვერდის ავლით.
export function loginAttempt(apiBaseUrl: string, body: Record<string, unknown>) {
  return request(apiBaseUrl).post('/api/login').send(body);
}

// 🔎 GET /organizations/resolve/:slug — საჯარო endpoint (Login.tsx-ის
// 1-ლი საფეხური), ავტორიზაციის გარეშე.
export function resolveOrganization(apiBaseUrl: string, slug: string) {
  return request(apiBaseUrl).get(`/api/organizations/resolve/${encodeURIComponent(slug)}`);
}
