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

## ✅ დასრულებულია — STEP 2, ტიერი 3: object-level IDOR write-scoping

იგივე დღის გაგრძელება (ცალკე სესია). ტიერი 2-ის შემდეგ საბოლოოდ დადასტურდა ტიერი 1-ის ანგარიშში ივარაუდებოდა: `products.ts`-ის და `auth.ts`-ის `PUT/PATCH/DELETE .../:id` route-ები **ყველა** `WHERE id = $1`-ს იყენებდა, `organization_id`-ის შემოწმების გარეშე — classic IDOR: Org A-ს ავტორიზებულ user-ს, თუ Org B-ს row-ის UUID-ს გამოიცნობდა/გაუჟონავდა (მაგ. ბრაუზერის dev tools-იდან, log-იდან), შეეძლო მისი რედაქტირება/წაშლა.

**გასწორებული endpoint-ები (`AND organization_id = $N` დაემატა):**

| ფაილი | Endpoint | შენიშვნა |
|---|---|---|
| `products.ts` | `PUT /products/:id` | dupCheck query-საც და UPDATE-საც |
| `products.ts` | `PATCH /products/:id/restock` | |
| `products.ts` | `DELETE /products/:id` | |
| `auth.ts` | `PUT /users/:id` | role/status შეცვლა |
| `auth.ts` | `PUT /users/:id/history-access` | |
| `auth.ts` | `PUT /users/:id/discount-access` | |
| `auth.ts` | `PUT /users/:id/void-access` | |
| `auth.ts` | `PUT /users/:id/clear-cart-access` | |
| `auth.ts` | `PUT /users/:id/password` | + **ბონუს-ფიქსი:** აქამდე `rowCount` საერთოდ არ მოწმდებოდა (არარსებული/სხვა org-ის id "წარმატებას" აბრუნებდა, თუმცა არაფერი შეცვლილა) — დაემატა 404-შემოწმება, სხვა by-id endpoint-ების პატერნის შესაბამისად |
| `auth.ts` | `PUT /users/:id/pin` | targetCheck query-საც და UPDATE-საც |
| `auth.ts` | `DELETE /users/:id` (soft delete) | + იგივე `rowCount`/404 ბონუს-ფიქსი |

**`registers.ts` — ცალკე, უფრო ღრმა პრობლემა (მთელი ფაილი org-ცნობიერების გარეშე იყო):**
- `POST /registers/pair` — არსებული `registerId`-ის ძებნა (`WHERE id = $1`) **IDOR**-იყო: Org A-ს მენეჯერს შეეძლო Org B-ს არსებულ სალაროსთან დაწყვილება. გასწორდა `AND organization_id = $2`-ით.
- `POST /registers/pair` — ახალი register-ის INSERT **write-blocker**-იც იყო: `organization_id`-ის გარეშე (migration 013-ის NOT NULL constraint-ის გამო) **500-ით ჩავარდებოდა** — ანუ "ახალი სალაროს დამატება" ნაკადი production-ში საერთოდ არ იმუშავებდა STEP 1-ის merge-ის შემდეგ. გასწორდა INSERT-ში `organization_id`-ის დამატებით.
- `GET /registers` — ტექნიკურად ტიერი 4-ის item იყო (read-only), მაგრამ იმავე ფაილშია და პირდაპირ უკავშირდება ზემოთა IDOR ფიქსს (pairing UI-ს picker-ი წინააღმდეგ შემთხვევაში ყველა org-ის სალაროს აჩვენებდა) — ერთდროულად გასწორდა, `WHERE organization_id = $1`-ით.

**ახალი ტესტები** (`tenant-isolation.test.ts`, ახალი `authorizedPut`/`authorizedPatch`/`authorizedDelete` helper-ები `api.ts`-ში):
- Cross-org 404 შემოწმებები: `PUT`/`PATCH restock`/`DELETE` `/products/:id`, `PUT`/`DELETE` `/users/:id`, `POST /registers/pair` (არსებული register-ით).
- `GET /registers` — org-scoping (ორივე მიმართულებით საკმარისია ერთი, სიმეტრიული query-ის გამო).
- Happy-path რეგრესია — საკუთარ org-ში PUT/DELETE (products/users) კვლავ მუშაობს, `organization_id`-ის დამატებამ ნორმალური ნაკადი არ გაუფუჭა.
- `seed.ts`-ის `cleanupIsolationTestData` გაფართოვდა: `activation_codes` ჯერ იშლება (FK `confirmed_by`→`users`, `register_id`→`registers`), მერე `registers` — წინააღმდეგ შემთხვევაში teardown FK violation-ით ჩავარდებოდა.

**დადასტურება:** იგივე 4-პუნქტიანი მეთოდოლოგია — `tsc --noEmit` სუფთაა, migrations 001–013 უცვლელად გადის, ლოკალური Postgres 16 + backend-ის წინააღმდეგ **22/22 აქტიური ტესტი მწვანე** (წინა 11 + ახალი 11), 6 კვლავ `it.todo` (`dashboard.stats`, `notifications`, `shifts/history`, `payments` GET, `POST /payments`, `PUT /payments/:id/void`). ორჯერ თანმიმდევრობით გაშვებული (idempotency-ის დასადასტურებლად cleanup-ის მხრივ) — ორივეჯერ მწვანე.

