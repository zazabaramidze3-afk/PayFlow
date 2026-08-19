// backend/tests/isolation/env.ts
//
// STEP 2.3 (Roadmap "Multi-Tenant SaaS") — tenant-იზოლაციის ტესტების
// გარემოს კონფიგურაცია. ეს ფაილი პასუხისმგებელია ორ რამეზე:
//   1) რომელ backend-ს/DB-ს ეხება ტესტები (env ცვლადებით, არა hardcoded).
//   2) უსაფრთხოების "ბადე" — ეს ტესტები INSERT/DELETE-ს აკეთებენ ტესტ-
//      მონაცემებზე, ამიტომ production DATABASE_URL-ზე შემთხვევითი გაშვება
//      კატეგორიულად აკრძალულია.

export interface IsolationTestConfig {
  readonly apiBaseUrl: string;
  readonly databaseUrl: string;
}

/**
 * production-ის მსგავს host-ებზე ტესტის შემთხვევით გაშვების თავიდან
 * ასაცილებლად — Neon-ის ჰოსტინგის დომენს ვამოწმებთ. ეს არ არის
 * ამომწურავი სია, მხოლოდ evident შემთხვევის დაჭერა (defense-in-depth,
 * არა ერთადერთი დაცვის ფენა — ამიტომაც სავალდებულოა TEST_DATABASE_URL).
 */
function assertNotObviouslyProduction(databaseUrl: string): void {
  const lower = databaseUrl.toLowerCase();
  const looksLikeNeon = lower.includes('.neon.tech');
  const explicitlyAllowed = process.env.ALLOW_ISOLATION_TESTS_ON_NEON === 'true';

  if (looksLikeNeon && !explicitlyAllowed) {
    throw new Error(
      '🛑 TEST_DATABASE_URL Neon-ის host-ს ჰგავს. ეს ტესტები INSERT/DELETE-ს აკეთებენ ტესტ-org-ებზე — ' +
        'production ბაზაზე გაშვება აკრძალულია. თუ ეს ნამდვილად Neon *branch* -ია (არა production), ' +
        'დაადასტურე ცალსახად: ALLOW_ISOLATION_TESTS_ON_NEON=true (Roadmap ცვლილება #2 — "Neon branch STEP 1-ის წინ").'
    );
  }
}

export function loadIsolationTestConfig(): IsolationTestConfig {
  const apiBaseUrl = process.env.TEST_API_URL || 'http://localhost:5000';

  // ⚠️ განზრახ *არ* ვეცემით უკან DATABASE_URL-ზე (production .env-ის იგივე
  // ცვლადი) — ტესტ-DB ცალსახად, ცალკე ცვლადით უნდა იყოს მითითებული, რომ
  // არასდროს მოხდეს "დამთხვევით" production-ზე მუშაობა.
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      '🛑 TEST_DATABASE_URL არ არის მითითებული. დააყენე ის backend-ის test/dev/Neon-branch ბაზაზე ' +
        '(არასდროს production DATABASE_URL-ზე) — მაგ: TEST_DATABASE_URL=postgres://... npm test'
    );
  }

  assertNotObviouslyProduction(databaseUrl);

  return { apiBaseUrl, databaseUrl };
}
