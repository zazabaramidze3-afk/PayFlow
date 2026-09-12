# Hotel Room Management Module — Roadmap

**სტატუსი:** 🔵 დაგეგმილია — იმპლემენტაცია ჯერ არ დაწყებულა
**თარიღი:** 11.09.2026
**კონტექსტი:** HoReCa მოდულის (`ROADMAP - HoReCa Module - 03.09.2026.md`)
იმავე "მაგიდა + სტატუსი" პატერნის განხილვისას წამოვიდა იდეა — შესაძლებელია
თუ არა იგივე მიდგომით სასტუმროს ოთახების მართვის მოდულის დამატება
(თავისუფალი/დაკავებული/დაჯავშნილი/დასალაგებელი სტატუსებით, Tables.tsx-ის
card + quick-status ღილაკების UI-ის მსგავსად). ეს დოკუმენტი აფიქსირებს
საწყის არქიტექტურულ გადაწყვეტილებას და scope-ს, დეტალური იმპლემენტაციის
დაწყებამდე.

---

## 1. `business_type` გადაწყვეტილება (გადაწყვეტილია)

**კონტექსტი:** Migration 019 (`organizations.business_type`) ამჟამად
mutually-exclusive enum-ია — `CHECK (business_type IN ('retail', 'horeca'))`.
სასტუმროს მოდულისთვის ორი გზაა:

- **(A) მესამე მნიშვნელობის დამატება** — `'hotel'` ემატება CHECK-ს
  (`retail` | `horeca` | `hotel`). მინიმალური, idempotent migration
  (019-ის იგივე pattern), არსებულ businessType-გეითინგის ლოგიკას
  (`App.tsx`/`Tables.tsx`/`Modifiers.tsx` და ა.შ. — ყველგან
  string-შედარებაა) არ არღვევს.
- **(B) `business_type` → `modules TEXT[]`/ცალკე `organization_modules`
  ცხრილი** — org-ს შეეძლება ერთდროულად ჰქონდეს რამდენიმე მოდული
  (მაგ. სასტუმრო + საკუთარი რესტორანი/HoReCa ერთად). არქიტექტურულად
  "სწორი" გრძელვადიან პერსპექტივაში (სასტუმროებს ხშირად რეალურადაც
  აქვთ F&B სერვისი), მაგრამ მოითხოვს ყველა არსებული businessType-შემოწმების
  რეფაქტორინგს (`=== 'horeca'` → `.includes('horeca')` ტიპის ცვლილება
  ყველგან) — დიდი, invasive refactor კონკრეტული hybrid-org მოთხოვნის
  გარეშე.

**გადაწყვეტილება:** STEP 1-ისთვის **(A) — მესამე enum-მნიშვნელობა**.
YAGNI პრინციპით: hybrid (სასტუმრო + რესტორანი ერთ org-ში) მოთხოვნა ჯერ
რეალურად არავის დაუსვამს, migration მარტივი და უსაფრთხო რჩება, არსებული
გეითინგის ლოგიკა უცვლელია. **ცნობილი შეზღუდვა, განზრახ დეფერილი:** თუ
მომავალში რეალურად საჭირო გახდება ერთ org-ზე ერთდროულად Hotel + HoReCa
(ან Hotel + Retail — მაგ. სასტუმროს სუვენირების მაღაზია), საჭირო იქნება
migration (B)-ზე გადასვლა — ეს არ არის ამ STEP-ის ნაწილი.

---

## 2. მონაცემთა მოდელი — ცალკე `rooms` entity (არა `tables`-ის გაფართოება)

**რატომ ცალკე ცხრილი, არა `tables`-ის reuse:**
- ოთახებს აქვთ განსხვავებული ატრიბუტები, რომლებიც `tables`-ს არ სჭირდება:
  ოთახის ნომერი, ტიპი/კატეგორია (Standard/Deluxe/Suite და ა.შ.), სართული,
  საწოლების კონფიგურაცია.
- Occupancy-ციკლი დროში სრულიად განსხვავებულია — HoReCa-ს მაგიდა "იხსნება"
  ერთი ვიზიტისთვის (`orders`, საათების მასშტაბით), სასტუმროს ოთახი
  "იკავება" check-in/check-out თარიღების დიაპაზონით (დღეების მასშტაბით,
  calendar/booking-ლოგიკით) — სრულიად სხვა domain model, `orders`-ის
  ხელახლა გამოყენება არასწორი იქნებოდა.

