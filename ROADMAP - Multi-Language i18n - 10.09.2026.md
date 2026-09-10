# Multi-Language (i18n) — Roadmap

**სტატუსი:** 🟡 მიმდინარე — ინფრასტრუქტურა + 2 გვერდი დასრულებულია (Sales.tsx, Tables.tsx), დარჩენილია 6 გვერდი + backend error-message-ების ფენა.
**თარიღი:** 10.09.2026
**წყარო:** react-i18next-ზე გადასვლის ეტაპობრივი (page-by-page) rollout, დაწყებული Cowork session-ში.

**კონტექსტი:** აპლიკაციას ემატება მრავალენოვნება — ქართული (default) და ინგლისური. ენა ინახება მომხმარებლის მიხედვით ბაზაში (`users.language` სავარაუდოდ, `PATCH /me/language`-ით მუშავდება). თარგმანი მიმდინარეობს ეტაპობრივად, ერთი გვერდი/კომპონენტი ერთ ჯერზე: ვთარგმნით → ვატესტებთ ლოკალურად (`localhost:3000`) ორივე ენაზე და ორივე თემაზე (light/dark) → commit მხოლოდ მომხმარებლის პირდაპირი დადასტურების შემდეგ → push ყოველთვის მომხმარებელი აკეთებს თავად.

---

## ✅ დასრულებული

### 1. i18n ინფრასტრუქტურა + Login + sidebar nav
**Commit:** `07f8718` — `feat(i18n): react-i18next infrastructure + per-user language (Login + sidebar nav)`

- `react-i18next` დაყენება/კონფიგურაცია, `frontend/src/i18n/` — `ka.json`/`en.json` locale ფაილები.
- ენის სვიჩერი + per-user persistence ბაზაში.
- გადათარგმნილია: Login გვერდი, sidebar ნავიგაცია.
- დაარსდა ძირითადი namespace-ები: `login`, `language`, `nav`, `common`.

### 2. Sales.tsx (POS სალარო გვერდი)
**Commit:** `a2ad321` — `feat(i18n): translate Sales.tsx (POS cashier page)`

- სრულად გადათარგმნილია: cart, discount, split payment, checkout, ბეჭდვა, "ჩემი ისტორია", void-confirm, close-shift + Z-Report.
- ~47 JSX ტექსტ-ბლოკი + ~32 toast შეტყობინება.
- დაემატა `sales.*` namespace (მათ შორის `sales.toasts.*`, `sales.paymentBadge.*`).
- დაფიქსირდა და გასწორდა variable-shadowing ბაგი `ToastContainer`-ში (`toasts.map(t => ...)` შეეჯახა `useTranslation()`-ის `t`-ს).
- ტესტირებულია მომხმარებლის მიერ, ორივე ენაზე/თემაზე, სრული cashier flow.

### 3. Tables.tsx (HoReCa Floor Plan) + ConfirmModal.tsx
**Commit:** `f68ac9c` — `feat(i18n): translate Tables.tsx (HoReCa floor plan) + ConfirmModal defaults`

- სრულად გადათარგმნილია: floor plan, მაგიდის დამატება/რედაქტირება/წაშლა, shift-control mini-widget (გახსნა/დახურვა + Z-Report).
- დაემატა `tables.*` namespace (`tables.status.*`, `tables.toasts.*`), მაქსიმალურად გამოყენებულია არსებული `sales.*`/`common.*` key-ები დუბლირების ნაცვლად.
- `ConfirmModal.tsx` (გაზიარებული კომპონენტი) — default button label-ები (`დიახ`/`გაუქმება`) გადავიდა `i18n.t()`-ზე, აღარ არის ჰარდკოდილი ქართულად.
- ტესტირებულია მომხმარებლის მიერ ორივე ენაზე, ორივე თემაზე; დადასტურებულია production-ზეც (`pay-flow-zet3.vercel.app`).

---

## ⏳ დარჩენილი გვერდები (თარგმანი ჯერ არ დაწყებულა)

