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

- `syncSingleOfflineReceipt()` არ ამოწმებს `receipt.cashierId === req.user.id` — თეორიულად cashier-impersonation offline sync-ის დროს.
- `GET /payments/export/excel`/`/pdf` — არცერთ როლს არ ზღუდავს (ნებისმიერი authenticated user-ს, cashier-საც კი, შეუძლია excel/pdf export).
- `GET /payments` — იგივე, role-restriction არ აქვს.

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
**ტიერი 4/5 commit:** ⏳ `git add` წარმატებით შესრულებულია (8 ფაილი), მაგრამ `git commit` კვლავ იმავე stale `.git/index.lock`-ს გადააწყდა — მოსალოდნელი, იგივე გვერდითი აღმოჩენის მესამე გამეორება. საჭიროა იგივე ხელით წაშლა (`del ".git\index.lock"` VS Code ტერმინალში), მერე მხოლოდ `git commit` ხელახლა (add-ის გამეორება საჭირო არაა).

⚠️ **დარჩენილი ნაბიჯი:** commit `23fcdc8` ჯერ მხოლოდ ლოკალურ (device) repo-შია — **GitHub-ზე jერ არ არის push-ილი**. Push-ის შემდეგ ავტომატურად აისახება ღია PR #3-ში (იგივე branch-იდან იხსნება). ტიერი 4/5-ის commit-ის დასრულების შემდეგ ორივე (23fcdc8 + ახალი) ერთად დაჭირდება push-ი.

---

## განახლებული პრიორიტეტების რიგი

1. ~~STEP 0, STEP 1~~ ✅ დასრულებული (feature branch-ზე, jერ არ production-ზე)
2. ~~STEP 2, ტიერი 1 (read-only)~~ ✅ **დასრულებული, ტესტირებული, commit `db73b3c`** — dashboard.ts, products.ts GET-ები, auth.ts GET/DELETE `/audit-logs`, GET `/users`, audit-logs.ts export + bonus fix (`verify-manager-pin`)
3. ~~STEP 2, ტიერი 2 (write-blocker)~~ ✅ **დასრულებული, ტესტირებული, commit `9a059ea`** — `POST /users`/`POST /products`-ს `organization_id` დაემატა INSERT-ში
4. ~~STEP 2, ტიერი 3 (object-level write-scoping)~~ ✅ **დასრულებული, ტესტირებული, commit `23fcdc8` (ქართულად)** — `PUT/PATCH/DELETE /products/:id`, `PUT/DELETE /users/:id`, `registers.ts`-ის მთელი pairing-ნაკადი: IDOR + write-blocker ორივე გასწორდა
5. ~~STEP 2, ტიერი 4/5 (დარჩენილი read-only + write-heavy/ფინანსური)~~ ✅ **დასრულებული, ტესტირებული (31/32), commit ⏳ pending** — `notifications.ts`, `sales.ts` მთლიანად + ბონუსად `writeAuditLog()` silent write-blocker და register-hijack ფიქსი. **STEP 2 ამით სრულად დასრულებულია.**
6. **ტიერი 4/5-ის commit + push + PR #3-ის description-ის განახლება** — commit ბლოკილია stale lock-ზე (იხ. ზემოთ), საჭიროა მომხმარებლის ხელით ჩარევა
7. **PR #3-ის merge-ის გადაწყვეტილება** — push-ის შემდეგ PR #3 შეიცავს ტიერი 1-5-ს მთლიანად (STEP 1-ის schema-ც). STEP 2-ის მთელი route-scoping scope ახლა დასრულებულია — ფინანსური cross-tenant რისკი, რაც ადრე ტიერი 5-მდე იყო ღია, აღარ არსებობს
8. **STEP 2.2 (RLS)** — დამატებითი, defense-in-depth შრე route-level `WHERE organization_id`-ის თავზე (route-scoping უკვე ცალკე საკმარისია production-ისთვის, RLS extra-hardening-ია)
9. **Neon branch-ის მომზადება** — კვლავ ბლოკილია მომხმარებელზე (Neon API key)
10. **გადაწყვეტილების წერტილი** — SaaS vs Multi-Store (მოიცავს `users.name` per-org uniqueness-ის გადაწყვეტასაც)
11. **დოკუმენტირებული, განზრახ გადადებული ხარვეზები** (multi-tenant-სპეციფიკური არაა, STEP 2-ის scope-ის გარეთ): `syncSingleOfflineReceipt()`-ის cashier-impersonation რისკი, `GET /payments/export/excel`/`/pdf`-ისა და `GET /payments`-ის role-restriction-ის არქონა

დანარჩენი უცვლელად ვალიდურია `ROADMAP - Multi-Tenant SaaS - 16.08.2026.md`-დან.
