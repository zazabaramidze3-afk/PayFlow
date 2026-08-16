You are an expert software architect and full-stack engineer. PayFlow ამჟამად არის **single-tenant** POS/Inventory სისტემა — ერთი ბაზა, ერთი მაღაზია/ქსელი, `registers`/`shifts`/`users` ყველა ერთი ორგანიზაციის ფარგლებში. ეს დოკუმენტი გეგმავს გარდაქმნას **true multi-tenant SaaS**-ად — ერთი დეპლოიმენტი, რომელიც ბევრ დამოუკიდებელ ბიზნესს (ორგანიზაციას) ემსახურება, თითოეულს საკუთარი მონაცემების იზოლაციით, subscription-ითა და self-service signup-ით.

### წყარო
`PROGRESS - 12.08.2026.md` (STEP 1–5 დასრულებული, Late-close guard + code-splitting დამატებული) + `ROADMAP - 11.08.2026.md` (Multi-POS/Offline/Device Pairing საბაზისო არქიტექტურა). ეს roadmap მათზე ზემოდან შენდება — არცერთ STEP 1–5-ს არ ცვლის, მხოლოდ ამატებს tenant-განზომილებას.

### რატომ ასეთი თანმიმდევრობა
Multi-tenancy ერთი ღამის ცვლილება არ არის — ეს არის fundamental data-model გადაწყვეტილება, რომელიც ყველა query-ს ეხება (`sales.ts` მარტო 80KB+ query-ითაა). თანმიმდევრობა აგებულია რისკის კლებადობით: jერ მონაცემთა მოდელი და იზოლაცია (რომ ორ ბიზნესს შორის მონაცემი არასდროს გაჟონოს — ეს SaaS-ის ნდობის საფუძველია), მერე signup/billing (რომ საერთოდ შემოვიდნენ ახალი მომხმარებლები), მერე ოპერაციული მომწიფება (რომ საიმედოდ იმუშაოს production-ზე).

---

### STEP 0: წინაპირობა — არსებული ცნობილი დავალიანებები

Multi-tenant გახსნამდე (უცხო ბიზნესების მონაცემები ერთ სისტემაში) სასურველია დაიხუროს ის ხარვეზები, რაც უკვე `PROGRESS`-შია დოკუმენტირებული — production-ზე გახსნის რისკს ამცირებს:
1. **`tsconfig.json` + `tsc --noEmit`** frontend-ზე (ამჟამად მხოლოდ `vite build`-ითაა შემოწმებული, სრული ტიპ-შემოწმების გარეშე).
2. **`GET /users` `ORDER BY id ASC`** ფიქსი (იგივე UUID-lexicographic ბაგი, რაც STEP 5-ში ოთხ სხვა ადგილას გასწორდა).
3. **რეალური branding icons** (placeholder PNG-ების ნაცვლად) — SaaS-ის public-facing ხარისხის საკითხია.

### STEP 1: Tenant Data Model & Migration

1. ახალი `organizations` ცხრილი: `id` (UUID PK), `name`, `slug` (UNIQUE, subdomain/URL-ისთვის), `status` (`trial`/`active`/`suspended`/`cancelled`), `plan` (FK მომავალი `plans`-ზე ან უბრალო TEXT ჯერჯერობით), `trial_ends_at`, `created_at`.
2. **`organization_id` (UUID, FK) დაემატოს ყველა ცხრილს**, რომელიც ამჟამად "გლობალურია": `users`, `registers`, `shifts`, `payments`, `products`, `activation_codes`, `audit_logs`, `stock_deficit_notifications`, `shift_amendments`. (`payment_items`/`payment_splits` არაპირდაპირ დაცულია `payment_id`-ის FK-ით — ცალკე `organization_id` არ სჭირდებათ, თუ `payments`-ზე join ყოველთვის ხდება.)
3. **Backfill:** ერთი migration script, რომელიც ქმნის ერთ `organizations` row-ს (თქვენი არსებული, უკვე production-ში მყოფი მაღაზია) და ანიჭებს მის `id`-ს ყველა არსებულ row-ს — ნულოვანი downtime, არსებული მონაცემი არ იკარგება.
4. **`products.barcode`/`products.name` UNIQUE constraints** — ამჟამად გლობალურად unique-ია (migration 001), multi-tenant-ში unique უნდა იყოს `(organization_id, barcode)`/`(organization_id, name)` წყვილზე — ორ სხვადასხვა ბიზნესს ერთი და იგივე ბარკოდი/სახელი უნდა შეეძლოთ.