**Commit:** `23fcdc8` — `feat/pwa-icons-and-tenant-isolation-tests` branch-ზე, ტიერი 2-ის (`9a059ea`) თავზე. ეს commit ქართულადაა დაწერილი (მომხმარებლის მოთხოვნით, ამიერიდან ყველა ახალი commit ასე იქნება — ტიერი 1/2-ის ინგლისურენოვანი commit-ების history არ გადაწერილა).

---

## ✅ დასრულებულია — STEP 2, ტიერი 4/5: დარჩენილი read-only + write-heavy (ფინანსური) route-ები

იგივე დღის გაგრძელება (ცალკე სესია, "ჯერ ტიერი 4/5 დავასრულოთ, მერე merge" — მომხმარებლის მოთხოვნით). ეს ტიერი ხურავს STEP 2-ის მთელ დარჩენილ scope-ს: `notifications.ts`-ის და `sales.ts`-ის ყველა route. `sales.ts` (90KB+) roadmap-ის ცვლილება #1-ის მიხედვით "მაღალი მოცულობის, მაღალი ფხიზლობის" ფაილი იყო — ამიტომ ტიერი 5 ბოლოს დარჩა, დანარჩენი ტიერების შემდეგ.

### გადასინჯული/გასწორებული endpoint-ები

| ფაილი | Endpoint | პრობლემა | ფიქსი |
|---|---|---|---|
| `notifications.ts` | `GET /notifications/stock-deficits` | org-scoping აკლდა | `AND sdn.organization_id = $1` |
| `notifications.ts` | `PUT /notifications/stock-deficits/:id/resolve` | IDOR | `AND organization_id = $3` |
| `notifications.ts` | `GET /notifications/shift-amendments` | org-scoping აკლდა | `AND sa.organization_id = $1` |
| `notifications.ts` | `PUT /notifications/shift-amendments/:id/resolve` | IDOR | `AND organization_id = $3` |
| `sales.ts` | `POST /shifts/open` | **write-blocker** (500) | INSERT-ს დაემატა `organization_id` |
| `sales.ts` | `GET /shifts/history` | org-scoping აკლდა | `AND s.organization_id = $1`, `req: any` → `CustomRequest` |
| `sales.ts` | `POST /payments` | **write-blocker** (500) | INSERT-ს დაემატა `organization_id` |
| `sales.ts` | `POST /payments/:id/void` | **სერიოზული IDOR** — ნებისმიერ org-ს შეეძლო ნებისმიერი org-ის რეალური ფინანსური ჩეკის გაუქმება | `AND organization_id = $2` (SELECT) და `$3` (UPDATE, defense-in-depth) |
| `sales.ts` | `syncSingleOfflineReceipt()` (Background Sync Engine) | 3 write-blocker ერთდროულად (`payments`/`stock_deficit_notifications`/`shift_amendments` INSERT-ები) + cross-org shift-hijack | ყველა INSERT-ს `organization_id`; ახალი გუარდი — `shift.organization_id !== organizationId` → throw |
| `sales.ts` | `buildPaymentsFilterQuery()` (საერთო helper — `GET /payments`, `/payments/export/excel`, `/payments/export/pdf`) | `WHERE 1=1`-ით იწყებოდა, org-ის გარეშე | `WHERE p.organization_id = $1`, სამივე call site ერთდროულად გასწორდა |
| `sales.ts` | `GET /payments/export/excel`/`/pdf` | `authenticateToken`-ს არ იყენებენ (query-param token, ხელით `jwt.verify`) — decoded payload ჩუმად იგნორირდებოდა | payload ახლა ტიპიზირებულია (`JwtPayload`) და `organizationId` ამოღებულია მისგან |

### 🎁 ორი დამატებითი, ცალკე აღმოჩენილი ხარვეზი (route-review-ის გვერდით)

1. **`writeAuditLog()`-ის "ჩუმი" write-blocker (`auth.ts`)** — ყველაზე სერიოზული აღმოჩენა ამ სესიაში. Migration 013-ის შემდეგ `audit_logs.organization_id` NOT NULL-ია, მაგრამ `writeAuditLog()`-ის INSERT-ს არასდროს გადაცემია — ანუ **ყოველი** აუდიტ-ლოგის ჩანაწერი (history/discount/void/clear-cart-access toggle-ები, manager-pin-override, void-receipt-override) migration 013-ის შემდეგ **ჩუმად ჩავარდებოდა**. ფუნქცია `try/catch`-შია გახვეული (მხოლოდ `console.error`), ამიტომ არც ერთ callers-ს, არც ტესტს არასდროს დაენახა ეს — მთელი აუდიტ-ტრეილი უხმაუროდ მკვდარი იქნებოდა. გასწორდა: `writeAuditLog`-ს დაემატა მე-5 პარამეტრი `organizationId`, ყველა (6) call site `auth.ts`-ში + ყველა call site `notifications.ts`/`sales.ts`-ში განახლდა.
2. **Register-hijack cross-org ხარვეზი (`middleware/registerAuth.ts`)** — `requireRegister` მხოლოდ JWT-ხელმოწერას/`is_active`-ს ამოწმებდა, org-ს არასდროს. თეორიულად, თუ ვინმეს (malicious კლიენტი ან X-Register-headers-ის "გაჟონვა") ჰქონდა ვალიდური headers სხვა org-ის register-ისთვის, შეეძლო ცვლის გახსნა/ჩეკის ჩაწერა **სხვა org-ის ფიზიკურ register-ზე**. გასწორდა: `requireRegister`-მა ახლა `req.user.organizationId`-საც ადარებს register-ის `organization_id`-ს, მისმატებაზე 403.

