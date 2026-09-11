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

## შემდეგი ნაბიჯი

STEP 2-ის (Migration + routes + page) დაწყებამდე საჭიროა დამატებითი
გადაწყვეტილებები (scope-ის ცხადად შემდეგ ეტაპზე): booking/calendar
საჭიროა თუ არა STEP 2-ში, თუ მხოლოდ სტატუსის მართვა საკმარისია პირველ
ეტაპზე (Tables.tsx-ის ანალოგიით, calendar-ის გარეშე).