### STEP 2: Tenant Isolation Enforcement — ორი დამოუკიდებელი დაცვის ფენა

ეს არის **ყველაზე კრიტიკული, ნდობის საფუძველი** ნაბიჯი — ერთი გამოტოვებული `WHERE organization_id = $1` ნიშნავს, რომ ერთი ბიზნესი მეორის ჩეკებს/მომხმარებლებს ხედავს.

1. **App-level scoping:** JWT payload-ს დაემატოს `organizationId`. ყველა route-ს (`sales.ts`, `products.ts`, `dashboard.ts`, `registers.ts`, `notifications.ts`, `audit-logs.ts`, `auth.ts`-ის `/users`) გადაუსინჯოთ ყოველი query — `WHERE organization_id = $N` აუცილებელია ყველგან, სადაც ეს ცხრილები გამოიყენება. ეს ფაქტობრივად ყველა route-ის ხელახლა გავლაა (დიდი, მაგრამ მექანიკური სამუშაო).
2. **DB-level backstop — PostgreSQL Row-Level Security (RLS):** app-level scoping-ს ადამიანური შეცდომა შეიძლება მოსდვნას (დაგავიწყდეთ ერთ endpoint-ზე WHERE-ის დამატება). RLS policy (`CREATE POLICY ... USING (organization_id = current_setting('app.current_org')::uuid)`) ყოველ request-ის დასაწყისში (`SET app.current_org`) db connection-ს აიძულებს, ფიზიკურად ვერ დაბრუნოს სხვა tenant-ის row, თუნდაც query-ში WHERE დაგვავიწყდეს. ეს არის defense-in-depth — არა app-level scoping-ის ჩამნაცვლებელი, დამატებითი ბარიერი.
3. **სავალდებულო ტესტების ნაკრები** სპეციალურად tenant-იზოლაციაზე: ორი ორგანიზაცია, ორივეს მონაცემები, და ტესტი ამოწმებს, რომ Org A-ს ტოკენით Org B-ს არცერთი endpoint-იდან (products/payments/shifts/users/notifications) რაიმე არ უბრუნდება. ეს ტესტების კატეგორია პრიორიტეტულია ნებისმიერ ფუნქციონალურ ტესტზე მეტად.

### STEP 3: Self-Service Onboarding & Multi-Tenant Auth

1. **`POST /api/signup`** — ახალი ორგანიზაციის რეგისტრაცია: ბიზნესის სახელი + პირველი admin მომხმარებელი ერთდროულად იქმნება ერთ ტრანზაქციაში (`organizations` row + `users` row, role=`admin`).
2. **Email ვერიფიკაცია** — `migration 004_add_password_reset.sql`-ის უკვე არსებული email infrastructure-ის (თუ არსებობს) გაფართოება ან ახალი `email_verifications` ცხრილი.
3. **გუნდის მოწვევა** — არსებული `UsersManagement.tsx`-ის გაფართოება: admin-მა შეძლოს ახალი მომხმარებლის მოწვევა email-ით საკუთარ org-ში (ამჟამად, ვვარაუდობთ, users პირდაპირ იქმნება — invite-flow-ს accept/token სჭირდება).
4. **Login-ის ცვლილება** — ტოკენი ახლა `organizationId`-საც შეიცავს; `RegisterGuard.tsx`/`registerAuth.ts`-ის Device Pairing (STEP 2, `ROADMAP - 11.08.2026.md`) ასევე tenant-ისთვის უნდა დარჩეს იზოლირებული — `activation_codes`-ის 6-ნიშნა კოდი უნდა შემოწმდეს მხოლოდ იმავე `organization_id`-ის ფარგლებში.

### STEP 4: Billing & Subscription (Stripe)