გვერდები დალაგებულია `frontend/src/pages/`-ში ჯერ კიდევ დარჩენილი ქართული ტექსტის მოცულობის მიხედვით (მიახლოებითი, მოიცავს კომენტარებსაც — რეალური scope დაზუსტდება თითოეულის თარგმნის დაწყებისას):

1. **UsersManagement.tsx** — მომხმარებლების/როლების მართვის გვერდი (admin/manager). დიდი ფაილია.
2. **OrderScreen.tsx** — HoReCa-ს ცალკე შეკვეთის ეკრანი (მიმტანის order-taking UI). დიდი ფაილია, საჭიროებს ცალკე ყურადღებას (მოდიფაიერები, split, BOM).
3. **Dashboard.tsx** — მთავარი დეშბორდი (სტატისტიკა/რეპორტები).
4. **Products.tsx** — პროდუქტების მართვის გვერდი.
5. **ExecutiveDashboard.tsx** — executive/owner დეშბორდი.
6. **Modifiers.tsx** — მოდიფაიერების მართვა (HoReCa).
7. **KitchenDisplay.tsx (KDS)** — სამზარეულოს ეკრანი.
8. **Ingredients.tsx** — ინგრედიენტების მართვა.
9. **Register.tsx** — სალარო/register-ის გვერდი.
10. **Settings.tsx** — პარამეტრების გვერდი.

**შენიშვნა:** ეს სია მოიცავს მხოლოდ `frontend/src/pages/`-ს. დამატებით საჭირო იქნება გაზიარებული კომპონენტების (`frontend/src/components/`) გადამოწმებაც თითოეული გვერდის თარგმნისას — ისე, როგორც `ConfirmModal.tsx` მოგვეყარა Tables.tsx-ის დროს.

## ⏳ ცალკე ფენა (out of scope ჯერჯერობით)

- **Backend error-message-ების i18n** — ამჟამად API error-ები ინგლისურ/ქართულად ჰარდკოდილია backend-ში; frontend-ზე ნაჩვენებ toast/error ტექსტებთან შესათანხმებლად საჭირო იქნება ცალკე გადაწყვეტა (key-ების დაბრუნება ტექსტის მაგივრად + frontend-ზე თარგმნა, ან locale-aware error-messaging backend-ზე). არ დაწყებულა.
- Dev-only `console.error()` ზარები და კოდის კომენტარები **განზრახ რჩება** ნათარგმნი — out of scope (დადგენილია პროექტის დასაწყისშივე).

---

## პროცესი / კონვენციები (გასაგრძელებლად)

- **ერთი გვერდი ერთ ჯერზე** — თარგმანი → ლოკალური ტესტი (ორივე ენა + ორივე თემა) → commit მხოლოდ მომხმარებლის დადასტურებით → push ყოველთვის მომხმარებელი.
- **Key namespace** გვერდის სახელის მიხედვით (`sales.*`, `tables.*`, და ა.შ.), საერთო key-ები (`common.*`, `nav.*`) — გამეორებადი ტექსტისთვის (ღილაკები, სტატუსები), key-ების დუბლირების ნაცვლად.
- **Module-level ფუნქციები/constant-ები** (კომპონენტის გარეთ, `useTranslation()` hook-ის გარეშე) იყენებენ `i18n.t()` singleton-ს (`import i18n from '../i18n'`), არა hook-ს.
- **Variable-shadowing შემოწმება სავალდებულოა** ყოველი გვერდის შემდეგ — `grep` `t =>`/`(t,`/`(t)` პატერნებზე, რომ `.map(t => ...)`-ისნაირმა callback-ებმა არ დაფაროს `useTranslation()`-ის `t`.
- **ვერიფიკაცია გვერდის დასრულებისას:** (1) დარჩენილი ქართული ტექსტის სკანი (კომენტარების გამოკლებით), (2) `tsc --noEmit` სუფთა უნდა იყოს, (3) გამოყენებული ყველა `t('...')` key არსებობს ორივე `ka.json`/`en.json`-ში.
