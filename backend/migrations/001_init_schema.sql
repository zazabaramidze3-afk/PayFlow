-- ==========================================
-- Migration 001: Baseline Schema
-- ==========================================
-- საბაზისო ცხრილები: users, shifts, products, payments, payment_items.
-- ეს ფაილი ცვლის index.ts-ის ძველ initDB()-ის ავტომატურ
-- CREATE TABLE IF NOT EXISTS ლოგიკას — ბაზის სტრუქტურის ერთადერთი
-- წყარო ახლა ეს migrations/ ფოლდერია.
--
-- გაუშვით ეს ფაილი ახალ (ცარიელ) DB-ზე pgAdmin-ში/psql-ით, ან
-- `npm run migrate`-ით (იხ. src/migrate.ts). არსებულ, უკვე
-- დაყენებულ production DB-ზეც უსაფრთხოა გაშვება — ყველგან
-- IF NOT EXISTS-ია, ამიტომ უკვე არსებულ ცხრილებს არაფერს
-- გაუკეთებს.
--
-- შემდეგი მიგრაციები (თანმიმდევრობით გასაშვები):
--   002_add_discount_system.sql — payments.discount_* + users.can_use_discount
--   003_add_audit_logs.sql      — audit_logs ცხრილი
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier',
  status TEXT NOT NULL DEFAULT 'active',
  can_view_history BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at TEXT DEFAULT TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'),
  start_amount REAL NOT NULL,
  closed_at TEXT,
  end_amount_expected REAL,
  end_amount_actual REAL,
  difference REAL
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL UNIQUE,
  price REAL NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT chk_barcode_positive_v2 CHECK (barcode !~ '-'),
  CONSTRAINT chk_price_positive CHECK (price > 0),
  CONSTRAINT chk_stock_positive CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  cashier_id INTEGER REFERENCES users(id),
  shift_id INTEGER REFERENCES shifts(id),
  total_amount REAL NOT NULL,
  created_at TEXT DEFAULT TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS payment_items (
  id SERIAL PRIMARY KEY,
  payment_id INTEGER,
  product_id INTEGER,
  quantity INTEGER NOT NULL,
  price REAL NOT NULL
);

COMMIT;
