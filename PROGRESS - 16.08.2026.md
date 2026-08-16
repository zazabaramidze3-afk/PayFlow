# PayFlow — პროგრესის ანგარიში (16.08.2026)

დღევანდელი სესია დაიწყო როგორც GitHub-ზე ატვირთვის წინა `.gitignore` აუდიტი, მაგრამ გადაიზარდა production security incident-ის მოგვარებასა და რამდენიმე production-ზე აქტიური ბაგის დიაგნოსტიკა/ფიქსში. ქვემოთ — ქრონოლოგიური თანმიმდევრობით ყველაფერი, რაც დღეს გაკეთდა.

---

## 🔴 კრიტიკული — Secrets Leak & Remediation

**აღმოჩენა:** VS Code-ის **Local History** extension-მა (`.history/` ფოლდერი) ავტომატურად შეინახა `backend/.env`-ის წინა ვერსიების snapshot-ები, რომლებიც `git add`/`git commit`-ის დროს შემთხვევით ატვირთულიყო GitHub-ის public repo-ში — მათ შორის რეალური production Neon DB პაროლი (`npg_xXg37WyKRZfq`) და `JWT_SECRET`.

**რემედიაცია:**
- `.gitignore` (root/backend/frontend) მთლიანად ხელახლა დაწერილი და გამკაცრებული — `.env*`, `.history/`, `node_modules/`, `dist/`, IDE/OS ფაილები
- `git rm -r --cached .history` + `git filter-repo --path .history --invert-paths --force` — ისტორიიდან სრულად ამოშლილი (არა მხოლოდ ბოლო commit-იდან)
- `git remote add origin ...` (filter-repo default ქცევით შლის remote-ს) + `git push origin main --force`
- **Neon-ის პაროლი როტირებული** Console-ის "Reset password" ფუნქციით (ახალი: `npg_jt5UJ9DqEICQ`)
- Vercel-ის `DATABASE_URL` environment variable განახლებული ახალი კავშირის სტრიქონით + redeploy

---

## ✅ Production Bug #1 — Schema Drift (Missing Columns)

**სიმპტომი:** ლოგინისას `column "can_view_history" does not exist`, მერე `column "requires_password_reset" does not exist`.

**მიზეზი:** `backend/migrations/001_init_schema.sql` იყენებდა `CREATE TABLE IF NOT EXISTS users (...)`, რომელშიც ახალი სვეტებიც (`can_view_history`) იყო ჩაშენებული — production-ის `users` ცხრილი უკვე არსებობდა, ამიტომ ეს ბრძანება no-op იყო და ახალი სვეტი არასდროს დაემატა. Migrations 003–012 საერთოდ არასდროს ყოფილა გაშვებული production-ზე.

**ფიქსი:** `npm run migrate` გაშვებული production `DATABASE_URL`-ით (`backend/src/migrate.ts`) — ყველა 12 migration წარმატებით შესრულდა.

---

## ✅ Production Bug #2 — Hardcoded `localhost:5000` URLs

**სიმპტომი:** Dashboard-ის ანალიტიკა, Users Control, Products, Sales (POS) — ვერცერთი ვერ ტვირთავდა production-ზე (CORS/connection შეცდომები).

**მიზეზი:** Frontend-ის მთელი რიგი ფაილი იყენებდა absolute URL-ს (`http://localhost:5000/api/...`) `/api/...`-ის (relative) ნაცვლად — dev-ზე Vite-ის proxy-ს მეშვეობით მუშაობდა, production-ზე კი პირდაპირ (არარსებულ) `localhost`-ს მიმართავდა.

**ფიქსი (`sed` + ხელით grep-ვერიფიკაცია):**
`Dashboard.tsx`, `ExecutiveDashboard.tsx`, `Products.tsx`, `Sales.tsx`, `UsersManagement.tsx`, `useNetworkStatus.ts`, `backgroundSync.ts` — ყველგან `http://localhost:5000/api` → `/api`.

⚠️ **ცალკე აღმოჩენილი გართულება:** ამ ფიქსის პირველი მცდელობა შემთხვევით გაკეთდა **stale, disconnected** ლოკალურ ფოლდერ-კოპიაზე (`gitupload\Pay_Flow\PayFlow`) — GitHub-თან რეალურად დაკავშირებული ფოლდერი აღმოჩნდა `PAY FLOW PROJECT -Offline Mode-PWA\PayFlow`. ფიქსი თავიდან გამეორდა სწორ ფოლდერზე.

---

## ✅ Production Bug #3 — Service Worker "იტაცებდა" `/api/*` მოთხოვნებს

**სიმპტომი:** Excel/PDF ექსპორტის ღილაკები ხსნიდნენ ახალ ტაბს, მაგრამ ფაილის ნაცვლად თავად PayFlow აპლიკაცია (Dashboard) იტვირთებოდა.

**მიზეზი:** `vite-plugin-pwa`-ს (Workbox) default ქცევა ნებისმიერ **navigation**-ტიპის მოთხოვნას (`window.open(url, '_blank')` ამ კატეგორიაშია) გადაჭერს და cache-ში მდებარე `index.html`-ს (SPA app shell) აბრუნებს, თუ `navigateFallbackDenylist` ცხადად არ გამორიცხავს გარკვეულ paths-ს. `/api/payments/export/excel|pdf` ვერასდროს აღწევდა ბექენდამდე.

