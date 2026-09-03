# HoReCa მოდულის დანერგვა — Roadmap

**სტატუსი:** 🟡 STEP 1 (Tables + Orders) — backend (migration + API) დასრულებულია, ველოდებით production migration-ის გაშვებას (pgAdmin) + frontend
**თარიღი:** 03.09.2026
**კონტექსტი:** PayFlow ამჟამად მთლიანად Retail (მარკეტი/საცალო) სეგმენტზეა
აგებული. მოთხოვნაა იმავე კოდბაზაში/DB-ში HoReCa-ს (რესტორანი, კაფე-ბარი
და მისთ.) მხარდაჭერის დამატება — მაგიდების მართვა, ღია შეკვეთა,
სამზარეულო/ბარის ბეჭდვა (KDS), მენიუს მოდიფაიერები + რეცეპტზე
დაფუძნებული საწყობი (BOM), ჩეკის გაყოფა და მიმტანის როლი/tips.

### გადაწყვეტილებები (Cowork session, 03.09.2026)

- [x] **არქიტექტურა:** ერთი კოდბაზა/ერთი DB, `organizations.business_type`
  flag-ით (`'retail' | 'horeca'`) — არა ცალკე ფორკი, არა ცალკე schema.
- [x] **v1 scope (ყველა STEP ერთად საჭირო, თანმიმდევრობით):** Tables +
  Orders, KDS/სამზარეულო-ბარის routing, მენიუს მოდიფაიერები + BOM,
  ჩეკის გაყოფა + მიმტანის როლი/tips.

### რატომ ასეთი თანმიმდევრობა

HoReCa-ს ყველაზე ღრმა architectural gap ესაა: Retail-ში გაყიდვა
ერთჯერადი ატომური ტრანზაქციაა (`POST /api/payments`, `backend/src/
routes/sales.ts:364` — კალათა → მაშინვე checkout → stock decrement).
HoReCa-ს კი სჭირდება **დროში გაწელილი, თანდათან-შევსებადი შეკვეთა**
(მაგიდაზე სტუმარი ჯდება, კერძები ტალღებად ემატება, ჩეკი მხოლოდ ბოლოს
იხურება) — ეს ახალი domain object-ია (`orders`), რომელიც არსად
არსებობს. ამიტომ STEP 1 (Tables + Orders schema) ყველა დანარჩენის
წინაპირობაა — KDS-საც (STEP 2), მოდიფაიერებსაც/BOM-საც (STEP 3) და
ჩეკის გაყოფასაც (STEP 4) `order_items`-ის არსებობა სჭირდება. STEP-ები
რისკის კლებადობითაც არის დალაგებული: STEP 1 არაფერს არღვევს Retail-ში
(ახალი ცხრილები, `business_type = 'retail'`-ზე უცვლელი ქცევა), STEP 3
კი ეხება checkout-ის უკვე არსებულ, მყიფე stock-ლოგიკას (`sales.ts`-ის
~150 ხაზი) — ამიტომ ბოლოს.

---

## STEP 0: წინაპირობა — მიმდინარე არქიტექტურის შეჯამება

დაწყებამდე რელევანტური, უკვე არსებული საფუძველი (კოდის გაცნობით
დადასტურებული — `schema.sql`, `backend/migrations/001-018`,
`backend/src/routes/{products,sales,organizations}.ts`,
`backend/src/middleware/requireRole.ts`, `frontend/src/App.tsx`):

1. **Multi-tenant უკვე დანერგილია** (`ROADMAP - Multi-Tenant SaaS - *.md`,
  migration `013`) — ყველა "გლობალურ" ცხრილს აქვს `organization_id
  UUID NOT NULL`, RLS policy (migrations `017`/`018`) + აპლიკაციური
  `withOrgContext()` (`backend/src/db.ts`) ორმაგი დაცვა. ახალი HoReCa
  ცხრილები იმავე პატერნს მისდევს.
2. **Products ცხრილი ბრტყელია:** `id, organization_id, barcode, name,
  price, stock`. არ არსებობს კატეგორია, მოდიფაიერი, რეცეპტი,
  "დასამზადებელი vs მზა-გასაყიდი" განსხვავება.