### ⛔ დისციპლინის დარღვევის გაცნობიერებული უარი — ეს 3 რამ **განზრახ** დარჩა შეუხებელი

STEP 2-ის scope მკაცრად "ორგანიზაციული სეგმენტაცია" იყო — ეს 3 ხარვეზი multi-tenant-სპეციფიკური არაა (ცალკე org-ის შიგნითაც არსებობს), ამიტომ documented, magram not fixed:

- ~~`syncSingleOfflineReceipt()` არ ამოწმებს `receipt.cashierId === req.user.id` — თეორიულად cashier-impersonation offline sync-ის დროს.~~ ✅ **გასწორებულია, 23.08.2026** — იხ. "🔒 დარჩენილი 2 security-ხარვეზი" სექცია ქვემოთ.
- ~~`GET /payments/export/excel`/`/pdf` — არცერთ როლს არ ზღუდავს (ნებისმიერი authenticated user-ს, cashier-საც კი, შეუძლია excel/pdf export).~~ ✅ **გასწორებულია, 23.08.2026**
- ~~`GET /payments` — იგივე, role-restriction არ აქვს.~~ ✅ **გასწორებულია, 23.08.2026**

### ახალი ტესტები (`tenant-isolation.test.ts`)

ახალი describe-ბლოკი, register-authenticated + write-heavy route-ებისთვის — `seedOrgUser`/`seedOrgRegister`/`seedStockDeficitNotification` (ახალი helper-ები `seed.ts`-ში) + `signRegisterToken` (Pairing UI-ის გვერდის ავლით, პირდაპირ `registerAuth.ts`-იდან):

- `POST /shifts/open` — cross-org register-hijack რეჯექტდება (403, `requireRegister`-ის ახალი org-check).
- `POST /shifts/open` — write-blocker fix-ის რეგრესია, ორივე org-ისთვის.
- `GET /shifts/history` — org-scoping, ორივე მიმართულებით.
- `POST /payments` — write-blocker fix-ის რეგრესია, ორივე org-ისთვის.
- `GET /payments` — org-scoping, ორივე მიმართულებით.
- `GET /notifications/stock-deficits` — org-scoping.
- `POST /payments/:id/void` — cross-org IDOR (404) + happy-path რეგრესია (200, საკუთარი ჩეკი).
- **`writeAuditLog` silent write-blocker-ის რეგრესია** — არა mock, ნამდვილი endpoint (`PUT /users/:id/void-access`) → `GET /audit-logs`-ში რეალური ჩანაწერის დადასტურება.

`seed.ts`-ის `cleanupIsolationTestData` გაფართოვდა: `payments`/`shifts` ჯერ იშლება (register_id/cashier_id-ით), registers/users-მდე — FK-ების გამო (`payments.register_id`/`shifts.register_id`/`shifts.cashier_id`-ს CASCADE არ აქვთ). `payments`-ის წაშლა თავად ჯაჭვურად შლის `payment_items`/`payment_splits`/`stock_deficit_notifications`/`shift_amendments`-საც (ON DELETE CASCADE). ასევე `audit_logs`-ის cleanup გაფართოვდა actor_id/target_id-ითაც (არა მხოლოდ marker-ით) — ტიერი 4/5-ის ტესტები ნამდვილ `writeAuditLog()`-ს იძახებენ, არა `seedAuditLogEntry`-ის მარკერს.

**დადასტურება:** იგივე 4-პუნქტიანი მეთოდოლოგია — `tsc --noEmit` სუფთაა, ლოკალური Postgres 16 + backend-ის წინააღმდეგ **31/32 აქტიური ტესტი მწვანე** (წინა 22 + ახალი 9), 1 კვლავ `it.todo` (`GET /dashboard/stats` — განზრახ, resource-heavy სრულფასოვანი revenue-aggregation ტესტი მომავალი სესიის scope-ია). ორჯერ თანმიმდევრობით გაშვებული (idempotency-ის დასადასტურებლად cleanup-ის მხრივ) — ორივეჯერ მწვანე, ბაზაში ნარჩენი ტესტ-მონაცემი არ დარჩენილა (ხელით შემოწმებული `payments`/`shifts`/`registers`/`users`/`audit_logs`-ზე).

