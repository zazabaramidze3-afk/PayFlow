import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import path from 'path';
import bcrypt from 'bcrypt';

// მარშრუტების (Routes) შემოტანა
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import salesRoutes from './routes/sales';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// SQLite კავშირი სერვერის საწყისი ინიციალიზაციისთვის
const dbPath = path.resolve(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath);

// ==========================================
//  ავტომატური ბაზის და ცხრილების შექმნა
// ==========================================
// ==========================================
//  ავტომატური ბაზის და ცხრილების შექმნა
// ==========================================
db.serialize(async () => {
  console.log('ავტომატური ბაზის და ცხრილების შექმნა...');
  
  // 1. მომხმარებლები
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'cashier', status TEXT NOT NULL DEFAULT 'active')`);
  
  // 2. 🔄 დღიური ცვლები (ეს ხაზი აუცილებელია ახალი ბაზისთვის!)
  db.run(`CREATE TABLE IF NOT EXISTS shifts (id INTEGER PRIMARY KEY AUTOINCREMENT, cashier_id INTEGER NOT NULL, status TEXT CHECK(status IN ('open', 'closed')) DEFAULT 'open', opened_at TEXT DEFAULT (STRFTIME('%Y-%m-%d %H:%M:%S', 'now', 'localtime')), start_amount REAL NOT NULL, closed_at TEXT, end_amount_expected REAL, end_amount_actual REAL, difference REAL, FOREIGN KEY(cashier_id) REFERENCES users(id))`);
  
  // 3. პროდუქტები
  db.run(`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, barcode TEXT UNIQUE, name TEXT NOT NULL UNIQUE, price REAL NOT NULL, stock INTEGER NOT NULL DEFAULT 0)`);
  
  // 4. გადახდები (payments)
  db.run(`CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, cashier_id INTEGER, shift_id INTEGER, total_amount REAL NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(cashier_id) REFERENCES users(id), FOREIGN KEY(shift_id) REFERENCES shifts(id))`);
  
  // 5. გადახდის დეტალები
  db.run(`CREATE TABLE IF NOT EXISTS payment_items (id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER, product_id INTEGER, quantity INTEGER NOT NULL, price REAL NOT NULL)`);

  try {
    const defaultHash = await bcrypt.hash('1234', 10);
    db.run(`INSERT OR IGNORE INTO users (name, password_hash, role, status) VALUES ('admin', ?, 'admin', 'active')`, [defaultHash]);
    db.run(`INSERT OR IGNORE INTO users (name, password_hash, role, status) VALUES ('manager', ?, 'manager', 'active')`, [defaultHash]);
    db.run(`INSERT OR IGNORE INTO users (name, password_hash, role, status) VALUES ('cashier', ?, 'cashier', 'active')`, [defaultHash]);
  } catch (err) {
    console.error('საწყისი მომხმარებლების შექმნის შეცდომა:', err);
  }
});


// ==========================================
//  🔗 მარშრუტების ინტეგრაცია (Middleware)
// ==========================================
app.use('/api', authRoutes);
app.use('/api', productRoutes);
app.use('/api', salesRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 ბექენდ სერვერი წარმატებით ჩაირთო პორტზე ${PORT}`));
