import bcrypt from 'bcrypt';
import pool from './db';

// ⚠️ ყურადღება — ეს ფაილი ხელით გასაშვები, დამატებითი სატესტო-სიდის (seed)
// სკრიპტია, არა სქემის წყარო.
//
// Production-Ready Migration განახლების შემდეგ (Roadmap ეტაპი 1.5.1),
// ცხრილების სტრუქტურის ერთადერთი წყარო აღარ არის კოდი — ის არის
// backend/migrations/*.sql ფაილები. ახალ/ცარიელ ბაზაზე ჯერ გაუშვით:
//   npm run migrate
// (ან migrations/001, 002, 003... ხელით, pgAdmin-ში), და მხოლოდ მერე
// გაუშვით index.ts (რომელიც აღარ ქმნის ცხრილებს — მხოლოდ დეფოლტ
// admin/manager/cashier იუზერებს ამატებს).
//
// ეს ფაილი დატოვეთ მხოლოდ დამატებითი სატესტო პროდუქტების/მოლარეების
// ჩასატვირთად, საჭიროებისამებრ — სქემა ქვემოთ უნდა ემთხვეოდეს
// migrations/001_init_schema.sql-ს (products.stock პირდაპირ, არა
// ცალკე stocks ცხრილი; payment_items.price, არა unit_price; users.name
// UNIQUE, არა email).

async function seedMockData() {
  console.log('Seeding additional mock data into existing schema...');

  const hashedPassword = await bcrypt.hash('1234', 10);

  // სატესტო მოლარეები (name არის UNIQUE რეალურ სქემაში — არა email)
  await pool.query(
    `INSERT INTO users (name, password_hash, role, status)
     VALUES ($1, $2, 'cashier', 'active')
     ON CONFLICT (name) DO NOTHING`,
    ['გიორგი კაპანაძე', hashedPassword]
  );
  await pool.query(
    `INSERT INTO users (name, password_hash, role, status)
     VALUES ($1, $2, 'cashier', 'active')
     ON CONFLICT (name) DO NOTHING`,
    ['ანი მეგრელიშვილი', hashedPassword]
  );

  // სატესტო პროდუქტები (stock პირდაპირ products ცხრილშია, არა ცალკე stocks-ში)
  await pool.query(
    `INSERT INTO products (barcode, name, price, stock)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO NOTHING`,
    ['SKU-001', 'ყავა არაბიკა', 15.50, 150]
  );
  await pool.query(
    `INSERT INTO products (barcode, name, price, stock)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO NOTHING`,
    ['SKU-002', 'შოკოლადი', 4.20, 80]
  );

  console.log('Mock data seeded successfully!');

  await pool.end();
  console.log('Database connection closed.');
}

seedMockData().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