**STEP 2 ამით საბოლოოდ დასრულებულია** — `notifications.ts`, `products.ts`, `dashboard.ts`, `registers.ts`, `auth.ts`, `sales.ts`-ის ყველა route ახლა org-scoped-ია (write-blocker-ებიც, IDOR-ებიც).

---

## 🔧 გვერდითი აღმოჩენა — stale `.git/index.lock` / `.git/HEAD.lock` (განმეორებადი, გადაწყვეტადი)

ტიერი 1-ის commit-ის დროს repo-ში დარჩა stale `.git/index.lock` — device-bridge-ის sandbox-მა ავტომატური წაშლა არ დაუშვა. ტიერი 3-ის commit-ის დროს იგივე მოხდა, მაგრამ ამჯერად `.git/HEAD.lock`-ით (სავარაუდოდ VS Code-ის ჩაშენებული git-ინტეგრაციის ფონური `git status`-პოლინგი ტოვებს, არა უშუალოდ ეს სესია). **ორივეჯერ მომხმარებელმა ხელით წაშალა** (VS Code ტერმინალში `del ".git\index.lock"` ან `del ".git\HEAD.lock"`) და commit წარმატებით გავიდა. თუ მომავალშიც განმეორდება ("another git process is running" / "cannot lock ref") — იგივე ხელით წაშლა წყვეტს პრობლემას; `git add` ჩვეულებრივ უკვე წარმატებულია ასეთ დროს, საჭიროა მხოლოდ ხელახლა `git commit`.

**ტიერი 1 commit:** `db73b3c` — ინგლისურად (STEP 1-ის, `35a1bf1`-ის თავზე).
**ტიერი 2 commit:** `9a059ea` — ინგლისურად.
**ტიერი 3 commit:** `23fcdc8` — **ქართულად** (მომხმარებლის მოთხოვნით, ამიერიდან ყველა ახალი commit ქართულადაა).
**ტიერი 4/5 commit:** `ad4ed47` — **ქართულად**, 9 ფაილი (8 კოდი/ტესტი + roadmap დოკუმენტი). Stale `.git/index.lock`/`.git/HEAD.lock` მესამედ განმეორდა (`git add`-ის დროს index.lock, `git commit`-ის დროს HEAD.lock) — მომხმარებელმა ხელით წაშალა, commit წარმატებით გავიდა.

✅ **დასრულებულია:** commit-ები `23fcdc8` + `ad4ed47` push-ილია GitHub-ზე, PR #3 merge-ილია `main`-ში ("Create a merge commit" სტრატეგიით, merge commit `115c8ca`), ლოკალური `main` sync-ილია (`git checkout main && git pull`, fast-forward `1191a1c` → `115c8ca`).

---

## 🚨 Production ინციდენტი — DB migration 013 production-ზე დაგვიანებული, 23.08.2026

**რა მოხდა:** PR #3-ის `main`-ში merge-ისთანავე Vercel-მა ავტომატურად deploy გააკეთა production-ზე ახალი backend-ის კოდი (STEP 1 + STEP 2, ტიერი 1-5) — ეს კოდი მოითხოვს `organization_id`-ს (NOT NULL) 8 ცხრილში, migration `013_add_organizations_and_tenant_scope.sql`-ის მიხედვით. მაგრამ production-ის Neon PostgreSQL-ს (branch: `production`, project: `payflow-db`) migration 013 არასდროს ჰქონდა გატარებული — მხოლოდ ლოკალურ/sandbox-ის ბაზაზე იყო დატესტილი. შედეგად production-ის backend-მა დაიწყო query-ების ჩავარდნა (`organization_id`-ის მოთხოვნისას column არ არსებობდა), მომხმარებელმა აღწერა როგორც "პროდაქშენზე გატყდა ბაზა".

**Root cause:** repo-ში არ არსებობს ცალკე migration-ტრეკინგის მექანიზმი production-ისთვის (`backend/migrate.ts` მხოლოდ ლოკალურად/manual-ად ეშვება, `.sql` ფაილებს filename-ის მიხედვით try/catch-ით ერთმანეთისგან დამოუკიდებლად), ამიტომ `main`-ში merge + Vercel-ის ავტო-deploy schema migration-ის გარეშე დატოვა code-ს და production DB-ს schema-ს შორის უთანხმოება — **code deploy და DB migration ორი დამოუკიდებელი, სინქრონიზებული არ ნაბიჯი აღმოჩნდა**.

**დიაგნოსტიკა:** Neon SQL Editor-ში (production branch) დიაგნოსტიკური query-ით დადასტურდა, რომ `organizations` ცხრილი production-ზე არ არსებობდა:
```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'organizations';
```

**Fix:** migration 013-ის სრული SQL (`BEGIN;`...`COMMIT;`, ატომური ტრანზაქცია, საკუთარი idempotency guard) ხელით გაეშვა Neon SQL Editor-ში production branch-ზე, `console.neon.tech` → პროექტი `payflow-db` → branch `production`. შესრულდა წარმატებით ("Statement executed successfully") — 20-ვე statement (BEGIN → DO guard → CREATE `organizations` → INSERT default org → 8×(ALTER + UPDATE backfill) → COMMIT) გაშვებულა ერთ ტრანზაქციაში.

