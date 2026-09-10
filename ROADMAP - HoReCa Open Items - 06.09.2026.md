# HoReCa მოდულის ღია საკითხები — Roadmap

**სტატუსი:** 🟡 ღია — 5/8 პუნქტი დასრულებულია (#1, Waiter Access Scope, 10.09.2026; #2, Item Void Authorization, 10.09.2026; #4, KDS Realtime, 09.09.2026; #5, Register Re-pair, 10.09.2026; #6, CRLF Housekeeping, 10.09.2026). #3 ნაწილობრივ (setting-infrastructure), #7 დოკუმენტირებული (hardware-deployment ჯერ უცნობია, code-ცვლილება განზრახ არ დაწყებულა), #8 დაბალი პრიორიტეტით დოკუმენტირებული.
**თარიღი:** 06.09.2026
**წყარო:** `ROADMAP - HoReCa Module - 03.09.2026.md`-ის STEP 1-4 (ყველა
production-ზეა, დასრულებული) — ამ ძირითადი roadmap-ის "ღია საკითხები"
ქვეთავიდან გამოტანილი პუნქტები + Cowork session, 06.09.2026-ზე
დამატებით აღმოჩენილი ერთი ახალი საკითხი (#7, waiter-ის ცვლა/device
საკითხი).

**კონტექსტი:** STEP 1-4 (Tables/Orders, KDS, მოდიფაიერები+BOM, ჩეკის
გაყოფა+tips) სრულად დასრულებულია და production-ზეა. ეს roadmap
აგროვებს იმ პროდუქტულ გადაწყვეტილებებს და ცნობილ ტექნიკურ საკითხებს,
რომლებიც მთავარი roadmap-ის წერისას/ტესტირებისას გამოვლინდა, მაგრამ
scope-ის მიღმა დარჩა — რომ ცალკე, მოსახერხებლად ვიმუშაოთ მათზე.

---

## 1. მიმტანის წვდომის scope (STEP 1-დან)

**საკითხი:** Waiter-ს (მიმტანს) რომელი ღია მაგიდების/შეკვეთების ნახვა-
რედაქტირება უნდა შეეძლოს?

- **ვარიანტი ა — მხოლოდ საკუთარი:** მხოლოდ ის მაგიდები, რომლებიც
  თავად გახსნა (`orders.opened_by = req.user.id`). სხვა waiter-ის
  მაგიდას ვერ ხედავს/ვერ ეხება.
- **ვარიანტი ბ — ყველა ღია შეკვეთა (cross-waiter):** ნებისმიერ
  waiter-ს ყველა ღია მაგიდის ნახვა/რედაქტირება შეუძლია (მაგ. თუ
  კოლეგა შვებულებაშია გასული სამუშაო საათებში, ან მაგიდები
  ერთმანეთს "ეხმარებიან").

**გადაწყვეტილება (10.09.2026): ვარიანტი ბ (cross-waiter, ყველა ღია
მაგიდა org-ის ფარგლებში).**

**დასაბუთება:** ეს არის ინდუსტრიის სტანდარტული pattern მსხვილ POS
სისტემებშიც (Toast, Square, Lightspeed, iiko) — floor work
კოლაბორაციულია (shift coverage, table transfer, ერთობლივი
მომსახურება), და "მხოლოდ საკუთარი" hard-restriction პრაქტიკაში
problem-ს ქმნის უფრო, ვიდრე წყვეტს (მაგიდა "frozen" რჩება, თუ owner
მიუწვდომელია). Accountability (ვინ რას ცვლის) `opened_by`/audit-log-ით
წყდება — access control-ით არა.

**იმპლემენტაცია:** კოდის ცვლილება არ საჭიროებულა — `orders.ts`-ის
routes-ები (`GET /orders`, `GET /orders/:id`, item-updates, checkout)
უკვე მხოლოდ `organization_id`-ზე ფილტრავენ (`authenticateToken` +
org-scope), `opened_by`-ზე restriction არსად ყოფილა. `opened_by`
column რჩება მხოლოდ tracking/audit/tip-attribution-ისთვის (#3-თან
ერთად), არა access-control-ისთვის — ეს განზრახვა კომენტარადაც
დაფიქსირდა `backend/src/routes/orders.ts:125`-ზე.

**სტატუსი:** 🟢 დასრულებულია — გადაწყვეტილება მიღებულია, კოდი უკვე
შესაბამისობაშია.

---

## 2. Void-ის ავტორიზაცია item-დონეზე (STEP 1/3-დან)

**საკითხი:** როცა waiter/cashier შეკვეთიდან პროდუქტს შლის
(item-level void, უკვე "sent"-სტატუსში მყოფსაც), საჭიროა თუ არა
დამატებითი ავტორიზაცია?

- **ვარიანტი ა — cashier/waiter თავად:** არავითარი დამატებითი
  დადასტურება.
- **ვარიანტი ბ — Manager PIN Override:** Discount-permission-ის
  ანალოგიური pattern — item-ის წაშლა სავალდებულოდ მოითხოვს
  მენეჯერის PIN-ს, აუდიტისთვის.

**გადაწყვეტილება (10.09.2026): ჰიბრიდი — PIN საჭიროა მხოლოდ
`kitchen_status !== 'pending'`-ზე.**

**დასაბუთება:** 'pending' item (jერ არ გაგზავნილა სამზარეულოში) —
food cost არ გაწეულა, ჩვეულებრივი order-შესწორებაა, PIN აქ
სუფთა friction იქნებოდა. 'sent'/'preparing'/'ready'/'served' — real
fraud vector (დაემატა → მომზადდა/მიირთვა → checkout-მდე ჩუმად
წაიშალა), აქ manager-ის დადასტურება რეალურ ღირებულებას მატებს.
Admin/manager როლს (`canManage`) PIN არ სჭირდება — თავად უკვე
პრივილეგირებულია, იგივე წესი, რაც `POST /orders/:id/void`-ზეა.

**იმპლემენტაცია (10.09.2026):**
- **Backend** (`backend/src/routes/orders.ts`, `PATCH
  /orders/items/:id`) — void-branch ახლა ამოწმებს `kitchen_status`-ს;
  თუ `!== 'pending'` და `req.user.role ∉ {admin, manager}`, სავალდე-
  ბულოა ვალიდური `X-Manager-Override: Bearer <token>` header
  (იგივე `verifyManagerOverrideToken`/`consumeOverrideToken`
  infrastructure, რაც Retail-ის discount-override-სა და
  `cart/confirm-override`-ზეა, `middleware/managerOverride.ts`).
  წარმატებული override-ის გამოყენება COMMIT-ის შემდეგ
  `writeAuditLog(..., 'item-void-override-used', ...)`-ით ჩაიწერება.
- **Frontend** (`frontend/src/pages/OrderScreen.tsx`) — `handleVoidItem`
  item-ის `kitchen_status`-ის მიხედვით პირდაპირ void-ს
  (`performVoidItem`) ან წინასწარ PIN-modal-ს (`pendingVoidItem`
  state, არსებული discount-PIN-modal-ის გაზიარებით) იძახებს;
  წარმატებული PIN-ვერიფიკაციის შემდეგ override-token ერთჯერადად
  (`X-Manager-Override` header) გამოიყენება — არ ინახება
  `managerOverrideToken`-ში, რომ discount/checkout-ის flow-ს
  შემთხვევით არ გადაეკვეთოს (token single-use-ია backend-ზე).
- ორივე მხარეს TypeScript compile სუფთაა (`tsc --noEmit`).

**სტატუსი:** 🟢 დასრულებულია, code-ცვლილება შესრულებულია.

---

## 3. Tips-ის განაწილება (STEP 4-დან)

**საკითხი:** ამჟამად (STEP 4, production) tip მთლიანად იმ waiter-ს
ერგება, ვინც checkout-ი გაატარა (`payments.waiter_id = req.user.id`,
ავტომატურად). ეს სწორია, თუ საჭიროა pooled-განაწილება?

- **ვარიანტი ა — ინდივიდუალური (ამჟამინდელი production-ის ქცევა):**
  ვინც სტუმარს მოემსახურა და checkout გაატარა, მთლიანი tip მასზეა.
- **ვარიანტი ბ — Pooled:** ყველა tip ერთიან fund-ში იყრება და ცვლის
  ბოლოს თანაბრად/საათების პროპორციულადნაწილდება გუნდზე. ეს
  მოითხოვს ახალ ბიზნეს-ლოგიკას (`shifts.tip_total` უკვე გვაქვს
  aggregation-ისთვის — Z-Report "ჯამური tip" STEP 4-ში უკვე ითვლის
  ცვლის ყველა tip-ს ჯამურად, ეს pooled-მოდელს ნაწილობრივ უკვე
  emxარს, თუმცა ცალკეულ waiter-ებზე გადანაწილების UI/ლოგიკა არ
  არსებობს).

**გადაწყვეტილება (10.09.2026): არც ერთი ვარიანტი გლობალურად —
ორგანიზაცია-დონის setting (`organizations.tip_distribution_mode`).**

**დასაბუთება:** Multi-tenant SaaS-ში ერთი, hardcoded გადაწყვეტილება
ვერ მოერგება ყველა რესტორნის ბიზნეს-მოდელს/კულტურას
(Georgian/European "individual service tip" vs US-style
"pooled/tip-out") — ზუსტად იგივე პრინციპია, რაც `business_type`-ს
აქვს (migration 019). ამიტომ თითოეულ org-ს თავისი მოდელის არჩევის
საშუალება ეძლევა, პლატფორმის დონეზე არცერთი მხარე არ არის
დაწესებული.

**იმპლემენტაცია (10.09.2026) — მხოლოდ "setting-infrastructure"
ეტაპი:**
- Migration `026_add_tip_distribution_mode.sql` —
  `organizations.tip_distribution_mode` (`individual`|`pooled`,
  DEFAULT `'individual'` — production-ის ამჟამინდელ ქცევასთან
  ნულოვანი გავლენით).
- Backend (`backend/src/routes/organizations.ts`) — `GET
  /organizations/me` ახლა აბრუნებს `tipDistributionMode`-საც;
  ახალი `PATCH /organizations/me` (admin/manager-ონლი,
  `requireAnyRole`, IDOR-დაცული `req.user.organizationId`-დან)
  ინახავს არჩევანს.
- Frontend — ახალი "⚙️ პარამეტრები" გვერდი
  (`frontend/src/pages/Settings.tsx`), admin/manager + HoReCa-ონლი
  ხილვადობით (Modifiers/Ingredients-ის იგივე გეითინგი App.tsx-ში) —
  "ინდივიდუალური"/"საერთო (Pooled)" toggle, `GET`/`PATCH
  /organizations/me`-ზე.
- ორივე მხარეს TypeScript compile სუფთაა (`tsc --noEmit`);
  დატესტილია ლოკალურად — admin/manager save+DB-persist, cashier/
  waiter/retail-cashier-ით nav item დამალულია.

**⚠️ სქოუფის გარეთ (მომავალი ეტაპი):** ფაქტობრივი "pooled"
გადანაწილების ალგორითმი (shift-close-ზე ჯამური tip-ის დაყოფა
აქტიურ ვეითერებზე — საათების პროპორციულად თუ თანაბრად) ჯერ არ
არის იმპლემენტირებული. Checkout-ის (`sales.ts`) ლოგიკა უცვლელი
რჩება — მთელი tip კვლავ იმ waiter-ს/მოლარეს ეკუთვნის, ვინც
checkout გაატარა, org-ის არჩეული მოდელის მიუხედავად. `pooled`-ის
არჩევა ამ ეტაპზე მხოლოდ პარამეტრს ინახავს, რეალურ გადანაწილებაზე
ჯერ გავლენას არ ახდენს.

**სტატუსი:** 🟡 ნაწილობრივ დასრულებულია — setting-infrastructure
მზადაა, pooled-ალგორითმი მომავალი ეტაპისთვისაა დაგეგმილი.

---

## 4. KDS-ის realtime latency (STEP 2-დან)

**საკითხი (თავდაპირველი):** v1 (production) 4-წამიან polling-ს
იყენებდა (`KitchenDisplay.tsx`) სამზარეულოს ეკრანის განახლებისთვის —
production peak load-ზე (რამდენიმე ერთდროული waiter + KDS ეკრანი)
ჯერ არ ყოფილა შემოწმებული, რისკი იყო WebSocket-ზე გადასვლის
საჭიროება.

**გადაწყვეტა (09.09.2026):** polling WebSocket-ით (Socket.IO)
ჩანაცვლდა:
- `backend/src/socket.ts` (ახალი) — Socket.IO server, JWT
  handshake-auth (იგივე secret, რასაც REST-ის `authenticateToken`),
  org-scoped room-ები (`org:<organizationId>`). Path
  `/api/socket.io` — dev-ში vite-ის უკვე არსებულ `/api` proxy-rule-ს
  ეკვრის (`ws: true` დამატებულია).
- `backend/src/index.ts` — `app.listen` → `http.createServer(app)` +
  `initSocket(...)`, იმავე PORT-ზე (ცალკე service/port არ ემატება).
- `backend/src/routes/orders.ts`, `kitchen.ts` — item-ის დამატება
  (routed station-ზე), სტატუსის წინსვლა და void — ყველა ცვლილება
  `emitKdsChanged`-ით ატყობინებს დაკავშირებულ KDS ეკრანებს.
- `frontend/src/lib/socket.ts` (ახალი) — singleton socket
  connection, იგივე auth token.
- `frontend/src/pages/KitchenDisplay.tsx` — `'kds:changed'`-ზე
  დაუყოვნებელი refetch; polling დარჩა მხოლოდ fallback/safety-net-ად
  (4წმ → 20წმ, connection-ის დროებითი ჩავარდნისთვის).

**Design:** socket მხოლოდ "changed" სიგნალს აგზავნის, არა სრულ
ticket-payload-ს — client მიღებისთანავე უკვე არსებულ
`GET /kitchen/tickets`-ს იძახებს (ticket-shape-ის ორმაგი
წყაროს/დესინქრონიზაციის თავიდან ასაცილებლად).

**ტესტირება:** ლოკალურად დადასტურებულია ორ ცალკე ეკრანს შორის —
real-time განახლება მყისიერია (არა 4-წამიანი დაყოვნებით). WS
connection დადასტურებულია Chrome DevTools-ში (`101 Switching
Protocols`, სრული handshake header-ები).

**Commits:** `2c54866` (feat: WebSocket realtime), `5c83351` (fix:
CRLF line-ending housekeeping, `frontend/package(-lock).json`).

**Deployment:** ✅ Vercel (frontend) და ✅ Render (backend) —
ორივე production-ზეა (`5c83351`, "Deploy succeeded | Live",
10.09.2026 — Render-ის პირველი მცდელობა ჩავარდა ქსელური
`ECONNRESET`-ით `npm ci`-ის დროს, მეორე manual redeploy-მა
წარმატებით გაიარა).

**სტატუსი:** 🟢 დასრულებულია, production-ზეა.

---

## 5. Retail POS — Register cross-org mismatch re-pair UI (გვერდითი ეფექტი)

**საკითხი:** `App.tsx`-ის გლობალური 403-interceptor მხოლოდ "სალაროს
ტოკენი"-ს შემცველ შეტყობინებებზე რთავს ავტომატურ re-pair UI-ს.
Register-ის cross-org mismatch-ის შეტყობინება ("ეს სალარო თქვენს
ორგანიზაციას არ ეკუთვნის!") ამ პატერნს არ ემთხვევა, ამიტომ
მომხმარებელს ხელით სჭირდება localStorage-ის გასუფთავება.

**აღმოჩენილია (10.09.2026):** Fix უკვე გატარებულია — roadmap-ის ეს
ჩანაწერი მოძველებული აღმოჩნდა. `frontend/src/App.tsx`-ის
`axios.interceptors.response`-ში `REGISTER_PAIRING_INVALID_MESSAGES`
მასივი (commit `1667715`, "fix: auto re-pair register on
cross-org/deactivated/deleted mismatch") უკვე მოიცავს ზუსტად ამ
სამივე შეტყობინების ტექსტს (`backend/src/middleware/registerAuth.ts`-ის
ტექსტის ზუსტი დამთხვევით):
- "ეს სალარო აღარ არსებობს ბაზაში!" (404)
- "ეს სალარო დეაქტივირებულია — მიმართეთ ადმინისტრატორს!" (403)
- "ეს სალარო თქვენს ორგანიზაციას არ ეკუთვნის!" (403, cross-org mismatch)

ანუ ავტომატური re-pair UI (`register:pairing-required` event)
სამივე შემთხვევაზე უკვე ირთვება — ხელით localStorage-გასუფთავება
აღარ სჭირდება. Commit `1667715` ჩვენი ბოლო deploy-ებზე ძველია,
ამიტომ production-ზეც უკვე გატარებულია.

**სტატუსი:** 🟢 დასრულებულია (roadmap-ის ეს ჩანაწერი status-ში
ჩამორჩენილი იყო, კოდი უკვე გამართული იყო).

---

## 6. Housekeeping — CRLF/LF line-ending noise

**საკითხი:** repo-ში ~29 ფაილშია line-ending (CRLF/LF) noise
(`.gitignore`-ები, `README.md`, რამდენიმე ROADMAP/დოკუმენტაცია,
backend/frontend config ფაილები). `git diff --stat` ყველგან
insertions == deletions, ანუ რეალური კონტენტი უცვლელია — მხოლოდ
line-ending-ია სხვადასხვა.

**რატომ ღირს გასწორება:** `git status` მუდმივად "ჭუჭყიანი" რჩება
ამ ფაილებით, რაც ართულებს რეალური, განზრახ ცვლილებების შემჩნევას
(STEP 4-ის commit-ების დროსაც routinely გვიწევდა CRLF-noise-ის
manual გამორთვლა/გამორიცხვა — იხ. `backend/src/routes/auth.ts`-ის
STEP 4-ის WAITER-commit-ის მაგალითი, 06.09.2026).

**აღმოჩენა (10.09.2026):** დამატებითი შემოწმებით (`git show
HEAD:<file>` vs working tree, `cat -A`) გაირკვა, რომ commit-ებში
(HEAD) ეს ~25 ფაილი უკვე LF-ითაა შენახული — CRLF მხოლოდ ლოკალურ
checkout-ში იყო (Windows-ზე editor/git-ის line-ending კონვერტაციის
შედეგი, `.gitattributes`-ის არარსებობის გამო git ამას "ცვლილებად"
თვლიდა). ანუ repo თავად სუფთა იყო, `git status`-ის "ჭუჭყიანობა"
მხოლოდ ლოკალურ-checkout-vs-repo შედარების ხარვეზი იყო.

**Fix (10.09.2026, დასრულებულია):** repo root-ში დაემატა
`.gitattributes` (`* text=auto eol=lf` + ცნობილი ბინარული ტიპების
ცხადი გამორიცხვა) — ამის შემდეგ Git ავტომატურად სწორად ადარებს
CRLF-checkout-ს LF-repo-ს (ნორმალიზებულად), და `git status`
დაუყოვნებლივ დასუფთავდა ყველა ამ ~25 ფაილზე, ცალკე
normalize-commit-ის საჭიროების გარეშე. სამომავლოდაც არ დაბრუნდება.

**სტატუსი:** 🟢 დასრულებულია.

---

## 7. [ახალი, 06.09.2026] Waiter-ის "ცვლა" ცალკე device/register-პეარინგს მოითხოვს

**აღმოჩენილია:** Cowork session, 06.09.2026 — მომხმარებლის ტესტირებისას
(cashier + waiter ერთსა და იმავე browser/device-ზე).

**პრობლემა:** `POST /shifts/open`-ს (STEP 2.1) აქვს "ერთი აქტიური
ცვლა თითო **register**-ზე" წესი — და "register" ფიზიკურ
browser/device-პეარინგს ნიშნავს (`payflow_register_id`
localStorage-ში), არა ადამიანს. თუ cashier-ს კონკრეტულ device-ზე
ღია ცვლა აქვს, იმავე device-ზე მეორე ვერავინ (waiter-იც ვერ) გახსნის
საკუთარ ცვლას, სანამ cashier არ დახურავს.

ამავე დროს, შეკვეთის შექმნას/checkout-ს (`checkActiveShift`)
**პირადი** ცვლა სჭირდება (`cashier_id = req.user.id`) — ანუ
თითოეულ waiter-ს **საკუთარი** ღია ცვლა სჭირდება, რომ საერთოდ
იმუშაოს (STEP 4-ის tip-ატრიბუციისა და cash-reconciliation-ის გამო —
დეტალურად განხილულია ამავე session-ში).

**პრაქტიკული გამოსავალი (v1-ისთვის, კოდის ცვლილების გარეშე):**
თითოეულ waiter-ს **ცალკე ფიზიკური device** უნდა ჰქონდეს
(ტელეფონი/planshet), საკუთარი register-პეარინგით — მაშინ cashier-ის
ცვლა waiter-ს საერთოდ არ შეეხება (სხვადასხვა `register_id`). ეს
სტანდარტული deployment-პატერნია მოდერნ mobile-POS სისტემებში (Toast,
Lightspeed, iiko-ს handheld-ები).

**გრძელვადიანი დიზაინის საკითხი (v2-კანდიდატი):** ამჟამად "ცვლა"
ერთდროულად ორ რამეს აკეთებს — (ა) ნაღდი ფულის reconciliation
cashier-ისთვის და (ბ) tip-ატრიბუცია/checkout-უფლება waiter-ისთვის.
თუ რომელიმე restaurant-ის რეალურ setup-ში waiter არ ეხება ფულს
(ცენტრალური cashier ხურავს ყველა ჩეკს), ეს ორი კონცეფცია
შესაძლოა საჭირო გახდეს გამოცალკავდეს (მაგ. waiter-ს
"cash-ცვლის" ნაცვლად უბრალო "on-duty" სტატუსი ჰქონდეს).

**გადასაწყვეტი კითხვა:** რომელი hardware/business მოდელია
რეალურად? — waiter-ები საკუთარ ტელეფონ/planshet-ებზე მუშაობენ
(→ პრობლემა არ დგას, უბრალოდ თითო device-ს თავისი register
სჭირდება), თუ ერთი საერთო POS/კომპიუტერია გამოყენებული ყველასთვის
(→ საჭირო იქნება "ცვლა vs on-duty" გამოცალკავება)?

**გადაწყვეტილება (10.09.2026):** ჯერ უცნობია — restaurant ჯერ
სატესტო ეტაპზეა, რეალური hardware-deployment ჯერ არ არის
დაზუსტებული. ამიტომ v2-ის (code-ცვლილება, "ცვლა vs on-duty"
გამოცალკავება) დაწყება ამ ეტაპზე ნაადრევია — რეალურ საჭიროებაზე
დაფუძნებული არ იქნებოდა.

**რას ვაკეთებთ ახლა (v1, კოდის ცვლილების გარეშე):** ვრჩებით
roadmap-ის თავად შემოთავაზებულ პრაქტიკულ გამოსავალზე — production
deployment-ში თითოეულ waiter-ს ცალკე ფიზიკური device (ტელეფონი/
planshet) უნდა ჰქონდეს, საკუთარი register-პეარინგით. ეს
სტანდარტული, staff-ს არაფერს არ ართულებს (Toast/Lightspeed/iiko-ს
იგივე პატერნია handheld-ებზე).

**ხელახლა გადასახედია:** როცა რეალურ restaurant-ში ცხადი გახდება
hardware-მოდელი (ცალკე device თითო waiter-ზე, თუ საერთო POS) —
თუ საერთოა, მაშინ v2-ის "ცვლა vs on-duty" გამოცალკავებაზე
დაბრუნება საჭირო გახდება.

**სტატუსი:** 🟡 დოკუმენტირებული, v1-გამოსავალი ცნობილია — code-
ცვლილება განზრახ არ დაწყებულა, სანამ რეალური hardware-deployment
არ დაზუსტდება.

---

## 8. [ახალი, 10.09.2026] Self-registration abuse დაცვა (rate-limit vs captcha)

**აღმოჩენილია:** Cowork session, 10.09.2026 — production superadmin
პანელზე (`/admin`) შემჩნეული უცნობი, თვით-დარეგისტრირებული ორგანიზაცია
("IMStore", `alexduke@rover.info`) გამოიწვია საკითხის გადამოწმება: რამდენად
დაცულია `POST /organizations/register` (საჯარო, ავტორიზაციის გარეშე
endpoint — ნებისმიერს შეუძლია ინტერნეტიდან მიმართვა) მასობრივი/ავტომატური
(bot) რეგისტრაციისგან.

**ამჟამინდელი მდგომარეობა (გადამოწმებულია):**
- **Rate-limiting: არსებობს.** `backend/src/middleware/registrationRateLimit.ts`
  — ერთი IP-დან მაქსიმუმ 5 მცდელობა 1 საათში (in-memory `Map`, ითვლის
  ყველა მცდელობას, არა მხოლოდ წარუმატებელს).
  ⚠️ **ცნობილი შეზღუდვა:** in-memory Map — single backend-instance-ს
  ვარაუდობს; თუ Render რამდენიმე instance-ზე გადავა (horizontal scaling),
  counter აღარ იქნება გაზიარებული და ეფექტური ლიმიტი რეალურად გაიზრდება
  (instance-თა რაოდენობის მიხედვით).
- **Captcha: არ არსებობს.** კოდში დადასტურებულია (`recaptcha`/`hcaptcha`/
  `turnstile` — არცერთი მოძებნილი).

**რატომ არ არის ეს ამჟამად საგანგებო:** ერთი, უსარგებლო ("IMStore", 0
users, 0 ჩეკი) trial-რეგისტრაცია rate-limit-საც კი ვერ გაავარჯიშებდა —
ეს ჩვეულებრივი, ერთჯერადი დათვალიერების ნიშანია, არა mass-abuse-ის.

**გადასაწყვეტი კითხვა:** ღირს თუ არა Captcha-ს (მაგ. Cloudflare Turnstile
— უფასო, დამატებითი UX-ხახუნი მინიმალური) დამატება `Register.tsx`-ზე,
თუ საკმარისია ამჟამინდელი 5/საათი IP-based rate-limit?

**რჩევა გადასაწყვეტად:** Captcha-ს დამატება არ არის სასწრაფო — ღირს
მხოლოდ მაშინ, თუ რეალურად შეიმჩნევა scripted/mass-registration-ის
ნიშნები (ბევრი ორგანიზაცია ერთდროულად/მოკლე დროში, უსარგებლო
სახელებით). მანამდე საკმარისია მონიტორინგი (superadmin `/admin`
პანელის პერიოდული გადახედვა).

**სტატუსი:** 🟡 დაბალი პრიორიტეტი — მოქმედი დაცვა (rate-limit) არსებობს,
დამატებითი ზომა (captcha) საჭიროებისამებრ, არა დაუყოვნებლივ.

---

**წყარო საუბარი:** Claude Cowork session, 06.09.2026 — HoReCa STEP 4-ის
production-ტესტირების გაგრძელება (WAITER-როლის commit + end-to-end
QA screenshot-ებით), შემდეგ მთავარი roadmap-ის ღია საკითხების
გამოტანა ცალკე დოკუმენტად + ახალი #7 საკითხის აღმოჩენა/დოკუმენტირება.
