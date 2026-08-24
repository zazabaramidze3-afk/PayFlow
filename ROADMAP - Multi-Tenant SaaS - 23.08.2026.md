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

✅ **Migration 014 გატარებულია ორივე გარემოში:**
- ლოკალურად (pgAdmin, `payflow_db`) — 23.08.2026.
- **Production Neon-ზეც (Neon SQL Editor, branch `production`, project `payflow-db`)** — 24.08.2026, 00:03, ("add email column to users table with unique constraint") — ყველა 5 statement ("BEGIN → DO guard → ALTER → CREATE UNIQUE INDEX → COMMIT") წარმატებით შესრულდა ("Statement executed successfully"). ამჯერად migration production-ზე **push-ის შემდეგ**, მაგრამ ცოტა ხანში გაეშვა — წინა incident-ისგან განსხვავებით, ცოცხალი user-ზე ზემოქმედების გარეშე (ახალი endpoint, ძველი route-ები `users.email`-ზე დამოკიდებული არ იყო).
- ✅ ხელით დადასტურებული production-ზეც: `testmarketadmin`-ის რეგისტრაცია, auto-login, Device Pairing, POS გაყიდვა, ცვლის დახურვა, Dashboard — ყველა ნაბიჯი tenant-isolation-ის სრული დადასტურებით.

✅ **Commit:** `9d13855` — ქართულად, push-ილია (`030465c..9d13855`, `main`-ზე პირდაპირ), 13 ფაილი.

