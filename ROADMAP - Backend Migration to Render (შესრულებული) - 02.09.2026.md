# Backend Migration to Render.com — შესრულების ანგარიში
**სტატუსი:** ✅ **შესრულებულია** (production live)
**თარიღი:** 02.09.2026
**წინაპირობა:** `PLAN - Backend Migration to Render (მომავალი ეტაპი) - 31.08.2026.md`-ში აღწერილი გეგმის რეალიზაცია — trigger პირობა ("Vercel Free Tier-ის 100 MB-execution/day ლიმიტთან მიახლოება") დადგა, ამიტომ migration დღესვე შესრულდა.

---

## 📊 I. საბოლოო არქიტექტურა

| კომპონენტი | სად | სტატუსი |
|---|---|---|
| Frontend (React/Vite) | Vercel | ✅ უცვლელი, `VITE_API_URL` cutover-ით |
| Backend (Express/Node, Docker) | **Render.com** (`payflow-backend`, Frankfurt) | ✅ ახალი, production live |
| Database (PostgreSQL) | Neon (Frankfurt) | ✅ უცვლელი |
| Error Monitoring | Sentry | ✅ დადასტურებული, production-ზე მუშაობს |

**Production URL-ები:**
- Frontend: `https://pay-flow-zet3.vercel.app`
- Backend: `https://payflow-backend-wcye.onrender.com`

---

## 🛠️ II. Backend Deploy-Readiness ფიქსები

| # | პრობლემა | გამოსავალი | ფაილი |
|---|---|---|---|
| 1 | `tsc` აწარმოებდა `dist/src/index.js`-ს, არა `dist/index.js`-ს — ამტვრევდა `package.json`-ის `"main"`-ს | `rootDir`/`outDir`/`include`/`exclude` დამატება | `backend/tsconfig.json` |
| 2 | `"start"` script არ არსებობდა | `"start": "node dist/index.js"` დამატება | `backend/package.json` |
| 3 | PDFKit-ის `Sylfaen.ttf` ფონტი არ იკოპირებოდა `dist`-ში (Z-Report/ინვოისები გატყდებოდა) | `copy-assets` npm script (`fs.cpSync`) build-ის ბოლოს | `backend/package.json` |
| 4 | Docker image — bcrypt native addon Alpine-ზე | Multi-stage build, `python3 make g++` builder stage-ში, `apk del .build-deps` production stage-ში | `backend/Dockerfile` (ახალი) |

**ვერიფიკაცია:** რეალური `docker build` (135.9წმ, 16 ნაბიჯი) + `docker run` + `curl /api/health` → `{"status":"ok"}` — ყველა ტესტი გაკეთდა ლოკალურად, commit-მდე.

---

## ☁️ III. Render Setup

- **Runtime:** Docker (`rootDir: backend`, `dockerfilePath: ./Dockerfile`)
- **Region:** Frankfurt (Neon-ის Frankfurt region-თან შესატყვისად)
- **Plan:** Free (ტესტირებისთვის — იხ. IV. დარჩენილი ამოცანები)
- **Health Check Path:** `/api/health`
- **Env vars:** `DATABASE_URL` (Neon-ის production connection string, pooling ჩართული), `JWT_SECRET` (Render-ის "Generate" ღილაკით — **ახალი**, არა Vercel-ის ძველის იდენტური), `SENTRY_DSN`, `NODE_ENV=production`
- **`render.yaml`** (Blueprint, repo root) — infrastructure-as-code, `sync: false` სამივე secret-ზე

---

## 🔀 IV. Frontend Cutover

| ცვლილება | ფაილი |
|---|---|
| `axios.defaults.baseURL = import.meta.env.VITE_API_URL \|\| ''` | `frontend/src/App.tsx` |
| `platformAdminApi = axios.create({ baseURL: ... })` | `frontend/src/lib/platformAdminApi.ts` |
| `VITE_API_URL: string` ტიპის დეკლარაცია | `frontend/src/vite-env.d.ts` |
| Vercel Env Var დამატება (**Config type**, არა Secret — Vercel `VITE_*` პრეფიქსზე Secret-ს კრძალავს) | Vercel Dashboard → Project → Environment Variables |

