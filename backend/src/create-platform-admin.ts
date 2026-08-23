import bcrypt from 'bcrypt';
import pool from './db';

// ==========================================
// Superadmin ბუტსტრეპ-სკრიპტი — Multi-Tenant SaaS STEP 8
// ==========================================
// გაშვება: npm run create-platform-admin -- "სახელი" "email@example.com" "პაროლი"
// (backend/ ფოლდერიდან)
//
// ეს ერთადერთი, განზრახ ხელით/CLI-დან გასაშვები გზაა პირველი (ან
// ნებისმიერი შემდეგი) Superadmin ანგარიშის შესაქმნელად — POST
// /platform-admin-ს ჯერჯერობით *არ* გააჩნია საჯარო "self-service"
// registration endpoint (განსხვავებით organizations.ts-ის ჩვეულებრივი
// კომპანიის რეგისტრაციისგან), განზრახ: ეს ანგარიში ყველა კომპანიაზე
// წვდომას იძლევა, ამიტომ მისი შექმნა infrastructure-დონის (CLI/DB)
// წვდომას მოითხოვს, არა HTTP-ს, თუნდაც authenticated.
//
// migrate.ts-ის იგივე კონვენცია: პირდაპირ `./db`-ს იყენებს (არა
// `index.ts`-ს), რომ Express სერვერი/Sentry სკრიპტის გაშვებისას არ
// ჩაირთოს.
async function createPlatformAdmin() {
  const [name, email, password] = process.argv.slice(2);

  if (!name || !email || !password) {
    console.error('გამოყენება: npm run create-platform-admin -- "სახელი" "email@example.com" "პაროლი"');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('❌ პაროლი უნდა შედგებოდეს მინიმუმ 8 სიმბოლოსგან!');
    process.exit(1);
  }

  const trimmedEmail = email.trim().toLowerCase();

  try {
    const existing = await pool.query('SELECT id FROM platform_admins WHERE LOWER(email) = $1', [trimmedEmail]);
    if (existing.rows.length > 0) {
      console.error(`❌ ამ email-ით ("${trimmedEmail}") Superadmin უკვე არსებობს.`);
      process.exit(1);
    }

    // 🔐 იგივე bcrypt cost factor (10), რასაც organizations.ts/auth.ts იყენებს.
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query<{ id: string }>(
      `INSERT INTO platform_admins (name, email, password_hash, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id`,
      [name.trim(), trimmedEmail, hashedPassword]
    );

    console.log(`✅ Superadmin შეიქმნა: ${trimmedEmail} (id: ${result.rows[0].id})`);
    console.log('   ახლა შეგიძლიათ შეხვიდეთ /admin გვერდზე ამ email-ითა და პაროლით.');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'უცნობი შეცდომა';
    console.error(`❌ შეცდომა: ${message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createPlatformAdmin();
