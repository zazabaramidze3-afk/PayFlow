// backend/tests/isolation/tenant-isolation.test.ts
//
// STEP 2.3 (Roadmap "Multi-Tenant SaaS") — tenant-იზოლაციის სავალდებულო
// ტესტების ჩონჩხი. Roadmap-ის ("ROADMAP - Multi-Tenant SaaS - 16.08.2026.md",
// ცვლილება #3) მოთხოვნით ეს ტესტები იწერება STEP 1-ის (`organizations`
// ცხრილი) migration-ის დაწერამდე:
//
//   1) ახლა, STEP 1-მდე (ერთი, იმპლიციტური ორგანიზაცია) — ტრივიალურად
//      უნდა გაიაროს ("Trivial smoke checks" ბლოკი ქვემოთ).
//   2) STEP 1-ის migration-ის შემდეგ (ორი ნამდვილი org ბაზაში) — იგივე
//      ფაილი ავტომატურად ჩართავს "Cross-tenant data isolation" ბლოკს,
//      აღარაფრის ხელახლა წერა არ სჭირდება.
//   3) წესი (STEP 2-ის ცვლილება #3): არცერთი route არ ითვლება
//      "დასრულებულად", სანამ ეს ტესტები მწვანე არ არის იმ endpoint-ზე.
//
// გაშვება:
//   TEST_DATABASE_URL=postgres://...  TEST_API_URL=http://localhost:5000  npm test
//
// წინაპირობა: backend გაშვებული უნდა იყოს TEST_API_URL-ზე, იმავე
// TEST_DATABASE_URL-ის წინააღმდეგ (`npm run dev`, .env.test-ით ან
// ცალკე env ცვლადებით). production DATABASE_URL-ზე გაშვება
// კატეგორიულად აკრძალულია — იხ. env.ts.
//
// ⚠️ schema-ის დეტექცია (async, DB query) ხდება `beforeAll`-ში, ტესტების
// კოლექციის დროს კი პირობა ჯერ არ არის ცნობილი — ამიტომ `it.skipIf(...)`-ის
// ნაცვლად თითოეული multi-org ტესტი დაწყებისთანავე თავად ამოწმებს
// `schema.multiTenantReady`-ს და საჭიროებისამებრ `ctx.skip()`-ს იძახებს
// (dynamic skip, ცნობილი შედეგით ცალკე რეპორტდება "passed"-ისგან).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { loadIsolationTestConfig } from './env';
import { detectSchemaCapabilities, columnExists, type SchemaCapabilities } from './schema';
import {
  cleanupIsolationTestData,
  seedAuditLogEntry,
  seedOrgProduct,
  seedOrgWithAdmin,
  seedTestUser,
  type SeededOrg,
} from './seed';
import { authorizedGet, login } from './api';

const config = loadIsolationTestConfig();
const pool = new Pool({ connectionString: config.databaseUrl, max: 5 });

let schema: SchemaCapabilities;
let productsOrgColumnExists = false;

beforeAll(async () => {
  // იდემპოტენტურობა: წინა გაუთავებელი გაშვების ნარჩენი ტესტ-მონაცემები
  // (თუ იყო) ჯერ იშლება, რომ ON CONFLICT-ებზე დაყრდნობილი seed-ი
  // სუფთა მდგომარეობიდან დაიწყოს.
  await cleanupIsolationTestData(pool);
  schema = await detectSchemaCapabilities(pool);
  productsOrgColumnExists = schema.multiTenantReady ? await columnExists(pool, 'products', 'organization_id') : false;
});

afterAll(async () => {
  await cleanupIsolationTestData(pool);
  await pool.end();
});

