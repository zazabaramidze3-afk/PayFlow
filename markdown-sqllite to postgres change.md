# 🗺️ ProjectPay — SQLite-დან PostgreSQL-ზე მიგრაციის გეგმა (Migration Roadmap)

ეს დოკუმენტი წარმოადგენს დეტალურ ტექნიკურ ინსტრუქციას, თუ როგორ უნდა გადავიყვანოთ ProjectPay სისტემა SQLite ფაილური ბაზიდან წარმოების დონის (Production-Ready) PostgreSQL არქიტექტურაზე მულტი-კომპანიური (SaaS Multi-Tenancy) მხარდაჭერით.

---

## 🏗️ 1. არქიტექტურული მოდელის არჩევა (SaaS Architecture)

კომპანიების იზოლაციისთვის PostgreSQL-ში ვირჩევთ **Schema-per-Tenant** (ვარიანტი ა) მოდელს:
*   **ცენტრალური სქემა (`public`)**: ინახავს გლობალურ მონაცემებს (კომპანიების სია, ბილინგი, სერვერის პარამეტრები).
*   **კომპანიის პირადი სქემები (`company_spar`, `company_gorgia`)**: თითოეულ ახალ კლიენტს (მარკეტს) ბაზაში ავტომატურად უფესდება თავისი იზოლირებული "საქაღალდე" (Schema), სადაც იქმნება იდენტური ცხრილები (`users`, `products`, `sales`, `shifts`).

---

## 🛠️ 2. მოსამზადებელი ეტაპი (Dependencies & Config)

### ა) ახალი პაკეტების ინსტალაცია ბექენდში
ტერმინალში უნდა წაიშალოს `sqlite3` და დაინსტალირდეს PostgreSQL დრაივერი:
```bash
npm uninstall sqlite3
npm install pg
npm install @types/pg --save-dev
```

### ბ) გარემოს ცვლადების განახლება (`backend/.env`)
კავშირის ლოკალური ფაილის ნაცვლად, ვამატებთ PostgreSQL-ის სერვერის მისამართს:
```env
PORT=5000
JWT_SECRET=თქვენი_საიდუმლო_კოდი
DATABASE_URL=postgres://pp_user:strong_password@localhost:5432/projectpay_db
```

### გ) ბაზის კავშირის ფაილის შექმნა (`backend/src/config/database.ts`)
```typescript
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // მაქსიმალური პარალელური კავშირები
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

---

## 🗄️ 3. მონაცემთა ბაზის სქემის კონვერტაცია (DDL)

SQL სინტაქსის ძირითადი ცვლილებები SQLite-დან Postgres-ზე გადასვლისას:


| პარამეტრი | SQLite სინტაქსი | PostgreSQL სინტაქსი |
| :--- | :--- | :--- |
| **ავტომატური ID** | `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| **ლოგიკური ტიპი** | `INTEGER` (1 ან 0) | `BOOLEAN` (`TRUE` ან `FALSE`) |
| **თარიღის ტიპი** | `TEXT` | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` |

### 📝 ახალი გლობალური სქემის ინიციალიზაცია (`public`)
```sql
-- კომპანიების რეესტრი (მხოლოდ საჯარო სქემაში)
CREATE TABLE public.companies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL, -- მაგ. 'spar', 'gorgia'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 📝 შაბლონური სქემის სტრუქტურა თითოეული ობიექტისთვის
```sql
-- ეს სკრიპტი გაეშვება დინამიურად ყოველი ახალი კომპანიის შექმნისას
CREATE TABLE %SCHEMA_NAME%.users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) CHECK (role IN ('admin', 'manager', 'cashier')) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE %SCHEMA_NAME%.products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    barcode VARCHAR(100) UNIQUE NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    stock INT NOT NULL DEFAULT 0
);

CREATE TABLE %SCHEMA_NAME%.payments (
    id SERIAL PRIMARY KEY,
    cashier_id INT REFERENCES %SCHEMA_NAME%.users(id),
    total_amount NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🖥️ 4. ბექენდის კოდის მოდიფიკაცია (Code Changes)

### ა) დინამიური Tenant მიდლვეარი (`backend/src/middleware/tenantHandler.ts`)
ეს მიდლვეარი ფრონტენდიდან (ჰედერიდან ან დომენიდან) ამოიკითხავს კომპანიის სახელს და ავტომატურად გადართავს Postgres-ს შესაბამის სქემაზე.

```typescript
import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';

export interface TenantRequest extends Request {
  tenantSchema?: string;
}

