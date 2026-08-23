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

## ✅ დასრულებულია — STEP 2, ტიერი 2: write-blocker fix (`POST /users`, `POST /products`)

იგივე სესიის გაგრძელება. Migration 013-ის შემდეგ `users.organization_id`/`products.organization_id` NOT NULL-ია — ეს ორი endpoint კი `organization_id`-ის გარეშე აკეთებდა INSERT-ს, ანუ STEP 1-ის merge-ის შემდეგ **500-ით ჩავარდებოდა**. გასწორდა:

- **`POST /users`** (`auth.ts`) — INSERT-ს დაემატა `organization_id = req.user.organizationId` (ახალი user ყოველთვის შემქმნელი ადმინის org-ში იქმნება).
- **`POST /products`** (`products.ts`) — იგივე INSERT-ზე, პლუს **dupCheck query**-საც დაემატა `organization_id` ფილტრი: migration 013-ის შემდეგ `products.name` მხოლოდ per-org უნიკალურია (`uq_products_org_name`), ორგ-ის ფილტრის გარეშე dupCheck არასწორად უარყოფდა Org A-ს მოთხოვნას, თუ Org B-ს უკვე ჰქონდა იგივე სახელით პროდუქტი — ეს ცალკე, functional bug იყო (არა უსაფრთხოების), პირდაპირ migration 013-ის შედეგი.

**ახალი ტესტები** (`tenant-isolation.test.ts`, ახალი `authorizedPost` helper `api.ts`-ში):
- `POST /api/products` — ახალი პროდუქტი შემქმნელის org-ში ჯდება, მეორე org ვერ ხედავს.
- `POST /api/products` — ორივე org-ს შეუძლია იგივე სახელით პროდუქტის შექმნა (per-org uniqueness რეალურად მუშაობს).
- `POST /api/users` — ახალი user შემქმნელის org-ში ჯდება, მეორე org ვერ ხედავს.

**დადასტურება:** იგივე ლოკალური Postgres 16 + backend — **11/11 აქტიური ტესტი მწვანე** (წინა 8 + ახალი 3), 7 კვლავ `it.todo`. დამატებით ხელით curl-შემოწმება: პროდუქტის/user-ის შექმნა 201-ით, დუბლიკატი იმავე org-ში კვლავ 409-ს აბრუნებს (behavior უცვლელია), სერვერი მდგრადია.

**⚠️ გვერდითი, გადაუწყვეტელი დათქმა:** `users.name` კვლავ **გლობალურად** უნიკალურია (migration 013-მა მხოლოდ `products`-ის constraint გადააკეთა per-org-ად, `users`-ს არ შეხებია). ანუ ორ სხვადასხვა org-ს ჯერ არ შეუძლია ერთი და იმავე username-ის ქონა (მაგ. ორივემ ვერ დაარეგისტრირონ "admin"). ეს **schema-decision-ია**, არა route-ის ბაგი — გადასაწყვეტია STEP 1-ის revizia-ს ან STEP 2.2-ის (RLS) ფარგლებში, დამოკიდებულია საბოლოო SaaS-vs-Multi-Store გადაწყვეტილებაზეც.

---

## ⚠️ STEP 2-ის დარჩენილი, ჯერ **არ**-scoped ნაწილი

**Read-only, jერ არ გადასინჯული:**
- `GET /api/notifications/stock-deficits` (`notifications.ts`)
- `GET /api/registers` (`registers.ts`)
- `GET /api/shifts/history`, `GET /api/payments` (`sales.ts`)

