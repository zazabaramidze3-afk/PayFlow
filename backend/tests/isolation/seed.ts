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
  // 🏢 Roadmap "24.08.2026" — STEP 7-lite (company slug login) —
  // migration 016-ის (`users.name` per-org uniqueness) შემდეგ
  // `POST /login`-ს ცალსახად სჭირდება org-ის slug, ამიტომ ყოველი
  // seed-ილი user-ი საკუთარ org-slug-საც ატარებს — `login(...)`
  // helper-ს (api.ts) ცალკე org-ის მოძებნა/გახსენება აღარ სჭირდება.
  readonly orgSlug: string;
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
async function getOrCreateDefaultOrganization(pool: Pool): Promise<{ id: string; slug: string }> {
  const existing = await pool.query<{ id: string; slug: string }>(
    `SELECT id, slug FROM organizations ORDER BY created_at ASC LIMIT 1`
  );
  const existingRow = existing.rows[0];
  if (existingRow) {
    return existingRow;
  }

  const created = await pool.query<{ id: string; slug: string }>(
    `INSERT INTO organizations (name, slug, status)
     VALUES ('PayFlow — Default Organization', 'default', 'active')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, slug`
  );
  const createdRow = created.rows[0];
  if (!createdRow) {
    throw new Error('ვერ შეიქმნა/მოიძებნა default organization ტესტ-user-ისთვის');
  }
  return createdRow;
}

/**
 * ერთი user-ის შექმნა (idempotent — თუ სახელით უკვე არსებობს, ხელახლა
 * ჰეშავს პაროლს და აბრუნებს არსებულ id-ს). ორგანიზაციის კონცეფციისგან
 * დამოუკიდებელი "smoke" ტესტებისთვის — ამიტომ არ იღებს `organizationId`-ს
 * პარამეტრად. STEP 1-მდე (`users.organization_id` სვეტი არ არსებობს)
 * ორგანიზაციის გარეშე წერს; STEP 1-ის შემდეგ (NOT NULL) ავტომატურად
 * იყენებს `getOrCreateDefaultOrganization`-ს — ორივე რეჟიმში იგივე
 * ფუნქცია იძახება უცვლელად (STEP 1-2-ის schema-detection-ის იგივე
 * პატერნი, რასაც `schema.ts`/`tenant-isolation.test.ts` მიჰყვება).
 *
 * 🏢 Roadmap "24.08.2026" — STEP 7-lite-ის შემდეგ დაბრუნებულ
 * `SeededUser`-საც `orgSlug` სჭირდება (`login(...)`-ისთვის); STEP
 * 1-მდე რეჟიმში (`hasOrgColumn === false`) რეალური org საერთოდ არ
 * არსებობს, ამიტომ იქ `orgSlug` მუდმივი `'default'`-ია — ეს რეჟიმი
 * ისედაც მხოლოდ ისტორიული fallback-ია, production schema დიდი ხანია
 * STEP 1-ის მიღმაა.
 */
