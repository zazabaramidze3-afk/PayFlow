PayFlow — STEP 0-ის დასრულების ანგარიში (Sentry + CORS + Security Hardening) და განახლებული Multi-Tenant SaaS roadmap, 18–19.08.2026-ის სესიის მიხედვით.

### წყარო და კონტექსტი
წინა დოკუმენტი — `ROADMAP - Multi-Tenant SaaS - 16.08.2026.md` — განსაზღვრავდა, რომ **Sentry error monitoring** და **CORS allowlist hardening** (ცვლილება #7) წამოწეულია STEP 6-დან და უნდა შესრულდეს STEP 1-მდე, tenant-model-ისგან დამოუკიდებლად. ეს სესია სწორედ ამ ორი პუნქტის სრულ, production-ზე დადასტურებულ დანერგვას მოიცავს.

---

## ✅ დასრულებულია — STEP 0: Sentry Error Monitoring

**რისთვისაა:** production-ზე unhandled backend error-ები აქამდე არავის ეცნობებოდა — user უბრალოდ ხედავდა გატეხილ UI-ს. Multi-Tenant refactor-ის წინ (STEP 1-2, `organization_id`-ის ყველგან დამატება) ეს განსაკუთრებით საშიშია, რადგან bug-ის ფასი მაღალია (cross-tenant data leak).

**რა დაინერგა:**
- `@sentry/node` (`^10.x`) დამატებული `backend/package.json`-ში
- ახალი ფაილი — `backend/src/instrument.ts`: Sentry-ის ინიციალიზაცია, `index.ts`-ის ყველა დანარჩენ import-ზე ადრე ჩატვირთული (auto-instrumentation-ის მოთხოვნა):
  ```ts
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
  });
  ```
  `dataCollection`-ის კონფიგი განზრახ გამორიცხავს user PII-ს (IP, email) და request body-ებს Sentry-ის event-ებიდან — payment/POS მონაცემები არასდროს გაეგზავნება მესამე მხარის სერვისს.
- `backend/src/index.ts`-ში, ყველა route-ის შემდეგ: `Sentry.setupExpressErrorHandler(app)` — იჭერს ყველა unhandled exception-ს ავტომატურად.
- `SENTRY_DSN` დამატებული Vercel-ის Environment Variables-ში, **ცალკე Production და Preview** scope-ისთვის, ასევე ლოკალურ `backend/.env`-ში.

**დადასტურება:** ტესტ-route-ით (`/api/debug-sentry`, დროებით დამატებული და შემდეგ წაშლილი) და შემდეგ **რეალურად**, დამოუკიდებლად — Sentry-მ ავტომატურად დაიჭირა ორი ცალკეული production-ზე რეალურად მომხდარი bug (იხ. ქვემოთ, "სესიის მსვლელობაში აღმოჩენილი და გასწორებული პრობლემები").

---

## ✅ დასრულებულია — STEP 0: CORS Allowlist Hardening

**რისთვისაა:** `app.use(cors())` ნებისმიერ origin-ს უშვებდა backend API-სთან — ნებისმიერ საიტს შეეძლო cross-origin request-ის გაგზავნა browser-იდან (მაგ. მოპარული JWT token-ით). ეს security hardening-ია, function-ს არ ცვლის.

**რა დაინერგა (`backend/src/index.ts`):**
```ts
const ALLOWED_ORIGINS = [
  'https://pay-flow-coral.vercel.app',
  'https://pay-flow-zet3.vercel.app',
  'http://localhost:3000',   // frontend/vite.config.ts server.port
  'http://localhost:5173',   // fallback, Vite default
];

if (process.env.VERCEL_URL) {
  ALLOWED_ORIGINS.push(`https://${process.env.VERCEL_URL}`);
}
if (process.env.VERCEL_BRANCH_URL) {
  ALLOWED_ORIGINS.push(`https://${process.env.VERCEL_BRANCH_URL}`);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origin "${origin}" დაშვებული არ არის`));
    },
  })
);
```
- `VERCEL_URL` — ყოველი deployment-ის (production თუ preview) საკუთარი, unique domain, ავტომატურად injected Vercel-ის მიერ.
- `VERCEL_BRANCH_URL` — stable, branch-alias domain (`*-git-<branch>-*.vercel.app`), რომელიც უცვლელი რჩება ერთი branch-ის ყველა redeploy-ს შორის.
- JWT ავტორიზაცია ხდება `Authorization` header-ით (არა cookie-ით) — `credentials: true` განზრახ არ არის საჭირო.

**დადასტურება:** login წარმატებით ტესტირებული ოთხივე scenario-ზე — `localhost:3000` (dev), production domain (`pay-flow-coral.vercel.app`), preview deployment-specific URL, preview branch-alias URL.

---

## ✅ დასრულებულია — Security Hardening (გვერდითი, მაგრამ კრიტიკული)

- **`.gitignore` (root)** — 16.08-ის სესიაზე დაფიქსირებული ფიქსი რეალურად **არასდროს მისულა** ამ (რეალურად GitHub-თან დაკავშირებულ) ფოლდერში — `.history/`-ს (VS Code Local History extension) ხელახლა ჰქონდა დაფაილული ახალი `.env` snapshot (`SENTRY_DSN`-იანად), `git status`-ში untracked. გასწორებულია:
  ```
  .history/
  .env
  .env.*
  !.env.example
  node_modules/
  dist/
  build/
  .DS_Store
  ```
- **Vercel `DATABASE_URL` — Preview scope** აკლდა (მხოლოდ Production-ზე იყო scoped) — დამატებულია "Production and Preview" ორივესთვის, Neon-ის production connection string-თან პირდაპირ შედარებული და დადასტურებული (host: `ep-royal-hill-a2xrxk9r-pooler.eu-central-1.aws.neon.tech`, db: `neondb`).

---

## 🔧 სესიის მსვლელობაში აღმოჩენილი და გასწორებული პრობლემები

დიაგნოსტიკის რეალური, ქრონოლოგიური მსვლელობა — სამომავლოდ მსგავს სიტუაციებში სასარგებლო:

1. **Vercel Redeploy default → Production, არა Preview.** Redeploy-ის დიალოგი branch-ის მიუხედავად ხანდახან `main`/Production-ს ჩამოთვლის default-ად — ყოველთვის საჭიროა ხელით შემოწმება, კონკრეტული branch-ის row-დან Redeploy გაკეთდეს.
2. **CORS ჩავარდა preview branch-alias domain-ზე** (`*-git-<branch>-*.vercel.app`) — თავიდან მხოლოდ `VERCEL_URL` იყო დამატებული, `VERCEL_BRANCH_URL` აკლდა. Sentry-მ ავტომატურად დაიჭირა ეს ახალი origin.
3. **`git push` არ იყო შესრულებული** ერთ-ერთ ცვლილებაზე (`VERCEL_BRANCH_URL` fix) — ფაილი დისკზე იყო, მაგრამ commit+push არ იყო გაკეთებული, ამიტომ ყველა შემდეგი Redeploy ძველ commit-ს იმეორებდა. აღმოჩენილია `git log`-ის შემოწმებით, გასწორებულია `git add` + `git commit` + `git push`-ით.
4. **Vercel branch-ის Redeploy history-ის აღრევა.** Redeploy ძველ commit-ზე ხელახლა "იტაცებს" branch-alias domain-ს ახალი, სწორი commit-ის deployment-იდან — საჭირო იყო ხელახლა Redeploy ზუსტად სწორი (`VERCEL_BRANCH_URL`-იანი) commit-ის row-დან.
5. **მოჩვენებითი production DATABASE_URL "დაზიანება"** — Vercel-ის Edit ფორმაში მნიშვნელობის ველი მომენტალურად აჩვენებდა placeholder-ის მსგავს ტექსტს (`postgres://user:pass@db.example.com...`) — ეს იყო მხოლოდ UI-ის ჩატვირთვის ვიზუალური hint, არა რეალური მონაცემის დაკარგვა. დადასტურებულია Neon-ის Connect modal-იდან connection string-ის პირდაპირი შედარებით.

---

## 📋 PR & Merge პროცესი

- **Branch:** `feat/step0-sentry-cors` (4 commits: Sentry setup, CORS allowlist, VERCEL_URL fix, VERCEL_BRANCH_URL fix)
- **Testing:** ყველა ცვლილება ჯერ Preview-ზე დადასტურდა (login, dashboard, POS pairing module) სანამ production-ს შეეხებოდა
- **PR #1** (`main` ← `feat/step0-sentry-cors`) — 5 ფაილი შეცვლილი (`.gitignore`, `backend/package.json`, `backend/package-lock.json`, `backend/src/index.ts`, `backend/src/instrument.ts`), +535/−3, diff სრულად გადამოწმებული merge-მდე
- **Merge commit:** `020e275` → `main` → Vercel-ის ავტომატური production build
- **Production-ის საბოლოო ვერიფიკაცია:** login წარმატებით, dashboard იტვირთება, CORS/500 error არ ჩანს, Sentry-ზე ახალი production error არ დაფიქსირდა

---

## ⚠️ დარჩენილი STEP 0 პუნქტები (16.08-ის სიიდან, ჯერ არ გაკეთებული)

1. `backend/tsconfig.json` + `tsc --noEmit` — type-checking-ის სისუფთავის დადასტურება
2. `GET /users` route-ის `ORDER BY` ფიქსი
3. რეალური ბრენდინგის PWA icons (placeholder-ები კვლავ placeholder-ია)

## ⚠️ სხვა ცნობილი, გადავადებული ხარვეზები

- `auth.ts`-ში raw DB error message-ები (მაგ. `connect ECONNREFUSED ...`) პირდაპირ frontend-ის login UI-ზე ჩანს — information disclosure, უსაფრთხოების მომავალი პასის საკითხი
- `npm audit`: 5 vulnerability (1 low, 2 moderate, 2 high) `@sentry/node`-ის დაყენების შემდეგ — არ არის urgent, მაგრამ საჭიროებს განხილვას
- ისტორიული (16.08-მდე შექმნილი) ცვლების/ჩეკების `opened_at`/`voided_at` timezone-მონაცემები კვლავ ~4სთ-ით არასწორია (SQL `UPDATE` ჯერ არ გაკეთებულა, იხ. `PROGRESS - 16.08.2026.md`)
- ძველი, disconnected ლოკალური ფოლდერ-კოპია (`gitupload\Pay_Flow\PayFlow`) ჯერ არ წაშლილა დისკიდან
- **Offline Sync robustness** (STEP 3-5, დღეს განხილული, არ დანერგილა): eager background sync, idempotent client-UUID writes და UI-ის "unsynced" indicator უკვე არსებობს; **manual "Export unsynced receipts" fallback** (JSON/CSV) — ოფციონალური, დაბალი პრიორიტეტის დამატება, extreme edge-case-ისთვის (მოწყობილობის დაზიანება sync-მდე)

---

## განახლებული პრიორიტეტების რიგი (Multi-Tenant SaaS მიმართულებით)

1. ~~Sentry + CORS allowlist~~ ✅ **დასრულებული და production-ზე დადასტურებული (ეს სესია)**
2. STEP 0-ის დარჩენილი 3 პუნქტი (ზემოთ) — დამოუკიდებელი, სწრაფი
3. **Neon branch-ის მომზადება** — production ბაზის branch STEP 1-ის migration-ის უსაფრთხო ტესტვისთვის
4. **STEP 2-ის იზოლაციის ტესტების ჩონჩხი** — დაწერეთ ჯერ, სანამ STEP 1-ის migration საერთოდ დაიწერება
5. **STEP 1** — `organizations` ცხრილი, `organization_id` backfill, UNIQUE constraints-ის განახლება
6. **STEP 2** — route-ების გადასინჯვა რისკის ზრდადობით (read-only → write-heavy), RLS, ტესტების საბოლოო დამტკიცება
7. **გადაწყვეტილების წერტილი** — SaaS vs Multi-Store, STEP 2-ის შედეგების საფუძველზე
8. **STEP 3-4** (SaaS-ის შემთხვევაში) ან **ხელით org-მართვა** (Multi-Store-ის შემთხვევაში)
9. **STEP 5-7** — საჭიროებისამებრ, მოცულობის ზრდასთან ერთად, launch-ს არ ბლოკავს

დანარჩენი (ცვლილება #1–#6, Neon branching, route review, decision point-ის ლოგიკა) უცვლელად ვალიდურია `ROADMAP - Multi-Tenant SaaS - 16.08.2026.md`-დან — იხ. ის დოკუმენტი დეტალური დასაბუთებისთვის.