export const tenantHandler = async (req: TenantRequest, res: Response, next: NextFunction) => {
  // ფრონტენდი Axios Interceptor-ით გამოაგზავნის ჰედერს: X-Company-Slug
  const companySlug = req.headers['x-company-slug'] as string;

  if (!companySlug) {
    return res.status(400).json({ error: "კომპანიის იდენტიფიკატორი (Slug) არასწორია" });
  }

  const schemaName = `company_${companySlug.toLowerCase()}`;
  req.tenantSchema = schemaName;

  try {
    // უსაფრთხო გადართვა კონკრეტული კომპანიის ძებნის არეალზე (Search Path)
    await pool.query(`SET search_path TO ${schemaName}`);
    next();
  } catch (error) {
    res.status(500).json({ error: "კომპანიის სქემასთან დაკავშირება ვერ მოხერხდა" });
  }
};
```
*ეს მიდლვეარი უნდა ჩააშენოთ გლობალურად `app.use(tenantHandler)` ყველა ბიზნეს-როუტამდე (გარდა გლობალური ლოგინისა).*

### ბ) SQL მოთხოვნების სინტაქსის კორექტირება
ყველა ფაილში (`products.ts`, `sales.ts`, `users.ts`), სადაც ხელით გიწერიათ SQL, კითხვის ნიშნები `?` უნდა შეიცვალოს ნომრიანი არგუმენტებით `$1, $2...`.

**მაგალითი (პროდუქტის ძებნა ბარკოდით):**
*   *იყო (SQLite):*
    ```typescript
    db.get('SELECT * FROM products WHERE barcode = ?', [barcode], ...)
    ```
*   *გახდა (PostgreSQL):*
    ```typescript
    const result = await pool.query('SELECT * FROM products WHERE barcode = \$1', [barcode]);
    const product = result.rows[0];
    ```

**მაგალითი (Dashboard-ის ანალიტიკა — თარიღების ფორმატი):**
*   *იყო (SQLite):* `strftime('%Y-%m-%d', created_at)`
*   *გახდა (PostgreSQL):* `to_char(created_at, 'YYYY-MM-DD')` ან `created_at::date`

---

## ⚛️ 5. ფრონტენდის ცვლილებები (Axios Interceptor)

React აპლიკაციაში კოდის ლოგიკა უცვლელი რჩება. იცვლება მხოლოდ `Axios Interceptor`, რომელიც ავტორიზაციის ტოკენთან ერთად, ყოველ HTTP მოთხოვნას ავტომატურად დააყოლებს კომპანიის იდენტიფიკატორს.

```typescript
// frontend/src/api/axiosConfig.ts
import axios from 'axios';

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
});

API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  const companySlug = localStorage.getItem('companySlug'); // ინახება ლოგინის დროს

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  if (companySlug) {
    config.headers['X-Company-Slug'] = companySlug; // ბექენდის მიდლვეარისთვის
  }

  return config;
});

export default API;
```

---

## 📈 6. მიგრაციის პროცედურა (Live Migration Steps)

1.  **სერვერის მომზადება**: Ubuntu VPS-ზე PostgreSQL სერვერის დაყენება და ახალი ცარიელი ბაზის შექმნა.
2.  **სტრუქტურის გადატანა**: `public` სქემის და პირველი კლიენტების სატესტო სქემების შექმნა (DDL სკრიპტით).
3.  **მონაცემთა კონვერტაცია**: ძველი ლოკალური `database.sqlite` ფაილიდან მონაცემების ექსპორტი (JSON ან CSV სახით) და მათი იმპორტი შესაბამის Postgres სქემაში სპეციალური Node.js ერთჯერადი სკრიპტით.
4.  **ბექენდის გადართვა**: `.env` ფაილში `DATABASE_URL`-ისთვის Postgres-ის მისამართის გაწერა და PM2 პროცესის გადატვირთვა (`pm2 restart all`).


🗄️ 4. მონაცემთა ბაზის სქემა (Current SQLite Schema)

👥 1. users (მომხმარებლები)
id: INTEGER PRIMARY KEY AUTOINCREMENT
username: TEXT UNIQUE NOT NULL
password_hash: TEXT NOT NULL (Bcrypt-ით ჰეშირებული)
role: TEXT NOT NULL ('Admin', 'Manager', 'Cashier')

📦 2. products (პროდუქტები)
id: INTEGER PRIMARY KEY AUTOINCREMENT
sku: TEXT UNIQUE NOT NULL (შტრიხკოდი)
title: TEXT NOT NULL
quantity: INTEGER NOT NULL DEFAULT 0
price: REAL NOT NULL

🧾 3. transactions (გაყიდვები)
id: INTEGER PRIMARY KEY AUTOINCREMENT
user_id: INTEGER FOREIGN KEY REFERENCES users(id)
total_amount: REAL NOT NULL
payment_method: TEXT NOT NULL DEFAULT 'Cash' (ეტაპი 2-ისთვის)
created_at: DATETIME DEFAULT CURRENT_TIMESTAMP

