import fs from 'fs';
import path from 'path';
import pool from './db';

// ==========================================
// მიგრაციების გამშვები სკრიპტი
// ==========================================
// გაშვება: npm run migrate  (backend/ ფოლდერიდან)
//
// თანმიმდევრობით უშვებს backend/migrations/-ში არსებულ ყველა
// .sql ფაილს ფაილის სახელით დალაგებული (001, 002, 003...).
// გამოსადეგია ახალი environment-ის (staging/CI/CD) ერთბაშად
// გასამართად, ან production-ზე ხელით გასაშვები ფაილების
// თანმიმდევრობის დასაცავად.
//
// ⚠️ 001 და 003 სრულად უსაფრთხოა განმეორებით გაშვებისთვისაც
// (IF NOT EXISTS ყველგან). 002 კი უკვე ერთხელ გაშვებულია
// production-ზე — თუ იქ ხელახლა გაუშვებთ, "constraint already
// exists" ტიპის შეცდომას ნახავთ კონკრეტულ ცალკეულ ბლოკზე; ეს
// მოსალოდნელია და არ აჩერებს დანარჩენი ფაილების გაშვებას.
async function runMigrations() {
  const migrationsDir = path.resolve(__dirname, '../migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  console.log(`ნაპოვნია ${files.length} მიგრაციის ფაილი: ${files.join(', ')}`);

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');
    console.log(`\n▶ ვუშვებ: ${file} ...`);

    try {
      await pool.query(sql);
      console.log(`✅ წარმატებით შესრულდა: ${file}`);
    } catch (err: any) {
      console.error(`❌ შეცდომა ${file}-ში: ${err.message}`);
      console.error(
        '   (თუ ეს მიგრაცია უკვე გაშვებულია production-ზე, ეს მოსალოდნელია — საჭიროების შემთხვევაში გადაამოწმეთ pgAdmin-ში)'
      );
    }
  }

  await pool.end();
  console.log('\nმიგრაციები დასრულდა.');
}

runMigrations().catch((err) => {
  console.error('მიგრაციის გაშვება ჩავარდა:', err);
  process.exit(1);
});