**დაგეგმილი სქემა (Migration draft, STEP 2-ზე დასაზუსტებელი):**
```sql
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  number TEXT NOT NULL,           -- ოთახის ნომერი (მაგ. "204")
  room_type TEXT,                 -- Standard/Deluxe/Suite და ა.შ.
  floor TEXT,
  capacity INTEGER,               -- საწოლების/სტუმრების რაოდენობა
  status TEXT NOT NULL DEFAULT 'free'
    CHECK (status IN ('free', 'occupied', 'reserved', 'dirty', 'out_of_order')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
`tables`-ის იგივე idempotent/RLS (`org_isolation_*`, fail-open) pattern
გამეორდება (Migration 019-ის კონვენციით).

---

## 3. სტატუსები

`tables`-ის 4 სტატუსს (`free`/`occupied`/`reserved`/`dirty`) emატება
housekeeping-სპეციფიკური მე-5 სტატუსი:

| სტატუსი | ქართული | კონტექსტი |
|---|---|---|
| `free` | თავისუფალი | დასაკავებლად მზადაა |
| `occupied` | დაკავებული | სტუმარი ამჟამად ცხოვრობს |
| `reserved` | დაჯავშნილი | მომავალი check-in-ისთვის დაჯავშნილია |
| `dirty` | დასალაგებელი | check-out მოხდა, დასალაგებელია |
| `out_of_order` | ტექნიკურად გამორთული | რემონტი/ავარია — ვერ გაიცემა |

UI-ის quick-status ღილაკები (`Tables.tsx`-ის `QUICK_STATUSES` პატერნის
იდენტურად) `out_of_order`-ს გამორთავს "quick"-სიიდან — ეს სტატუსი
ცალკე, უფრო "ცნობიერი" მოქმედებით უნდა ინიშნებოდეს (არა ერთი დაჭერით),
შემთხვევითი მონიშვნის თავიდან ასაცილებლად.

---

## 4. საჭირო კომპონენტები (STEP 2 scope — არ დაწყებულა)

1. **Migration** — `organizations.business_type` CHECK-ის განახლება
   (`+ 'hotel'`) + ახალი `rooms` ცხრილი (ზემოთ, RLS-ითურთ).
2. **`backend/src/routes/rooms.ts`** — CRUD + `PATCH /rooms/:id/status`
   (`tables.ts`-ის იდენტური სტრუქტურით).
3. **`frontend/src/pages/Rooms.tsx`** — `Tables.tsx`-ის card/
   quick-status-ღილაკების/ფერადი dot-ინდიკატორის იგივე UI-პატერნით,
   ცალკე `RoomStatus` ტიპით (`'free' | 'occupied' | 'reserved' | 'dirty'
   | 'out_of_order'`).
4. **Sidebar nav-item** — `businessType === 'hotel'`-ზე გეითინგი
   (`Modifiers`/`Ingredients`-ის იგივე admin/manager-ონლი pattern,
   `App.tsx`).
5. **i18n keys** — `rooms.status.*`, `rooms.title` და ა.შ., ორივე ენაზე
   (`ka.json`/`en.json`), i18n roadmap-ის fragment-merge staleness-guard
   პატერნით.
6. **Lazy-loaded route** — `const Rooms = lazy(() => import('./pages/Rooms'))`
   (Dashboard/Tables/KitchenDisplay-ის იგივე code-splitting კონვენციით).

**Out of scope STEP 2-ისთვის (მომავალი STEP-ები):** booking/calendar
ლოგიკა (check-in/check-out თარიღების დიაპაზონი, ჯავშნების კალენდარი),
room service შეკვეთები (`orders`-თან კავშირი), housekeeping-პერსონალის
ცალკე როლი/დავალებები.

---

## 5. STEP 3 — Booking/Calendar ინტეგრაცია (დაგეგმილი, არ დაწყებულა)

**კონცეფცია:** `bookings` — ცალკე entity, `rooms.status`-ისგან
დამოუკიდებელი. `rooms.status` არის "ახლა რა ხდება ოთახში" (მყისიერი,
manually-toggled), `bookings` — დროში გაწელილი ჩანაწერი (check-in →
check-out თარიღების დიაპაზონი).

**სქემა (draft):**
```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  room_id UUID NOT NULL REFERENCES public.rooms(id),
  guest_name TEXT NOT NULL,
  guest_phone TEXT,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (check_out_date > check_in_date),

  -- 🔒 ორმაგი დაჯავშნის აკრძალვა DB-დონეზე (race condition-საც კი
  -- იცავს) — cancelled/no_show აღარ ითვლება "დაკავებულად".
  EXCLUDE USING gist (
    room_id WITH =,
    daterange(check_in_date, check_out_date, '[)') WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'))
);
```
`guest_name`/`guest_phone` პირდაპირ `bookings`-ზეა, ცალკე
`guests`/CRM ცხრილის გარეშე (YAGNI — CRM ცნება ჯერ არსად არსებობს
codebase-ში).

**`rooms.status` ↔ `bookings` კავშირი — manual action, არა auto-derive:**
`Tables.tsx`-ის quick-status ღილაკების იგივე ფილოსოფია:
- **"Check-in" ღილაკი** → `bookings.status → checked_in` +
  `rooms.status → occupied`.
- **"Check-out" ღილაკი** → `bookings.status → checked_out` +
  `rooms.status → dirty` (housekeeping-ს სჭირდება დალაგება).
- დღეს-არსებული, ჯერ check-in-არდამდგარი ჯავშანი ოთახის `status`-ს
  ავტომატურად **არ** ცვლის `reserved`-ზე — date-ზე დამოკიდებული
  auto-compute (cron/scheduled job) მომავალი, გამარტივებული STEP-ია.

**Calendar UI:** ცალკე `RoomCalendar.tsx` — Gantt/timeline grid
(მწკრივები = ოთახები, სვეტები = თარიღები, ~14/30-დღიანი ფანჯარა),
ჯავშნები ზოლებად. `Rooms.tsx` რჩება "დღევანდელი სტატუს-დაფად"
(Tables.tsx-ის ანალოგი), `RoomCalendar.tsx` — ცალკე გვერდი/ტაბი.

**Payments:** STEP 3-ში არ შედის — `orders.closed_payment_id`-ის იგივე
პატერნი (`bookings.deposit_payment_id`/`final_payment_id`) STEP 5-ზეა
გადატანილი.

---

## 6. STEP 4 — OTA Sync (Booking.com) — ანალიზი და გადაწყვეტილება

**კონტექსტი:** განხილულია სამი შესაძლო გზა Booking.com-თან ოთახების
ხელმისაწვდომობის სინქრონისთვის (Booking.com-ზე პირდაპირ დაჯავშნისას
PayFlow-შიც აისახოს, და პირიქით).

### 6.1 სამი ვარიანტის შედარება

| მეთოდი | ღირს? | დამტკიცება საჭიროა? | სისწრაფე |
|---|---|---|---|
| **iCal calendar sync** | უფასო | არა — extranet-ის ჩვეულებრივი პარამეტრი | ნელი — polling, 15წთ-რამდენიმე საათი |
| **Connectivity API (პირდაპირ)** | უფასო (API თავად), მაგრამ commission ცალკეა | დიახ — Booking.com Connectivity Partner-ის სერტიფიცირება (კვირები/თვეები, ზოგჯერ დახურულია ახალი განაცხადებისთვის) | Tier-ზეა დამოკიდებული: **Standard** = საათობრივი/batch, **Premier** = near real-time (webhook, წამები) |
| **Channel Manager** (SiteMinder/RateGain/HotelRunner და ა.შ.) | ფასიანი — ყოველთვიური subscription | არა ჩვენგან (Channel Manager თავად უკვე სერტიფიცირებულია Booking.com-თან) | ჩვეულებრივ წამები-წუთები (CM-ის საკუთარი tier-ზეა დამოკიდებული) |

**მექანიზმის განსხვავება:** iCal არის **pull/polling** (ორივე მხარე
პერიოდულად "ამოწმებს" ლინკს, push საერთოდ არ არსებობს — ამ
ინტერვალში overselling-ის რეალური რისკია). Connectivity API/Channel
Manager არის **push/webhook** (ჯავშნის მომენტში მყისიერად ეცნობება).

### 6.2 კრიტიკული შეზღუდვა — iCal და multi-room room-type

Booking.com-ის calendar-sync ფუნქცია **თითო room type-ზე მაქსიმუმ 1
ერთეულს** უშვებს. ანუ:
- თუ ოთახები ჯგუფურადაა დარეგისტრირებული (მაგ. "Standard Double" — 1
  room type, 10 ერთეულით, საერთო inventory pool) — calendar-sync ამ
  10 ოთახზე **ცალ-ცალკე ვერ იმუშავებს**, რადგან Booking.com კონკრეტულ
  ოთახის ნომერს არც კი იცნობს (მხოლოდ pool-ის რაოდენობას იკლებს).
- სამუშაოდ საჭირო იქნებოდა თითოეული ოთახის ცალკე room type-ად
  რეგისტრირება Booking.com-ის მხარეს (30 ოთახი → 30 room type) — რაც
  სტუმრისთვის საძიებო შედეგებში არეულობას და rate-მართვის 30-ჯერად
  გამრავლებას იწვევს. **30-ოთახიან, რამდენიმე room-type-იან რეალურ
  სასტუმროზე ეს პრაქტიკულად არ ჯდება.**
- iCal რეალურად მუშაობს მხოლოდ იმ property-ებზე, სადაც ყოველი ოთახი
  უკვე ისედაც უნიკალურია (ერთი ოთახი = ერთი room type, ხშირია პატარა
  guesthouse-ებში).

### 6.3 გადაწყვეტილება

**iCal — deferred/not recommended** მრავალ-ოთახიანი, room-type-პულებზე
დაფუძნებული სასტუმროსთვის (ჩვენი target-შემთხვევა), ზემოთხსენებული
შეზღუდვის გამო.

**Channel Manager — რეკომენდებული გზა STEP 4-ისთვის:** room-type +
inventory count მოდელს სწორად უმკლავდება (Booking.com-ის ნამდვილი
hotel-inventory API-ს იყენებს, არა iCal-ს), დამტკიცება/სერტიფიცირება
ჩვენგან არ სჭირდება (Channel Manager უკვე სერტიფიცირებულია), ღირს
subscription-ის სახით (კონკრეტული ვენდორი და ფასი — მომავალი
გადაწყვეტილება, ბიზნეს-მხარეზეა დამოკიდებული).

**Connectivity API პირდაპირ — deferred:** დამტკიცების ბარიერი
(კვირები/თვეები, ზოგჯერ დახურული ახალი განაცხადებისთვის) ამ ეტაპზე
არაპროპორციულია, სანამ Channel Manager-ის გზა არ იქნება ამოწურული.

**STEP 4 იმპლემენტაციის ნაბიჯები (Channel Manager არჩევის შემდეგ):**
1. **ვენდორის არჩევა** — კონკრეტული Channel Manager (SiteMinder/
   RateGain/HotelRunner და ა.შ.), ფასი/ფუნქციონალის შედარებით
   (ბიზნეს-გადაწყვეტილება, ცალკე კვლევის საგანი).
2. **`bookings`-ზე ახალი ველები** — `external_source TEXT` (`'direct'`
   | `'channel_manager'`), `external_reservation_id TEXT` (idempotent
   upsert/dedupe-სთვის) + unique constraint
   `(external_source, external_reservation_id)`.
3. **`backend/src/routes/channelManagerWebhook.ts`** — ვენდორის
   webhook-ის მიმღები endpoint (ახალი/შეცვლილი/გაუქმებული ჯავშნის
   push-ის დამუშავება → `bookings` upsert).
4. **PayFlow → Channel Manager push** — ჩვენი მხრიდან ახალი/გაუქმებული
   ჯავშნის შემთხვევაში ვენდორის ARI/inventory API-ს გამოძახება
   (room-type-ის ხელმისაწვდომობის განახლება).
5. **Retry/idempotency** — webhook-ის ორმაგი მიღების დაცვა
   (`external_reservation_id` unique constraint-ით, ზემოთ).

---

## შემდეგი ნაბიჯი

STEP 2 (Migration + routes + page — ოთახის სტატუსის მართვა, calendar/
booking-ის გარეშე) რჩება პირველი, თვითკმარი ეტაპი. STEP 3 (booking/
calendar) და STEP 4 (OTA sync, Channel Manager-ის ვენდორის არჩევით)
ცალკე, მომდევნო ეტაპებია — STEP 2-ის დასრულების/დადასტურების შემდეგ
დასაწყები.