**დადასტურება production-ზე (post-fix):**
- `POST /login` — წარმატებული (ADMIN browser-ზე, MANAGER desktop app-ზე)
- `GET /api/dashboard/stats` და ანალიტიკის chart-ები — იტვირთება, შეცდომის გარეშე
- `GET /products` — 5 პროდუქტი იტვირთება მართებულად (stock levels, low-stock warning ჩვეულებრივად მუშაობს)
- Vercel deployments-ში production badge `115c8ca`-ზეა (33წთ+ Ready) — deploy-ი და DB schema ახლა სინქრონულია

**დროის ხაზი:** merge `115c8ca` → production crash → დიაგნოსტიკა Neon SQL Editor-ში → migration 013 ხელით გაშვება production branch-ზე → login/dashboard/products დადასტურება. ყველა ნაბიჯი ერთ სესიაში, 23.08.2026.

**⚠️ Lesson learned — მომავალი migration-ებისთვის (Neon branch-ის მომზადებამდე, item #9-მდე დროებითი წესი):**
Vercel `main`-ზე push-ისთანავე ავტომატურად deploy-ავს — ეს ნიშნავს, რომ **schema migration ყოველთვის უნდა გაეშვას production DB-ზე მანამ, სანამ ის კოდი merge/push ხდება `main`-ში**, არა შემდეგ. ალტერნატივა (item #9, Neon branch-ის მომზადების შემდეგ ხელმისაწვდომი): preview/staging Neon branch-ზე migration-ის წინასწარი ტესტირება + production-ზე გატარება PR merge-მდე, ან Vercel deploy-ის დროებითი pause + manual coordination. სანამ ეს პროცესი არ ჩამოყალიბდება, ყოველი მომავალი migration-ის მქონე PR-ის merge-მდე საჭიროა ხელით შემოწმდეს/გატარდეს production migration.

---

## ✅ დასრულებულია — დარჩენილი 2 security-ხარვეზი (ადრე "დისციპლინის დარღვევის გაცნობიერებული უარი", item #12), 23.08.2026

STEP 2-ის დასრულების (merge, production-ინციდენტის fix) შემდეგ ლოგიკური გაგრძელება — 3 დოკუმენტირებული, განზრახ გადადებული ხარვეზიდან 2 (როლის-შეზღუდვის ტიპის) მალევე გასწორდა, სესიის იმავე დისციპლინით (fix → ტესტი → tsc/vitest → commit).

**1. Role-restriction — `GET /payments`, `GET /payments/export/excel`, `GET /payments/export/pdf` (`sales.ts`)**
სამივე endpoint-ს არცერთი როლის შეზღუდვა არ ჰქონდა — ნებისმიერ authenticated user-ს, cashier-საც კი, შეეძლო მთელი ორგანიზაციის სრული გაყიდვების ისტორიის/Excel/PDF ექსპორტის ნახვა, თუმცა cashier-ის "საკუთარი" scope-ია `GET /payments/my-history`. გასწორდა ზუსტად `GET /shifts/history`-ის უკვე არსებული პატერნით: `if (req.user?.role === 'cashier') return res.status(403)...`. `export/excel`/`export/pdf` `authenticateToken`-ს არ იყენებს (token query param-იდან, პირდაპირ ბრაუზერში გახსნადი ბმულებისთვის) — იქ როლი JWT decoded payload-იდან იკითხება იმავე ლოგიკით.

**2. Cashier-impersonation — `syncSingleOfflineReceipt()` (`sales.ts`, `POST /payments/sync-offline`)**
ფუნქცია receipt.cashierId-ს მხოლოდ ბაზაში არსებულ shift.cashier_id-ს ადარებდა, მაგრამ არასდროს ამოწმებდა, რომ **ავტორიზებული სესია** (`req.user.id`) თავად cashierId-ს ემთხვეოდა — თეორიულად, cashier-ს შეეძლო თავისივე ვალიდური token-ით სხვისი (სხვა cashier-ის) cashierId-ით ჩეკის სინქრონიზაცია, თუ იცოდა/გამოიცნო შესაბამისი shiftId. გასწორდა: `role === 'cashier'`-ს დამატებით მოეთხოვება `receipt.cashierId === requestingUserId`, წინააღმდეგ შემთხვევაში ეს კონკრეტული ჩეკი (batch-ის დანარჩენების ხელშეუხებლად) `'failed'`-ად ბრუნდება. **განზრახ გამონაკლისი admin/manager-ისთვის** დარჩა — long-offline shift-handover-ის შემდეგ stuck ჩეკის ხელით სინქრონიზაცია მენეჯერს მაინც უნდა შეეძლოს, წინააღმდეგ შემთხვევაში ლეგიტიმური გაყიდვა სამუდამოდ დაიკარგებოდა.

**ახალი ტესტები** (`tenant-isolation.test.ts`, ტიერი 4/5-ის describe-ბლოკში):
- `GET /api/payments` — cashier-ს 403 უბრუნდება.
- `GET /api/payments/export/excel` — იგივე (ახალი `tokenQueryGet` helper `api.ts`-ში, `?token=` query-authenticated route-ებისთვის).
- `POST /api/payments/sync-offline` — საკუთარი, იზოლირებული seed-ით (2 ახალი cashier + 1 register იმავე org-ში, shift handover): ერთი batch-ის ორი ჩეკი — საკუთარი (late-sync, დახურულ ცვლაზე) `'synced'`-ია, სხვისი cashierId-ით `'failed'`-ია + DB-ში row არ იქმნება (ორმაგი დადასტურება, `pool.query`-ით პირდაპირ).

**დადასტურება:** `tsc --noEmit` სუფთაა, ლოკალური Postgres 16 + backend-ის წინააღმდეგ **34/34 აქტიური ტესტი მწვანე** (წინა 31 + ახალი 3), 1 კვლავ `it.todo`. ორჯერ თანმიმდევრობით გაშვებული — ორივეჯერ მწვანე, ბაზაში ნარჩენი ტესტ-მონაცემი არ დარჩენილა.

✅ **Commit:** `030465c` — ქართულად, push-ილია (`115c8ca..030465c`), production-ზეც deploy-ილი და ხელით დადასტურებული (cashier token-ით `GET /payments/export/excel` → `403 {"error":"წვდომა შეზღუდულია!"}`).

---

## ✅ დასრულებულია — STEP 3: კომპანიის Self-Service რეგისტრაცია (SaaS მიმართულება), 23.08.2026

### გადაწყვეტილების წერტილი — გადაწყვეტილია

წინა სექციებში (item #11, "გადაწყვეტილების წერტილი — SaaS vs Multi-Store") ღიად დარჩენილი კითხვა ამ სესიაში დაისვა კონკრეტულად: მიუხედავად STEP 1-ის (migration 013, `organizations` ცხრილი) და STEP 2-ის (route-level org-scoping) დასრულებისა, **პროდუქტში ფაქტობრივად არ არსებობდა ახალი კომპანიის შექმნის მექანიზმი** — არც backend endpoint, არც frontend გვერდი. ერთადერთი გზა ახალი org-ის დასამატებლად pgAdmin-ში ხელით INSERT იყო.

მომხმარებელმა აირჩია:
1. **ბიზნეს-მოდელი: SaaS — თვითრეგისტრაცია** (არა Multi-Store, სადაც ერთი კომპანია ხელით მართავდა ყველა ფილიალს).
2. **ადმინის email-ის უნიკალურობის scope: მთელი პლატფორმის მასშტაბით** (არა per-org) — ერთი email მხოლოდ ერთხელ შეიძლება იყოს რეგისტრირებული, მიუხედავად იმისა, რომელ org-შია.

### Backend

**ახალი migration `014_add_users_email.sql`** — `users.email` (TEXT, NULLABLE — ისტორიულ user-ებს email არასდროს ჰქონიათ) + `CREATE UNIQUE INDEX ... ON users (LOWER(email)) WHERE email IS NOT NULL` (platform-wide, partial — NULL-ები ერთმანეთს არ ეჯახება). იდემპოტენტურობის guard migration 009/013-ის იგივე კონვენციით.

**ახალი endpoint `POST /api/organizations/register`** (`backend/src/routes/organizations.ts`) — საჯარო (ავტორიზაციის გარეშე — თავად org/admin ჯერ არ არსებობს), მაგრამ rate-limited:
- ვალიდაცია: კომპანიის სახელი (≥2 სიმბოლო), slug (`slugify()` + `SLUG_REGEX` — მხოლოდ პატარა ლათინური/ციფრები/დეფისი, 3-40 სიმბოლო, subdomain-მზადყოფნით STEP 7-ისთვის), ადმინის სახელი (≥2), email (`EMAIL_REGEX`), პაროლი (**≥8 სიმბოლო** — უფრო მკაცრი, ვიდრე internal `POST /users`-ის 4-სიმბოლოიანი მინიმუმი, რადგან ეს endpoint ინტერნეტიდან ნებისმიერისთვისაა ხელმისაწვდომი).
- უნიკალურობის წინასწარი შემოწმება (slug/email/username) + `23505` fallback (`uq_organizations_slug`/`uq_users_email`/`users_name_key` constraint-დისპეჩი) race-condition-ის დასაცავად.
- ერთ ტრანზაქციაში: INSERT `organizations` (`status: 'trial'`, `trial_ends_at: NOW() + 14 დღე`) + INSERT `users` (`role: 'admin'`).
- წარმატებაზე — **auto-login**: იგივე JWT payload-ფორმა, რაც `POST /login`-ს, რომ frontend-ის არსებულმა session-restore ლოგიკამ უცვლელად მიიღოს.

**ახალი `middleware/registrationRateLimit.ts`** — in-memory (`managerPinRateLimit.ts`-ის იგივე პატერნი, ცალკე npm დამოკიდებულების გარეშე), მაგრამ განსხვავებული სემანტიკით: **ყველა** მცდელობას ითვლის (არა მხოლოდ წარუმატებელს) — 5 მცდელობა/საათში, IP-ის მიხედვით.

**`types.ts`** — `User` interface-ს დაემატა `email: string | null`.

### Frontend

**ახალი `pages/Register.tsx` + `Register.module.scss`** — `Login.tsx`-ის იგივე structural/visual კონვენცია (card/form/field/label/input/error/submitBtn, GSAP staggered entrance). ველები: კომპანიის სახელი, subdomain/slug (live auto-suggest `companyName`-იდან, ხელით რედაქტირებადი — `slugTouched` flag-ით), ადმინის სახელი (**იგივე ველი, რაც login username** — ცალკე username ველი არ არსებობს, `POST /organizations/register`-ის backend-ლოგიკასთან შესაბამისობაში), email, პაროლი + დადასტურება. Submit → `POST /api/organizations/register` → წარმატებაზე `onRegisterSuccess(token, user)` callback (იგივე auto-login პატერნი, რაც `handlePasswordResetComplete`-ს აქვს).

**`App.tsx`** — პროექტს **router ბიბლიოთეკა არ აქვს** (plain React state), ამიტომ Login ⇄ Register გადართვა ახალი `showRegister` state-ტოგლითაა: `isLoggedIn === false` branch-ში ან `<Login>` ან `<Register>` რენდერდება. ახალი `handleRegisterSuccess` handler (`handlePasswordResetComplete`-ის იდენტური სტრუქტურა).

**`Login.tsx`** — დაემატა `onNavigateToRegister` prop + ღილაკი ("კომპანია არ გაქვთ დარეგისტრირებული? დაარეგისტრირეთ აქ") ფორმის ბოლოში, `m.btn-ghost` მიქსინით.

### ტესტები (`tenant-isolation.test.ts`, ახალი ცალკე describe-ბლოკი)

ახალი `registerOrganization()` helper `api.ts`-ში (ავტორიზაციის გარეშე POST). 5 ტესტი, **საერთო `beforeAll`-ში ერთი საბაზისო რეგისტრაციით** (409/400 ტესტები მას იმეორებენ slug/email-ის დაკავებულობის დასამტკიცებლად) — განზრახ დიზაინის გადაწყვეტილება, რომ rate-limit-ის 5/საათში ბიუჯეტი ერთმა test-run-მა არ გადაწუროს, სანამ rate-limit-ის ტესტამდე მიაღწევს:
- **happy path** — org + admin იქმნება, auto-login token მუშაობს, ახალი org-ის ტოკენით შექმნილი პროდუქტი ზუსტად ახალი org-ის `organization_id`-ზეა (იზოლაციის დადასტურება), `status: 'trial'`.
- **409 — დაკავებული slug**-ით მეორე რეგისტრაცია.
- **409 — დაკავებული email**-ით მეორე რეგისტრაცია, თუნდაც სრულიად სხვა კომპანიისთვის (platform-wide უნიკალურობის დადასტურება).
- **400 — სუსტი პაროლი** (<8 სიმბოლო), org საერთოდ არ იქმნება.
- **429 — rate limiting** — მცდელობები მანამ მეორდება, სანამ 429 არ დაბრუნდება (10-ცდიანი უსაფრთხოების ჭერით), ყველა წინა მცდელობა 201-ია.

**დადასტურება:** `tsc --noEmit` სუფთაა. Migration 014 ხელით გაშვებული ლოკალურ ტესტ-ბაზაზე. Backend server-ი **განზრახ გადატვირთული** ორ vitest-გაშვებას შორის (rate-limiter-ის in-memory Map server-პროცესის მასშტაბითაა — გადატვირთვის გარეშე მეორე გაშვება ადრეულადვე 429-ს მიიღებდა, რაც production-ში ცოცხალ deploy-ზეც ბუნებრივად ხდება cold-start-ზე). **39/39 აქტიური ტესტი მწვანე ორივე გაშვებაზე** (წინა 34 + ახალი 5), 1 კვლავ `it.todo`, ბაზაში ნარჩენი ტესტ-მონაცემი არ დარჩენილა.

Frontend-ის ცალკე ვერიფიკაცია (frontend-ს `tsconfig.json`/ცალკე type-check სკრიპტი არ აქვს — `npm run build` მხოლოდ `vite build`-ია, esbuild-ის type-stripping-ით, ცალკე `tsc` საფეხურის გარეშე): `Register.tsx`/`Login.tsx`/`App.tsx` გატესტილია `esbuild`-ით (JSX/TS syntax სუფთაა), `Register.module.scss`/`Login.module.scss` გატესტილია `sass`-ის კომპილაციით (`@use`/მიქსინების იმპორტები სწორია).

⚠️ **დარჩენილი:**
- **Migration 014 არ არის გატარებული არც production-ზე, არც სხვა environment-ზე** (მხოლოდ ლოკალურ ვერიფიკაციის ბაზაზე) — production-ზე გატარება საჭიროა **ამ ცვლილებების deploy-მდე** (იხ. ზემოთა "🚨 Production ინციდენტი" სექციის lesson-learned — migration ყოველთვის deploy-მდე).
- Commit ჯერ არ არის შექმნილი — ფაილები მზადაა.
- Subdomain-ი (`slug`) ამ ეტაპზე მხოლოდ ველია, ჯერ არ არსებობს რეალური subdomain-routing (STEP 7-ის scope).

---

## განახლებული პრიორიტეტების რიგი

1. ~~STEP 0, STEP 1~~ ✅ დასრულებული (feature branch-ზე, jერ არ production-ზე)
2. ~~STEP 2, ტიერი 1 (read-only)~~ ✅ **დასრულებული, ტესტირებული, commit `db73b3c`** — dashboard.ts, products.ts GET-ები, auth.ts GET/DELETE `/audit-logs`, GET `/users`, audit-logs.ts export + bonus fix (`verify-manager-pin`)
3. ~~STEP 2, ტიერი 2 (write-blocker)~~ ✅ **დასრულებული, ტესტირებული, commit `9a059ea`** — `POST /users`/`POST /products`-ს `organization_id` დაემატა INSERT-ში
4. ~~STEP 2, ტიერი 3 (object-level write-scoping)~~ ✅ **დასრულებული, ტესტირებული, commit `23fcdc8` (ქართულად)** — `PUT/PATCH/DELETE /products/:id`, `PUT/DELETE /users/:id`, `registers.ts`-ის მთელი pairing-ნაკადი: IDOR + write-blocker ორივე გასწორდა
5. ~~STEP 2, ტიერი 4/5 (დარჩენილი read-only + write-heavy/ფინანსური)~~ ✅ **დასრულებული, ტესტირებული (31/32), commit `ad4ed47` (ქართულად)** — `notifications.ts`, `sales.ts` მთლიანად + ბონუსად `writeAuditLog()` silent write-blocker და register-hijack ფიქსი. **STEP 2 ამით სრულად დასრულებულია.**
6. ~~push (`23fcdc8` + `ad4ed47`) + PR #3-ის description-ის განახლება~~ ✅ **დასრულებული**
7. ~~PR #3-ის merge-ის გადაწყვეტილება~~ ✅ **დასრულებული — merge commit `115c8ca`**, `main`-ში STEP 1 + STEP 2 (ტიერი 1-5) მთლიანად
8. ~~Production incident: migration 013 production Neon-ზე~~ ✅ **დასრულებული, 23.08.2026** — იხ. "🚨 Production ინციდენტი" სექცია ზემოთ. Production დადასტურებულია აღდგენილად (login, dashboard, products)
9. **STEP 2.2 (RLS)** — დამატებითი, defense-in-depth შრე route-level `WHERE organization_id`-ის თავზე (route-scoping უკვე ცალკე საკმარისია production-ისთვის, RLS extra-hardening-ია)
10. **Neon branch-ის მომზადება** — კვლავ ბლოკილია მომხმარებელზე (Neon API key). ასევე გახდის შესაძლებელს future migration-ების staging-ზე წინასწარ ტესტირებას push-ამდე (იხ. lesson learned production-ინციდენტის სექციაში)
11. ~~გადაწყვეტილების წერტილი — SaaS vs Multi-Store~~ ✅ **გადაწყვეტილია, 23.08.2026 — SaaS მიმართულება, email platform-wide უნიკალურობით.** `users.name` per-org uniqueness საკითხი კვლავ ღიაა (STEP 2.2/RLS-ის ან ცალკე migration-ის scope) — ახალი registration-ის ნაკადს ამ ეტაპზე არ ბლოკავს, რადგან username-კონფლიქტი 409-ით ინფორმატიულად ბრუნდება.
12. ~~დოკუმენტირებული, განზრახ გადადებული ხარვეზები (role-restriction: `GET /payments`, export/excel, export/pdf; cashier-impersonation: `syncSingleOfflineReceipt()`)~~ ✅ **დასრულებული, ტესტირებული (34/34), commit `030465c`** — იხ. "✅ დარჩენილი 2 security-ხარვეზი" სექცია ზემოთ. დარჩენილია მხოლოდ: `syncSingleOfflineReceipt()`-ის cashier-impersonation-ის მესამე, უფრო ღრმა ვარიანტი (თუ ოდესმე გამოვლინდება — cross-register/cross-shift ცალკე scenario-ები STEP 2.2-ის (RLS) ფარგლებში შეიძლება საბოლოოდ დაიხუროს) — non-blocking
13. ~~STEP 3 — კომპანიის Self-Service რეგისტრაცია~~ ✅ **დასრულებული, ტესტირებული (39/39), commit ⏳ pending** — იხ. "✅ STEP 3" სექცია ზემოთ. **დარჩენილია: migration 014 production-ზე გატარება** (deploy-მდე, item-ის commit/push/merge-მდე) — იხ. lesson learned production-ინციდენტის სექციაში.
14. **STEP 7 (subdomain routing)** — STEP 3-ის `slug` ველი ჯერ მხოლოდ მონაცემია, რეალური subdomain-ზე routing/tenant-resolution ჯერ არ არსებობს.

დანარჩენი უცვლელად ვალიდურია `ROADMAP - Multi-Tenant SaaS - 16.08.2026.md`-დან.
