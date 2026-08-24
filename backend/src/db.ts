import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// ⚠️ FIX: ადრე ssl: true იყო დაფიქსირებული უპირობოდ, რაც ლოკალურ
// PostgreSQL-თან (SSL გარეშე) კავშირს ამტვრევდა. ახლა იგივე პირობითი
// ლოგიკა გვაქვს, რასაც index.ts იყენებდა — ერთი წყარო სიმართლისთვის.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('❌ მოულოდნელი შეცდომა PostgreSQL pool-ში:', err);
});

// ==========================================
// 🔒 withOrgContext — RLS org-context helper (Roadmap STEP 2.2, "24.08.2026")
// ==========================================
// PILOT, sales.ts-ზე (roadmap-ის RLS scope-გადაწყვეტილება, "24.08.2026" —
// "Pilot — sales.ts პირველად"). Row-Level Security-ს (migration 017)
// სჭირდება `app.current_org_id` GUC, კონკრეტულ connection-ზე/ტრანზაქციაზე
// დაყენებული — მაგრამ ეს shared `pool`-ის `db.query(...)`-ის (ყოველ
// გამოძახებაზე შემთხვევითი connection-ის) წინააღმდეგობაშია. ეს helper
// checks-out-ავს dedicated PoolClient-ს, ხსნის ცხად ტრანზაქციას,
// `set_config('app.current_org_id', ..., true)`-ით (მესამე არგუმენტი —
// `is_local = true` — ნიშნავს, რომ მნიშვნელობა ავტომატურად "იშლება"
// COMMIT/ROLLBACK-ზე, ისე რომ pool-ში დაბრუნებულ connection-ს არასდროს
// "გადმორჩება" წინა request-ის org-კონტექსტი).
//
// ⚠️ fail-open, თუ `organizationId` არ არის გადაცემული (undefined) —
// `set_config` საერთოდ არ გამოიძახება, ანუ migration 017-ის RLS
// policy-ები (`current_setting('app.current_org_id', true) IS NULL OR ...`)
// ყველა row-ს გაატარებენ. ეს **განზრახ, დროებითი** დიზაინია: sales.ts-ის
// გარეთ სხვა route-ები (auth.ts, products.ts, registers.ts, dashboard.ts,
// notifications.ts, platformAdmin.ts, organizations.ts) ჯერ კიდევ
// პირდაპირ `db.query(...)`-ს იყენებენ (92-ვე გამოძახება routes/-ში, სულ
// მხოლოდ sales.ts-ია ამ ეტაპზე გადასული) — თუ policy fail-closed
// ყოფილიყო, migration 017-ის გატარებისთანავე ყველა დანარჩენი route
// (რომელიც users/products/payments-ს ეხება) production-ზე მყისიერად
// ჩავარდებოდა. ეს escape-hatch საშუალებას იძლევა RLS ეტაპობრივად,
// route-route-ზე ჩაირთოს, უსაფრთხოდ — თითოეული მიგრირებული route დამატებით
// დაცვის შრეს იღებს, დანარჩენები კი უცვლელად განაგრძობენ მუშაობას
// (არსებული `WHERE organization_id = $1` scoping-ით, ისევე როგორც აქამდე).
// **TODO (RLS roll-out-ის შემდეგი ფაზები):** როცა ყველა route გადავა
// `withOrgContext`-ზე, ეს "IS NULL OR" escape-hatch policy-ებიდან
// მოსაშორებელია (migration-ით), fail-closed-ის სასარგებლოდ — ნამდვილი,
// ბოლომდე მკაცრი DB-level დაცვისთვის.
export async function withOrgContext<T>(
  organizationId: string | undefined,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (organizationId) {
      // 🔐 პარამეტრიზებული `set_config` (არა string-ინტერპოლაცია SQL-ში
      // პირდაპირ) — SQL-ინექციისგან დაცვა, ისევე როგორც ყველა დანარჩენი
      // query ამ პროექტში.
      await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [organizationId]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // ROLLBACK ორმაგად დაცული — თუ თავად ROLLBACK-იც ჩავარდა (მაგ.
    // connection უკვე მოკვდა), ორიგინალი შეცდომა მაინც კარგავდეს, არა
    // ROLLBACK-ის მეორადი.
    try {
      await client.query('ROLLBACK');
    } catch {
      // ჩუმად იგნორირდება — ორიგინალი err ქვემოთ მაინც გადაიგდება.
    }
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