1. `organizations.plan`/`stripe_customer_id`/`stripe_subscription_id` ველები.
2. Stripe Checkout/Billing Portal ინტეგრაცია — trial → paid გადასვლა, subscription webhook-ების დამუშავება (`invoice.paid`, `customer.subscription.deleted` და ა.შ.) `organizations.status`-ის განახლებისთვის.
3. **Plan-based ლიმიტები** — app-level enforcement (მაგ. `registers`/`users`/`products` row count შემოწმება ახალი resource-ის შექმნისას, plan-ის ლიმიტთან შედარებით) — `POST /api/registers/generate-code`, `POST /api/users`, `POST /api/products`-ში.
4. Suspended/cancelled org-ის ქცევა — login კვლავ დაშვებული, მაგრამ write-ოპერაციები დაბლოკილი ("გადაუხადეთ გამოწერა გასაგრძელებლად" ბანერით), read/export კი ღიაა (მონაცემის მძევლად აღება ცუდი პრაქტიკაა).

### STEP 5: Superadmin / Back-Office Console

1. ახალი role: `superadmin` (მხოლოდ PayFlow-ის, არა client-ის, გუნდისთვის) — ცალკე auth scope, **არ** მიბმული `organization_id`-ზე.
2. Panel: ყველა tenant-ის სია, სტატუსი/plan/usage, ხელით suspend/reactivate, support-ისთვის "impersonate" (დროებითი, ლოგირებული, ცხადად მონიშნული სესია კონკრეტულ org-ში — არასდროს "ჩუმად").
3. Cross-tenant აგრეგირებული მეტრიკები (total MRR, active orgs, churn) — ეს ცალკე dashboard-ია, არა `ExecutiveDashboard.tsx`-ის ნაწილი (რომელიც tenant-ის საკუთარი მენეჯერისთვისაა).

### STEP 6: Production Infrastructure & Observability

1. **Connection pooling მასშტაბით** — ამჟამინდელი `new Pool({ max: 20 })` (`backend/src/db.ts`) ერთი tenant-ისთვის საკმარისია, ბევრი ტენანტისთვის არა — PgBouncer (ან managed DB-ის ჩაშენებული pooler, მაგ. Supabase/Neon) სავალდებულო ხდება.
2. **Managed PostgreSQL** + ავტომატური backup/point-in-time-recovery — ამჟამად ალბათ ერთი instance-ია.
3. **Structured logging + error tracking** (Sentry ან ანალოგი) — ამჟამად `console.log`/`console.error` (მაგ. `index.ts`-ის pool error handler) — production-ზე ბევრი tenant-ისას log-ების ინდექსირება/ძიება tenant-ის მიხედვით აუცილებელია.
4. **Rate limiting** გლობალურად — ამჟამად მხოლოდ `managerPinRateLimit.ts` ერთ endpoint-ზეა; auth/signup endpoint-ებს (brute-force/scraping-ისგან) ცალკე limiter სჭირდება.
5. **CORS-ის დავიწროება** — ამჟამად `app.use(cors())` ყველასთვის ღიაა (`index.ts`); production SaaS-ს კონკრეტული origin-ების allowlist სჭირდება.
6. **CI/CD** — ტესტების/type-check-ის ავტომატური გაშვება ყოველ PR-ზე, staging გარემო production-ის წინ.

### STEP 7: მასშტაბი, შესაბამისობა და გაპრიალება

1. **Custom subdomain/domain per tenant** (`{slug}.payflow.ge` ან საკუთარი დომენი) — `organizations.slug`-ზე დაყრდნობით routing.
2. **Data export/წაშლა tenant-ის მოთხოვნით** (GDPR-ტიპის მოთხოვნა) — org-ის ყველა მონაცემის ექსპორტი/სრული წაშლა ერთი ღილაკით.
3. **White-labeling** (ლოგო/ფერები per tenant) — STEP 3-ის placeholder icons-საც შველის, ერთი გამოსავლით.
4. **Status page + SLA მონიტორინგი**.

---

## შემაჯამებელი პრიორიტეტები

**აუცილებელი, launch-მდე:** STEP 0 (backlog) → STEP 1 (data model) → STEP 2 (იზოლაცია + ტესტები) — ამის გარეშე პროდუქტი უსაფრთხოდ ვერ გაიხსნება მეორე ბიზნესისთვის.

**საჭირო, რომ ვინმემ გადაიხადოს:** STEP 3 (signup) → STEP 4 (billing).

**საჭირო, რომ საიმედოდ იმუშაოს scale-ზე:** STEP 5–7 — ეს პარალელურად/თანდათანობით შეიძლება დაემატოს, launch-ს არ ბლოკავს.
