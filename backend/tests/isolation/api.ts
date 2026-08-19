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