**ვერიფიკაცია:** DevTools Network tab → `Request URL: https://payflow-backend-wcye.onrender.com/...`, CORS preflight header-ები, რეალური login+payment ტესტი — production frontend-ი დადასტურებულად Render-ზე მიდის.

---

## 🐛 V. Migration-ის დროს აღმოჩენილი და გასწორებული bug-ები

### 1. Register-token 403 → სრული, არასწორი logout
**მიზეზი:** `JWT_SECRET`-ის rotation-ის (Vercel→Render) გამო ძველი `payflow_register_token` (localStorage) აღარ გადიოდა `jwt.verify`-ს ახალ secret-თან. `requireRegister` middleware აბრუნებდა 403 `"სალაროს ტოკენი არავალიდურია!"`-ს, frontend-ის `App.tsx` interceptor კი ამ error-საც user-ის auth-token-ის მსგავსად აღიქვამდა (`message.includes('ტოკენი')` ძალიან ფართო შემოწმება იყო) — შედეგად სრული session logout ხდებოდა, register re-pairing UI-ის ნაცვლად.

**ფიქსი (commit `7699b9b`):**
- `frontend/src/App.tsx` — `"სალაროს ტოკენი"` 403 ცალკე დამუშავდა, user-ის token არ იშლება
- `frontend/src/components/RegisterGuard.tsx` — ახალი `register:pairing-required` event listener, `isPaired` state-ის reset logout-ის გარეშე

### 2. `GET /organizations/resolve/:slug` rate limit (20/სთ)
ინტენსიური testing-ის დროს ამოიწურა — **სწორი, განზრახული ქცევაა** (anti-enumeration დაცვა), არა bug. Render service-ის restart-მა (in-memory Map) მყისიერად გაასუფთავა.

### 3. Sentry ingestion — end-to-end ვერიფიკაცია
`SENTRY_DSN` Render-ის env var-შია, `Sentry.setupExpressErrorHandler(app)` კოდში სწორადაა ჩართული — დადასტურდა დროებითი `/api/debug/sentry-test` route-ით (commit `8255098`), წარმატებით დაიჭირა production-ზე (issue `PAYFLOW-BACKEND-3`), შემდეგ route წაშლილია (commit `4743311`).

### 4. Payments PDF/Excel export — ძველ Vercel ბექენდზე მიდიოდა
**მიზეზი:** `Dashboard.tsx`-ის `handleExport` ფუნქცია `window.open('/api/payments/export/...', '_blank')`-ს რელატიური URL-ით იძახებდა — `App.tsx`-ის `axios.defaults.baseURL` override მხოლოდ axios-ის request-ებზე მოქმედებს, `window.open`-ზე გავლენა არ აქვს. ბრაუზერი ამ path-ს მიმდინარე origin-თან (`pay-flow-zet3.vercel.app`) ხსნიდა — რადგან ძველი Vercel serverless ბექენდი `vercel.json`-ის მოუცილებელი backend build-ის გამო ჯერ კიდევ ცოცხალია, request სწორედ იქ მიდიოდა, სხვა (ძველი) `JWT_SECRET`-ით → 403 `"ტოკენი არავალიდურია!"`.

**ფიქსი (commit `3e4d5ef`):** `window.open`-ს `import.meta.env.VITE_API_URL` დაემატა, იმავე pattern-ით რასაც `App.tsx`/`platformAdminApi.ts` იყენებს. `Products.tsx`-ის export (`axios.get(..., { responseType: 'blob' })`) ეს პრობლემა არ შეხებია — უკვე axios-ს იყენებდა.