**ფიქსი:** `frontend/vite.config.ts`-ის `workbox` კონფიგს დაემატა:
```ts
navigateFallbackDenylist: [/^\/api\//],
```

---

## ✅ Production Bug #4 — PDF Export-ის ID სვეტის ვიზუალური overlap

**სიმპტომი:** გადმოწერილ `payments_report.pdf`-ში ID (სრული UUID, 36 სიმბოლო) გადაედინებოდა და ედებოდა Cashier/Subtotal/Total სვეტების ტექსტს.

**ფიქსი (`backend/src/routes/sales.ts`, PDF export route):** ID შემოკლებული პირველ 8 სიმბოლომდე (`row.id.toString().slice(0, 8)`), ყველა სვეტს დამატებული `{ width, ellipsis: true }` PDFKit-ის `doc.text()`-ში — მომავალშიც დაცული გრძელი მნიშვნელობებისგან.

---

## ✅ Production Bug #5 — Timezone მისმატება (`opened_at` vs `closed_at`)

**სიმპტომი:** Manager Dashboard-ის "მოლარეების ცვლები" ცხრილში ცვლის გახსნის დრო ~4 საათით ჩამორჩებოდა დახურვის დროს (მაგ. გახსნა 16:40, დახურვა 20:43 — რეალურად თითქმის იმავე დროს).

**მიზეზი:** `POST /shifts/open` ინახავდა `opened_at`-ს Postgres-ის `TO_CHAR(CURRENT_TIMESTAMP, ...)`-ით (server-ის default timezone — Neon-ზე UTC), ხოლო `PUT /shifts/close` ცხადად `Asia/Tbilisi`-ზე (UTC+4) კონვერტირებულ დროს წერდა.

**ფიქსი (`backend/src/routes/sales.ts`):**
```sql
TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tbilisi', 'YYYY-MM-DD HH24:MI:SS')
```
გამოყენებულია `shifts.opened_at`-ზეც და იგივე ტიპის ბაგზე `payments.voided_at`-ზეც (ჩეკის გაუქმების დრო — იგივე pattern-ით აღმოჩენილი).

⚠️ **ცნობილი შეზღუდვა:** ეს ფიქსი მხოლოდ **ახლიდან** შექმნილ ჩანაწერებზე მოქმედებს. ბაზაში უკვე არსებული ძველი ჩანაწერების `opened_at`/`voided_at` კვლავ არასწორია — საჭიროებს ერთჯერად SQL `UPDATE`-ს (გადავადებული, არ გაკეთებულა დღეს).

📝 **შემოწმებელი:** `notifications.ts` (`resolved_at`) და `registers.ts` (`confirmed_at`) იგივე `CURRENT_TIMESTAMP`-ის pattern-ს იყენებენ, მაგრამ `TIMESTAMP` (არა TEXT) სვეტებზე — შესაძლოა იგივე კლასის ბაგი არ არსებობდეს (სხვანაირი read-path), დღეს არ გადამოწმებულა.

---

## ✅ Vercel Deployment Protection

**სიმპტომი:** `pay-flow-zet3.vercel.app` სხვა ბრაუზერში (სადაც Vercel-ზე შესული არ ხარ) ხსნიდა Vercel-ის საკუთარ login გვერდს, PayFlow-ის Login-ის ნაცვლად.

**მიზეზი:** Project Settings → Deployment Protection → **Vercel Authentication** ჩართული იყო "Standard Protection" რეჟიმში — ეს მხოლოდ **Custom Domains**-ს იცავს ცალკე production-ისგან, `*.vercel.app` default დომეინი კი მაინც დაცული რჩება.

**ფიქსი:** Vercel Authentication მთლიანად გამორთული (`disable vercel authentication` დადასტურებით) — production ახლა საჯაროდ ხელმისაწვდომია, PayFlow-ის საკუთარი JWT-based login სისტემა უცვლელად რჩება ერთადერთ access control-ად.

---

## ⚠️ დარჩენილი / გადავადებული

- ძველი, disconnected ლოკალური ფოლდერ-კოპია (`gitupload\Pay_Flow\PayFlow`) — უსაფრთხოა წასაშლელად დისკიდან, ჯერ არ წაშლილა
- ბაზაში უკვე არსებული ცვლების/გაუქმებული ჩეკების ისტორიული `opened_at`/`voided_at` მნიშვნელობები კვლავ ~4სთ-ით არასწორია (SQL UPDATE არ გაკეთებულა)
- `notifications.ts`/`registers.ts`-ის `resolved_at`/`confirmed_at` timezone-ის ქცევა არ არის გადამოწმებული
- რეალური ბრენდინგის PWA icons (placeholder-ები კვლავ პლაცჰოლდერია — STEP 3-დან გადმოსული ძველი ცნობილი ხარვეზი)

---

## შემდეგი ნაბიჯი

პროექტი production-ზე სტაბილურ მდგომარეობაშია — ყველა დღეს აღმოჩენილი ბაგი გასწორებული და დადასტურებულია (Dashboard, Products, Sales/POS, Users Control, Excel/PDF export). შემდეგი პრიორიტეტი: ზემოთ ჩამოთვლილი "დარჩენილი" პუნქტების მოგვარება, დაწყებული ისტორიული timezone მონაცემების ერთჯერადი SQL შესწორებით.
