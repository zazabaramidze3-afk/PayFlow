# PayFlow — რეფაქტორინგის სტატუსი (განახლებულია 13.08.2026)

წყარო: `ROADMAP - 11.08.2026.md` (STEP 1–5). ეს დოკუმენტი აჯამებს, რა არის დასრულებული, რა შეზღუდვებია ცნობილი და რა რჩება roadmap-ის მიღმა. STEP 1–5 სრულად დასრულებულია (12.08); 13.08-ში roadmap-ის მიღმა კიდევ ორი გაუმჯობესება დაემატა (Late-close guard, Code-splitting) და ორი გვერდითი ბაგიც გასწორდა (STEP 5-ის sync-ის ორი ხარვეზი + `ORDER BY`-ის UUID-ბაგი).

---

## ✅ დასრულებული

### STEP 1 — PostgreSQL Schema Refactoring (UUID & Multi-POS)
- Migration: ყველა PK/FK (`payments`, `payment_items`, `payment_splits`, `shifts`, `users`, `audit_logs`) გადავიდა `SERIAL` → `UUID` (`gen_random_uuid()`)
- ახალი `registers` ცხრილი (`id`, `name`, `is_active`, `created_at`)
- `shifts`/`payments`-ს დაემატა `register_id` FK
- Receipt endpoint-ებმა `created_at`-ისთვის client-side timestamp-ს იღებენ (არა DB `DEFAULT NOW()`)

### STEP 2 — Device Pairing & Activation Flow
- Per-register shift isolation (partial unique index `WHERE status = 'open'`) — გლობალურის ნაცვლად
- `POST /api/registers/generate-code`, `POST /api/registers/pair` endpoint-ები
- `RegisterGuard.tsx` — **არქიტექტურული გადახრა თავდაპირველი მოთხოვნიდან**: მთელი აპის ნაცვლად მხოლოდ `Sales` (POS) გვერდს ეხვევა. მიზეზი: Login/Manager/Admin routes დამოუკიდებელი უნდა იყოს pairing-ისგან, თორემ მენეჯერი ვერასდროს გაივლიდა Login-ს კოდის დასადასტურებლად (chicken-and-egg problem — იხ. `RegisterGuard.tsx` header-ის კომენტარი)
- Pairing UI დამატებულია `UsersManagement.tsx`-ში (თავდაპირველად roadmap-ში არ ყოფილა ცალკე მოთხოვნილი, მაგრამ საჭირო იყო endpoint-ის რეალურად გამოსაყენებლად)

### STEP 3 — PWA & Service Worker (Vite)
- `vite-plugin-pwa` კონფიგურირებულია `vite.config.ts`-ში, Workbox `generateSW` სტრატეგიით
- Static assets (JS/CSS/HTML/icons/fonts) precached
- `navigator.storage.persist()` — `src/pwa.ts`, გამოძახებული `index.tsx`-იდან
- ⚠️ Placeholder icons (`frontend/public/*.png`) — ლურჯი ფონი + "P". რეალური ბრენდინგით ჩანაცვლება რჩება

### STEP 4 — Client-Side Offline DB (Dexie.js)
- `src/db/offlineDb.ts` — ორი ცხრილი: `cached_products`, `offline_receipts`
- `Sales.tsx` checkout: offline (`navigator.onLine === false` ან request ჩავარდნა ქსელის გარეშე) → `crypto.randomUUID()`, ჩანაწერი `offline_receipts`-ში, optimistic stock decrement
- დამატებით (roadmap-ს მიღმა, საჭირო აღმოჩნდა რეალურ ტესტში): აქტიური shift და პროდუქტების კატალოგი ქეშდება `localStorage`/`cached_products`-ში და გამოიყენება fallback-ად offline reload-ზეც

**დღეს (12.08) production build-ზე (`npm run build && npm run preview`) დადასტურებული:**
Service Worker registration, offline-ზე app shell-ის ჩატვირთვა, აქტიური shift-ის შენარჩუნება reload-ის შემდეგაც, offline checkout → Dexie-ში ჩაწერა.

