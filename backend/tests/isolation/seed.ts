// backend/tests/isolation/seed.ts
//
// ტესტ-მონაცემების შექმნა/გასუფთავება. ყველა ჩანაწერს აქვს საერთო
// პრეფიქსი (`ISOLATION_TEST_PREFIX`), რომ:
//   1) არასდროს შეეჯახოს რეალურ (ადამიანის შექმნილ) მონაცემს;
//   2) `cleanupIsolationTestData`-მ ზუსტად იცოდეს, რისი წაშლაც შეუძლია.

import bcrypt from 'bcrypt';
import { Pool } from 'pg';

export const ISOLATION_TEST_PREFIX = 'isolation_test_';

export interface SeededUser {
  readonly id: string;
  readonly username: string;
  readonly password: string;
  readonly role: 'admin' | 'manager' | 'cashier';
}

export interface SeededOrg {
  readonly id: string;
  readonly slug: string;
  readonly admin: SeededUser;
}

const DEFAULT_TEST_PASSWORD = 'IsolationTest123!';

/**
 * ერთი user-ის შექმნა (idempotent — თუ სახელით უკვე არსებობს, ხელახლა
 * ჰეშავს პაროლს და აბრუნებს არსებულ id-ს). ორგანიზაციის გარეშე რეჟიმისთვის
 * (STEP 1-მდე, ამჟამინდელი production schema).
 */
export async function seedTestUser(
  pool: Pool,
  opts: { readonly usernameSuffix: string; readonly role: SeededUser['role'] }
): Promise<SeededUser> {
  const username = `${ISOLATION_TEST_PREFIX}${opts.usernameSuffix}`;
  const passwordHash = await bcrypt.hash(DEFAULT_TEST_PASSWORD, 10);

  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (name, password_hash, role, status, requires_password_reset)
     VALUES ($1, $2, $3, 'active', false)
     ON CONFLICT (name) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
     RETURNING id`,
    [username, passwordHash, opts.role]
  );

  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`ვერ შეიქმნა ტესტ-user: ${username}`);
  }

  return { id, username, password: DEFAULT_TEST_PASSWORD, role: opts.role };
}

/**
 * ორგანიზაცია + ერთი admin user მასში. მხოლოდ მაშინ გამოსაძახებელია,
 * როცა `detectSchemaCapabilities(pool).multiTenantReady === true`
 * (STEP 1 migration უკვე გატარებულია — `organizations`/`users.organization_id`
 * არსებობს). სვეტების სახელები STEP 1-ის დაგეგმილ სქემას მიჰყვება
 * (`ROADMAP - Multi-Tenant SaaS - 14.08.2026.md`): organizations(id, name,
 * slug, status, plan, trial_ends_at, created_at).
 */
export async function seedOrgWithAdmin(
  pool: Pool,
  opts: { readonly orgSuffix: string }
): Promise<SeededOrg> {
  const slug = `${ISOLATION_TEST_PREFIX}${opts.orgSuffix}`;
  const orgName = `Isolation Test Org ${opts.orgSuffix}`;

  const orgResult = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, status)
     VALUES ($1, $2, 'active')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [orgName, slug]
  );
  const orgId = orgResult.rows[0]?.id;
  if (!orgId) {
    throw new Error(`ვერ შეიქმნა ტესტ-organization: ${slug}`);
  }

  const username = `${ISOLATION_TEST_PREFIX}${opts.orgSuffix}_admin`;
  const passwordHash = await bcrypt.hash(DEFAULT_TEST_PASSWORD, 10);

  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO users (name, password_hash, role, status, requires_password_reset, organization_id)
     VALUES ($1, $2, 'admin', 'active', false, $3)
     ON CONFLICT (name) DO UPDATE SET password_hash = EXCLUDED.password_hash, organization_id = EXCLUDED.organization_id
     RETURNING id`,
    [username, passwordHash, orgId]
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) {
    throw new Error(`ვერ შეიქმნა ტესტ-org admin: ${username}`);
  }

  return {
    id: orgId,
    slug,
    admin: { id: userId, username, password: DEFAULT_TEST_PASSWORD, role: 'admin' },
  };
}

export interface SeededProduct {
  readonly id: string;
  readonly name: string;
  readonly barcode: string;
}

/**
 * ერთი პროდუქტი კონკრეტულ ორგანიზაციაში — მხოლოდ მაშინ გამოსაძახებელია,
 * როცა `products.organization_id` სვეტი უკვე არსებობს (STEP 1-ის
 * ნაწილია `products.barcode`/`name` UNIQUE constraint-ების per-org
 * გადაკეთებასთან ერთად, იხ. `ROADMAP - Multi-Tenant SaaS - 14.08.2026.md`
 * STEP 1.4). name/barcode პრეფიქსით უნიკალურია ორგანიზაციებს შორის,
 * რომ ტესტმა ცალსახად შეძლოს "ეს Org A-ს პროდუქტია, არა Org B-ს" ცნობა.
 */
export async function seedOrgProduct(
  pool: Pool,
  opts: { readonly organizationId: string; readonly nameSuffix: string }
): Promise<SeededProduct> {
  const name = `${ISOLATION_TEST_PREFIX}product_${opts.nameSuffix}`;
  const barcode = `${ISOLATION_TEST_PREFIX}${opts.nameSuffix}`;

  const result = await pool.query<{ id: string }>(
    `INSERT INTO products (barcode, name, price, stock, organization_id)
     VALUES ($1, $2, 9.99, 10, $3)
     ON CONFLICT (barcode) DO UPDATE SET organization_id = EXCLUDED.organization_id
     RETURNING id`,
    [barcode, name, opts.organizationId]
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`ვერ შეიქმნა ტესტ-პროდუქტი: ${name}`);
  }

  return { id, name, barcode };
}

/** ტესტ-მონაცემების სრული გასუფთავება — `beforeAll`/`afterAll`-ში გამოსაძახებელი. */
export async function cleanupIsolationTestData(pool: Pool): Promise<void> {
  const likePattern = `${ISOLATION_TEST_PREFIX}%`;

  await pool.query(`DELETE FROM products WHERE barcode LIKE $1`, [likePattern]);

  // users-ის FK-ები (payments/shifts/audit_logs) ON DELETE CASCADE არაა
  // ყველგან (იხ. migrations/009) — ტესტ-user-ები განზრახ არასდროს ქმნიან
  // sales/shifts მონაცემს (STEP 2-ის ორგანიზაციული ტესტები მხოლოდ read
  // endpoint-ებს ამოწმებს), ამიტომ უბრალო DELETE საკმარისია.
  await pool.query(`DELETE FROM users WHERE name LIKE $1`, [likePattern]);

  const orgsTableExists = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'organizations'
     ) AS exists`
  );
  if (orgsTableExists.rows[0]?.exists) {
    await pool.query(`DELETE FROM organizations WHERE slug LIKE $1`, [likePattern]);
  }
}