⚠️ **დარჩენილი:**
- Subdomain-ი (`slug`) ამ ეტაპზე მხოლოდ ველია, ჯერ არ არსებობს რეალური subdomain-routing (STEP 7-ის scope).
- **Lesson learned:** migration production-ზე ამჯერად push-ის *შემდეგ* გაეშვა (ლუკით/დაგვიანებით) — ამჯერად უვნებლად ჩაიარა, რადგან ახალი endpoint-ი იზოლირებული იყო, მაგრამ STEP 4+-ისთვის სჯობს "🚨 Production ინციდენტი" სექციის წესს მკაცრად დავიცვათ: **migration ყოველთვის push/deploy-მდე**, არა შემდეგ.

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
10. ~~Neon branch-ის მომზადება~~ ✅ **დასრულებული, ავტომატიზებული, 24.08.2026** — იხ. "🌿 Neon branch-ზე migration-ის ავტომატური ტესტირება" სექცია ქვემოთ.
11. ~~გადაწყვეტილების წერტილი — SaaS vs Multi-Store~~ ✅ **გადაწყვეტილია, 23.08.2026 — SaaS მიმართულება, email platform-wide უნიკალურობით.** `users.name` per-org uniqueness საკითხი ✅ **დახურულია, 24.08.2026 — განზრახ, დოკუმენტირებული უარი, `users.name` რჩება გლობალურად unique.** იხ. "🔒 გადაწყვეტილება — `users.name` uniqueness" სექცია ქვემოთ.
12. ~~დოკუმენტირებული, განზრახ გადადებული ხარვეზები (role-restriction: `GET /payments`, export/excel, export/pdf; cashier-impersonation: `syncSingleOfflineReceipt()`)~~ ✅ **დასრულებული, ტესტირებული (34/34), commit `030465c`** — იხ. "✅ დარჩენილი 2 security-ხარვეზი" სექცია ზემოთ. დარჩენილია მხოლოდ: `syncSingleOfflineReceipt()`-ის cashier-impersonation-ის მესამე, უფრო ღრმა ვარიანტი (თუ ოდესმე გამოვლინდება — cross-register/cross-shift ცალკე scenario-ები STEP 2.2-ის (RLS) ფარგლებში შეიძლება საბოლოოდ დაიხუროს) — non-blocking
13. ~~STEP 3 — კომპანიის Self-Service რეგისტრაცია~~ ✅ **სრულად დასრულებული, ტესტირებული (39/39), commit `9d13855`, push-ილი, migration 014 გატარებული ორივე გარემოში (ლოკალურად + production Neon), ხელით დადასტურებული production-ზეც** — იხ. "✅ STEP 3" სექცია ზემოთ.
14. ~~STEP 7 (subdomain routing) — რეალური subdomain routing~~ ⚠️ **შეუძლებელია ამჟამინდელ ინფრასტრუქტურაზე** (`*.vercel.app` საზიარო დომეინი wildcard subdomain-ს არ უჭერს მხარს) — ჩანაცვლდა STEP 7-lite-ით (item #19), ფასიან custom domain-ამდე. იხ. "🏢 STEP 7-lite — კომპანიის slug login" სექცია ქვემოთ.
15. ~~Dashboard "დღეს" სტატისტიკის timezone ბაგი~~ ✅ **დასრულებული, 24.08.2026** — იხ. "🐛 Dashboard timezone ბაგი" სექცია ქვემოთ.
16. ~~STEP 8 — Superadmin Panel~~ ✅ **სრულად დასრულებული, ტესტირებული, deploy-ილი და production-ზე დადასტურებული, 24.08.2026, commit `1a5e911`** — იხ. "✅ STEP 8" სექცია ზემოთ.
17. ~~`users.name` uniqueness — per-org გახდომის საკითხი~~ ✅ **დახურულია, 24.08.2026, კოდის ცვლილების გარეშე** — იხ. "🔒 გადაწყვეტილება — `users.name` uniqueness" სექცია ქვემოთ.
18. ~~Neon branch-ზე migration-ის ავტომატური ტესტირება~~ ✅ **დასრულებული, end-to-end დადასტურებული production-ზე ზემოქმედების გარეშე, 24.08.2026** — იხ. "🌿 Neon branch-ზე migration-ის ავტომატური ტესტირება" სექცია ქვემოთ.
19. ~~STEP 7-lite — კომპანიის slug login~~ ✅ **დასრულებულია (24.08.2026)** — migration 016 გატარდა Neon branch-ზე, ლოკალურად და production-ზე; `vitest run tests/isolation` — 46 passed | 1 todo; commit `a5bd6e7` push-ილია; production-ზე (`pay-flow-zet3.vercel.app`) ხელით დადასტურებულია ორსაფეხურიანი login რამდენიმე org-ისთვის (tenant isolation production-შიც სწორად მუშაობს). იხ. "🏢 STEP 7-lite — კომპანიის slug login" სექცია ქვემოთ.

დანარჩენი უცვლელად ვალიდურია `ROADMAP - Multi-Tenant SaaS - 16.08.2026.md`-დან.

---

## 🐛 Dashboard timezone ბაგი — "დღეს" სტატისტიკა ნულოვანი, 24.08.2026

**რა მოხდა:** STEP 3-ის ხელით ტესტირების დროს (`testmarketmanager`) Dashboard-ის "ანალიტიკა" ტაბზე ყველა "დღევანდელი" ბარათი (შემოსავალი, ჩეკები, საშუალო ჩეკი) 0-ს აჩვენებდა, მიუხედავად იმისა, რომ "გაყიდვების ისტორია" ტაბში იმავე დღეს ჩაწერილი ჩეკი ჩანდა (`8/24/2026, 00:25:34`). თვის დინამიკის გრაფიკიც 23 რიცხვზე ჩერდებოდა, 24-ის მონაცემის გარეშე.

**Root cause:** `dashboard.ts`-ის ოთხივე "დღეს"/"მიმდინარე თვე" query (`today`, `paymentBreakdown`, `voided`, `topProducts`, `dailyTrend`) Postgres-ის `CURRENT_DATE`-ს იყენებდა — ეს სესიის (Neon default: **UTC**) დროის ზონას ეყრდნობა. მაგრამ `payments.created_at` (TEXT სვეტი) `sales.ts`/`checkShift.ts`-ის მიერ ცალსახად **Asia/Tbilisi** (UTC+4) ადგილობრივი დროით იწერება (ადრინდელი, განზრახ FIX — იხ. `sales.ts`-ის კომენტარები). ორი განსხვავებული timezone-კონვენცია ერთდროულად → ყოველი დღის **00:00–04:00 თბილისის დროის ფანჯარაში** ჩაწერილი ჩეკი backend-ის "დღეს"-ის boundary-ს გარეთ ვარდებოდა (UTC-ის მიხედვით ეს ჯერ კიდევ "გუშინდელი" დღეა).

**დადასტურება (SQL-ით, არა ვარაუდი):** ლოკალურ ტესტ-ბაზაზე სიმულირებული `created_at = '2026-08-24 00:25:34'` ჩანაწერზე — ძველი (UTC `CURRENT_DATE`) ლოგიკა: `false`. ახალი (Asia/Tbilisi-ცნობიერი) ლოგიკა: `true`.

**Fix:** ხუთივე query-ში `CURRENT_DATE` → `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tbilisi')::date`, `created_at`-ის ჩაწერის იგივე კონვენციით.

**ვერიფიკაცია:** `tsc --noEmit` სუფთა. `vitest run tests/isolation` — 39/39 მწვანე (რეგრესია არ არის). ხელით დადასტურებული production-ზეც (`pay-flow-zet3.vercel.app`) — Dashboard-ისა და Sales History-ის მონაცემები ახლა ემთხვევა.

**Commit:** push-ილია, DB migration არ სჭირდებოდა (მხოლოდ query-ლოგიკა), Vercel-მა ავტომატურად deploy გააკეთა.

**Lesson learned:** როცა TEXT-ტიპის timestamp სვეტი ცალსახა timezone-კონვენციით იწერება (აქ Asia/Tbilisi), ყველა query, რომელიც მასზე თარიღის boundary-ს აგებს, იგივე კონვენცია უნდა გამოიყენოს — `CURRENT_DATE`/`CURRENT_TIMESTAMP`-ის "შიშველი" გამოყენება მიიღებს DB სესიის default timezone-ს (Neon-ზე UTC), რაც ჩუმად გაუსწორდება მონაცემების რეალურ timezone-ს.

---

## ✅ დასრულებულია, ტესტირებული, production-ზეც დადასტურებული — STEP 8: Superadmin Panel (პლატფორმის მართვა), 24.08.2026

### გადაწყვეტილების წერტილი — მომხმარებლის კითხვიდან

მომხმარებელმა დასვა საკვანძო კითხვა: STEP 1-3-ის შემდეგ კომპანიები თავად რეგისტრირდებიან და ერთმანეთისგან იზოლირებულები არიან (STEP 2-ის org-scoping), მაგრამ **პლატფორმის მხარეს არცერთი მექანიზმი არ არსებობდა** ყველა კომპანიის ერთად სანახავად/სამართავად — მხოლოდ pgAdmin-ში ხელით SQL. ეს STEP ხურავს ამ ხარვეზს Superadmin-ის (platform-wide, ყველა org-ზე წვდომადი) როლის დამატებით.

`AskUserQuestion`-ით დაზუსტებული 2 არქიტექტურული გადაწყვეტილება:

1. **Auth მექანიზმი: სრულად ცალკე `platform_admins` ცხრილი** (არა ახალი როლი `users` ცხრილში). მიზეზი — STEP 2-ის ტენანტ-იზოლაციის ინვარიანტი (`users.organization_id` ყოველთვის NOT NULL, ყველგან `WHERE organization_id = $1`) არ უნდა შესუსტდეს ახალი, ორგანიზაციის-გარეშე როლის დამატებით. Superadmin-ს სულ სხვა JWT claim-ი (`type: 'platform-admin-auth'`), სულ სხვა middleware, სულ სხვა login endpoint აქვს — cross-tenant პრივილეგიის შემთხვევითი გაჟონვის რისკი არქიტექტურულად გამორიცხულია.
2. **v1 scope (4/4 არჩეული):** კომპანიების სია + სტატუსი, Suspend/Activate + trial გაგრძელება, Cross-org აუდიტი/სტატისტიკა, Superadmin action-ების log.

### Backend

**ახალი migration `015_add_platform_admins.sql`** — `platform_admins` (id, name, email, password_hash, is_active, created_at — `LOWER(email)`-ზე unique index) + `superadmin_audit_logs` (platform_admin_id FK, action, target_organization_id FK `ON DELETE SET NULL`, details, created_at, 3 index). `organizations.status`-ის CHECK constraint (`trial/active/suspended/cancelled`) და `trial_ends_at` სვეტი migration 013-იდან უკვე არსებობდა — მხოლოდ **enforcement** (login-ის დაბლოკვა) აკლდა, ახლა დამატებულია.

**ახალი `middleware/platformAdminAuth.ts`** — `authenticatePlatformAdmin` + `signPlatformAdminToken`, სრულად დამოუკიდებელი `auth.ts`-ის `authenticateToken`/`CustomRequest`-გან. Token TTL: 12სთ.

**ახალი `middleware/platformAdminLoginRateLimit.ts`** — `managerPinRateLimit.ts`-ის იგივე in-memory პატერნი (5 მცდელობა/15წთ, IP+email key).

**ახალი `routes/platformAdmin.ts`** — ყველა route `/api/platform-admin/...`:

| Endpoint | დანიშნულება |
|---|---|
| `POST /platform-admin/login` | rate-limited, `bcrypt.compare`, `is_active` შემოწმება |
| `GET /platform-admin/organizations` | ყველა org + სტატისტიკა (user_count, admin_email, total_revenue, receipt_count — **3 ცალკე correlated subquery, არა LEFT JOIN**, users×payments Cartesian fan-out-ის თავიდან ასაცილებლად, რაც SUM/COUNT-ს გააბერავდა) |
| `GET /platform-admin/organizations/:id` | ერთი org-ის დეტალები + users სია + stats |
| `PATCH /platform-admin/organizations/:id/status` | Suspend/Activate (`trial/active/suspended/cancelled`) + audit log |
| `PATCH /platform-admin/organizations/:id/trial` | Trial-ის გაგრძელება (`GREATEST(COALESCE(trial_ends_at, NOW()), NOW()) + N days` — უკვე ამოწურული trial-იც სწორად NOW()-დან აითვლის) + audit log |
| `GET /platform-admin/audit-logs` | ყველა superadmin action-ის ისტორია (paginated) |

**`auth.ts` — Suspend-ის რეალური enforcement** — `POST /login`-ის SELECT query-ს დაემატა `JOIN organizations`, ახალი შემოწმება (`user.status === 'inactive'`-ის წინ): თუ `organization_status IN ('suspended', 'cancelled')` → 403, "თქვენი ორგანიზაცია დაბლოკილია". ხელით curl-ით დადასტურებული: normal login 200-ია suspend-მდე/reactivate-ის შემდეგ, suspend-ის დროს ზუსტად 403.

**ახალი `create-platform-admin.ts`** (CLI bootstrap script, `npm run create-platform-admin -- "სახელი" "email" "პაროლი"`) — `migrate.ts`-ის იგივე კონვენცია (`./db`-ს პირდაპირ იყენებს, `./index`-ს არა, რომ Express/Sentry არ ჩაირთოს). Superadmin ანგარიშის შექმნის **ერთადერთი** გზაა — განზრახ არ არსებობს საჯარო self-service registration endpoint (განსხვავებით `organizations.ts`-ის ჩვეულებრივი კომპანიის რეგისტრაციისგან), რადგან ეს ანგარიში ყველა კომპანიაზე წვდომას აძლევს.

**`types.ts`** — `PlatformAdmin`, `SuperadminAuditLog` ინტერფეისები დაემატა.

### Frontend

**ახალი, App.tsx-გან სრულად იზოლირებული root** (`/admin` pathname-ზე):

- **`lib/platformAdminApi.ts`** — ცალკე axios instance, საკუთარი request/response interceptor-ებით (`payflow_platform_admin_token` localStorage key, App.tsx-ის `'token'`-ისგან განსხვავებული). **მიზეზი:** App.tsx-ს module-level-ზე უკვე რეგისტრირებული აქვს გლობალური axios interceptor, რომელიც ტენანტის `'token'`-ს ყველა request-ს აბამს — Superadmin-ის calls-ისთვის ეს არასწორი იქნებოდა.
- **`index.tsx`** — root კომპონენტი აღარ არის სტატიკურად `import App from './App'`, არამედ **`React.lazy()`**-ით, pathname-ის მიხედვით: `/admin` → `admin/PlatformAdminApp`, სხვა ყველაფერი → `App`. **მიზეზი:** სტატიკური import მაინც გაუშვებდა App.tsx-ის module-level axios-interceptor კოდს, თუნდაც `<App />` არ დარენდერებულიყო — ეს დააბინძურებდა Superadmin-ის API calls-საც ტენანტის ტოკენით. `vite build`-ით დადასტურებულია (იხ. ვერიფიკაცია ქვემოთ), რომ `PlatformAdminApp` მართლაც ცალკე JS/CSS chunk-შია, App.tsx-ისგან სრულად განცალკევებული.
- **`admin/PlatformAdminApp.tsx`** — root: login/dashboard state, `platform-admin:session-expired` event listener (401/403-ზე ავტომატური re-login).
- **`admin/PlatformAdminLogin.tsx` + `.module.scss`** — `Login.tsx`-ის მსგავსი სტრუქტურა (card/form/field/label/input), განზრახ ვიზუალურად განსხვავებული (მუქი ფონი, GSAP-ის/"კომეტისებრი" ring-ის გარეშე) — ერთი შეხედვით ცხადია, რომ ეს პლატფორმის-დონის login-ია.
- **`admin/PlatformAdminDashboard.tsx` + `.module.scss`** — ტაბები "კომპანიები"/"Action Log". კომპანიების ცხრილი (`table-base` მიქსინი) — სტატუსის `badge()`, Suspend (დადასტურების მოდალით — ერთადერთი დესტრუქციული action, რეალურ მომხმარებლებს ბლოკავს)/Activate ღილაკები, Trial-გაგრძელების მოდალი, კომპანიის დეტალების მოდალი (users სია + stats). ყველა არსებული SCSS მიქსინის ხელახლა გამოყენებით (`card`, `input-base`, `btn-*`, `badge`, `table-base`, `modal-overlay`/`modal-body`) — ახალი სტილები არ დაწერილა თავიდან.

**`vercel.json` — SPA fallback-ის კრიტიკული ფიქსი.** ეს იყო ამ სესიაში ცალკე აღმოჩენილი, deploy-blocking ხარვეზი: არსებული `routes`-კონფიგურაცია (`"/(.*)" → "frontend/$1"`) ყოველთვის საკმარისი იყო აქამდე, რადგან აპლიკაციას router არ ჰქონდა და ერთადერთი URL `/`-ი იყო. STEP 8 კი პირველად ამატებს **რეალურ, პირდაპირ-navigatable URL-ს** (`/admin`) — ამ catch-all წესის ქვეშ Vercel-ის `routes` (განსხვავებით `rewrites`-გან) filesystem-ს ავტომატურად არ ამოწმებს, ანუ პირდაპირი გადასვლა `https://.../admin`-ზე production-ში **404-ს დააბრუნებდა**, მიუხედავად იმისა, რომ ლოკალურ Vite dev server-ზე (რომელსაც historyApiFallback ჩართული აქვს) ყველაფერი გამართულად იმუშავებდა — იგივე ხასიათის რისკი, რაც Dashboard-ის timezone ბაგს ჰქონდა ("ლოკალურად მუშაობს, production-ზე არა"). გასწორდა ორი ახალი, ცხადი `routes`-ჩანაწერით (`/admin`, `/admin/(.*)` → `frontend/index.html`), არსებული routes უცვლელად დარჩა.

### ვერიფიკაცია

1. **Backend `tsc --noEmit`** — სუფთა.
2. **`vitest run tests/isolation`** — 39/39 მწვანე, რეგრესია არ არის.
3. **ხელით curl end-to-end** (ცალკე sandbox backend + Postgres-ის წინააღმდეგ): login, org-სია, org-დეტალები, suspend → login 403, activate → login აღდგება, trial-გაგრძელება, audit-log ჩანაწერი, invalid status → 400, ავტორიზაციის გარეშე → 401, ტენანტის ტოკენით Superadmin route → 403 (და პირიქით — Superadmin ტოკენით ტენანტ route → 403), invalid UUID → 400.
4. **Frontend `vite build`** — სუფთად აშენდა (ცალკე sandbox-ში, სრული dependency-ნაკრებით), `PlatformAdminApp` დადასტურებულია ცალკე chunk-ად (`App`-ისგან განცალკევებული, lazy-loading-ის სისწორის დამადასტურებელი).
5. **Frontend `tsc --strict --noEmit`** ახალ ფაილებზე (`index.tsx`, `admin/*`, `lib/platformAdminApi.ts`) — სუფთა, `any` არსად გამოყენებული (ხელით grep-ითაც დამატებით დადასტურებული).

### Deploy-ის თანმიმდევრობა (როგორც რეალურად შესრულდა)

1. **Migration 015** — ჯერ ლოკალურად (pgAdmin, `COMMIT`, შეცდომის გარეშე), მერე production Neon-ზე (SQL Editor, branch `production`) — 9/9 statement "Statement executed successfully".
2. **`npm run create-platform-admin -- "სახელი" "email" "პაროლი"`** — ჯერ ლოკალურად (`backend/`-ის ქვეფოლდერიდან — `ENOENT`-ის ერთხელოვანი შეცდომა repo-root-იდან გაშვებისას, გასწორდა `cd backend`-ით), მერე production DB-ის წინააღმდეგაც ცალკე, დროებითი `$env:DATABASE_URL` override-ით (PowerShell სესია-scoped, `.env`-ს არაფერი ეხება).
3. **ლოკალური სრული write-path ტესტი `/admin`-ზე deploy-მდე** — login, org-სია, Suspend → tenant login 403 → Activate → tenant login აღდგა → Trial +14 დღე — ოთხივე ზუსტად მოსალოდნელისამებრ.
4. `git add`/`commit`/`push` — იხ. ⚠️ ქვემოთ, ეს ეტაპი ერთხელ გამოტოვებული აღმოჩნდა.
5. Production migration 015 (item #1) გატარდა commit/push-ზე **ადრე**, roadmap-ის სტანდარტული lesson-ის მიხედვით.

⚠️ **ახალი lesson learned — "push წარმატებულია" ≠ "ეს კოდი push-ილია".** STEP 8-ის ყველა ფაილი დროულად მიეწოდა მომხმარებლის დისკზე (device bridge-ით), მაგრამ `git add`/`commit` ამ ფაილებზე ამ სესიაში ფაქტობრივად არასდროს გაშვებულა — მომხმარებლის მიერ ადრე გაშვებული `git push` სინამდვილეში ძველ, უკვე არსებულ ლოკალურ commit-ებს (Dashboard timezone ბაგის) აგზავნიდა, არა STEP 8-ს. შედეგად production-ზე `/admin` 404-ს აბრუნებდა Vercel-იდან პირდაპირ (incognito-ტესტით დადასტურებული — Service Worker-ის ქეშის ვერსია გამოირიცხა). **დიაგნოსტიკა:** Vercel Dashboard → Deployments-ის სია — უახლესი Production-commit-ის შეტყობინება/თარიღი პირდაპირ აჩვენებს, რეალურად რა არის deploy-ილი (არა ვარაუდი "push ხომ გავუშვით"-ზე დაყრდნობით). **Fix:** `git status` → დადასტურდა, ყველა STEP 8 ფაილი (`modified`/`Untracked`) უცვლელად იდგა ლოკალურად → `git add`/`commit`/`push` ხელახლა, ამჯერად რეალურად STEP 8-ის ფაილებით.

✅ **Commit:** `1a5e911` — ქართულად ("STEP 8: Superadmin პანელი — platform_admins auth, org მართვა (suspend/activate/trial), audit log"), push-ილია `main`-ზე (`a2c93ba..1a5e911`).

✅ **Production-ზე ხელით დადასტურებული** (`pay-flow-zet3.vercel.app/admin`): login ახლადშექმნილი Superadmin ანგარიშით, org-სია სწორი სტატისტიკით — **ლოკალურის იდენტური ქცევა**.

⚠️ **დარჩენილი, მომავალი STEP-ების scope:** ცალკე UI Superadmin ანგარიშების შესაქმნელად (ამ ეტაპზე მხოლოდ CLI), billing/გეგმის მართვა, org-ის სრული წაშლა, უფრო დეტალური audit-ლოგის ფილტრაცია.

---

## 🔒 გადაწყვეტილება — `users.name` uniqueness რჩება გლობალური (არა per-org), 24.08.2026

### კონტექსტი

განახლებული პრიორიტეტების რიგის (item #11-ის ღია დათქმა) ლოგიკური შემდეგი ნაბიჯი ეს იყო — `products.name`-ის migration 013-ის იგივე პატერნით (`UNIQUE(barcode)/(name)` → `UNIQUE(organization_id, barcode)/(organization_id, name)`) `users.name`-ისთვისაც გამეორება, რომ ორ სხვადასხვა org-ს შეძლებოდა ერთი და იმავე admin-username-ის (მაგ. "admin") არჩევა STEP 3-ის (self-service registration) დროს.

### რატომ არ არის ეს "products.name-ის იგივე ფიქსი"

`products.name`-ის per-org unique constraint უსაფრთხოა, რადგან **ყველა** query, რომელიც მასზე დამოკიდებულია (`dupCheck`, `GET /products` და ა.შ.), უკვე ავტორიზებული მოთხოვნაა — JWT-ს (და მასში `organizationId`-ს) უკვე გააჩნია context, სანამ `products.name`-ს საერთოდ ვინმე ეხება.

`users.name` კი განსხვავებულია: `POST /login` (`auth.ts`, ხაზი ~59-66) მომხმარებელს პოულობს **მხოლოდ** `WHERE LOWER(u.name) = LOWER($1) LIMIT 1`-ით — org-ის კონტექსტის გარეშე, რადგან org-ი (და მისი JWT) სწორედ ამ query-ის შედეგადაა მისაღები (chicken-and-egg). Login ფორმას ამჟამად მხოლოდ ერთი ველი აქვს — username + password, კომპანიის იდენტიფიკატორის გარეშე.

თუ `users.name`-ს per-org unique გავხდიდით constraint-ის დონეზე, ეს **არ** მოაგვარებდა რეალურ პრობლემას — მხოლოდ დაშვებდა ორ org-ს ერთი და იმავე username-ის ქონას, `POST /login`-ის query კი კვლავ `LIMIT 1`-ს დაუბრუნებდა შემთხვევით ერთ-ერთს ორივედან. ესეც სახიფათო რომ არა (რომელი org-ის admin შედის, დამოკიდებული იქნებოდა row-order-ზე/`created_at`-ზე, არა მომხმარებლის განზრახვაზე), password-ის `bcrypt.compare`-იც მხოლოდ ერთ candidate-row-ს შეამოწმებდა — ანუ **სწორ org-ში სწორ password-ითაც კი login ვერ გაივლიდა**, თუ query-მ არასწორი org-ის იგივე-username row აარჩია.

### გადაწყვეტილება (`AskUserQuestion`-ით დაზუსტებული)

3 ვარიანტი დაისვა (products.name-ის იგივე per-org migration; per-org + login-ზე company-slug ველის დამატება; per-org + login მხოლოდ email-ით admin-ისთვის) — **მომხმარებელმა აირჩია სტატუს-კვოს შენარჩუნება**: `users.name` რჩება **გლობალურად unique** (`users_name_key`, migration 001-იდან, უცვლელი).

**რატომ ეს გონივრულია, არა უბრალოდ "გადადება":**
- ეს არ ბლოკავს არცერთ არსებულ ნაკადს — STEP 3-ის registration უკვე მეგობრულად აბრუნებს 409-ს დაკავებული username-ის შემთხვევაში (`organizations.ts`, ხაზი 112-115 + 23505 fallback).
- ალტერნატივები (login-ზე company-slug ველის დამატება, ან email-ზე დაფუძნებული login) ორივე მოითხოვდა login-ის ფლოუს/UI-ს გადაკეთებას — risk/scope რეალურ პრობლემასთან (username-კონფლიქტის onboarding-friction) შედარებით არაპროპორციულია STEP 7-მდე (subdomain routing), რომლის ფარგლებშიც ბუნებრივად გაჩნდება org-disambiguation მექანიზმი login-ისთვის (subdomain-ის მიხედვით).
- `users.name`-ის გლობალური uniqueness-ი რეალურად **იცავს** login-ის ამჟამინდელ, მარტივ (username+password) მოდელს — ambiguity-ს არქიტექტურულადვე გამორიცხავს, `LIMIT 1`-ის საფრთხის გარეშე.

### შედეგი

**კოდის ცვლილება არ განხორციელებულა.** `users_name_key` (global UNIQUE) უცვლელი რჩება. საკითხი ხელახლა უნდა გადაისინჯოს STEP 7-ის (subdomain routing) ფარგლებში, როცა login-ს ისედაც დასჭირდება org-resolution მექანიზმი (subdomain/slug-ის საშუალებით) — მხოლოდ მაშინ იქნება უსაფრთხო `users.name`-ის per-org დაშვება, რადგან login-ს მანამდე უკვე ექნება org-context, `POST /login`-ის query-ს კი დაემატება `AND organization_id = $2`.

---

## 🌿 Neon branch-ზე migration-ის ავტომატური ტესტირება, 24.08.2026

### კონტექსტი

განახლებული პრიორიტეტების რიგის item #10 — "🚨 Production ინციდენტი" სექციის lesson learned-ის პირდაპირი გაგრძელება: 23.08-ის production crash-ის root cause ის იყო, რომ migration 013 არასდროს გატესტილა production-ის რეალურ schema-ზე push-ამდე, მხოლოდ ლოკალურად. ამ ხარვეზის სტრუქტურული (არა მხოლოდ "მომავალში ყურადღებით ვიყოთ"-ტიპის) გადაწყვეტა იყო მიზანი.

### აღმოჩენა — network egress შეზღუდვა

სანამ ავტომატიზაციაზე გადავიდოდით, დადასტურდა, რომ **არც Claude-ის cloud sandbox-ს, არც device_bash-ის (მომხმარებლის კომპიუტერზე მომუშავე) sandbox-ს არ აქვს ქსელური წვდომა Neon API-სთან** (`api.neon.tech`/`console.neon.tech`) — ორივე მხრიდან timeout/no-network დადასტურდა ცხადად. ეს ორგანიზაციის/ანგარიშის egress allowlist-ის შეზღუდვაა.

**გადაწყვეტილება (მომხმარებელთან განხილვის შემდეგ):** სკრიპტი დაიწერა ისე, რომ **მომხმარებელმა თავად გაუშვას საკუთარი ტერმინალიდან** (VS Code-ში), სადაც ჩვეულებრივი, შეუზღუდავი ინტერნეტია — Claude ვერ იძახებს ამ სკრიპტს პირდაპირ, მაგრამ სკრიპტი თავად სრულად ავტომატიზებულია (ერთი command, არა ხელით Neon console-ში click-through).

### რა აშენდა

**`backend/src/test-migration-on-branch.ts`** — Neon API-ს (`console.neon.tech/api/v2`) გამოყენებით:
1. პოულობს parent branch-ს (`NEON_PARENT_BRANCH`, default `"production"`).
2. ქმნის დროებით child branch-ს production-იდან (copy-on-write, production-ის მონაცემებს/performance-ს არ ეხება).
3. Neon-ის ასინქრონული ოპერაციების (`operations`) დასრულებას პოლინგავს, სანამ endpoint არ იქნება მზად.
4. connection URI-ს იღებს (`/connection_uri` endpoint, branch-ის database/role-იდან).
5. მითითებულ ერთ migration ფაილს უშვებს ამ branch-ზე (`pg`-ით, `db.ts`-ის იგივე SSL კონვენცია).
6. sanity-შემოწმებას სვამს (public schema-ს ცხრილების სია).
7. შლის დროებით branch-ს (`--keep`-ით შეიძლება დატოვო ხელით შესამოწმებლად, connection string-იც იბეჭდება).

**`backend/package.json`** — `npm run test-migration -- <ფაილი.sql> [--keep]`.
**`backend/.env.example`** — ახალი, დოკუმენტაციისთვის (`NEON_API_KEY`/`NEON_PROJECT_ID`/`NEON_PARENT_BRANCH`-ის სახელები, ცარიელი მნიშვნელობებით — `.gitignore`-ით ერთადერთი `.env*` ფაილი, რომელიც commit-დება).

### Setup (მომხმარებლის მხრიდან)

- `NEON_API_KEY` — console.neon.tech → Account settings → API keys → "Create new API key" (Free plan-ზე account-wide, project-scope არჩევანი არ ჩანდა).
- `NEON_PROJECT_ID` — `rough-lake-28754800` (ჩანს პირდაპირ console.neon.tech-ის URL-ში).
- `NEON_PARENT_BRANCH=production`.

ორივე ველი `backend/.env`-ში ჩაიწერა (chat-ში არასდროს გამოჩენილა რეალური მნიშვნელობა, `.env` `.gitignore`-ით დაცულია).

⚠️ **ინციდენტი setup-ის დროს:** მომხმარებელმა პირველად "Connect to your branch" მოდალიდან Postgres connection string ჩააკოპირა `NEON_API_KEY`-ის ადგილას (არასწორი მნიშვნელობა — connection string ≠ API key), screenshot-ის საშუალებით ეს რეალური production DB პაროლიც გამოჩნდა chat-ში. რეკომენდირებული იყო role-ის პაროლის reset (Neon console-ის "Reset password") სიფრთხილისთვის — სწორი, ცალკე API key ბოლოს "Account settings → API keys"-იდან დაგენერირდა.

### ვერიფიკაცია (რეალური გაშვება, მომხმარებლის ტერმინალიდან)

`npm run test-migration -- 014_add_users_email.sql` — სრული ციკლი წარმატებით: parent branch ნაპოვნია (`production`, `br-polished-sunset-a2cyz4i4`) → დროებითი branch შეიქმნა და endpoint მზად გახდა (`br-plain-meadow-a2c86ik3`) → connection string აღებულია → migration გაეშვა და **მოსალოდნელად** დაეჯახა თავისივე idempotency-გუარდს ("Migration 014 უკვე გატარებულია" — migration 014 უკვე ერთხელაა production-ზე გატარებული, ანუ branch ზუსტად production-ის მდგომარეობას ასახავდა) → branch წარმატებით წაიშალა.

ეს დადასტურებულია, როგორც **სრული success ამ ტესტისთვის** — თავად "migration ჩავარდა"-ს მოსალოდნელობა (უკვე გატარებული migration-ისთვის) სწორედ იმის მტკიცებულებაა, რომ branch production-ის ზუსტი ასლია და მთელი ავტომატიზაცია (create → connect → run → cleanup) გამართულია. Production-ს არაფერი შეხებია.

### შედეგი

STEP 2.2-ის (RLS) გარდა, roadmap-ის ყველა დანარჩენი ღია პუნქტი ამ სესიით დაიხურა. მომავალი ნებისმიერი migration (STEP 7-ის subdomain-routing-ის, ან სხვა) ახლა შეიძლება უსაფრთხოდ გატესტდეს production-ის ასლზე, push/production-migration-ამდე — ზუსტად ის პროცესის ხარვეზი, რომელმაც 23.08-ის ინციდენტი გამოიწვია, ახლა დახურულია.

---

## 🏢 STEP 7-lite — კომპანიის slug login, 24.08.2026

### კონტექსტი

STEP 7-ის (item #14, subdomain routing) კვლევისას გაირკვა, რომ **რეალური subdomain-ზე routing ამჟამინდელ ინფრასტრუქტურაზე შეუძლებელია**: Vercel-ის საზიარო `*.vercel.app` დომეინი (`pay-flow-zet3.vercel.app`) wildcard subdomain-ს (`acme.pay-flow-zet3.vercel.app`) არ უჭერს მხარს პროექტის დონეზე — თითო პროექტს ერთი, ფიქსირებული მისამართი აქვს. ნამდვილი subdomain-per-tenant routing მოითხოვს საკუთარ (ფასიან) domain-ს + Vercel wildcard domain + DNS wildcard ჩანაწერს — ეს მომავლის, ფასიანი ეტაპია.

ამ შეზღუდვის ფარგლებში, **STEP 7-ის ფუნქციური არსი** (login-ს გააჩნია org-context, `users.name`-ის per-org uniqueness შესაძლებელია) მაინც მიღწევადია **ორსაფეხურიანი login UI-ით** (Slack/Notion-ის msგავსი პატერნი) — ეს არის STEP 7-lite. ამავდროულად ეს ხსნის "🔒 გადაწყვეტილება — `users.name` uniqueness"-ის ღია კითხვას: login-ს ახლა გააჩნია org-context slug-ის საშუალებით, ანუ `users.name` საბოლოოდ შეიძლება per-org unique გახდეს.

### რა შეიცვალა

**ახალი migration — `backend/migrations/016_users_name_per_org.sql`:**
`users_name_key` (გლობალური `UNIQUE(name)`) იშლება, ცვლის `uq_users_org_name` — `UNIQUE INDEX (organization_id, LOWER(name))` (migration 013/014-ის იგივე per-org, case-insensitive კონვენცია). ⚠️ **ჯერ არ გაშვებულა არც ლოკალურად, არც production-ზე.**

**`backend/src/routes/auth.ts` — `POST /login`:**
ახლა მოითხოვს `slug`-საც request body-ში (400, თუ არ არის). Query-ს დაემატა `JOIN organizations o ... WHERE o.slug = LOWER($1) AND LOWER(u.name) = LOWER($2)` — ჯერ ცალსახად ვპოულობთ org-ს, მერე user-ს მის შიგნით. ძველი `LIMIT 1`-ის ambiguity-რისკი (ორ org-ს ერთი და იმავე username რომ ჰყავდეს) ამით საბოლოოდ მოშორებულია.

**`backend/src/routes/organizations.ts` — ახალი public endpoint:**
`GET /organizations/resolve/:slug` — login-ის 1-ლი ნაბიჯისთვის: ადასტურებს, რომ slug-ით კომპანია არსებობს და აბრუნებს მის სახელს (org-ის სახელის საჩვენებლად, სანამ credentials-ის ველები გამოჩნდება). განზრახ **არ** ამოწმებს `org.status`-ს (suspended/cancelled) — ეს დარჩა მხოლოდ `POST /login`-ის პასუხისმგებლობად. ასევე მოშორდა STEP 3 registration-ის მოძველებული, გლობალური username-uniqueness წინასწარი შემოწმება (migration 016-ის შემდეგ ახალი org ცარიელია შექმნისას, ანუ per-org კონფლიქტი მასში სტრუქტურულადვე შეუძლებელია).

**`backend/src/middleware/orgResolveRateLimit.ts` (ახალი):**
`registrationRateLimit.ts`-ის იგივე in-memory, IP-keyed პატერნი, ცალკე Map-ით (20/სთ) — რომ slug-enumeration-ის მცდელობებმა STEP 3-ის რეგისტრაციის (5/სთ) ბიუჯეტი არ ამოწუროს.

**`frontend/src/pages/Login.tsx` — ორსაფეხურიანი UI:**
1) Subdomain/slug ველი → `GET /organizations/resolve/:slug` → კომპანიის სახელი ჩნდება. 2) ჩვეულებრივი username/password, ახლა org-სახელის ქვეშ (`"← სხვა კომპანია?"` ბმულით უკან დასაბრუნებლად). ბოლოს გამოყენებული slug `localStorage`-ში ინახება (UX convenience, non-critical — `try/catch`-ით დაცული). `frontend/src/App.tsx`-ის `handleLoginAttempt` შესაბამისად განახლდა (`slug` პარამეტრი დაემატა, `POST /api/login`-საც გადაეცემა).

**ტესტები (`backend/tests/isolation/`):**
- `api.ts` — `login()`-ს დაემატა `slug` პარამეტრი (`username`-ის წინ); ახალი `loginAttempt()`/`resolveOrganization()` helper-ები ნეგატიური სცენარებისთვის (status-კოდის პირდაპირი შემოწმება, `login()`-ის throw-on-non-200-ის გვერდის ავლით).
- `seed.ts` — `SeededUser`-ს დაემატა `orgSlug`; `seedTestUser`/`seedOrgWithAdmin`/`seedOrgUser` ყველა აბრუნებს მას (ან default org-ის, ან გადაცემული org-ის slug-ს).
- `tenant-isolation.test.ts` — ყველა არსებული `login(...)` call-site (8) და `seedOrgUser(...)` call-site (2) განახლდა ახალი სიგნატურით; დაემატა ახალი describe-ბლოკი ("STEP 7-lite") 7 ახალი ტესტით: (ა) ორ სხვადასხვა org-ს ერთი და იმავე username-ის cashier-ი შეუძლია, თითოეული საკუთარი slug-ით ცალსახად შედის (migration 016-ის მთავარი დადასტურება), (ბ) `POST /login` slug-ის გარეშე → 400, (გ) არარსებული slug → 404, (დ) სწორი slug, არასწორი პაროლი → 401, (ე) `GET /organizations/resolve/:slug` — ნაპოვნი/(ვ) ვერნაპოვნი, (ზ) rate-limit (20/სთ) ამოწურვა.

### ვერიფიკაცია (ეს სესია)

**`tsc --strict --noEmit`** (scoped, ცალკეულ ფაილებზე, backend/frontend-ის ორივე toolchain-ით) — ყველა ახალი/შეცვლილი ფაილი (`orgResolveRateLimit.ts`, `organizations.ts`, `auth.ts`, `tests/isolation/api.ts`, `tests/isolation/seed.ts`, `tests/isolation/tenant-isolation.test.ts`, `Login.tsx`, `App.tsx`) — **სუფთა, `any` არსად**.

⚠️ **აღმოჩენა ვერიფიკაციისას:** `frontend`-ს **საერთოდ არ აქვს** `typescript` დამოკიდებულება დაყენებული (`package.json`-ში არც devDependency, არც `tsconfig.json`) — `npm run build` (`vite build`) ტიპების შემოწმებას საერთოდ არ აკეთებს, მხოლოდ esbuild-ის transpile-ს. ანუ ტიპის შეცდომები frontend-ში ამჟამად **მხოლოდ** ამ სესიის ხელით, დროებით დაყენებული `typescript`-ით შემოწმდა — ეს არაა repo-ს მუდმივი ნაწილი. **რეკომენდაცია (არ განხორციელებულა, მომხმარებლის გადასაწყვეტია):** `typescript` დაემატოს `frontend`-ის devDependency-ებში + `tsconfig.json` შეიქმნას, რომ ტიპის უსაფრთხოება მუდმივად, ავტომატურად მოწმდებოდეს (და არა მხოლოდ session-დამოკიდებულად).

**`vitest run tests/isolation`** — ✅ **გაშვებულია, სრული წარმატება: 46 passed | 1 todo (47 total)**.

### ✅ შესრულებული ნაბიჯები (24.08.2026)

1. **Migration 016 Neon branch-ზე ტესტი** — `npm run test-migration -- 016_users_name_per_org.sql` — წარმატებული, production-ზე ზემოქმედების გარეშე.
2. **Migration 016 ლოკალურად** (pgAdmin) — წარმატებით გატარდა.
3. **`vitest run tests/isolation`** ლოკალურად — 46 passed | 1 todo (47 total), STEP 7-lite ბლოკის ჩათვლით.
4. **Migration 016 production Neon-ზე** (SQL Editor, branch `production`) — წარმატებით გატარდა commit/push-მდე, roadmap-ის სტანდარტული lesson-ის მიხედვით.
5. `git add`/`commit`/`push` — commit `a5bd6e7` ("feat: STEP 7-lite — კომპანიის slug login + users.name per-org unique"), ზუსტად 10 შეცვლილი ფაილით (`.git/index.lock`-ის VS Code-ის race-ი გვერდი აუარეს რამდენჯერმე — იხ. "🔧 გვერდითი აღმოჩენა" სექცია).
6. **Production deploy (Vercel) დადასტურებულია** — `pay-flow-zet3.vercel.app`-ზე ორსაფეხურიანი slug→credentials login მუშაობს რამდენიმე org-ისთვის (განსხვავებული dashboard-მონაცემები თითოეულისთვის — tenant isolation production-შიც უსაფრთხოდ მუშაობს).

**ღია დარჩა:** `frontend`-ს `typescript` დამოკიდებულება არ აქვს (იხ. ⚠️ აღმოჩენა ვერიფიკაციისას ზემოთ) — მომხმარებლის გადასაწყვეტია, ცალკე task.
