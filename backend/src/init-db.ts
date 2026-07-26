import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import bcrypt from 'bcrypt';

const dbPath = path.resolve(__dirname, '../database.sqlite');

async function initializeDatabase() {
  console.log('Connecting to SQLite database...');
  
  // ვხსნით ბაზას Promise-ზე დაფუძნებული Wrapper-ით
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // ⚡ WAL რეჟიმის აქტივაცია პარალელური მოთხოვნების (Concurrent Writes) ოპტიმიზაციისთვის
  await db.run('PRAGMA journal_mode = WAL;');
  await db.run('PRAGMA synchronous = NORMAL;');
  await db.run('PRAGMA foreign_keys = ON;'); // უზრუნველყოფს კავშირების (Foreign Keys) დაცვას

  console.log('Initializing tables...');

    // 1. მომხმარებლების ცხრილი
  await db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'cashier',
      status TEXT DEFAULT 'active' -- 👈 დაამატეთ ეს ხაზი
    )
  `);


  // 2. პროდუქტების ცხრილი
  await db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL
    )
  `);

  // 3. მარაგების ცხრილი
  await db.run(`
    CREATE TABLE IF NOT EXISTS stocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER UNIQUE,
      quantity INTEGER NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    )
  `);

  // 4. გადახდების ცხრილი
  await db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cashier_id INTEGER,
      total_amount REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(cashier_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // 5. გადახდების დეტალები
  await db.run(`
    CREATE TABLE IF NOT EXISTS payment_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER,
      product_id INTEGER,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      FOREIGN KEY(payment_id) REFERENCES payments(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
    )
  `);

  console.log('Seeding secure mock data...');

  // ვაჰეშირებთ საწყის პაროლს '1234'
  const hashedPassword = await bcrypt.hash('1234', 10);

  // სატესტო იუზერები
  await db.run(
    `INSERT OR IGNORE INTO users (id, name, email, password_hash, role) VALUES (1, 'გიორგი კაპანაძე', 'gio@pay.ge', ?, 'cashier')`,
    [hashedPassword]
  );
  await db.run(
    `INSERT OR IGNORE INTO users (id, name, email, password_hash, role) VALUES (2, 'ანი მეგრელიშვილი', 'ani@pay.ge', ?, 'cashier')`,
    [hashedPassword]
  );
  
  // სატესტო პროდუქტები
  await db.run(`INSERT OR IGNORE INTO products (id, sku, name, price) VALUES (1, 'SKU-001', 'ყავა არაბიკა', 15.50)`);
  await db.run(`INSERT OR IGNORE INTO products (id, sku, name, price) VALUES (2, 'SKU-002', 'შოკოლადი', 4.20)`);
  
  // სატესტო მარაგები
  await db.run(`INSERT OR IGNORE INTO stocks (product_id, quantity) VALUES (1, 150)`);
  await db.run(`INSERT OR IGNORE INTO stocks (product_id, quantity) VALUES (2, 80)`);

  // სატესტო გაყიდვები
  await db.run(`INSERT OR IGNORE INTO payments (id, cashier_id, total_amount) VALUES (1, 1, 19.70)`);
  await db.run(`INSERT OR IGNORE INTO payment_items (payment_id, product_id, quantity, unit_price) VALUES (1, 1, 1, 15.50)`);
  await db.run(`INSERT OR IGNORE INTO payment_items (payment_id, product_id, quantity, unit_price) VALUES (1, 2, 1, 4.20)`);

  console.log('Database initialized successfully with secure mock data!');
  
  // ბაზის კავშირის უსაფრთხო დახურვა
  await db.close();
  console.log('Database connection closed.');
}

// გაშვება ერორების სწორი ქენდლინგით
initializeDatabase().catch((error) => {
  console.error('Database initialization failed:', error);
});