---

## ✅ STEP 5 — Background Sync Engine & Conflict Resolution

დასრულებულია (12.08). მოიცავს:

1. `useNetworkStatus` React hook (`frontend/src/hooks/useNetworkStatus.ts`) — `navigator.onLine` + 10-წამიანი heartbeat (`GET /api/health`, ავტორიზაციის გარეშე) ნამდვილი backend-კავშირის დასადგენად. ეფექტური `isOnline` მხოლოდ მაშინ true-ია, თუ ორივე (ბრაუზერიც და ბოლო heartbeat-იც) დადებითია.
2. Background Sync Worker (`frontend/src/sync/backgroundSync.ts`) — `syncOfflineReceipts()` (React-გარეშე სუფთა ლოგიკა) + `useBackgroundSyncEngine()` hook, `App.tsx`-ის root-ში ჩატვირთული (route-ისგან დამოუკიდებლად). Online-ზე დაბრუნებისთანავე დაუყოვნებლივ, შემდეგ 20წმ-იანი ინტერვალით ცდის `offline_receipts` queue-ს (`pending` + `failed`) გაგზავნას, batch-ად, ერთი POST request-ით.
3. Backend: `POST /api/payments/sync-offline` (`backend/src/routes/sales.ts`) — ერთი DB connection-ის ფარგლებში, თითოეული ჩეკი **საკუთარ SAVEPOINT-ში** მუშავდება (არა ერთიან BEGIN/COMMIT-ში ყველა-ან-არცერთი) — ერთი ცუდი ჩეკი (მაგ. წაშლილი shift) დანარჩენების commit-ს არ აჩერებს. იდემპოტენტური `ON CONFLICT (id) DO NOTHING`-ით (payments.id = კლიენტისეული UUID). Stock-ის დეფიციტისას (migration 011-ით `chk_stock_positive` მოხსნილია) products.stock უპირობოდ იკლება, შეიძლება უარყოფითიც გახდეს — ტრანზაქცია მაინც გადის (ფული უკვე აღებულია), და `stock_deficit_notifications` ცხრილში ჩაიწერება ჩანაწერი.
4. Manager Dashboard ნოტიფიკაცია — `ExecutiveDashboard.tsx`-ის ანალიტიკის ტაბზე ბეჯი + პანელი (`GET /api/notifications/stock-deficits`, `PUT .../:id/resolve`, `backend/src/routes/notifications.ts`), დაუხურავი oversell-ების სია, "✅ განხილულია" მოქმედებით.
5. `products.ts`-ში დაემატა app-level `stock >= 0` ვალიდაცია (ხელით დამატება/რედაქტირება) — DB CHECK constraint-ის მოხსნის კომპენსაციისთვის, რომ ეს "დაცვის ხვრელი" მხოლოდ ავტომატურ sync-ს ეხებოდეს.

**ცნობილი, დაუხურავი საკითხი:** თუ მოლარემ ცვლა უკვე დახურა online-ზე დაბრუნებისა და სინქრონიზაციის დასრულებას შორის მონაკვეთში, სინქრონიზებული ჩეკი მაინც ჩაიწერება ამ (უკვე დახურულ) shift_id-ზე ფინანსური სიზუსტისთვის — მაგრამ ამ ცვლის უკვე დაბეჭდილი Z-Report საბოლოო აღარ იქნება ზუსტი. საჭიროებს მომავალში ან Z-Report-ის ხელახალი გენერაციის საშუალებას, ან ცვლის დახურვის დაბლოკვას, სანამ pending offline queue ცარიელი არ არის.