export async function seedTestUser(
  pool: Pool,
  opts: { readonly usernameSuffix: string; readonly role: SeededUser['role'] }
): Promise<SeededUser> {
  const username = `${ISOLATION_TEST_PREFIX}${opts.usernameSuffix}`;
  const passwordHash = await bcrypt.hash(DEFAULT_TEST_PASSWORD, 10);
  const hasOrgColumn = await columnExists(pool, 'users', 'organization_id');
  const defaultOrg = hasOrgColumn ? await getOrCreateDefaultOrganization(pool) : undefined;

  // ⚠️ Roadmap "24.08.2026" — migration 016-ის შემდეგ `users_name_key`
  // (გლობალური UNIQUE(name)) აღარ არსებობს — `ON CONFLICT (name)`-ს
  // აღარაფერი ემთხვევა (Postgres error: "no unique or exclusion
  // constraint matching the ON CONFLICT specification"). ახალი target
  // — `uq_users_org_name`-ის იგივე expression, `(organization_id,
  // LOWER(name))`.
  const result = hasOrgColumn
    ? await pool.query<{ id: string }>(
        `INSERT INTO users (name, password_hash, role, status, requires_password_reset, organization_id)
         VALUES ($1, $2, $3, 'active', false, $4)
         ON CONFLICT (organization_id, LOWER(name)) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
         RETURNING id`,
        [username, passwordHash, opts.role, defaultOrg!.id]
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

  return { id, username, password: DEFAULT_TEST_PASSWORD, role: opts.role, orgSlug: defaultOrg?.slug ?? 'default' };
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
  // ⚠️ Roadmap "24.08.2026" — STEP 7-lite: `slug` აქ ადრე პირდაპირ
  // `${ISOLATION_TEST_PREFIX}${opts.orgSuffix}`-ს უდრიდა — RAW, დაუმუშავებელი
  // (მაგ. "isolation_test_orgA", ხაზგასმულით და დიდი ასოთი). Production-ის
  // ერთადერთი org-შემქმნელი ნაკადი (`POST /organizations/register`) კი
  // ყოველთვის `slugify()`-ს ატარებს (lowercase + `[^a-z0-9]` → `-`), ანუ
  // production-ის slug ყოველთვის უკვე "სუფთაა". ეს raw ტესტ-slug კი ვერც
  // `POST /login`-ის `o.slug = LOWER($1)`-ს ემთხვეოდა (LOWER მხოლოდ
  // ინფუთს ალაგებდა, არა column-ს — column თავად შეიცავდა დიდ ასოს) და
  // ვერც `GET /organizations/resolve/:slug`-ის `slugify()`-ს (რომელიც
  // ხაზგასმულს ტირედაც აქცევს) — ორივე შემთხვევაში 404. გასწორდა:
  // slug აქვე ერთხელ და სამუდამოდ "სუფთავდება" იმავე წესით, რასაც
  // production-ის slugify() იყენებს — idempotent, ანუ resolve-ის
  // slugify()-ის ხელახალი გატარებაც იგივე მნიშვნელობას აბრუნებს.
  const slug = `${ISOLATION_TEST_PREFIX}${opts.orgSuffix}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

  // ⚠️ Roadmap "24.08.2026" — migration 016-ის შემდეგ per-org target
  // (`uq_users_org_name`-ის იგივე expression) — იხ. იგივე შენიშვნა
  // `seedTestUser`-ში.
  const userResult = await pool.query<{ id: string }>(
    `INSERT INTO users (name, password_hash, role, status, requires_password_reset, organization_id)
     VALUES ($1, $2, 'admin', 'active', false, $3)
     ON CONFLICT (organization_id, LOWER(name)) DO UPDATE SET password_hash = EXCLUDED.password_hash
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
    admin: { id: userId, username, password: DEFAULT_TEST_PASSWORD, role: 'admin', orgSlug: slug },
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

/**
 * ერთი user, კონკრეტულ ორგანიზაციასა და როლში — `seedOrgWithAdmin`-ის
 * ანალოგიით, მაგრამ role/org თავად გამომძახებელი ირჩევს (`seedTestUser`
 * მხოლოდ default org-ს იყენებს, `seedOrgWithAdmin` კი მხოლოდ admin-ს
 * ქმნის). 🏢 STEP 2, ტიერი 5 (Roadmap "23.08.2026") — register-authenticated
 * route-ების (POST /shifts/open, POST /payments) ტესტებს კონკრეტული org-ის
 * cashier-role user სჭირდება, `seedOrgWithAdmin`-ის admin საკმარისი არაა
 * (POST /shifts/open მკაცრად `role === 'cashier'`-ს მოითხოვს).
 *
 * 🏢 Roadmap "24.08.2026" — STEP 7-lite — `orgSlug` opts-ში აქედან
 * დაემატა (და არა DB query-ით ამოღებული): გამომძახებელს (ტესტ-ფაილს)
 * ისედაც აქვს `SeededOrg` (`orgA`/`orgB`) სკოუპში, ამიტომ მისი `.slug`-ის
 * პირდაპირი გადაცემა ერთ ზედმეტ DB round-trip-ს ზოგავს ყოველ user-ზე.
 */
export async function seedOrgUser(
  pool: Pool,
  opts: {
    readonly organizationId: string;
    readonly orgSlug: string;
    readonly usernameSuffix: string;
    readonly role: SeededUser['role'];
  }
): Promise<SeededUser> {
  const username = `${ISOLATION_TEST_PREFIX}${opts.usernameSuffix}`;
  const passwordHash = await bcrypt.hash(DEFAULT_TEST_PASSWORD, 10);

  // ⚠️ Roadmap "24.08.2026" — migration 016-ის შემდეგ per-org target
  // (იგივე შენიშვნა `seedTestUser`-ში). ეს ცვლილება ასევე შინაარსობრივად
  // აუცილებელია: `ON CONFLICT (name)` ძველად შესაძლოა ორ org-ს შორის
  // "მოეპარა" row (`organization_id = EXCLUDED.organization_id`-ით
  // გადაეწერა სხვა org-ის მფლობელობა) — STEP 7-lite-ის მთელი მიზანი კი
  // ზუსტად საწინააღმდეგოა: ორ org-ს დამოუკიდებელი, ერთსახელა user-ები
  // ჰყავდეთ. ახალი target ამას სტრუქტურულადვე უზრუნველყოფს.
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (name, password_hash, role, status, requires_password_reset, organization_id)
     VALUES ($1, $2, $3, 'active', false, $4)
     ON CONFLICT (organization_id, LOWER(name)) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
     RETURNING id`,
    [username, passwordHash, opts.role, opts.organizationId]
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`ვერ შეიქმნა ტესტ-org user: ${username}`);
  }

  return { id, username, password: DEFAULT_TEST_PASSWORD, role: opts.role, orgSlug: opts.orgSlug };
}

export interface SeededRegister {
  readonly id: string;
  readonly name: string;
}

/**
 * ერთი ფიზიკური Register კონკრეტულ ორგანიზაციაში — Pairing UI ნაკადის
 * (POST /registers/generate-code + POST /registers/pair, tier 3-ის
 * ტესტებში უკვე დაფარული) გვერდის ავლით, პირდაპირ ბაზაში. 🏢 STEP 2,
 * ტიერი 5 (Roadmap "23.08.2026") — register-authenticated route-ების
 * ტესტებს (POST /shifts/open, POST /payments) სჭირდება ვალიდური
 * registers.id + შესაბამისი signRegisterToken(...)-ით ხელმოწერილი
 * X-Register-Token, pairing ნაკადის ხელახლა გავლის გარეშე.
 */
export async function seedOrgRegister(
  pool: Pool,
  opts: { readonly organizationId: string; readonly nameSuffix: string }
): Promise<SeededRegister> {
  const name = `${ISOLATION_TEST_PREFIX}register_${opts.nameSuffix}`;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO registers (name, organization_id, is_active)
     VALUES ($1, $2, true)
     RETURNING id`,
    [name, opts.organizationId]
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`ვერ შეიქმნა ტესტ-register: ${name}`);
  }
  return { id, name };
}

