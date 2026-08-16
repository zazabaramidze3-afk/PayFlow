# ProjectPay — Roadmap

*განახლებულია: 2026-08-06*

Stack: Node.js / Express / TypeScript (backend), React + TS (frontend), PostgreSQL.

---

## ✅ დასრულებული ფიჩერები

### 1. Export Route Synchronization & Filtering
`GET /api/payments/export/excel` და `/pdf` ახლა იღებენ `from`, `to`, `cashierId` (და `productName`) query-პარამეტრებს — იგივე ფილტრაცია, რასაც Dashboard.tsx ხედავს ეკრანზე. საერთო `buildPaymentsFilterQuery()` helper `sales.ts`-ში იზიარება `/payments`, export/excel და export/pdf routes-ს შორის.

**შეხებული ფაილები:** `sales.ts`, `Dashboard.tsx` (`handleExport`).

### 2. Discount System (receipt-level)
`POST /payments` იღებს არასავალდებულო `discount: { type: 'percent' | 'fixed', value }`. Backend ვალიდაცია: percent 0–100%, fixed ≤ subtotal. ბაზაში დაემატა `subtotal_amount`, `discount_type`, `discount_value` სვეტები (`payments` table) + CHECK constraints. Dashboard.tsx-ს, export-ებს და Sales.tsx POS checkout-ს (calculator UI + "ჩემი ისტორია" ბეჯი) დაემატა შესაბამისი ასახვა.

**შეხებული ფაილები:** `migration_add_discount.sql`, `sales.ts`, `Dashboard.tsx`, `Sales.tsx`.

---

## 🔜 შემდეგი ეტაპები (პრიორიტეტის მიხედვით)

### 3. Payment Methods (Cash / Card / Mixed)
*გადავდეთ Discount-ის შემდეგ — შენ თვითონ ასე ითხოვე.*

- `payments` ცხრილს დაემატება `payment_method` სვეტი (`text`, CHECK `IN ('cash', 'card', 'mixed')`).
- Mixed-ის შემთხვევაში, სავარაუდოდ დასჭირდება ცალკე `payment_splits` ცხრილი ან `cash_amount`/`card_amount` სვეტები, თუ გინდა ორივე მეთოდით ნაწილობრივი გადახდის თანხების ცალ-ცალკე დაფიქსირება.
- `POST /payments` payload-ს დაემატება `payment_method` ველი (+ `mixed`-ისთვის თანხების split).
- Sales.tsx checkout-ში: radio/select ღილაკები Cash / Card / Mixed-ისთვის.
- Dashboard.tsx-ს დაემატება ფილტრი და/ან სვეტი payment method-ის მიხედვით.
- Z-Report (`/shifts/close`) ალბათ საჭიროებს გადახედვას — ამჟამად ვარაუდობს, რომ ყველა გაყიდვა ნაღდი ფულია (`SUM(total_amount)` ითვლის სალაროს მოსალოდნელ ნაშთს). Card/Mixed გაყიდვები არ უნდა შედიოდეს ნაღდი ფულის ინკასაციის ჯამში.

**გადასაწყვეტი კითხვა შემდეგ სესიაზე:** გინდა თუ არა, რომ Card-ით გადახდილი თანხა საერთოდ არ ჩაითვალოს "სალაროს ნაღდ ფულში" `/shifts/close`-ის დროს?

### 4. Visual Dashboard Charts & SQL Aggregation
- Recharts ან Chart.js ინტეგრაცია Dashboard.tsx-ში.
- Line Chart: დღიური გაყიდვების დინამიკა.
- Bar Chart: საათობრივი intensity (peak hours) — ცვლის ოპტიმიზაციისთვის.
- ბექენდზე ახალი endpoint(ები), მაგ. `GET /payments/analytics/daily`, `GET /payments/analytics/hourly` — SQL `SUM`/`COUNT`/`GROUP BY` აგრეგაციით, რომ მძიმე დამუშავება ბაზაზე მოხდეს და frontend-მა უკვე მზა JSON მიიღოს.
- Discount-ის ჩართვის შემდეგ, ღირს გადავწყვიტოთ: სქემები `total_amount`-ზე თუ `subtotal_amount`-ზე უნდა აგებულიყო (revenue vs gross sales).

### 5. Robust Concurrency & Error Handling
- `POST /payments`-ში `BEGIN`/`COMMIT`/`ROLLBACK` უკვე არსებობს — მაგრამ სჭირდება PostgreSQL-ის constraint violation-ების (მაგ. `chk_stock_positive`) descriptive 400 შეცდომად დაჭერა, 500 crash-ის ნაცვლად.
- გირჩევ დავამატოთ helper, რომელიც PG error code-ებს (`23514` CHECK violation, `23505` unique violation და ა.შ.) აქცევს ქართულ, გასაგებ შეტყობინებად.
- Load/concurrency ტესტი: ორი checkout ერთდროულად ერთსა და იმავე product-ზე, დარწმუნდე რომ `stock >= $1` WHERE-პირობა რეალურად იცავს race condition-ისგან (თეორიულად უკვე იცავს, მაგრამ ღირს გატესტვა).

### 6. Dockerization & Production Cloud Deployment
- `Dockerfile` frontend-ისთვის და backend-ისთვის ცალ-ცალკე.
- `docker-compose.yml` ლოკალური ტესტისთვის (backend + frontend + postgres).
- Render.com-ზე managed PostgreSQL provisioning.
- Production env ცვლადები: `DATABASE_URL`, `JWT_SECRET`, `VITE_API_URL`.
- Static site deploy frontend-ისთვის, `VITE_API_URL`-ით production backend-ზე მიმართვა.
- pgAdmin remote connection-ის უსაფრთხო კონფიგურაცია production DB-სთან.

### 7. SaaS Scale: Schema-per-Tenant Multi-Tenancy
- ყველაზე დიდი არქიტექტურული ცვლილება — ბოლოს, სხვა ყველაფრის სტაბილიზაციის შემდეგ.
- თითო tenant-ისთვის ცალკე PostgreSQL schema (ან connection routing middleware-ით).
- საჭირო იქნება: tenant identification (subdomain/JWT claim), dynamic `search_path` ან connection pool per schema, migration ტული, რომელიც ყველა tenant schema-ს ერთდროულად აახლებს.

---

## 📌 როგორ გავაგრძელოთ

შემდეგ სესიაზე უბრალოდ დამიწერე, მაგალითად:
- „გავაგრძელოთ roadmap-ის მე-3 პუნქტიდან — Payment Methods" — და პირდაპირ დავიწყებთ schema migration-ით.
- ან თუ სხვა პრიორიტეტი გაქვს (მაგ. ჯერ Charts გინდა Payment Methods-მდე), უბრალოდ თქვი და თანმიმდევრობას შევცვლით.

ეს დოკუმენტი agent-ის context-შიც შემინახავს (PAY FLOW PROJECT knowledge-ში), ასე რომ ახალ საუბარშიც შემიძლია სწრაფად გავერკვე, სად შევჩერდით.
