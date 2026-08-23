PayFlow — STEP 2-ის პირველი ეტაპის ანგარიში (read-only, დაბალი-რისკის route-review) — 23.08.2026-ის სესიის მიხედვით.

### წყარო და კონტექსტი
წინა დოკუმენტი — `ROADMAP - Multi-Tenant SaaS - 19.08.2026.md` — ადასტურებდა STEP 1-ის დასრულებას (`organizations` ცხრილი, migration 013, `organization_id` backfill 8 ცხრილზე), მაგრამ commit `35a1bf1` მხოლოდ `feat/pwa-icons-and-tenant-isolation-tests` branch-ზეა — **jერ არ არის main-თან დამერჯილი, production-ზეც არაა**. ეს სესია STEP 2-ს იწყებს — route-ების გადასინჯვას, roadmap-ის ("16.08.2026", ცვლილება #4) რისკის-ზრდადობის თანმიმდევრობით: ჯერ read-only/დაბალი-რისკის route-ები, ბოლოს write-heavy/ფინანსური.

---

## ✅ დასრულებულია — STEP 2, ტიერი 1: Read-Only, დაბალი რისკი

### 🔧 წინაპირობა — JWT/CustomRequest-ს დაემატა `organizationId`

STEP 1-ის შემდეგაც JWT token-ი (POST `/login`) მხოლოდ `{ id, username, role }`-ს შეიცავდა — `organization_id` არცერთ route-ში არ იყო ხელმისაწვდომი (types.ts-ის STEP 1-ის კომენტარი ამას ცალსახად აღნიშნავდა). გასწორდა `backend/src/routes/auth.ts`-ში:

- `CustomRequest.user` ტიპს დაემატა `organizationId: string`.
- POST `/login`-ის SELECT query-ს და `jwt.sign`-ს დაემატა `organization_id`/`organizationId`.
- POST `/auth/reset-password-initial`-ის ეკვივალენტურ login-ტოკენს იგივე ცვლილება.

ამის გარეშე STEP 2-ის route-scoping ფიზიკურად შეუძლებელი იყო — ყველა ქვემოთა ცვლილება ამაზეა დამოკიდებული.

### გადასინჯული endpoint-ები (`WHERE organization_id = $N` დაემატა)

| ფაილი | Endpoint | შენიშვნა |
|---|---|---|
| `auth.ts` | `GET /users` | `req: CustomRequest` აკლდა — დამატებულია |
| `auth.ts` | `GET /audit-logs` | |
| `auth.ts` | `DELETE /audit-logs` | ტექნიკურად destructive, არა "read-only" — მაინც შესწორდა GET-თან ერთად (იხ. ქვემოთ "ტიერის გარეთ") |
| `audit-logs.ts` | `GET /audit-logs/export` (CSV) | |
| `dashboard.ts` | `GET /dashboard/stats` | 5 query — today/activeShifts/paymentBreakdown/voided/topProducts/dailyTrend. `dailyTrend`-ის `LEFT JOIN`-ში ფილტრი `ON`-კლაუზაშია (არა `WHERE`), რომ ნულოვან-გაყიდვის დღეები არ დაიკარგოს |
| `products.ts` | `GET /products` | |
| `products.ts` | `GET /products/barcode/:barcode` | migration 013-ის შემდეგ ბარკოდი per-org უნიკალურია, არა გლობალურად |
| `products.ts` | `GET /products/export/excel` | |
| `products.ts` | `GET /products/export/pdf` | |

### ტიერის გარეთ, მაგრამ ამავე სესიაში გასწორებული (დისციპლინის დარღვევის გააზრებული გამონაკლისი)

- **`DELETE /audit-logs`** — destructive, არა read-only, მაგრამ `GET /audit-logs`-ის გვერდით ნახევრად-scoped მდგომარეობა აზრს იყო მოკლებული: ერთი org-ის ადმინს შეეძლო **ყველა** org-ის აუდიტ-ისტორიის წაშლა. ერთ-ხაზიანი fix, იგივე ფაილი/სესია.
- **`POST /auth/verify-manager-pin`** (`auth.ts`) — მენეჯერების ძებნის query (`WHERE role = 'manager' AND manager_pin IS NOT NULL`) **არცერთ org-ზე არ იყო შეზღუდული** — ნებისმიერი org-ის მოლარეს შეეძლო ნებისმიერი სხვა org-ის მენეჯერის PIN-ით override-ის მიღება. ავთენტიფიკაციის query-ია (არა read-only route ტექნიკური გაგებით), მაგრამ სერიოზული cross-tenant ხარვეზია, აღმოჩენილია იმავე auth.ts-ის revizia-ს დროს — გასწორდა `AND organization_id = $1`-ით.

### STEP 2.3 ტესტების ჩონჩხი — შევსებული

`backend/tests/isolation/tenant-isolation.test.ts`:
- `GET /api/users` და `GET /api/products` ტესტები (ადრე უკვე დაწერილი, მაგრამ STEP 2-მდე წითელი) — ახლა **მწვანეა**.
- ახალი ბლოკი: `GET /api/audit-logs` — org-scoping, ორივე მიმართულებით (Org A/Org B). ახალი helper `seedAuditLogEntry` (`seed.ts`) და `cleanupIsolationTestData`-ს დამატებული cleanup-ნაბიჯი (audit_logs → products → users FK-მიმართულებით).
- `GET /api/dashboard/stats`-ის it.todo **განზრახ დარჩა todo** — route თავად უკვე org-scoped-ია, მაგრამ სრულფასოვანი ტესტი registers/shifts/payments-ის FK-ჯაჭვის seed-ს საჭიროებს, რომელიც STEP 2-ის write-heavy (sales.ts) ეტაპზეა აშენებული.

**შედეგი:** `TEST_DATABASE_URL`+`TEST_API_URL`-ით ლოკალურად გაშვებულ Postgres 16-ზე (ყველა migration 001–013) — **8/8 აქტიური ტესტი მწვანეა**, 7 კვლავ `it.todo` (განზრახ, STEP 2-ის შემდეგი ტიერებისთვის).

---

## 🧪 დადასტურება (ეს სესია)

1. **`tsc --noEmit`** — სუფთაა (ცალკე დამოუკიდებელ environment-ში აწყობილი, სრული dependency ნაკრებით).
2. **Migration 001–013** — ცალ-ცალკე გაშვებული სუფთა Postgres 16-ზე, შეცდომის გარეშე (დამატებითი დადასტურება, რომ migration 013 თავისთავად სწორია).
3. **`vitest run tests/isolation`** — რეალურად აწყობილი backend + Postgres-ის წინააღმდეგ: 8/8 აქტიური ტესტი მწვანე.
4. **ხელით smoke-შემოწმება** (რეალური admin token-ით, ცალკე ბაზაზე): `GET /dashboard/stats`, `GET /products/export/excel`, `GET /products/export/pdf` (Sylfaen ფონტით), `GET /audit-logs/export`, `POST /auth/verify-manager-pin` — ყველა სწორად პასუხობს, სერვერი არ იშლება.

---

## ⚠️ STEP 2-ის დარჩენილი, ჯერ **არ**-scoped ნაწილი

**Read-only, jერ არ გადასინჯული:**
- `GET /api/notifications/stock-deficits` (`notifications.ts`)
- `GET /api/registers` (`registers.ts`)
- `GET /api/shifts/history`, `GET /api/payments` (`sales.ts`)

**Write-heavy — ყველაზე მაღალი პრიორიტეტი შემდეგი სესიისთვის, roadmap-ის ("16.08.2026" ცვლილება #4) მიხედვით ბოლოს დაგეგმილი, მაგრამ ერთი კონკრეტული პუნქტი უფრო სასწრაფოა ვიდრე დანარჩენი:**

- **`POST /users` და `POST /products`** (და სავარაუდოდ `registers.ts`/`sales.ts`-ის ანალოგიური INSERT-ები) **ამჟამად INSERT-ს აკეთებენ `organization_id`-ის გარეშე.** Migration 013-ის შემდეგ ეს სვეტი NOT NULL-ია — ანუ STEP 1-ის merge-ის შემდეგ ეს endpoint-ები **500 შეცდომით ჩავარდება** (არა მხოლოდ tenant-leak რისკი, არამედ funkცional crash). ეს არ არის "დაბალი რისკის read-only" კატეგორია, მაგრამ functional blocker-ია STEP 1-ის production-ზე გასვლისთვის — რეკომენდებულია STEP 2-ის write-heavy ტიერის **პირველი** პუნქტი იყოს (არა ბოლო), რადგან ის STEP 1-ის merge-ის უშუალო წინაპირობაა.
- `POST/PUT/PATCH/DELETE /products/*`, `PUT/DELETE /users/*` — ჯერ არ scoped.
- `sales.ts` (90KB+, roadmap-ის ცვლილება #1-ის მიხედვით "მაღალი მოცულობის, მაღალი ფხიზლობის" ფაილი) — მთლიანად შეხებული არ არის. STEP 2.2 (RLS) ჯერ არ დაწყებულა.

---

## 🔧 გვერდითი აღმოჩენა — stale `.git/index.lock`

სესიის განმავლობაში repo-ში დარჩა `.git/index.lock` (ალბათ ჩემი პარალელური `git status` გამოძახებების კოლიზიით). device-bridge-ის sandbox-მა ამ ფაილის წაშლა არ დამრთო (delete-permission საჭიროებს ცალკე დადასტურებას, რომელიც ამ სესიაში ვერ მოვითხოვე). **თუ VS Code-დან git add/commit "another git process is running"-ს გიჩვენებთ — წაშალეთ ეს ფაილი ხელით** (`PayFlow/.git/index.lock`, 0 ბაიტიანი).

**Commit არ გაკეთებულა** — ცვლილებები დისკზეა (6 ფაილი, იხ. ცხრილი ზემოთ), მაგრამ `git add`/`commit` არ შესრულებულა (მხოლოდ მოთხოვნაზე ვაკეთებ commit-ს). ასევე გაითვალისწინეთ, რომ `git status`-ში ჩანს **დიდი რაოდენობის line-ending (CRLF/LF) noise** 26+ ფაილზე — ეს ჩემი ცვლილება არაა (`git diff -w` ადასტურებს, რომ ამ ფაილებში რეალური კონტენტი უცვლელია), სავარაუდოდ `core.autocrlf`-ის არარსებობა Windows-ზე. Commit-ის გაკეთებისას ეს ფაილები ცალკე უნდა გამოირიცხოს (მხოლოდ ჩემ მიერ რეალურად შეცვლილი 6 ფაილის `git add`).

---

## განახლებული პრიორიტეტების რიგი

1. ~~STEP 0, STEP 1~~ ✅ დასრულებული (feature branch-ზე, jერ არ production-ზე)
2. ~~STEP 2, ტიერი 1 (read-only)~~ ✅ **დასრულებული და ტესტირებული (23.08, ეს სესია)** — dashboard.ts, products.ts GET-ები, auth.ts GET/DELETE `/audit-logs`, GET `/users`, audit-logs.ts export + bonus fix (`verify-manager-pin`)
3. **STEP 2, ტიერი 2 (write-blocker, სასწრაფო)** — `POST /users`/`POST /products`-ს `organization_id` დაემატოს INSERT-ში, თორემ STEP 1-ის merge production-ს crash-ს გაუკეთებს ამ ორ endpoint-ზე
4. **STEP 2, ტიერი 3 (დანარჩენი read-only)** — `notifications.ts`, `registers.ts`, `sales.ts`-ის GET route-ები
5. **STEP 2, ტიერი 4 (write-heavy, ფინანსური)** — `sales.ts` მთლიანად (POST/PUT payments/shifts), RLS (STEP 2.2)
6. **Neon branch-ის მომზადება** — კვლავ ბლოკილია მომხმარებელზე (Neon API key)
7. **STEP 1-ის merge** main-ში — ტიერი 2-ის (write-blocker) fix-ის შემდეგ, არა უადრეს
8. **გადაწყვეტილების წერტილი** — SaaS vs Multi-Store

დანარჩენი უცვლელად ვალიდურია `ROADMAP - Multi-Tenant SaaS - 16.08.2026.md`-დან.