export interface SeededStockDeficitNotification {
  readonly id: string;
}

/**
 * ერთი stock_deficit_notifications ჩანაწერი, უკვე არსებულ (real) payment-ს
 * მიბმული — GET /notifications/stock-deficits-ის org-scoping ტესტისთვის
 * (ტიერი 4). `payment_id` NOT NULL + FK ON DELETE CASCADE payments(id)-ზე,
 * ამიტომ ცალკე cleanup არ სჭირდება — testId-ის payment-ის წაშლა (იხ.
 * `cleanupIsolationTestData`) ამასაც თან წაშლის.
 */
export async function seedStockDeficitNotification(
  pool: Pool,
  opts: { readonly organizationId: string; readonly paymentId: string; readonly productNameSuffix: string }
): Promise<SeededStockDeficitNotification> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO stock_deficit_notifications
       (payment_id, product_name, requested_quantity, available_quantity, deficit_quantity, organization_id)
     VALUES ($1, $2, 5, 2, 3, $3)
     RETURNING id`,
    [opts.paymentId, `${ISOLATION_TEST_PREFIX}deficit_${opts.productNameSuffix}`, opts.organizationId]
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error('ვერ შეიქმნა ტესტ-stock-deficit-notification');
  }
  return { id };
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
  // 🏢 STEP 2, ტიერი 4/5 (Roadmap "23.08.2026") — `new_value = marker`-ის
  // გარდა ახლა actor_id/target_id-ითაც ვშლით: ტიერი 4/5-ის ტესტები
  // (PUT /users/:id/void-access) ნამდვილ writeAuditLog()-ს იძახებენ
  // (არა seedAuditLogEntry-ის მარკერით), ამიტომ ეს ჩანაწერები
  // `new_value = marker`-ს არ ემთხვევა და users-ის შემდგომ წაშლას
  // (ქვემოთ) FK violation-ით ბლოკავდა (audit_logs.actor_id/target_id →
  // users(id), CASCADE გარეშე).
  await pool.query(
    `DELETE FROM audit_logs
     WHERE new_value = $1
        OR actor_id IN (SELECT id FROM users WHERE name LIKE $2)
        OR target_id IN (SELECT id FROM users WHERE name LIKE $2)`,
    [`${ISOLATION_TEST_PREFIX}marker`, likePattern]
  );

  // 🏢 STEP 2, ტიერი 4/5 (Roadmap "23.08.2026") — payments/shifts ჯერ
  // იშლება, registers/users-მდე: payments.register_id/shifts.register_id
  // და shifts.cashier_id FK-ებზე CASCADE არაა, ამიტომ registers/users-ის
  // ტესტ-ჩანაწერების წაშლა FK violation-ს გამოიწვევდა, სანამ ეს ჩანაწერები
  // არსებობს (POST /shifts/open, POST /payments-ის tier 5 ტესტები ქმნის
  // ორივეს). payments-ის წაშლა თავად ჯაჭვურად (ON DELETE CASCADE) შლის
  // payment_items/payment_splits/stock_deficit_notifications-ს (payment_id-ით)
  // და shift_amendments-საც (payment_id-ით); shifts-ის შემდგომი წაშლა კი
  // დარჩენილ shift_amendments-საც შლის (shift_id-ით, ასევე CASCADE).
  await pool.query(
    `DELETE FROM payments
     WHERE register_id IN (SELECT id FROM registers WHERE name LIKE $1)
        OR cashier_id IN (SELECT id FROM users WHERE name LIKE $1)`,
    [likePattern]
  );
  await pool.query(
    `DELETE FROM shifts
     WHERE register_id IN (SELECT id FROM registers WHERE name LIKE $1)
        OR cashier_id IN (SELECT id FROM users WHERE name LIKE $1)`,
    [likePattern]
  );

  // 🏢 STEP 2, ტიერი 3 (Roadmap "23.08.2026") — activation_codes ჯერ იშლება,
  // registers/users-მდე: `activation_codes.confirmed_by` FK users(id)-ზეა
  // და `activation_codes.register_id` FK registers(id)-ზეა (ON DELETE
  // CASCADE არცერთ მათგანზე), ამიტომ registers-ის/users-ის ტესტ-ჩანაწერების
  // წაშლა ჯერ activation_codes-ს მოითხოვს (POST /registers/pair-ის tier 3
  // ტესტები ქმნის ორივეს). registers-ს code არ აქვს პრეფიქსი (6-ციფრიანი
  // random კოდია), ამიტომ register_id/confirmed_by-ით ვცდილობთ, არა code-ით.
  await pool.query(
    `DELETE FROM activation_codes
     WHERE register_id IN (SELECT id FROM registers WHERE name LIKE $1)
        OR confirmed_by IN (SELECT id FROM users WHERE name LIKE $1)`,
    [likePattern]
  );

  await pool.query(`DELETE FROM registers WHERE name LIKE $1`, [likePattern]);

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