3. **Partial-success/SAVEPOINT პატერნი უკვე არსებობს** (`sales.ts`-ის
  offline-sync ლოგიკა, `productImportService.ts`) — იგივე მიდგომა
  გამოსადეგია `order_items`-ის row-level დამუშავებისთვის.
4. **როლები `TEXT`-ია, DB constraint-ის გარეშე** — ახალი `'waiter'`
  როლი **migration-ს არ საჭიროებს**, მხოლოდ TS union type-ების და
  `requireAnyRole(...)` გამოძახებების განახლებას.
5. **Realtime infra არ არსებობს** (არც WebSocket, არც SSE) — KDS-ის
  დიზაინი ამაზეა აწყობილი (STEP 2, polling).
6. **Offline-first PWA** (`dexie`, `frontend/src/sync/backgroundSync.ts`)
  მთავარი architectural ღერძია Retail POS-ისთვის — `orders`-ის სრული
  offline მხარდაჭერა **v1-ის scope-ს სცდება** (იხ. "Offline-ის
  საზღვარი" ბოლოში).
7. **Migration numbering:** ბოლო არსებული `018_rls_registers_
  activation_codes.sql` — HoReCa იწყება `019`-დან, არსებული idempotent
  `DO $$ ... RAISE EXCEPTION` პატერნით (მაგ. `009`/`013`).

### business_type — ჩართვის მექანიზმი

```sql
-- 019_add_business_type.sql (მონახაზი)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'retail'
    CHECK (business_type IN ('retail', 'horeca'));
```

ნაგულისხმევი `'retail'` — ყველა არსებული org უცვლელი რჩება. JWT
payload-ს ემატება `businessType` (`organizationId`-ის ანალოგიით) —
frontend ერთი decode-ით წყვეტს, HoReCa-ს ნავიგაცია (`Tables.tsx`,
`OrderScreen.tsx`, `KitchenDisplay.tsx`) გამოაჩინოს თუ არა. `Sales.tsx`
(POS checkout) **ორივე ტიპისთვის საერთოა** — მაგიდის დახურვისას
საბოლოო checkout მაინც იგივე `POST /api/payments`-ს გაივლის
(`order_items`-დან გენერირებული `items[]` + ახალი, არასავალდებულო
`order_id`).

---

## STEP 1: Tables + Orders (ბირთვი)

### 1.1 მაგიდები (`tables`)

```sql
CREATE TABLE public.tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,              -- "მაგიდა 5", "ბარის სკამი 2"
  section TEXT,                    -- "დარბაზი", "ტერასა", "ბარი"
  capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'free'
    CHECK (status IN ('free', 'occupied', 'reserved', 'dirty')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

`status` დენორმალიზებულია — `'reserved'`/`'dirty'`-ს პირდაპირი
შესაბამისი `order` არ აქვს (ჯავშანი/დასუფთავების მოლოდინი ოფიციანტის/
ჰოსტესის მანუალური მარკირებაა).

### 1.2 ღია შეკვეთა (`orders`)

```sql
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  table_id UUID REFERENCES tables(id),          -- NULL = ბარი/takeaway
  register_id UUID NOT NULL REFERENCES registers(id),
  shift_id UUID NOT NULL REFERENCES shifts(id),
  opened_by UUID NOT NULL REFERENCES users(id), -- ოფიციანტი
  guest_count INTEGER,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'voided')),
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP,
  closed_payment_id UUID REFERENCES payments(id)
);

CREATE UNIQUE INDEX uq_one_open_order_per_table
  ON public.orders (table_id) WHERE (status = 'open' AND table_id IS NOT NULL);