**Write-heavy, ჯერ scoped არ არის:**
- `PUT /products/:id`, `PATCH /products/:id/restock`, `DELETE /products/:id` — ამ სამივეს **object-level** (IDOR-ტიპის) ხარვეზი აქვს: `WHERE id = $1`-ს არ ემატება `AND organization_id = $2`, ანუ Org A-ს ადმინს, თუ Org B-ს პროდუქტის (UUID) id გამოიცნობს/გაუჟონავს, შეუძლია მისი რედაქტირება/წაშლა/restock. იგივე ტიპის ხარვეზი სავარაუდოდ `PUT/DELETE /users/:id`-ზეც (`auth.ts`) და `registers.ts`-ის write route-ებზეც.
- `sales.ts` (90KB+, roadmap-ის ცვლილება #1-ის მიხედვით "მაღალი მოცულობის, მაღალი ფხიზლობის" ფაილი) — მთლიანად შეხებული არ არის. STEP 2.2 (RLS) ჯერ არ დაწყებულა.

---

## 🔧 გვერდითი აღმოჩენა — stale `.git/index.lock` (გადაწყვეტილი)

ტიერი 1-ის commit-ის დროს repo-ში დარჩა stale `.git/index.lock`, device-bridge-ის sandbox-მა ავტომატური წაშლა არ დამრთო. **მომხმარებელმა ხელით წაშალა** (File Explorer/VS Code) და commit წარმატებით გავიდა (`db73b3c`). თუ მომავალშიც განმეორდება ("another git process is running" VS Code-ში) — იგივე ხელით წაშლა (`PayFlow\.git\index.lock`, 0 ბაიტიანი) წყვეტს პრობლემას.

**ტიერი 1 commit:** `db73b3c` — `feat/pwa-icons-and-tenant-isolation-tests` branch-ზე, STEP 1-ის (`35a1bf1`) თავზე.
**ტიერი 2-ის ცვლილებები** (ეს სესია, POST /users + POST /products fix) **დისკზეა, ჯერ commit არ გაკეთებულა** — 4 ფაილი: `auth.ts`, `products.ts`, `tests/isolation/api.ts`, `tests/isolation/tenant-isolation.test.ts`.

---

## განახლებული პრიორიტეტების რიგი

1. ~~STEP 0, STEP 1~~ ✅ დასრულებული (feature branch-ზე, jერ არ production-ზე)
2. ~~STEP 2, ტიერი 1 (read-only)~~ ✅ **დასრულებული, ტესტირებული, commit `db73b3c`** — dashboard.ts, products.ts GET-ები, auth.ts GET/DELETE `/audit-logs`, GET `/users`, audit-logs.ts export + bonus fix (`verify-manager-pin`)
3. ~~STEP 2, ტიერი 2 (write-blocker)~~ ✅ **დასრულებული და ტესტირებული (23.08, ეს სესია) — ჯერ commit არ გაკეთებულა** — `POST /users`/`POST /products`-ს `organization_id` დაემატა INSERT-ში
4. **STEP 2, ტიერი 3 (object-level write-scoping)** — `PUT/PATCH/DELETE /products/:id`, `PUT/DELETE /users/:id`, `registers.ts`-ის write route-ები: `WHERE id = $1 AND organization_id = $2`-ის დამატება ყველგან (IDOR-ტიპის ხარვეზი)
5. **STEP 2, ტიერი 4 (დანარჩენი read-only)** — `notifications.ts`, `registers.ts`, `sales.ts`-ის GET route-ები
6. **STEP 2, ტიერი 5 (write-heavy, ფინანსური)** — `sales.ts` მთლიანად (POST/PUT payments/shifts), RLS (STEP 2.2)
7. **Neon branch-ის მომზადება** — კვლავ ბლოკილია მომხმარებელზე (Neon API key)
8. **STEP 1-ის merge** main-ში — ტიერი 3-ის (მაინც STEP 2-ის write route-ების ძირითადი ნაწილის) დასრულების შემდეგ, არა უადრეს
9. **გადაწყვეტილების წერტილი** — SaaS vs Multi-Store (მოიცავს `users.name` per-org uniqueness-ის გადაწყვეტასაც)

დანარჩენი უცვლელად ვალიდურია `ROADMAP - Multi-Tenant SaaS - 16.08.2026.md`-დან.
