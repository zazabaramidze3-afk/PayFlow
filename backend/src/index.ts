import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';

// მარშრუტების (Routes) შემოტანა
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import salesRoutes from './routes/sales';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL კავშირის უსაფრთხო ინიციალიზაცია Neon-ისთვის
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: true // Neon-ის ოფიციალური სტანდარტი Vercel-ზე მუშაობისთვის
});


// სხვა ფაილებისთვის თავსებადობის შესანარჩუნებლად (ექსპორტი db სახელით)
export const db = pool;

// ==========================================
//  ავტომატური ბაზის და ცხრილების შექმნა
// ==========================================
const initDB = async () => {
  console.log('ავტომატური ბაზის და ცხრილების შექმნა PostgreSQL-ში...');
  try {
    // 1. მომხმარებლები
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, 
        name TEXT NOT NULL UNIQUE, 
        password_hash TEXT NOT NULL, 
        role TEXT NOT NULL DEFAULT 'cashier', 
        status TEXT NOT NULL DEFAULT 'active'
      )
    `);
    
    // 2. 🔄 დღიური ცვლები
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shifts (
        id SERIAL PRIMARY KEY, 
        cashier_id INTEGER NOT NULL, 
        status TEXT CHECK(status IN ('open', 'closed')) DEFAULT 'open', 
        opened_at TEXT DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')), 
        start_amount REAL NOT NULL, 
        closed_at TEXT, 
        end_amount_expected REAL, 
        end_amount_actual REAL, 
        difference REAL, 
        FOREIGN KEY(cashier_id) REFERENCES users(id)
      )
    `);
    
    // 3. პროდუქტები
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY, 
        barcode TEXT UNIQUE, 
        name TEXT NOT NULL UNIQUE, 
        price REAL NOT NULL, 
        stock INTEGER NOT NULL DEFAULT 0
      )
    `);
    
    // 4. გადახდები (payments)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY, 
        cashier_id INTEGER, 
        shift_id INTEGER, 
        total_amount REAL NOT NULL, 
        created_at TEXT DEFAULT (TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')), 
        FOREIGN KEY(cashier_id) REFERENCES users(id), 
        FOREIGN KEY(shift_id) REFERENCES shifts(id)
      )
    `);
    
    // 5. გადახდის დეტალები
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_items (
        id SERIAL PRIMARY KEY, 
        payment_id INTEGER, 
        product_id INTEGER, 
        quantity INTEGER NOT NULL, 
        price REAL NOT NULL
      )
    `);

    // საწყისი მომხმარებლების შექმნა (თუ არ არსებობენ)
    const defaultHash = await bcrypt.hash('1234', 10);
    
    await pool.query(`
      INSERT INTO users (name, password_hash, role, status) 
      VALUES ('admin', $1, 'admin', 'active') 
      ON CONFLICT (name) DO NOTHING
    `, [defaultHash]);
    
    await pool.query(`
      INSERT INTO users (name, password_hash, role, status) 
      VALUES ('manager', $1, 'manager', 'active') 
      ON CONFLICT (name) DO NOTHING
    `, [defaultHash]);
    
    await pool.query(`
      INSERT INTO users (name, password_hash, role, status) 
      VALUES ('cashier', $1, 'cashier', 'active') 
      ON CONFLICT (name) DO NOTHING
    `, [defaultHash]);

    console.log('PostgreSQL ბაზა და ცხრილები წარმატებით მომზადდა.');
  } catch (err) {
    console.error('საწყისი ბაზის მომზადების შეცდომა:', err);
  }
};

// ბაზის გაშვება
initDB();

// ==========================================
//  🔗 მარშრუტების ინტეგრაცია (Middleware)
// ==========================================
app.use('/api', authRoutes);
app.use('/api', productRoutes);
app.use('/api', salesRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 ბექენდ სერვერი წარმატებით ჩაირთო პორტზე ${PORT}`));
export default app;