```

`uq_one_open_order_per_table` იმეორებს არსებულ პატერნს
(`uq_one_open_shift_per_register`, migration `009`).

### 1.3 შეკვეთის სტრიქონები (`order_items`)

```sql
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL,          -- შეკვეთის მომენტში დაფიქსირებული ფასი
  seat_number INTEGER,               -- STEP 4-ის ჩეკის გაყოფისთვის
  course_number INTEGER DEFAULT 1,   -- "ტალღა" — 1=წინადადგმა, 2=მთავარი...
  kitchen_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (kitchen_status IN ('pending', 'sent', 'preparing', 'ready', 'served', 'voided')),
  station TEXT,                      -- STEP 2-ის routing ('kitchen'|'bar'|NULL)
  notes TEXT,                        -- "medium rare", "ცხარის გარეშე"
  sent_to_kitchen_at TIMESTAMP,
  voided_by UUID REFERENCES users(id),
  void_reason TEXT
);
```

Void აქ **item-დონეზეა** (არა მხოლოდ მთელი payment-ის void, როგორც
ახლა `sales.ts:660`-ზეა) — რესტორანში ხშირია ერთი კერძის გაუქმება,
დანარჩენი მაგიდის უცვლელად დატოვებით.

### 1.4 ✅ Backend — დასრულებულია (03.09.2026)

- `backend/migrations/019_add_horeca_core.sql` — `organizations.business_type`,
  `tables`, `orders`, `order_items`, RLS policy-ები (migration 017/018-ის
  იდენტური fail-open pattern). **წაუშვია production/dev DB-ზე ჯერ არ არის**
  — pgAdmin-ით ხელით გასაშვები (მომხმარებლის გადაწყვეტილებით).
- `backend/src/middleware/requireBusinessType.ts` — ახალი გუარდი,
  ფრეშ DB-ჩანაწერიდან ამოწმებს `organizations.business_type`-ს
  (`can_use_discount`-ის იდენტური "არა JWT" პატერნით).
- `backend/src/routes/tables.ts` — `GET/POST/PUT/DELETE /tables`,
  `PATCH /tables/:id/status`.
- `backend/src/routes/orders.ts` — `POST /orders`, `GET /orders`,
  `GET /orders/:id`, `POST /orders/:id/items`, `PATCH /orders/items/:id`
  (რედაქტირება ან `void`), `POST /orders/:id/void` (მთელი შეკვეთის
  გაუქმება payment-ის გარეშე).
- `backend/src/routes/sales.ts` — `POST /payments`-ს დაემატა
  არასავალდებულო `orderId`: მითითებისას იმავე ტრანზაქციაში ხურავს
  შეკვეთას (`closed_payment_id`) და ათავისუფლებს მაგიდას. Retail
  checkout-ზე (`orderId` არასდროს იგზავნება) ნულოვანი გავლენა.
- `backend/src/index.ts` — ორივე router დარეგისტრირებულია.
- `backend/src/types.ts` — `BusinessType`, `RestaurantTable`, `Order`,
  `OrderItem`, `TableStatus`, `OrderStatus`, `KitchenStatus`.
- ვერიფიცირებულია: `npx tsc --noEmit` სუფთაა (0 შეცდომა).
- **დარჩენილია STEP 1-დან:** migration-ის გაშვება production/dev DB-ზე
  (მომხმარებელი, pgAdmin-ით) + frontend (`Tables.tsx`, `OrderScreen.tsx`,
  `App.tsx`-ის ნავიგაცია).

### 1.5 API + Frontend (მიმოხილვა, უცვლელი)

- `routes/tables.ts`: `GET/POST/PUT/DELETE /tables`, `PATCH /tables/:id/status`
- `routes/orders.ts`: `POST /orders` (გახსნა), `GET /orders?status=open`,
  `POST /orders/:id/items`, `PATCH /orders/items/:id`, `POST /orders/:id/close`
  (→ `payments` INSERT, `order_id`-ით)
- `Tables.tsx` — ვიზუალური floor plan, მაგიდაზე კლიკი → `OrderScreen.tsx`
- `OrderScreen.tsx` — item-ების დამატება (მოდიფაიერების/BOM-ის გარეშე
  ჯერ, STEP 3-მდე), checkout → `Sales.tsx`-ის არსებული checkout
  კომპონენტის ხელახლა გამოყენებით (discount/split/cashReceived
  ლოგიკა უკვე იქ არსებობს)

---

## STEP 2: სამზარეულო/ბარის routing (KDS)

`products`-ს ემატება `category_id` (ახალი `product_categories`
ცხრილი) და `station TEXT CHECK (station IN ('kitchen','bar'))`.
`order_items.station` ამის **snapshot**-ია (კატეგორია მომავალში
შეიცვალოს, ძველი შეკვეთა უცვლელი დარჩეს).

**გზა 1 — Thermal printer (ESC/POS):** ფიზიკური ბეჭდვითი აპარატი,
ახალი dependency + hardware-ტესტირება საჭირო.
**გზა 2 — KDS ეკრანი:** ბრაუზერის გვერდი (`KitchenDisplay.tsx`),
polling-ით (`GET /kitchen/tickets?station=...`, 3-5 წმ ინტერვალით).

**რეკომენდაცია v1: გზა 2.** ნულოვანი ახალი hardware-დამოკიდებულება,
polling საკმარისია ამ მასშტაბზე, WebSocket (`ws`/`socket.io`) ცალკე
infra-გადაწყვეტილებაა — თუ latency პრობლემად იქცევა, მომავალი STEP.
ფიზიკური ბეჭდვა (გზა 1) — მომავალი ეტაპი, printer-მოდელის შერჩევის
შემდეგ.

- `routes/kitchen.ts`: `GET /kitchen/tickets`, `PATCH /kitchen/tickets/:orderItemId/status`
- `KitchenDisplay.tsx` — station-ით გაფილტრული ტიკეტების სია, touch-friendly
  `pending → preparing → ready` ღილაკები

---

## STEP 3: მენიუს მოდიფაიერები + რეცეპტი-საწყობი (BOM)

### 3.1 მოდიფაიერები

```sql
CREATE TABLE public.modifier_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,               -- "ხარისხი", "დანამატი"
  selection_type TEXT NOT NULL DEFAULT 'single'
    CHECK (selection_type IN ('single', 'multiple')),
  is_required BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE public.modifier_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_group_id UUID NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,               -- "medium", "ყველით +2₾"
  price_delta REAL NOT NULL DEFAULT 0
);

