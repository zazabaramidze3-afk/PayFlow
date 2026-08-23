// backend/tests/isolation/seed.ts
//
// ტესტ-მონაცემების შექმნა/გასუფთავება. ყველა ჩანაწერს აქვს საერთო
// პრეფიქსი (`ISOLATION_TEST_PREFIX`), რომ:
//   1) არასდროს შეეჯახოს რეალურ (ადამიანის შექმნილ) მონაცემს;
//   2) `cleanupIsolationTestData`-მ ზუსტად იცოდეს, რისი წაშლაც შეუძლია.

import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { columnExists } from './schema';

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
 * STEP 1 migration (013) გატარების შემდეგ `users.organization_id` NOT
 * NULL-ია — ნებისმიერი INSERT-ს (ორგანიზაციაზე დამოუკიდებელ smoke ტესტსაც
 * კი) სჭირდება რომელიმე org id. ვიღებთ ყველაზე ძველ (migration 013-ის
 * backfill-ით შექმნილ "default") org-ს; თუ ცხრილი ცარიელია (მაგ. სუფთა
 * CI DB, სადაც migration-ები just now გავიდა ნულოვან production
 * მონაცემზე), ერთს ვქმნით ადგილზე — migration 013-ის იგივე bootstrap
 * ჩანაწერის ანალოგიით.
 */
async function getOrCreateDefaultOrganizationId(pool: Pool): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1`
  );
  const existingId = existing.rows[0]?.id;
  if (existingId) {
    return existingId;
  }

  const created = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, status)
     VALUES ('PayFlow — Default Organization', 'default', 'active')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const createdId = created.rows[0]?.id;
  if (!createdId) {
    throw new Error('ვერ შეიქმნა/მოიძებნა default organization ტესტ-user-ისთვის');
  }
  return createdId;
}

/**
 * ერთი user-ის შექმნა (idempotent — თუ სახელით უკვე არსებობს, ხელახლა
 * ჰეშავს პაროლს და აბრუნებს არსებულ id-ს). ორგანიზაციის კონცეფციისგან
 * დამოუკიდებელი "smoke" ტესტებისთვის — ამიტომ არ იღებს `organizationId`-ს
 * პარამეტრად. STEP 1-მდე (`users.organization_id` სვეტი არ არსებობს)
 * ორგანიზაციის გარეშე წერს; STEP 1-ის შემდეგ (NOT NULL) ავტომატურად
 * იყენებს `getOrCreateDefaultOrganizationId`-ს — ორივე რეჟიმში იგივე
 * ფუნქცია იძახება უცვლელად (STEP 1-2-ის schema-detection-ის იგივე
 * პატერნი, რასაც `schema.ts`/`tenant-isolation.test.ts` მიჰყვება).
 */
export async function seedTestUser(
  pool: Pool,
  opts: { readonly usernameSuffix: string; readonly role: SeededUser['role'] }
): Promise<SeededUser> {
  const username = `${ISOLATION_TEST_PREFIX}${opts.usernameSuffix}`;
  const passwordHash = await bcrypt.hash(DEFAULT_TEST_PASSWORD, 10);
  const hasOrgColumn = await columnExists(pool, 'users', 'organization_id');

  const result = hasOrgColumn
    ? await pool.query<{ id: string }>(
        `INSERT INTO users (name, password_hash, role, status, requires_password_reset, organization_id)
         VALUES ($1, $2, $3, 'active', false, $4)
         ON CONFLICT (name) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, organization_id = EXCLUDED.organization_id
         RETURNING id`,
        [username, passwordHash, opts.role, await getOrCreateDefaultOrganizationId(pool)]
      )
    : await pool.query<{ id: string }>(
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

  // ⚠️ ON CONFLICT (organization_id, barcode) — migration 013-ის შემდეგ
  // products-ს აღარ აქვს გლობალური UNIQUE(barcode), მხოლოდ composite
  // UNIQUE(organization_id, barcode) (`uq_products_org_barcode`). ეს
  // ფუნქცია მხოლოდ multiTenantReady-ს დროს გამოიძახება (იხ. ზემოთა
  // docstring), ამიტომ ეს constraint ყოველთვის არსებობს, როცა აქამდე
  // მივდივართ.
  const result = await pool.query<{ id: string }>(
    `INSERT INTO products (barcode, name, price, stock, organization_id)
     VALUES ($1, $2, 9.99, 10, $3)
     ON CONFLICT (organization_id, barcode) DO UPDATE SET organization_id = EXCLUDED.organization_id
     RETURNING id`,
    [barcode, name, opts.organizationId]
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`ვერ შეიქმნა ტესტ-პროდუქტი: ${name}`);
  }

  return { id, name, barcode };
}

export interface SeededAuditLog {
  readonly id: string;
}

/**
 * ერთი audit_logs ჩანაწერი კონკრეტულ ორგანიზაციაში — GET /api/audit-logs-ის
 * (auth.ts) STEP 2 org-scoping-ის ტესტისთვის. `seedOrgProduct`-ის იგივე
 * წინაპირობით (`multiTenantReady === true`) გამოსაძახებელი, migration
 * 013-ის შემდეგ `audit_logs.organization_id` NOT NULL-ია.
 */
export async function seedAuditLogEntry(
  pool: Pool,
  opts: { readonly organizationId: string; readonly actorId: string; readonly targetId: string; readonly action: string }
): Promise<SeededAuditLog> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO audit_logs (actor_id, target_id, action, new_value, organization_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [opts.actorId, opts.targetId, opts.action, `${ISOLATION_TEST_PREFIX}marker`, opts.organizationId]
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error('ვერ შეიქმნა ტესტ-audit-log ჩანაწერი');
  }
  return { id };
}

/** ტესტ-მონაცემების სრული გასუფთავება — `beforeAll`/`afterAll`-ში გამოსაძახებელი. */
export async function cleanupIsolationTestData(pool: Pool): Promise<void> {
  const likePattern = `${ISOLATION_TEST_PREFIX}%`;

  // ⚠️ audit_logs ჯერ იშლება, users-მდე — actor_id/target_id FK users(id)-ზეა
  // და ON DELETE CASCADE არაა (იხ. migrations/009), ამიტომ users-ის წაშლა
  // audit_logs-ის ტესტ-ჩანაწერების არსებობისას FK violation-ს გამოიწვევდა
  // (STEP 2-მდე ეს პრობლემა არ იყო, რადგან ტესტები audit_logs-ს არ ქმნიდნენ).
  await pool.query(`DELETE FROM audit_logs WHERE new_value = $1`, [`${ISOLATION_TEST_PREFIX}marker`]);

  await pool.query(`DELETE FROM products WHERE barcode LIKE $1`, [likePattern]);

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