describe('Trivial smoke checks (ყოველთვის მწვანე უნდა იყოს — STEP 1-მდეც)', () => {
  it('GET /api/health პასუხობს authentication-ის გარეშეც', async () => {
    const response = await authorizedGet(config.apiBaseUrl, '/api/health', '');
    expect(response.status).toBe(200);
  });

  it('ჩვეულებრივი login + GET /api/products მუშაობს ტოკენით', async () => {
    const user = await seedTestUser(pool, { usernameSuffix: 'smoke_admin', role: 'admin' });
    const { token } = await login(config.apiBaseUrl, user.username, user.password);

    const response = await authorizedGet(config.apiBaseUrl, '/api/products', token);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('ტოკენის გარეშე დაცული endpoint 401-ს აბრუნებს', async () => {
    const response = await authorizedGet(config.apiBaseUrl, '/api/products', '');
    expect(response.status).toBe(401);
  });
});

describe('Cross-tenant data isolation (გაშვება მხოლოდ STEP 1 migration-ის შემდეგ)', () => {
  let orgA: SeededOrg;
  let orgB: SeededOrg;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    if (!schema.multiTenantReady) return;

    orgA = await seedOrgWithAdmin(pool, { orgSuffix: 'orgA' });
    orgB = await seedOrgWithAdmin(pool, { orgSuffix: 'orgB' });

    tokenA = (await login(config.apiBaseUrl, orgA.admin.username, orgA.admin.password)).token;
    tokenB = (await login(config.apiBaseUrl, orgB.admin.username, orgB.admin.password)).token;

    if (productsOrgColumnExists) {
      await seedOrgProduct(pool, { organizationId: orgA.id, nameSuffix: 'orgA' });
      await seedOrgProduct(pool, { organizationId: orgB.id, nameSuffix: 'orgB' });
    }
  });

  it('GET /api/users — Org A-ს ტოკენი Org B-ს admin-ს ვერ ხედავს', async (ctx) => {
    if (!schema.multiTenantReady) return ctx.skip();

    const response = await authorizedGet(config.apiBaseUrl, '/api/users', tokenA);
    expect(response.status).toBe(200);

    const usernames = (response.body as Array<{ username: string }>).map((u) => u.username);
    expect(usernames).toContain(orgA.admin.username);
    expect(usernames).not.toContain(orgB.admin.username);
  });

  it('GET /api/users — მიმართულება საწინააღმდეგო მხარესაც მუშაობს', async (ctx) => {
    if (!schema.multiTenantReady) return ctx.skip();

    const response = await authorizedGet(config.apiBaseUrl, '/api/users', tokenB);
    expect(response.status).toBe(200);

    const usernames = (response.body as Array<{ username: string }>).map((u) => u.username);
    expect(usernames).toContain(orgB.admin.username);
    expect(usernames).not.toContain(orgA.admin.username);
  });

  it('GET /api/products — Org A ვერ ხედავს Org B-ს პროდუქტს', async (ctx) => {
    if (!schema.multiTenantReady || !productsOrgColumnExists) return ctx.skip();

    const response = await authorizedGet(config.apiBaseUrl, '/api/products', tokenA);
    expect(response.status).toBe(200);

    const names = (response.body as Array<{ name: string }>).map((p) => p.name);
    expect(names.some((n) => n.includes('orgA'))).toBe(true);
    expect(names.some((n) => n.includes('orgB'))).toBe(false);
  });

  // 🏢 STEP 2 route-review (Roadmap "23.08.2026") — auth.ts GET /audit-logs
  // ახლა org-scoped-ია. ორივე org-ს თავისი ჩანაწერი სჭირდება ცალკე
  // beforeAll-ში (audit_logs.organization_id NOT NULL-ია STEP 1-ის შემდეგ,
  // seedOrgWithAdmin თავად audit ჩანაწერს არ ქმნის).
  describe('GET /api/audit-logs — org-scoping (STEP 2, dependent on audit_logs.organization_id)', () => {
    let auditColumnExists = false;

    beforeAll(async () => {
      if (!schema.multiTenantReady) return;
      auditColumnExists = await columnExists(pool, 'audit_logs', 'organization_id');
      if (!auditColumnExists) return;

      await seedAuditLogEntry(pool, {
        organizationId: orgA.id,
        actorId: orgA.admin.id,
        targetId: orgA.admin.id,
        action: 'history-access',
      });
      await seedAuditLogEntry(pool, {
        organizationId: orgB.id,
        actorId: orgB.admin.id,
        targetId: orgB.admin.id,
        action: 'history-access',
      });
    });

    it('Org A ვერ ხედავს Org B-ს audit ჩანაწერს', async (ctx) => {
      if (!schema.multiTenantReady || !auditColumnExists) return ctx.skip();

      const response = await authorizedGet(config.apiBaseUrl, '/api/audit-logs', tokenA);
      expect(response.status).toBe(200);

      const actorIds = (response.body as Array<{ actor_id: string }>).map((log) => log.actor_id);
      expect(actorIds).toContain(orgA.admin.id);
      expect(actorIds).not.toContain(orgB.admin.id);
    });

    it('მიმართულება საწინააღმდეგო მხარესაც მუშაობს', async (ctx) => {
      if (!schema.multiTenantReady || !auditColumnExists) return ctx.skip();

      const response = await authorizedGet(config.apiBaseUrl, '/api/audit-logs', tokenB);
      expect(response.status).toBe(200);

      const actorIds = (response.body as Array<{ actor_id: string }>).map((log) => log.actor_id);
      expect(actorIds).toContain(orgB.admin.id);
      expect(actorIds).not.toContain(orgA.admin.id);
    });
  });

  // ==========================================
  // 🚧 TODO — დარჩენილი endpoint-ები (Roadmap "16.08.2026" ცვლილება #4-ის
  // რისკის-ზრდადობის თანმიმდევრობით). თითოეული აქტიური გახდება, როცა
  // STEP 2-ის route-review ამ კონკრეტულ endpoint-ს მიაღწევს — მანამდე
  // `it.todo`-დ დარჩება (vitest-ი ამას "pending"-ად აჩვენებს, ტესტს არ
  // ჩავარდნის ჩათვლის, უბრალოდ არ დავიწყებია).
  //
  // 🏢 STEP 2 (23.08.2026 სესია) — dashboard.ts route თავად უკვე org-scoped-ია
  // (ყველა query-ს `WHERE organization_id = $1` აქვს), მაგრამ ეს კონკრეტული
  // ტესტი განზრახ კვლავ it.todo-დ რჩება: სრულფასოვანი შემოწმება
  // (Org A-ს დღევანდელი revenue-ში Org B-ს გაყიდვა არ ერევა) registers/
  // shifts/payments-ის მთელი FK ჯაჭვის seed-ს საჭიროებს, რომელიც STEP 2-ის
  // write-heavy (sales.ts) ეტაპზეა აშენებული — მანამდე ცალკე დუბლირება
  // არ ღირს.
  // ==========================================

  // read-only, დაბალი რისკი
  it.todo('GET /api/dashboard/stats — Org A-ს რიცხვებში Org B-ს გაყიდვები არ ერევა');
  it.todo('GET /api/notifications/stock-deficits — Org A ვერ ხედავს Org B-ს ნოტიფიკაციას');
  it.todo('GET /api/registers — Org A ვერ ხედავს Org B-ს სალაროებს');

  // write-heavy, ფინანსური — ბოლოს (ცვლილება #4-ის თანახმად)
  it.todo('GET /api/shifts/history — Org A ვერ ხედავს Org B-ს ცვლას');
  it.todo('GET /api/payments — Org A ვერ ხედავს Org B-ს ჩეკს');
  it.todo('POST /api/payments — Org A-ს ტოკენით Org B-ს register_id/product_id მიუღებელია (400/403)');
  it.todo('PUT /api/payments/:id/void — Org A ვერ აუქმებს Org B-ს ჩეკს (403/404, არა 200)');
});