**პირველი ტესტირებისას (12.08) აღმოჩენილი და გასწორებული ორი ბაგი:**
- `useBackgroundSyncEngine` თავდაპირველად `useNetworkStatus`-ის ცალკე heartbeat-ზე (`GET /api/health`) იყო დამოკიდებული gating-ისთვის — ერთი წარუმატებელი heartbeat request Worker-ს სამუდამოდ აჩერებდა. გასწორდა: Worker ახლა დამოუკიდებელია, თავად უსმენს `window`-ის `'online'` event-ს + საკუთარი retry-ინტერვალი აქვს; ყველა STEP 5-ის ახალი endpoint-ის URL ფარდობითიდან აბსოლუტურზე (`http://localhost:5000/...`) გადავიდა, დანარჩენი კოდის კონვენციის შესაბამისად
- Page reload/tab-closure POST-ის მიმდინარეობისას ჩანაწერს Dexie-ში `syncing` სტატუსში "აჭედავდა" სამუდამოდ (`getSyncableOfflineReceipts` მხოლოდ `pending`/`failed`-ს კითხულობდა). გასწორდა: `resetStuckSyncingReceipts()` (`offlineDb.ts`) ყოველ app mount-ზე ნებელისმიერ "ჩარჩენილ" `syncing` ჩანაწერს `pending`-ზე აბრუნებს

ორივე ფიქსი დადასტურებულია რეალურ ტესტზე (localhost:4173, offline checkout → sync-offline → payments ცხრილში ჩანაწერი).

**გვერდითი აღმოჩენა (STEP 5-ის ტესტირებისას, STEP 5-თან პირდაპირ არაკავშირშია):** `ORDER BY <table>.id DESC` — Roadmap STEP 1-მდე (SERIAL PK-ის დროს) სწორად აჩვენებდა უახლესს პირველად, migration 009-ის (UUID PK) მერე კი აღარაფერს ნიშნავს (UUID ლექსიკოგრაფიულად თარიღივით არ ლაგდება) — აქტიური ცვლა/უახლესი ჩეკი შემთხვევით სიის შუაშიც კი ჩნდებოდა. გასწორდა ოთხივე ადგილას (`GET /shifts/history`, `buildPaymentsFilterQuery`, `GET /payments/my-history`, `GET /audit-logs` — ორივე routes/audit-logs.ts-სა და routes/auth.ts-ში) — `id`-ის ნაცვლად `created_at`/`opened_at` (TEXT, ლექსიკოგრაფიულად სორტირებადი). `GET /users`-ს (`ORDER BY id ASC`) მსგავსი პრობლემა აქვს, მაგრამ users-ს created_at სვეტი საერთოდ არ აქვს — ცალკე გადასაწყვეტია.

---

## ✅ Roadmap-ის მიღმა (13.08) — Late-close guard & Code-splitting

STEP 5-ის "შემდეგი ნაბიჯი"-დან ორი კანდიდატი დასრულდა:

1. **Late-close race condition-ის frontend-გუარდი** (`Sales.tsx`, `handleCloseShift`) — ცვლის დახურვის ღილაკზე დაჭერისას ჯერ მოწმდება Dexie-ის `offline_receipts` (ახალი `countUnsyncedOfflineReceipts()`, `offlineDb.ts` — ცხრილი ფაქტობრივად მხოლოდ დაუსინქრონებელ ჩანაწერებს ინახავს, `synced`-ზე row პირდაპირ იშლება). თუ queue არაცარიელია, ჯერ სცდება ერთჯერად `syncOfflineReceipts()`-ს (online-ზე ეს ჩვეულებრივ საკმარისია), და მხოლოდ თუ ამის შემდეგაც რჩება რამე — `PUT /shifts/close` საერთოდ არ გაიგზავნება, მოლარეს ცხადი შეტყობინება უჩნდება. ⚠️ ეს **მხოლოდ frontend-ის დონის დაცვაა** — ბექენდს ფიზიკურად არ შეუძლია იცოდეს, რა დევს კონკრეტული ბრაუზერის IndexedDB-ში, სერვერული enforcement აქ ტექნიკურად შეუძლებელია. Race condition თეორიულად მაინც არსებობს (მაგ. თუ მოლარემ DevTools-ით/სხვა route-ით გვერდი აუარა), უბრალოდ ნორმალურ UI ნაკადში პრაქტიკულად აღარ ხდება.
2. **Route-level code-splitting** (`App.tsx`) — `Dashboard`/`Products`/`Sales`/`UsersManagement` გადავიდა `React.lazy()` + `Suspense`-ზე (`Login` განზრახ დარჩა eager — ავტორიზაციამდე დაუყოვნებლივ უნდა გამოჩნდეს). შედეგად ერთი 877KB bundle-ის ნაცვლად: `index` (core — 385KB), `Dashboard` (recharts+gsap-ის გამო ყველაზე მძიმე — 418KB, მხოლოდ admin/manager-ს ეხება), `Sales` (37KB), `UsersManagement` (24.8KB), `Products` (10.7KB). Cashier-ის საწყისი ჩატვირთვა (`index` + `Sales`) ~422KB-მდე დავიდა 877KB-დან. ბონუსად, `frontend/package.json`-იდან მოცილდა `exceljs`/`pdfkit`/`react-router-dom` — დადასტურებულად არასდროს გამოყენებული frontend-ის კოდში (ისედაც არ შედიოდა bundle-ში, უბრალოდ `node_modules`-ის ზედმეტი წონა იყო). ✅ `npm install` რეალურ გარემოში დადასტურებულია — 180 პაკეტი მოცილდა.

