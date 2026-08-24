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
  ISOLATION_TEST_PREFIX,
  seedAuditLogEntry,
  seedOrgProduct,
  seedOrgRegister,
  seedOrgUser,
  seedOrgWithAdmin,
  seedStockDeficitNotification,
  seedTestUser,
  type SeededOrg,
  type SeededProduct,
  type SeededRegister,
  type SeededUser,
} from './seed';
import {
  authorizedDelete,
  authorizedGet,
  authorizedPatch,
  authorizedPost,
  authorizedPut,
  login,
  loginAttempt,
  registerOrganization,
  resolveOrganization,
  tokenQueryGet,
} from './api';
// 🔒 დისციპლინის დარღვევის გაცნობიერებული უარის fix-ის ტესტებისთვის
// (Roadmap "23.08.2026") — POST /payments/sync-offline-ის cashier-
// impersonation რეგრესიის ტესტს სჭირდება ცალსახად ვალიდური v4 UUID
// (UUID_V4_REGEX, routes/sales.ts), ისევე, როგორც frontend-ის
// crypto.randomUUID()-ი (Roadmap STEP 4.1) რეალურ ჩეკებს გენერირებს.
import { randomUUID } from 'crypto';
// 🏢 STEP 2, ტიერი 5 (Roadmap "23.08.2026") — register-authenticated
// route-ების (POST /shifts/open, POST /payments) ტესტებისთვის, seedOrgRegister-ით
// შექმნილი register-ისთვის ვალიდური X-Register-Token-ის ხელმოწერა
// Pairing UI-ს/POST /registers/pair-ის გვერდის ავლით (tier 3-ში ეს ნაკადი
// უკვე ცალკე დაფარულია).
import { signRegisterToken } from '../../src/middleware/registerAuth';
import type { OfflineSyncReceiptPayload, OfflineSyncResult } from '../../src/types';

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
    const { token } = await login(config.apiBaseUrl, user.orgSlug, user.username, user.password);

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
  let productA: SeededProduct | undefined;
  let productB: SeededProduct | undefined;

  beforeAll(async () => {
    if (!schema.multiTenantReady) return;

    orgA = await seedOrgWithAdmin(pool, { orgSuffix: 'orgA' });
    orgB = await seedOrgWithAdmin(pool, { orgSuffix: 'orgB' });

    tokenA = (await login(config.apiBaseUrl, orgA.slug, orgA.admin.username, orgA.admin.password)).token;
    tokenB = (await login(config.apiBaseUrl, orgB.slug, orgB.admin.username, orgB.admin.password)).token;

    if (productsOrgColumnExists) {
      productA = await seedOrgProduct(pool, { organizationId: orgA.id, nameSuffix: 'orgA' });
      productB = await seedOrgProduct(pool, { organizationId: orgB.id, nameSuffix: 'orgB' });
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

  // 🏢 STEP 2, ტიერი 2 (Roadmap "23.08.2026", write-blocker fix) — POST
  // /products/POST /users ახლა organization_id-ს თავად ინიშნავენ (creator-ის
  // საკუთარი org), migration 013-ის NOT NULL constraint-ის garda ისინი
  // 500-ით ჩაივარდებოდნენ. ეს ტესტები ადასტურებს ორივეს: (ა) INSERT
  // წარმატებულია, (ბ) ახალი row სწორ org-ში ჯდება (isolation, არა მხოლოდ
  // "არ ჩავარდა").
  it('POST /api/products — ახალი პროდუქტი Org A-ს ტოკენით Org A-ს org-ში იქმნება', async (ctx) => {
    if (!schema.multiTenantReady || !productsOrgColumnExists) return ctx.skip();

    const createResponse = await authorizedPost(config.apiBaseUrl, '/api/products', tokenA, {
      name: `${ISOLATION_TEST_PREFIX}post_product_orgA`,
      price: 9.99,
      stock: 3,
      barcode: `${ISOLATION_TEST_PREFIX}post_barcode_orgA`,
    });
    expect(createResponse.status).toBe(201);

    const [productsAsA, productsAsB] = await Promise.all([
      authorizedGet(config.apiBaseUrl, '/api/products', tokenA),
      authorizedGet(config.apiBaseUrl, '/api/products', tokenB),
    ]);

    const namesA = (productsAsA.body as Array<{ name: string }>).map((p) => p.name);
    const namesB = (productsAsB.body as Array<{ name: string }>).map((p) => p.name);
    expect(namesA).toContain(`${ISOLATION_TEST_PREFIX}post_product_orgA`);
    expect(namesB).not.toContain(`${ISOLATION_TEST_PREFIX}post_product_orgA`);
  });

  it('POST /api/products — Org B-ს იგივე სახელით პროდუქტის შექმნა არ ბლოკავს dupCheck-ს (per-org uniqueness)', async (ctx) => {
    if (!schema.multiTenantReady || !productsOrgColumnExists) return ctx.skip();

    // ორივე org-ს ერთი და იგივე სახელით პროდუქტი — თუ dupCheck org-ს არ
    // ითვალისწინებდა, Org B-ს მოთხოვნა 409-ს დააბრუნებდა, თუმცა
    // migration 013-ის შემდეგ products.name მხოლოდ per-org უნიკალურია.
    const sharedName = `${ISOLATION_TEST_PREFIX}post_product_shared_name`;

    const createA = await authorizedPost(config.apiBaseUrl, '/api/products', tokenA, {
      name: sharedName,
      price: 5,
      stock: 1,
      barcode: `${ISOLATION_TEST_PREFIX}post_barcode_shared_a`,
    });
    const createB = await authorizedPost(config.apiBaseUrl, '/api/products', tokenB, {
      name: sharedName,
      price: 5,
      stock: 1,
      barcode: `${ISOLATION_TEST_PREFIX}post_barcode_shared_b`,
    });

    expect(createA.status).toBe(201);
    expect(createB.status).toBe(201);
  });

  it('POST /api/users — ახალი user Org A-ს ადმინის ტოკენით Org A-ს org-ში იქმნება', async (ctx) => {
    if (!schema.multiTenantReady) return ctx.skip();

    const createResponse = await authorizedPost(config.apiBaseUrl, '/api/users', tokenA, {
      username: `${ISOLATION_TEST_PREFIX}post_user_orgA`,
      password: 'IsolationTest123!',
      role: 'cashier',
    });
    expect(createResponse.status).toBe(201);

    const [usersAsA, usersAsB] = await Promise.all([
      authorizedGet(config.apiBaseUrl, '/api/users', tokenA),
      authorizedGet(config.apiBaseUrl, '/api/users', tokenB),
    ]);

    const usernamesA = (usersAsA.body as Array<{ username: string }>).map((u) => u.username);
    const usernamesB = (usersAsB.body as Array<{ username: string }>).map((u) => u.username);
    expect(usernamesA).toContain(`${ISOLATION_TEST_PREFIX}post_user_orgA`);
    expect(usernamesB).not.toContain(`${ISOLATION_TEST_PREFIX}post_user_orgA`);
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

  // 🏢 STEP 2, ტიერი 3 (Roadmap "23.08.2026", IDOR fix) — PUT/PATCH/DELETE
  // /products/:id ახლა `AND organization_id = $N`-ს ამოწმებს. თითოეული
  // ტესტი Org A-ს ტოკენით Org B-ს პროდუქტს (productB) მიმართავს — id-ის
  // ცოდნა/გამოცნობა საკმარისი აღარაა, 404 უნდა დაბრუნდეს (არა 200/403).
  describe('PUT/PATCH/DELETE /api/products/:id — org-scoped IDOR fix (ტიერი 3)', () => {
    it('PUT — Org A ვერ არედაქტირებს Org B-ს პროდუქტს', async (ctx) => {
      if (!schema.multiTenantReady || !productsOrgColumnExists || !productB) return ctx.skip();

      const response = await authorizedPut(config.apiBaseUrl, `/api/products/${productB.id}`, tokenA, {
        name: `${ISOLATION_TEST_PREFIX}should_not_apply`,
      });
      expect(response.status).toBe(404);
    });

    it('PATCH /restock — Org A ვერ ამატებს მარაგს Org B-ს პროდუქტს', async (ctx) => {
      if (!schema.multiTenantReady || !productsOrgColumnExists || !productB) return ctx.skip();

      const response = await authorizedPatch(config.apiBaseUrl, `/api/products/${productB.id}/restock`, tokenA, {
        quantityToAdd: 5,
      });
      expect(response.status).toBe(404);
    });

    it('DELETE — Org A ვერ შლის Org B-ს პროდუქტს', async (ctx) => {
      if (!schema.multiTenantReady || !productsOrgColumnExists || !productB) return ctx.skip();

      const response = await authorizedDelete(config.apiBaseUrl, `/api/products/${productB.id}`, tokenA);
      expect(response.status).toBe(404);

      // ✅ დაზუსტება, რომ ნამდვილად არაფერი წაშლილა — Org B-ს კვლავ სჭირდება
      // საკუთარი productB, სხვა ტესტებში რომ არ "გაქრეს" 404-ის მიღმა.
      const stillThereForB = await authorizedGet(config.apiBaseUrl, '/api/products', tokenB);
      const namesB = (stillThereForB.body as Array<{ name: string }>).map((p) => p.name);
      expect(namesB).toContain(productB.name);
    });

    // ✅ "Happy path" რეგრესია — organization_id-ის დამატებამ საკუთარი
    // org-ის ჩვეულებრივი წაკითხვა/რედაქტირება/წაშლა არ უნდა გაუფუჭოს.
    // productA აქამდე არცერთ ტესტში არ გამოყენებულა — უსაფრთხოდ შეიძლება
    // ორივე (PUT მერე DELETE) ამ თანმიმდევრობით.
    it('PUT — Org A კვლავ არედაქტირებს საკუთარ productA-ს (happy path)', async (ctx) => {
      if (!schema.multiTenantReady || !productsOrgColumnExists || !productA) return ctx.skip();

      const response = await authorizedPut(config.apiBaseUrl, `/api/products/${productA.id}`, tokenA, {
        price: 12.5,
      });
      expect(response.status).toBe(200);
      expect(Number(response.body.price)).toBe(12.5);
    });

    it('DELETE — Org A კვლავ შლის საკუთარ productA-ს (happy path)', async (ctx) => {
      if (!schema.multiTenantReady || !productsOrgColumnExists || !productA) return ctx.skip();

      const response = await authorizedDelete(config.apiBaseUrl, `/api/products/${productA.id}`, tokenA);
      expect(response.status).toBe(200);
    });
  });

  // 🏢 STEP 2, ტიერი 3 (Roadmap "23.08.2026", IDOR fix) — PUT/DELETE
  // /users/:id (და შესაბამისი toggle/password/pin endpoint-ები, იმავე
  // პატერნით) ახლა `AND organization_id = $N`-ს ამოწმებს.
  describe('PUT/DELETE /api/users/:id — org-scoped IDOR fix (ტიერი 3)', () => {
    it('PUT — Org A-ს ადმინი ვერ ცვლის Org B-ს ადმინის როლს/სტატუსს', async (ctx) => {
      if (!schema.multiTenantReady) return ctx.skip();

      const response = await authorizedPut(config.apiBaseUrl, `/api/users/${orgB.admin.id}`, tokenA, {
        role: 'cashier',
        status: 'active',
      });
      expect(response.status).toBe(404);

      // ✅ Org B-ს admin-ი კვლავ admin-ია — role ნამდვილად არ შეცვლილა.
      const usersAsB = await authorizedGet(config.apiBaseUrl, '/api/users', tokenB);
      const orgBAdmin = (usersAsB.body as Array<{ username: string; role: string }>).find(
        (u) => u.username === orgB.admin.username
      );
      expect(orgBAdmin?.role).toBe('admin');
    });

    it('DELETE — Org A-ს ადმინი ვერ აპასიურებს Org B-ს ადმინს', async (ctx) => {
      if (!schema.multiTenantReady) return ctx.skip();

      const response = await authorizedDelete(config.apiBaseUrl, `/api/users/${orgB.admin.id}`, tokenA);
      expect(response.status).toBe(404);

      // ✅ Org B-ს admin-ი კვლავ აქტიურია.
      const usersAsB = await authorizedGet(config.apiBaseUrl, '/api/users', tokenB);
      const orgBAdmin = (usersAsB.body as Array<{ username: string; status: string }>).find(
        (u) => u.username === orgB.admin.username
      );
      expect(orgBAdmin?.status).toBe('active');
    });

    // ✅ "Happy path" რეგრესია — საკუთარ org-ში PUT/DELETE (role-ცვლილება,
    // soft-delete) კვლავ უნდა მუშაობდეს. ერთჯერადი, საკუთარი (throwaway)
    // cashier-ით, რომ orgA.admin-ს (სხვა ტესტებში საჭირო) არაფერი დაემართოს.
    it('PUT/DELETE — Org A-ს ადმინი კვლავ მართავს საკუთარი org-ის user-ს (happy path)', async (ctx) => {
      if (!schema.multiTenantReady) return ctx.skip();

      const createResponse = await authorizedPost(config.apiBaseUrl, '/api/users', tokenA, {
        username: `${ISOLATION_TEST_PREFIX}happy_path_cashier`,
        password: 'IsolationTest123!',
        role: 'cashier',
      });
      expect(createResponse.status).toBe(201);
      const targetId = createResponse.body.user.id as string;

      const putResponse = await authorizedPut(config.apiBaseUrl, `/api/users/${targetId}`, tokenA, {
        role: 'cashier',
        status: 'inactive',
      });
      expect(putResponse.status).toBe(200);
      expect(putResponse.body.user.status).toBe('inactive');

      const deleteResponse = await authorizedDelete(config.apiBaseUrl, `/api/users/${targetId}`, tokenA);
      expect(deleteResponse.status).toBe(200);
    });
  });

  // 🏢 STEP 2, ტიერი 3 (Roadmap "23.08.2026") — registers.ts-ს საერთოდ არ
  // ჰქონდა org-ცნობიერება: POST /registers/pair-ის IDOR fix (არსებული
  // register-ის id-ით დაწყვილება) + write-blocker fix (ახალი register-ის
  // INSERT-ს organization_id სჭირდება) + GET /registers-ის org-scoping
  // (ტექნიკურად tier 4-ის item იყო, მაგრამ იმავე ფაილშია და პირდაპირ
  // უკავშირდება pair-ის IDOR ფიქსს — იხ. registers.ts-ის კომენტარი).
  describe('POST /api/registers/pair & GET /api/registers — org-scoped (ტიერი 3)', () => {
    let registerIdA: string | undefined;
    let registerIdB: string | undefined;

    beforeAll(async () => {
      if (!schema.multiTenantReady) return;

      // Pairing ნაკადი თავად ვამოწმებთ — თითო org-ისთვის ცალკე
      // pairing-კოდი ვაგენერირებთ (ავტორიზაციის გარეშე, `generate-code`
      // ისედაც ასეთია) და შესაბამისი org-ის admin-ის ტოკენით ვადასტურებთ
      // ახალი register-ის შექმნით (`newRegisterName`).
      const codeA = (await authorizedPost(config.apiBaseUrl, '/api/registers/generate-code', '', {})).body.code;
      const pairA = await authorizedPost(config.apiBaseUrl, '/api/registers/pair', tokenA, {
        code: codeA,
        newRegisterName: `${ISOLATION_TEST_PREFIX}register_orgA`,
      });
      registerIdA = pairA.body.registerId;

      const codeB = (await authorizedPost(config.apiBaseUrl, '/api/registers/generate-code', '', {})).body.code;
      const pairB = await authorizedPost(config.apiBaseUrl, '/api/registers/pair', tokenB, {
        code: codeB,
        newRegisterName: `${ISOLATION_TEST_PREFIX}register_orgB`,
      });
      registerIdB = pairB.body.registerId;
    });

    it('POST /registers/pair — ახალი register write-blocker-ის გარეშე იქმნება Org-ის ტოკენის org-ში', async (ctx) => {
      if (!schema.multiTenantReady) return ctx.skip();
      // beforeAll-ში registerIdA/B-ის განსაზღვრა თავად ადასტურებს, რომ
      // POST-მა 201-ისმაგვარი წარმატებული პასუხი დააბრუნა (registerId
      // მოვიდა) — migration 013-ის NOT NULL constraint-ის მიუხედავად.
      expect(typeof registerIdA).toBe('string');
      expect(typeof registerIdB).toBe('string');
    });

    it('GET /api/registers — Org A ვერ ხედავს Org B-ს სალაროებს', async (ctx) => {
      if (!schema.multiTenantReady || !registerIdA) return ctx.skip();

      const response = await authorizedGet(config.apiBaseUrl, '/api/registers', tokenA);
      expect(response.status).toBe(200);

      const names = (response.body as Array<{ name: string }>).map((r) => r.name);
      expect(names).toContain(`${ISOLATION_TEST_PREFIX}register_orgA`);
      expect(names).not.toContain(`${ISOLATION_TEST_PREFIX}register_orgB`);
    });

    it('POST /registers/pair — Org A ვერ დაწყვილდება Org B-ს არსებულ register-თან (IDOR fix)', async (ctx) => {
      if (!schema.multiTenantReady || !registerIdB) return ctx.skip();

      const code = (await authorizedPost(config.apiBaseUrl, '/api/registers/generate-code', '', {})).body.code;
      const response = await authorizedPost(config.apiBaseUrl, '/api/registers/pair', tokenA, {
        code,
        registerId: registerIdB,
      });
      expect(response.status).toBe(404);
    });
  });

  // 🏢 STEP 2, ტიერი 4/5 (Roadmap "23.08.2026") — register-authenticated
  // (X-Register-Id/X-Register-Token) და write-heavy ფინანსური route-ები:
  // POST /shifts/open, POST /payments, POST /payments/:id/void, GET
  // /shifts/history, GET /payments, GET /notifications/stock-deficits.
  // ყველა state (cashier/register/shift/payment) beforeAll-ში შენდება
  // (POST /registers/pair-ის describe-ის იგივე პატერნი) — ქვემოთა it()-ები
  // მხოლოდ ადასტურებენ. seedOrgRegister + signRegisterToken (Pairing UI-ის
  // გვერდის ავლით) ვალიდურ register-headers-ს გვაძლევს ორივე org-ისთვის.
  describe('POST /shifts/open, POST /payments, void, history — register-auth + write-blocker/IDOR fix (ტიერი 4/5)', () => {
    let cashierA: SeededUser;
    let cashierB: SeededUser;
    let tokenCashierA: string;
    let tokenCashierB: string;
    let registerA: SeededRegister | undefined;
    let registerB: SeededRegister | undefined;
    let registerTokenA: string | undefined;
    let registerTokenB: string | undefined;
    let cartProductA: SeededProduct | undefined;
    let cartProductB: SeededProduct | undefined;
    let crossOrgOpenStatus: number | undefined;
    let shiftIdA: string | undefined;
    let shiftIdB: string | undefined;
    let paymentIdA: string | undefined;
    let paymentIdB: string | undefined;
    let deficitNotifOrgAExists = false;

    beforeAll(async () => {
      if (!schema.multiTenantReady) return;

      cashierA = await seedOrgUser(pool, { organizationId: orgA.id, orgSlug: orgA.slug, usernameSuffix: 'tier5_cashierA', role: 'cashier' });
      cashierB = await seedOrgUser(pool, { organizationId: orgB.id, orgSlug: orgB.slug, usernameSuffix: 'tier5_cashierB', role: 'cashier' });
      tokenCashierA = (await login(config.apiBaseUrl, cashierA.orgSlug, cashierA.username, cashierA.password)).token;
      tokenCashierB = (await login(config.apiBaseUrl, cashierB.orgSlug, cashierB.username, cashierB.password)).token;

      registerA = await seedOrgRegister(pool, { organizationId: orgA.id, nameSuffix: 'tier5_regA' });
      registerB = await seedOrgRegister(pool, { organizationId: orgB.id, nameSuffix: 'tier5_regB' });
      registerTokenA = signRegisterToken(registerA.id);
      registerTokenB = signRegisterToken(registerB.id);

      // 🔓 cross-org register-hijack ცდა — რეგისტრირებული ჯერ, სანამ
      // cashierA-ს რომელიმე register-ზე ცვლა გახსნილი აქვს, რომ
      // requireRegister-ის org-mismatch გუარდი (403) ცალსახად "ცვლის
      // უკვე ღიაობის" ლოგიკამდე დაფიქსირდეს ტესტში.
      const hijackAttempt = await authorizedPost(
        config.apiBaseUrl,
        '/api/shifts/open',
        tokenCashierA,
        { start_amount: 0 },
        { 'X-Register-Id': registerB.id, 'X-Register-Token': registerTokenB }
      );
      crossOrgOpenStatus = hijackAttempt.status;

      const openA = await authorizedPost(
        config.apiBaseUrl,
        '/api/shifts/open',
        tokenCashierA,
        { start_amount: 100 },
        { 'X-Register-Id': registerA.id, 'X-Register-Token': registerTokenA }
      );
      shiftIdA = openA.body.shiftId;

      const openB = await authorizedPost(
        config.apiBaseUrl,
        '/api/shifts/open',
        tokenCashierB,
        { start_amount: 50 },
        { 'X-Register-Id': registerB.id, 'X-Register-Token': registerTokenB }
      );
      shiftIdB = openB.body.shiftId;

      if (productsOrgColumnExists) {
        cartProductA = await seedOrgProduct(pool, { organizationId: orgA.id, nameSuffix: 'tier5_cartA' });
        cartProductB = await seedOrgProduct(pool, { organizationId: orgB.id, nameSuffix: 'tier5_cartB' });

        const paymentA = await authorizedPost(
          config.apiBaseUrl,
          '/api/payments',
          tokenCashierA,
          { items: [{ productId: cartProductA.id, quantity: 1, price: 9.99 }], paymentMethod: 'cash' },
          { 'X-Register-Id': registerA.id, 'X-Register-Token': registerTokenA }
        );
        paymentIdA = paymentA.body.paymentId;

        const paymentB = await authorizedPost(
          config.apiBaseUrl,
          '/api/payments',
          tokenCashierB,
          { items: [{ productId: cartProductB.id, quantity: 1, price: 9.99 }], paymentMethod: 'cash' },
          { 'X-Register-Id': registerB.id, 'X-Register-Token': registerTokenB }
        );
        paymentIdB = paymentB.body.paymentId;

        if (paymentIdA) {
          await seedStockDeficitNotification(pool, {
            organizationId: orgA.id,
            paymentId: paymentIdA,
            productNameSuffix: 'orgA',
          });
          deficitNotifOrgAExists = true;
        }
        if (paymentIdB) {
          await seedStockDeficitNotification(pool, {
            organizationId: orgB.id,
            paymentId: paymentIdB,
            productNameSuffix: 'orgB',
          });
        }
      }

      // 🕵️ ამავე დროს ეს არის writeAuditLog-ის silent-write-blocker-ის
      // რეგრესიის რეალური exercise (იხ. ქვემოთა ბოლო it()) — cashierA-ს
      // ეძლევა can_void_receipt, Manager PIN Override-ის საჭიროების გარეშე.
      await authorizedPut(config.apiBaseUrl, `/api/users/${cashierA.id}/void-access`, tokenA, {
        can_void_receipt: true,
      });
    });

    it('POST /shifts/open — cross-org register hijack რეჯექტდება (403, registerAuth.ts-ის org-check)', (ctx) => {
      if (!schema.multiTenantReady) return ctx.skip();
      expect(crossOrgOpenStatus).toBe(403);
    });

    it('POST /shifts/open — write-blocker fix-ის გარეშე Org A-ს/Org B-ს cashier-ს ცვლა ეხსნება', (ctx) => {
      if (!schema.multiTenantReady) return ctx.skip();
      expect(typeof shiftIdA).toBe('string');
      expect(typeof shiftIdB).toBe('string');
    });

    it('GET /api/shifts/history — Org A ვერ ხედავს Org B-ს ცვლას', async (ctx) => {
      if (!schema.multiTenantReady || !shiftIdA || !shiftIdB) return ctx.skip();

      const asA = await authorizedGet(config.apiBaseUrl, '/api/shifts/history', tokenA);
      expect(asA.status).toBe(200);
      const idsA = (asA.body as Array<{ id: string }>).map((s) => s.id);
      expect(idsA).toContain(shiftIdA);
      expect(idsA).not.toContain(shiftIdB);

      const asB = await authorizedGet(config.apiBaseUrl, '/api/shifts/history', tokenB);
      const idsB = (asB.body as Array<{ id: string }>).map((s) => s.id);
      expect(idsB).toContain(shiftIdB);
      expect(idsB).not.toContain(shiftIdA);
    });

    it('POST /api/payments — write-blocker fix-ის გარეშე ორივე org-ისთვის ჩეკი იქმნება', (ctx) => {
      if (!schema.multiTenantReady || !productsOrgColumnExists) return ctx.skip();
      expect(typeof paymentIdA).toBe('string');
      expect(typeof paymentIdB).toBe('string');
    });

    it('GET /api/payments — Org A ვერ ხედავს Org B-ს ჩეკს', async (ctx) => {
      if (!schema.multiTenantReady || !paymentIdA || !paymentIdB) return ctx.skip();

      const asA = await authorizedGet(config.apiBaseUrl, '/api/payments', tokenA);
      expect(asA.status).toBe(200);
      const idsA = (asA.body as Array<{ id: string }>).map((p) => p.id);
      expect(idsA).toContain(paymentIdA);
      expect(idsA).not.toContain(paymentIdB);

      const asB = await authorizedGet(config.apiBaseUrl, '/api/payments', tokenB);
      const idsB = (asB.body as Array<{ id: string }>).map((p) => p.id);
      expect(idsB).toContain(paymentIdB);
      expect(idsB).not.toContain(paymentIdA);
    });

    it('GET /api/notifications/stock-deficits — Org A ვერ ხედავს Org B-ს ნოტიფიკაციას', async (ctx) => {
      if (!schema.multiTenantReady || !deficitNotifOrgAExists) return ctx.skip();

      const response = await authorizedGet(config.apiBaseUrl, '/api/notifications/stock-deficits', tokenA);
      expect(response.status).toBe(200);
      const productNames = (response.body as Array<{ product_name: string }>).map((n) => n.product_name);
      expect(productNames).toContain(`${ISOLATION_TEST_PREFIX}deficit_orgA`);
      expect(productNames).not.toContain(`${ISOLATION_TEST_PREFIX}deficit_orgB`);
    });

    it('POST /api/payments/:id/void — Org A ვერ აუქმებს Org B-ს ჩეკს (IDOR fix, 404)', async (ctx) => {
      if (!schema.multiTenantReady || !paymentIdB) return ctx.skip();

      const response = await authorizedPost(config.apiBaseUrl, `/api/payments/${paymentIdB}/void`, tokenCashierA, {});
      expect(response.status).toBe(404);
    });

    it('POST /api/payments/:id/void — happy path, Org A აუქმებს საკუთარ ჩეკს', async (ctx) => {
      if (!schema.multiTenantReady || !paymentIdA) return ctx.skip();

      const response = await authorizedPost(config.apiBaseUrl, `/api/payments/${paymentIdA}/void`, tokenCashierA, {});
      expect(response.status).toBe(200);
      expect(response.body.payment?.is_voided).toBe(true);
    });

    // 🕵️ writeAuditLog silent write-blocker-ის რეგრესია — მანამდე (ტიერი
    // 4/5-მდე) audit_logs.organization_id-ის NOT NULL-ის დამატების შემდეგ
    // ეს INSERT-ი ჩუმად ჩავარდებოდა (console.error-ის მიღმა), ანუ
    // void-access toggle-ს (ზემოთ, beforeAll-ში) რეალურად არასდროს
    // დარჩებოდა კვალი. ეს ტესტი ამოწმებს არა mock-ს, არამედ ნამდვილ,
    // ცოცხალ endpoint-ს (PUT /users/:id/void-access) → real audit_logs row.
    it('writeAuditLog silent write-blocker რეგრესია — void-access toggle-მა რეალური audit ჩანაწერი დატოვა', async (ctx) => {
      if (!schema.multiTenantReady) return ctx.skip();

      const response = await authorizedGet(config.apiBaseUrl, '/api/audit-logs', tokenA);
      expect(response.status).toBe(200);
      // ℹ️ GET /audit-logs `target_id`-ს არ აბრუნებს (მხოლოდ `target_name`/
      // `target_role`, JOIN-ით) — იხ. auth.ts GET /audit-logs SELECT.
      const entry = (response.body as Array<{ action: string; target_name: string | null }>).find(
        (log) => log.action === 'void-access' && log.target_name === cashierA.username
      );
      expect(entry).toBeDefined();
    });

    // 🔒 დისციპლინის დარღვევის გაცნობიერებული უარის fix-ები (Roadmap
    // "23.08.2026", "⛔ ეს 3 რამ განზრახ დარჩა შეუხებელი" სექცია) — ახლა
    // მოგვარებულია, ტესტებით.
    it('GET /api/payments — მოლარეს (cashier) წვდომა შეზღუდულია, 403', async (ctx) => {
      if (!schema.multiTenantReady) return ctx.skip();

      const response = await authorizedGet(config.apiBaseUrl, '/api/payments', tokenCashierA);
      expect(response.status).toBe(403);
    });

    it('GET /api/payments/export/excel — მოლარეს (cashier) წვდომა შეზღუდულია, 403', async (ctx) => {
      if (!schema.multiTenantReady) return ctx.skip();

      const response = await tokenQueryGet(config.apiBaseUrl, '/api/payments/export/excel', tokenCashierA);
      expect(response.status).toBe(403);
    });

    // 🕵️ Cashier-impersonation რეგრესია — POST /payments/sync-offline.
    // საკუთარი, იზოლირებული seed-ი (გარე beforeAll-ის cashierA/registerA-ს
    // არ ეხება), რომ ცვლის დახურვა/გახსნა ამ ტესტში სხვა ტესტებს არ
    // დაარღვევდეს. სცენარი: cashierX-ი ხურავს თავის ცვლას registerX-ზე,
    // შემდეგ იმავე ფიზიკურ registerX-ზე ცვლას ხსნის cashierY (shift
    // handover). cashierX-ის ჯერ კიდევ ვალიდური token-ით (delayed sync-ის
    // ლეგიტიმური სცენარის მსგავსად) ვცდით ორი ჩეკის სინქრონიზაციას ერთ
    // batch-ში: (ა) საკუთარი, დახურულ ცვლაზე late-sync — უნდა გავიდეს
    // ('synced', late-close reconciliation-ის უკვე ტესტირებული გზით), და
    // (ბ) cashierY-ის (სხვის) ცვლაზე, cashierY-ის cashierId-ით — ეს არის
    // impersonation ცდა, უნდა ჩავარდეს ('failed'), თუმცა batch-ის საერთო
    // HTTP სტატუსი მაინც 200-ია (თითოეული ჩეკი დამოუკიდებელია).
    it('POST /api/payments/sync-offline — cashier ვერ ასინქრონებს სხვისი (cashierId) ჩეკს', async (ctx) => {
      if (!schema.multiTenantReady) return ctx.skip();

      const cashierX = await seedOrgUser(pool, { organizationId: orgA.id, orgSlug: orgA.slug, usernameSuffix: 'tier5_sync_cashierX', role: 'cashier' });
      const cashierY = await seedOrgUser(pool, { organizationId: orgA.id, orgSlug: orgA.slug, usernameSuffix: 'tier5_sync_cashierY', role: 'cashier' });
      const registerX = await seedOrgRegister(pool, { organizationId: orgA.id, nameSuffix: 'tier5_sync_regX' });
      const registerTokenX = signRegisterToken(registerX.id);

      const tokenX = (await login(config.apiBaseUrl, cashierX.orgSlug, cashierX.username, cashierX.password)).token;
      const tokenY = (await login(config.apiBaseUrl, cashierY.orgSlug, cashierY.username, cashierY.password)).token;

      const openX = await authorizedPost(
        config.apiBaseUrl,
        '/api/shifts/open',
        tokenX,
        { start_amount: 0 },
        { 'X-Register-Id': registerX.id, 'X-Register-Token': registerTokenX }
      );
      const shiftIdX: string = openX.body.shiftId;

      await authorizedPut(config.apiBaseUrl, '/api/shifts/close', tokenX, { end_amount_actual: 0 });

      const openY = await authorizedPost(
        config.apiBaseUrl,
        '/api/shifts/open',
        tokenY,
        { start_amount: 0 },
        { 'X-Register-Id': registerX.id, 'X-Register-Token': registerTokenX }
      );
      const shiftIdY: string = openY.body.shiftId;

      const makeReceipt = (shiftId: string, cashierId: string): OfflineSyncReceiptPayload => ({
        id: randomUUID(),
        shiftId,
        registerId: registerX.id,
        cashierId,
        items: [{ productId: -999001, name: `${ISOLATION_TEST_PREFIX}sync_item`, price: 1, quantity: 1 }],
        subtotalAmount: 1,
        discountType: null,
        discountValue: 0,
        totalAmount: 1,
        paymentMethod: 'cash',
        splits: null,
        cashReceived: null,
        createdAt: new Date().toISOString(),
      });

      const ownLateSyncReceipt = makeReceipt(shiftIdX, cashierX.id);
      const impersonationReceipt = makeReceipt(shiftIdY, cashierY.id);

      const response = await authorizedPost(
        config.apiBaseUrl,
        '/api/payments/sync-offline',
        tokenX,
        { receipts: [ownLateSyncReceipt, impersonationReceipt] },
        { 'X-Register-Id': registerX.id, 'X-Register-Token': registerTokenX }
      );

      expect(response.status).toBe(200);
      const results = (response.body as { results: OfflineSyncResult[] }).results;

      const ownResult = results.find((r) => r.id === ownLateSyncReceipt.id);
      expect(ownResult?.status).toBe('synced');

      const impersonationResult = results.find((r) => r.id === impersonationReceipt.id);
      expect(impersonationResult?.status).toBe('failed');

      const dbCheck = await pool.query('SELECT id FROM payments WHERE id = $1', [impersonationReceipt.id]);
      expect(dbCheck.rows.length).toBe(0);
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
  // shifts/payments-ის მთელი FK ჯაჭვის seed-ს საჭიროებს, რომელიც ტიერი
  // 4/5-ის ზემოთა describe-ში უკვე აშენებულია სხვა route-ებისთვის, მაგრამ
  // dashboard.ts-ის საკუთარი revenue-aggregation ცალკე გადამოწმებას
  // მაინც მოითხოვს — მომავალი სესიის ცალკე scope-ია.
  // ==========================================

  it.todo('GET /api/dashboard/stats — Org A-ს რიცხვებში Org B-ს გაყიდვები არ ერევა');
});

// ==========================================
// 🏢 POST /api/organizations/register — Multi-Tenant SaaS STEP 3
// (Roadmap "23.08.2026") — კომპანიის self-service რეგისტრაცია.
// ==========================================
// ⚠️ ეს describe განზრახ ცალკეა ზემოთა "Cross-tenant data isolation"-ისგან
// (არ იზიარებს orgA/orgB-ს).
//
// ⚠️ Rate limiting (registrationRateLimit.ts, MAX_ATTEMPTS=5/საათში,
// IP-ის მიხედვით, in-memory — server-პროცესის მასშტაბით, არა DB-ში)
// **ყველა** მოთხოვნას ითვლის, თუნდაც 400/409-ით ჩავარდნილს (განზრახ —
// წაკითხულია registrationRateLimit.ts-ის თავშივე კომენტარში). ამიტომ
// ეს describe ერთ საერთო `beforeAll`-ში ქმნის ერთადერთ საბაზისო
// registration-ს (1 მოთხოვნა) და ყველა 409/400 ტესტი მას იმეორებს
// slug/email-ის დაკავებულობის დასამტკიცებლად (თითო ტესტს კიდევ 1
// მოთხოვნა) — სულ მხოლოდ 4 მოთხოვნა 4 ტესტში, რომ ბოლო
// (rate-limiting-ის) ტესტს მაინც დარჩეს სივრცე 5-კაციან ლიმიტამდე
// მისაღწევად. `vitest run tests/isolation`-ის განმეორებით (idempotency-
// დამადასტურებელ) გაშვებაზე backend server პროცესი შუალედში
// გადატვირთულია სპეციალურად ამის გამო — წინააღმდეგ შემთხვევაში
// მეორე გაშვება ადრეულადვე 429-ს მიიღებდა.
describe('POST /api/organizations/register — Multi-Tenant SaaS STEP 3 (Roadmap "23.08.2026")', () => {
  const baseSuffix = 'tier6_reg_base';
  const baseEmail = `${ISOLATION_TEST_PREFIX}${baseSuffix}@example.com`;
  let baseRegistration: { token: string; organizationId: string; organizationSlug: string; userRole: string } | undefined;

  beforeAll(async () => {
    if (!schema.multiTenantReady) return;

    const response = await registerOrganization(config.apiBaseUrl, {
      companyName: `${ISOLATION_TEST_PREFIX}Company ${baseSuffix}`,
      slug: `${ISOLATION_TEST_PREFIX}${baseSuffix}`,
      adminName: `${ISOLATION_TEST_PREFIX}${baseSuffix}_admin`,
      email: baseEmail,
      password: 'ValidPass123!',
    });

    if (response.status === 201) {
      baseRegistration = {
        token: response.body.token,
        organizationId: response.body.organization.id,
        organizationSlug: response.body.organization.slug,
        userRole: response.body.user.role,
      };
    }
  });

  it('happy path — ახალი კომპანია + admin იქმნება, auto-login token მუშაობს, ახალი org იზოლირებულია', async (ctx) => {
    if (!schema.multiTenantReady || !baseRegistration) return ctx.skip();

    expect(typeof baseRegistration.token).toBe('string');
    expect(baseRegistration.token.length).toBeGreaterThan(0);
    expect(baseRegistration.userRole).toBe('admin');
    // ⚠️ ბექენდის slugify() ხაზგასმულ ტირედ გარდაქმნის ყველა
    // არა-[a-z0-9] სიმბოლოს (ISOLATION_TEST_PREFIX-ის `_`-ებიც შედის) —
    // ამიტომ ზუსტი ტოლობის მოლოდინი (`isolation_test_...`) არასწორი
    // იქნებოდა; საკმარისია ვადასტუროთ, რომ დაბრუნებული slug ცხადად ამ
    // ტესტ-პრეფიქსიდან მოდის (cleanup-ის LIKE-პატერნიც ამაზეა
    // დაფუძნებული — SQL LIKE-ში `_` ნებისმიერ სიმბოლოს ემთხვევა).
    expect(baseRegistration.organizationSlug.startsWith('isolation')).toBe(true);
    expect(baseRegistration.organizationSlug).toContain(baseSuffix.replace(/_/g, '-'));

    // 🔒 იზოლაცია: ახალი org-ის auto-login ტოკენით შექმნილი პროდუქტი
    // ზუსტად ახალი (რეგისტრაციით შექმნილი) org-ის organization_id-ზეა
    // მიბმული — ("POST /api/products" happy-path ტესტის იგივე
    // DB-დონეზე დადასტურების პატერნი ზემოთ, ხაზი ~189).
    const productBarcode = `${ISOLATION_TEST_PREFIX}${baseSuffix}`;
    const productResponse = await authorizedPost(config.apiBaseUrl, '/api/products', baseRegistration.token, {
      name: `${ISOLATION_TEST_PREFIX}product_${baseSuffix}`,
      barcode: productBarcode,
      price: 5,
      stock: 1,
    });
    expect(productResponse.status).toBe(201);

    const productDbCheck = await pool.query<{ organization_id: string }>(
      'SELECT organization_id FROM products WHERE barcode = $1',
      [productBarcode]
    );
    expect(productDbCheck.rows[0]?.organization_id).toBe(baseRegistration.organizationId);

    const orgDbCheck = await pool.query<{ status: string }>(
      'SELECT status FROM organizations WHERE id = $1',
      [baseRegistration.organizationId]
    );
    expect(orgDbCheck.rows[0]?.status).toBe('trial');
  });

  it('409 — დაკავებული subdomain (slug) მეორედ ვერ დარეგისტრირდება', async (ctx) => {
    if (!schema.multiTenantReady || !baseRegistration) return ctx.skip();

    const response = await registerOrganization(config.apiBaseUrl, {
      companyName: `${ISOLATION_TEST_PREFIX}Company ${baseSuffix}_dupslug`,
      slug: `${ISOLATION_TEST_PREFIX}${baseSuffix}`, // baseRegistration-ის იგივე slug
      adminName: `${ISOLATION_TEST_PREFIX}${baseSuffix}_dupslug_admin`,
      email: `${ISOLATION_TEST_PREFIX}${baseSuffix}_dupslug@example.com`,
      password: 'ValidPass123!',
    });
    expect(response.status).toBe(409);
  });

  it('409 — დაკავებული email მეორედ ვერ დარეგისტრირდება, თუნდაც სულ სხვა კომპანიისთვის (platform-wide უნიკალურობა)', async (ctx) => {
    if (!schema.multiTenantReady || !baseRegistration) return ctx.skip();

    const response = await registerOrganization(config.apiBaseUrl, {
      companyName: `${ISOLATION_TEST_PREFIX}Company ${baseSuffix}_dupemail`,
      slug: `${ISOLATION_TEST_PREFIX}${baseSuffix}_dupemail`,
      adminName: `${ISOLATION_TEST_PREFIX}${baseSuffix}_dupemail_admin`,
      email: baseEmail, // baseRegistration-ის იგივე email, სულ სხვა org/slug
      password: 'ValidPass123!',
    });
    expect(response.status).toBe(409);
  });

  it('400 — სუსტი პაროლი (< 8 სიმბოლო) უარყოფილია და არც org, არც user არ იქმნება', async (ctx) => {
    if (!schema.multiTenantReady || !baseRegistration) return ctx.skip();

    const suffix = `${baseSuffix}_weakpass`;
    const slug = `${ISOLATION_TEST_PREFIX}${suffix}`;
    const response = await registerOrganization(config.apiBaseUrl, {
      companyName: `${ISOLATION_TEST_PREFIX}Company ${suffix}`,
      slug,
      adminName: `${ISOLATION_TEST_PREFIX}${suffix}_admin`,
      email: `${ISOLATION_TEST_PREFIX}${suffix}@example.com`,
      password: 'short1',
    });
    expect(response.status).toBe(400);

    // 400-ზე org საერთოდ არ იქმნება — ვამოწმებთ ორივე ვარიანტს
    // (დაუმუშავებელი slug input და ბექენდის slugify()-ის შემდეგ), რომ
    // ტესტი slugify()-ის ზუსტ transformაციაზე დამოკიდებული არ იყოს.
    const rawSlugCheck = await pool.query('SELECT id FROM organizations WHERE slug = $1', [slug]);
    expect(rawSlugCheck.rows.length).toBe(0);
    const normalizedSlugCheck = await pool.query('SELECT id FROM organizations WHERE slug = $1', [slug.replace(/_/g, '-')]);
    expect(normalizedSlugCheck.rows.length).toBe(0);
  });

  it('429 — rate limiting: ერთი IP-დან საკმარისი მცდელობის შემდეგ რეგისტრაცია დროებით იბლოკება', async (ctx) => {
    if (!schema.multiTenantReady || !baseRegistration) return ctx.skip();

    // 🔁 ამ დროისთვის (ზემოთა 4 ტესტის შემდეგ) ეს IP უკვე 4-ჯერ
    // მოითხოვა (base + dupslug + dupemail + weakpass) — 1 მცდელობა
    // კიდევ რჩება 5-კაციან ლიმიტამდე. ზუსტი დათვლის ნაცვლად მაინც
    // ვცდით მანამ, სანამ 429 არ მივიღებთ (10 ცდის უსაფრთხოების
    // ჭერით) — მყიფე არაა, თუნდაც ზემოთა ტესტების მოთხოვნების რაოდენობა
    // მომავალში შეიცვალოს.
    const responses: { status: number; error?: string }[] = [];
    for (let i = 0; i < 10; i++) {
      const suffix = `tier6_reg_ratelimit_${i}`;
      const response = await registerOrganization(config.apiBaseUrl, {
        companyName: `${ISOLATION_TEST_PREFIX}Company ${suffix}`,
        slug: `${ISOLATION_TEST_PREFIX}${suffix}`,
        adminName: `${ISOLATION_TEST_PREFIX}${suffix}_admin`,
        email: `${ISOLATION_TEST_PREFIX}${suffix}@example.com`,
        password: 'ValidPass123!',
      });
      responses.push({ status: response.status, error: response.body?.error });
      if (response.status === 429) break;
    }

    const last = responses[responses.length - 1];
    expect(last?.status).toBe(429);
    expect(last?.error).toContain('მცდელობა');

    // ყველა წინა (429-მდე) მცდელობა წარმატებული (201) უნდა ყოფილიყო —
    // რომ დავრწმუნდეთ, ბლოკვა სწორედ rate-limit-ის გამო მოხდა და არა
    // რაიმე სხვა ვალიდაციის შეცდომის გამო.
    for (const r of responses.slice(0, -1)) {
      expect(r.status).toBe(201);
    }
  });
});

// ==========================================
// 🏢 STEP 7-lite — კომპანიის slug login (Roadmap "24.08.2026")
// ==========================================
// migration 016-ის (`users.name` per-org uniqueness) და ახალი `GET
// /organizations/resolve/:slug` + `POST /login`-ის slug-მოთხოვნის
// ტესტები. ⚠️ ცალკე, დამოუკიდებელი org-ები (არა ზემოთა "Cross-tenant
// data isolation"-ის orgA/orgB) — რომ ამ describe-ს საკუთარი
// "იგივე username ორ org-ში" სცენარიც დამოუკიდებლად შეეძლოს, სხვა
// ბლოკებზე გავლენის გარეშე.
describe('POST /api/login + GET /api/organizations/resolve/:slug — STEP 7-lite (Roadmap "24.08.2026")', () => {
  let orgX: SeededOrg;
  let orgY: SeededOrg;
  const sharedUsernameSuffix = 'tier7_shared_admin';
  const sharedUsername = `${ISOLATION_TEST_PREFIX}${sharedUsernameSuffix}`;
  const testPassword = 'IsolationTest123!';

  beforeAll(async () => {
    if (!schema.multiTenantReady) return;

    orgX = await seedOrgWithAdmin(pool, { orgSuffix: 'tier7_orgX' });
    orgY = await seedOrgWithAdmin(pool, { orgSuffix: 'tier7_orgY' });

    // 🔒 migration 016-ის (`uq_users_org_name`) მთავარი დადასტურება: ორივე
    // org-ში ერთი და იგივე username-ის cashier-ი — თუ constraint მხოლოდ
    // ერთ org-ს დაუშვებდა, მეორე INSERT 23505-ით ჩავარდებოდა.
    await seedOrgUser(pool, { organizationId: orgX.id, orgSlug: orgX.slug, usernameSuffix: sharedUsernameSuffix, role: 'cashier' });
    await seedOrgUser(pool, { organizationId: orgY.id, orgSlug: orgY.slug, usernameSuffix: sharedUsernameSuffix, role: 'cashier' });
  });

  it('ორ სხვადასხვა org-ს ერთი და იგივე username-ით cashier-ი შეუძლია — თითოეული საკუთარი slug-ით ცალსახად შედის', async (ctx) => {
    if (!schema.multiTenantReady) return ctx.skip();

    const [resultX, resultY] = await Promise.all([
      login(config.apiBaseUrl, orgX.slug, sharedUsername, testPassword),
      login(config.apiBaseUrl, orgY.slug, sharedUsername, testPassword),
    ]);

    expect(resultX.token).toBeTruthy();
    expect(resultY.token).toBeTruthy();
    expect(resultX.userId).not.toBe(resultY.userId);
  });

  it('POST /api/login — slug-ის გარეშე 400-ს აბრუნებს', async (ctx) => {
    if (!schema.multiTenantReady) return ctx.skip();

    const response = await loginAttempt(config.apiBaseUrl, { username: sharedUsername, password: testPassword });
    expect(response.status).toBe(400);
  });

  it('POST /api/login — არარსებული slug-ით 404-ს აბრუნებს (org-JOIN ვერ ემთხვევა)', async (ctx) => {
    if (!schema.multiTenantReady) return ctx.skip();

    const response = await loginAttempt(config.apiBaseUrl, {
      slug: `${ISOLATION_TEST_PREFIX}tier7_nonexistent_slug`,
      username: sharedUsername,
      password: testPassword,
    });
    expect(response.status).toBe(404);
  });

  it('POST /api/login — სწორი slug/username, არასწორი პაროლით 401-ს აბრუნებს', async (ctx) => {
    if (!schema.multiTenantReady) return ctx.skip();

    const response = await loginAttempt(config.apiBaseUrl, {
      slug: orgX.slug,
      username: sharedUsername,
      password: 'DefinitelyWrongPassword123!',
    });
    expect(response.status).toBe(401);
  });

  it('GET /api/organizations/resolve/:slug — არსებული org-ისთვის name/slug/status აბრუნებს', async (ctx) => {
    if (!schema.multiTenantReady) return ctx.skip();

    const response = await resolveOrganization(config.apiBaseUrl, orgX.slug);
    expect(response.status).toBe(200);
    expect(response.body.slug).toBe(orgX.slug);
    expect(typeof response.body.name).toBe('string');
    expect(response.body.status).toBeDefined();
  });

  it('GET /api/organizations/resolve/:slug — არარსებული slug-ისთვის 404-ს აბრუნებს', async (ctx) => {
    if (!schema.multiTenantReady) return ctx.skip();

    const response = await resolveOrganization(config.apiBaseUrl, `${ISOLATION_TEST_PREFIX}tier7_nonexistent_slug`);
    expect(response.status).toBe(404);
  });

  // ⚠️ orgResolveRateLimit.ts-ის MAX_ATTEMPTS=20/სთ, IP-ის მიხედვით,
  // in-memory (server-პროცესის მასშტაბით) — ისევე, როგორც
  // registrationRateLimit.ts-ის ანალოგიური ტესტი ზემოთ, `vitest run
  // tests/isolation`-ის განმეორებით გაშვებაზე backend server პროცესი
  // შუალედში გადატვირთული უნდა იყოს, თორემ ეს ტესტი ადრეულადვე 429-ს
  // მიიღებს (ამ describe-ის სხვა ტესტების 2 resolve-მოთხოვნის ჩათვლითაც).
  it('GET /api/organizations/resolve/:slug — rate limit (20/სთ) აჩერებს ზედმეტ მცდელობებს', async (ctx) => {
    if (!schema.multiTenantReady) return ctx.skip();

    const responses: Array<{ status: number; error?: string }> = [];
    for (let i = 0; i < 25; i++) {
      const response = await resolveOrganization(config.apiBaseUrl, orgX.slug);
      responses.push({ status: response.status, error: response.body?.error });
      if (response.status === 429) break;
    }

    const last = responses[responses.length - 1];
    expect(last?.status).toBe(429);
    expect(last?.error).toContain('მცდელობა');

    for (const r of responses.slice(0, -1)) {
      expect(r.status).toBe(200);
    }
  });
});