**⚠️ ამ bug-ის მნიშვნელობა:** ეს ცოცხალი დადასტურებაა, რომ VI.-ში ჩამოთვლილი `vercel.json`-ის cleanup-ის დარჩენა რეალურ რისკს წარმოადგენს — ნებისმიერი მომავალი კოდის ადგილი, სადაც შემთხვევით რელატიური `/api/...` დარჩება (axios baseURL-ის გარეშე), ჩუმად ძველ ბექენდზე გავარდება.

### 5. PDF export-ის "გენერირების თარიღი" — არასწორი timezone
**მიზეზი:** `sales.ts`-ის (Sales Report) და `products.ts`-ის (Products/Low Stock Report) PDF გენერაციაში `new Date().toLocaleString('ka-GE')` timezone-ის მითითების გარეშე გამოიყენებოდა — Render-ის Docker container-ის default TZ (UTC-ის მახლობელი) Tbilisi-ს (UTC+4) რეალურ დროსთან ~4-საათიან offset-ს იძლეოდა. ცხრილის row-ების `created_at` თარიღები (DB-დან პირდაპირ) სწორი იყო — მხოლოდ ეს ერთი "current time" ხაზი იყო დაზარალებული.

**ფიქსი (commit `f7e15e7`):** ორივე ადგილას `{ timeZone: 'Asia/Tbilisi' }` დაემატა, `sales.ts:287`-ის (Z-Report `closedAt`) უკვე არსებული სწორი pattern-ის მიხედვით. სხვა timezone-ს მოკლებული `toLocaleString` აღარსად დარჩა backend-ში (გადამოწმებულია `grep`-ით).

---

## 📋 VI. დარჩენილი ამოცანები

- [ ] **Render Free → Starter ($7/თვე)** — Free plan-ზე 15წთ უმოქმედობის შემდეგ spin-down + ~30-60წ cold start; POS რეალურ ტრანზაქციებზე მიუღებელია
- [ ] **`vercel.json`-ის გასუფთავება** — `@vercel/node` backend build block-ის მოცილება (ამჟამად ორმაგი-წყაროს რისკია: ძველი Vercel serverless ბექენდი ტექნიკურად ჯერ კიდევ ცოცხალია, სხვა `JWT_SECRET`-ით). **სანამ არ წაიშლება, დაველოდოთ სტაბილურ მონიტორინგის პერიოდს.**
- [ ] **`JWT_SECRET` insecure fallback** (`'super-secret-key'`) მოსაცილებელია კოდიდან 6 ფაილში: `routes/auth.ts`, `routes/sales.ts`, `routes/organizations.ts`, `middleware/managerOverride.ts`, `middleware/platformAdminAuth.ts`, `middleware/registerAuth.ts`. Production დაცულია (Render-ზე რეალური secret დაყენებულია), მაგრამ code-level რისკი რჩება.
- [ ] Subdomain routing (STEP 7, `PLAN`-ის დოკუმენტში აღწერილი) — **ჯერ არ დაწყებულა**, paid domain-ს ელოდება

---

## 📝 Commit-ების ისტორია (ამ migration-ის ფარგლებში)

| Commit | აღწერა |
|---|---|
| `4055af1` | frontend tsconfig.json + typescript devDependency ფიქსი |
| `69272a0` | backend Render.com + Docker migration-ის მომზადება (Dockerfile, tsconfig, package.json) |
| `7699b9b` | register-token 403 → სრული logout-ის ბაგის ფიქსი |
| `8255098` → `4743311` | Sentry ingestion-ის დროებითი ვერიფიკაცია (route დამატება/წაშლა) |
| `c2e392c` | ეს roadmap დოკუმენტი (პირველი ვერსია) |
| `3e4d5ef` | payments PDF/Excel export — stale Vercel ბექენდის ფიქსი |
| `f7e15e7` | PDF export-ის "გენერირების თარიღი" — Asia/Tbilisi timezone ფიქსი |

---

**წყარო საუბარი:** Claude Cowork session, 31.08.2026 – 02.09.2026 (განგრძობითი, PLAN დოკუმენტის რეალიზაცია)
