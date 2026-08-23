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

export async function login(apiBaseUrl: string, username: string, password: string): Promise<LoginResult> {
  const response = await request(apiBaseUrl).post('/api/login').send({ username, password });

  if (response.status !== 200) {
    throw new Error(
      `Login ჩავარდა (${username}): HTTP ${response.status} — ${JSON.stringify(response.body)}. ` +
        `დარწმუნდი, რომ backend გაშვებულია TEST_API_URL-ზე (${apiBaseUrl}) და ტესტ-DB seed-ი წარმატებით შესრულდა.`
    );
  }

  return { token: response.body.token as string, userId: response.body.user?.id as string };
}

export function authorizedGet(apiBaseUrl: string, path: string, token: string) {
  return request(apiBaseUrl).get(path).set('Authorization', `Bearer ${token}`);
}

// 🏢 STEP 2, ტიერი 2 (Roadmap "23.08.2026") — POST /users/POST /products-ის
// write-blocker fix-ის ტესტებისთვის (organization_id INSERT-ში).
export function authorizedPost(apiBaseUrl: string, path: string, token: string, body: Record<string, unknown>) {
  return request(apiBaseUrl).post(path).set('Authorization', `Bearer ${token}`).send(body);
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