CREATE TABLE public.product_modifier_groups (   -- M:N
  product_id INTEGER NOT NULL REFERENCES products(id),
  modifier_group_id UUID NOT NULL REFERENCES modifier_groups(id),
  PRIMARY KEY (product_id, modifier_group_id)
);

CREATE TABLE public.order_item_modifiers (
  order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_option_id UUID NOT NULL REFERENCES modifier_options(id),
  price_delta_snapshot REAL NOT NULL,
  PRIMARY KEY (order_item_id, modifier_option_id)
);
```

### 3.2 რეცეპტი-საწყობი

გახლეჩა, რაც ახლა Products-ში არ არსებობს: **`ingredients`**
(ნედლეული, საკუთარი `stock`-ით — არასდროს იყიდება პირდაპირ) vs
**`products`** (მენიუს ერთეული — რეცეპტიან რეჟიმში აღარ ინახავს
საკუთარ `stock`-ს).

```sql
CREATE TABLE public.recipe_items (
  product_id INTEGER NOT NULL REFERENCES products(id),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  quantity_required NUMERIC(10,3) NOT NULL CHECK (quantity_required > 0),
  PRIMARY KEY (product_id, ingredient_id)
);
```

`products`-ს ემატება `is_recipe_based BOOLEAN DEFAULT false`
(Retail-ზე ყოველთვის `false` — backward-compatible). Checkout-ის
stock-decrement ბლოკს (`sales.ts`) ემატება branch: `true`-ზე —
`recipe_items`-ის მიხედვით ingredient-ების შემცირება (SAVEPOINT/
partial-success პატერნით); `false`-ზე — ახლანდელი პირდაპირი ლოგიკა.
**ეს ყველაზე რისკიანი ცვლილებაა არსებულ checkout-კოდში** — ცალკე,
ფრთხილი refactor, `tests/isolation/`-ის დარღვევის გარეშე.

---

## STEP 4: ჩეკის გაყოფა + მიმტანის როლი/tips

- `payments`-ს ემატება `waiter_id UUID REFERENCES users(id)` და
  `tip_amount REAL NOT NULL DEFAULT 0 CHECK (tip_amount >= 0)`,
  `order_id UUID REFERENCES orders(id)`.
- **გაყოფის ორი რეჟიმი** (ორივე საბოლოოდ ქმნის რამდენიმე `payments`
  row-ს ერთი `order_id`-სთვის — არსებული `payment_splits`
  ("cash+card ერთ ჩეკში") სხვა კონცეფციაა, არ ერევა):
  1. თანაბრად (`totalAmount / guestCount`)
  2. item-ების მიხედვით (`order_items.seat_number`-ის მიხედვით)
- **`'waiter'` როლი** — `requireAnyRole()`-ის ახალი პარამეტრი, DB
  migration არ სჭირდება. უფლებები: `orders`/`order_items` CRUD,
  **არა** Products/UsersManagement/Discount-permission (ეს
  manager/admin რჩება).

---

## Offline-ის საზღვარი (v1-ის scope-ის მიღმა)

Retail POS checkout სრულად offline-capable-ია (Dexie + background
sync). **`orders`/`order_items` v1-ში ამ დონეს არ იღებს** — ღია,
დროში ცვალებადი შეკვეთის conflict-free sync გაცილებით რთულია, ვიდრე
ერთჯერადი checkout-ის queue. **გადაწყვეტილება:** `orders`/
`order_items` ენდპოინტები მოითხოვს აქტიურ კავშირს (კავშირის
გაწყვეტისას — ცხადი შეცდომა, არა silent queue); checkout-ის ბოლო
ნაბიჯი (`POST /api/payments`) კი შეიძლება არსებულ offline-queue
მექანიზმს გაჰყვეს. სრული offline-first Orders — მომავალი კვლევა.

---

## ღია საკითხები (გადასაწყვეტია შესაბამის STEP-მდე)

- [ ] **STEP 1:** მიმტანის წვდომის scope — მხოლოდ საკუთარი გახსნილი
  მაგიდები, თუ ყველა ღია შეკვეთა (cross-waiter)?
- [ ] **STEP 2:** Course-ის "გაგზავნის" UX — ავტომატურად დამატებისთანავე,
  თუ ცალკე batch-ღილაკით ("send course 2")?
- [ ] **STEP 3:** `recipe_items`-ის ერთეულები (გრ/კგ/ლ/ცალი) —
  კონვერტაციის ლოგიკა საჭიროა, თუ ერთი საბაზისო ერთეული საკმარისია?
- [ ] **STEP 1/3:** Void-ის ავტორიზაცია item-დონეზე — cashier/waiter
  თავად, თუ manager PIN override (Discount-ის ანალოგიით)?
- [ ] **STEP 4:** Tips-ის განაწილება — ერთ waiter-ს მთლიანად, თუ
  pooled (გუნდზე გადანაწილება)?
- [ ] **STEP 2:** Realtime latency — polling მისაღებია, თუ საწყისშივე
  WebSocket გვჭირდება?

---

**წყარო საუბარი:** Claude Cowork session, 03.09.2026 — კოდის დათვალიერება
(`schema.sql`, `backend/migrations/001-018`, `backend/src/routes/{products,
sales,organizations}.ts`, `backend/src/middleware/requireRole.ts`,
`frontend/src/App.tsx`, `package.json`-ები) + მომხმარებელთან დაზუსტებული
არქიტექტურული/scope გადაწყვეტილებები. აქამდე `PLAN - HoReCa Module
(მომავალი ეტაპი) - 03.09.2026.md`-ად ინახებოდა — გადარქმეულია ROADMAP-ად,
პროექტის კონვენციის მიხედვით (მსხვილი, მრავალ-STEP-იანი ინიციატივები
ROADMAP ფორმატში იწერება, არა PLAN-ში — შდრ. `ROADMAP - Multi-Tenant
SaaS - 14.08.2026.md`).