---

## ⚠️ ცნობილი შეზღუდვები

- **Login მხოლოდ online** — `POST /api/auth/login` ყოველთვის სერვერს მოითხოვს. უკვე ავტორიზებული სესია offline-ზეც გრძელდება (cache fallback), მაგრამ ახალი login (ნებისმიერი role) offline-ზე ვერ გაივლის
- **Shift-ის გახსნა/დახურვა მხოლოდ online** — offline-capable მხოლოდ checkout არის (STEP 4-ის ზუსტი scope). Shift ღია უნდა იყოს online-ზე ყოფნისას, სანამ offline გადახვალ
- **Manager PIN Override** offline-ზე არ მუშაობს (PIN ვერიფიკაცია თავადაც network call-ია), ამიტომ override-ს მოითხოვნი checkout ონლაინადვე იგზავნება (STEP 4.2), Dexie queue-ს არასდროს ხვდება
- **Migration 011-მა მოხსნა `products.chk_stock_positive`** — `products.stock` ახლა თეორიულად უარყოფითიც შეიძლება იყოს (მხოლოდ `POST /payments/sync-offline`-ის oversell-სცენარზე; ხელით დამატება/რედაქტირება კვლავ დაცულია app-level ვალიდაციით, `products.ts`)
- **Late-close race condition** — frontend-გუარდით შემცირებულია (იხ. ზემოთ, 13.08), მაგრამ სერვერული enforcement პრინციპულადაც შეუძლებელია (ბექენდს არ სწვდება კლიენტის IndexedDB) — თეორიულ კიდეებზე (DevTools/force-navigation) მაინც შესაძლებელია
- Build: single-bundle 877KB გაფრთხილება მოგვარებულია code-splitting-ით (იხ. ზემოთ, 13.08) — `Dashboard` chunk (418KB) მაინც ყველაზე მძიმეა (recharts+gsap), მაგრამ ეს მხოლოდ admin/manager-ს ეხება
- Dev server-ზე (`npm run dev`) Service Worker არ მუშაობს განზრახ (`devOptions.enabled: false`) — PWA ტესტირება მხოლოდ `npm run build && npm run preview`-ით
- Frontend-ს არ აქვს `tsconfig.json` (build მხოლოდ Vite/esbuild-ითაა, სრული `tsc` ტიპ-შემოწმების გარეშე) — STEP 5-ის ახალი ფაილებიც მხოლოდ `vite build`-ით არის გადამოწმებული, არა ცალკე `tsc --noEmit`-ით

---

## შემდეგი ნაბიჯი

STEP 1–5 დასრულებულია. Late-close guard-იც და code-splitting-იც დასრულებულია (13.08). დარჩენილი კანდიდატი:
- რეალური ბრენდინგის icons (STEP 3-ის placeholder-ების ნაცვლად) — საჭიროებს რეალურ ლოგო/ბრენდის ფაილს, ჯერჯერობით გადადებულია
