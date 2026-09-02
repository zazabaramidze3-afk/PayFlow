# მომავალი ფიჩერები — Product Excel Import & Dark/Light Mode
**სტატუსი:** ✅ ორივე ფიჩერი დასრულებული და production-ზე დეპლოილია (02.09.2026)
**თარიღი:** 02.09.2026
**კონტექსტი:** Render migration-ის (`ROADMAP - Backend Migration to Render (შესრულებული) - 02.09.2026.md`) დასრულების შემდეგ მოთხოვნილი — ორივე ფიჩერი დაისვენებს, სანამ დაწყებას არ გადავწყვეტთ.

---

## 1️⃣ Product Excel Import (მასობრივი დამატება)

### მოთხოვნა
`Products.tsx`-ის გვერდზე (`ID > შტრიხკოდი > დასახელება...` ცხრილი, Excel/PDF ექსპორტის ღილაკების გვერდით) დაემატოს **Import** ღილაკი — .xlsx ფაილის ატვირთვით პროდუქტების მასობრივი დამატება, მანუალური ერთ-ერთის დამატების პარალელურად (არა მის ჩამნაცვლებლად).

### რას ვიყენებთ უკვე არსებულიდან
- **`exceljs`** (`backend/package.json`) უკვე დამოკიდებულებაშია — ამჟამად მხოლოდ export-ისთვის (`products.ts`, `sales.ts`). იგივე ბიბლიოთეკა კითხულობს .xlsx ფაილებსაც (`ExcelJS.Workbook().xlsx.load(buffer)`) — ახალი dependency არ სჭირდება.
- Products ცხრილში `uq_products_org_barcode` (per-org unique constraint) უკვე არსებობს — import-ის validation-მაც ეს წესი უნდა დაიცვას.

### რა აკლია (ახალი მუშაობა)
- **Backend:** `multer` (ან მსგავსი) — ამჟამად პროექტში საერთოდ არ არსებობს multipart file upload მექანიზმი. ახალი endpoint, მაგ. `POST /products/import` (`authenticateToken` + manager/admin როლის შემოწმებით — cashier-ს ეს არ უნდა შეეძლოს)
- **Excel Template** — მომხმარებელს უნდა შეეძლოს "ნიმუშის ჩამოტვირთვა" (სვეტები: `barcode`, `name`, `price`, `stock`), რომ import-ის ფორმატი ცხადი იყოს
- **Validation & Error Reporting** — თითო row-ზე: სავალდებულო ველების შემოწმება, `price`/`stock` ტიპის ვალიდაცია, დუბლირებული `barcode`-ის დამუშავება (გადამწერა? გამოტოვება? უარყოფა?). საჭიროა row-level შედეგის დაბრუნება frontend-ზე ("15 დაემატა, 2 გამოტოვდა — barcode უკვე არსებობს")
- **Transaction handling** — `pool` client-ით `BEGIN`/`COMMIT` (bulk insert, all-or-nothing ან partial-success mode — გადასაწყვეტია)
- **Frontend:** file input + progress/result UI (`Products.tsx`-ში, Excel/PDF ღილაკების გვერდით)

### გადასაწყვეტი კითხვები — ✅ გადაწყვეტილია (02.09.2026, Cowork session)
- [x] დუბლირებული barcode: **skip + report** (row-level, existing DB-ბარკოდზეც და ერთსა და იმავე ფაილში დუბლირებაზეც — ორ პროდუქტს ერთი barcode არასდროს ექნება, scanner ambiguity გამორიცხულია).
- [x] წარუმატებელი row-ების დამუშავება: **partial import** — ვალიდური row-ები აიტვირთება, დანარჩენები row-level report-ში ბრუნდება (SAVEPOINT-ის pattern, sales.ts-ის syncSingleOfflineReceipt-ის ანალოგიით).
- [x] წვდომის შეზღუდვა: **მხოლოდ manager/admin** (requireAnyRole) — Products.tsx გვერდი ისედაც isAdminOrManager-ზეა დაცული App.tsx-ში.
- [x] მაქსიმალური row-ების რაოდენობა: **1000** row ერთ ფაილში.
- [x] ცარიელი ფაილი: reject-დება (400), ისევე როგორც სავალდებულო სვეტის (name/price) არქონა.

**იმპლემენტაცია დასრულებულია:** backend/src/services/productImportService.ts (parsing/validation),
backend/src/routes/products.ts (GET /products/import/template, POST /products/import),
frontend/src/pages/Products.tsx + Products.module.scss (Import ღილაკი, ნიმუშის ჩამოტვირთვა,
შედეგის მოდალი).

---

## 2️⃣ Dark/Light Mode + დიზაინის დახვეწა

### მოთხოვნა
Frontend-ზე Dark/Light mode-ის დანერგვა + ზოგადი დიზაინის გაუმჯობესება (კონკრეტული scope ჯერ არ არის დაზუსტებული).

### მიმდინარე მდგომარეობა
- Dark mode-ის ინფრასტრუქტურა (`prefers-color-scheme`, `data-theme`, theme context/hook) **საერთოდ არ არსებობს** კოდში — სუფთა ფურცლიდან დაწყება იქნება
- სტილები SCSS Modules-ითაა ორგანიზებული (`*.module.scss`, თითო კომპონენტს/გვერდს თავისი ფაილი) — თანმიმდევრული, მაგრამ ამ ეტაპზე ალბათ hardcoded ფერებით (არა CSS variables)

### მიდგომა (მაღალი დონის)
1. **CSS Custom Properties-ზე გადასვლა** — ყველა hardcoded ფერი (`#fff`, `#333` და ა.შ.) იცვლება `var(--bg-primary)`-ის მსგავსი token-ებით, განსაზღვრული `:root`-ში (light) და `[data-theme="dark"]`-ში (dark)
2. **Theme toggle + persistence** — მარტივი React context/hook, არჩევანი ინახება `localStorage`-ში, `<html>`/`<body>`-ზე `data-theme` attribute-ის დასმით
3. **სისტემური preference-ის pickup** — `prefers-color-scheme` media query default-ად, override-ადი manual toggle-ით
4. **სქოუფის განსაზღვრა "დიზაინის დახვეწისთვის"** — ეს ჯერ ბუნდოვანია (color palette? spacing/typography? კომპონენტების ვიზუალური განახლება?) — დაწყებამდე კონკრეტული მიმართულება/მაგალითები დასაზუსტებელია

### გადასაწყვეტი კითხვები — ✅ გადაწყვეტილია (02.09.2026, Cowork session)
- [x] Dark mode ყველა გვერდზე ერთდროულად, თუ ეტაპობრივად (გვერდი-გვერდზე)? → **ერთბაშად ყველა გვერდზე** (ცენტრალიზებული token-სისტემის წყალობით ერთდროულად დაფარვა დამატებით რისკს არ მატებდა)
- [x] "დიზაინის დახვეწა" — კონკრეტულად რომელი გვერდები/კომპონენტები ჯერ? → **ამ ეტაპზე გადავადებულია**, scope შემოიფარგლა მხოლოდ Dark/Light toggle-ის ინფრასტრუქტურით (ვიზუალური/კომპონენტების რედიზაინი ცალკე, მომავალში დასაზუსტებელი ეტაპია)

**იმპლემენტაცია დასრულებულია:** frontend/src/styles/_theme.scss (light/dark CSS custom properties),
frontend/src/styles/_variables.scss (ყველა $color-* token გადავიდა var(--...)-ზე),
frontend/src/styles/global.scss (@use './theme' დამატება), frontend/index.html (FOUC-ის თავიდან
ასაცილებელი inline script), frontend/src/hooks/useTheme.ts (თემის მართვის hook), frontend/src/App.tsx
+ App.module.scss (toggle ღილაკი sidebar-ში). ვერიფიცირებულია: tsc --noEmit სუფთაა, ყველა 11
.module.scss ფაილი კომპილირდება წარმატებით, ტოკენები სწორად გადადის var(--...)-ის სახით.

### შემდგომი დახვეწა — production feedback-ის შემდეგ (02.09.2026)

საწყისი დეპლოის შემდეგ, რეალურ production screenshot-ებზე დაფუძნებული feedback-ით, დამატებით
გასწორდა:

- **Autofill-ის კონტრასტი** — Chrome/Edge-ის ავტომატური ფონი (email/password ველებზე) CSS-ს
  არ ემორჩილებოდა, dark mode-ში თეთრ „ლაქებად" გამოჩნდებოდა → `input-base`-ს დაემატა
  `-webkit-autofill` inset box-shadow override.
- **Toggle-ის მდებარეობა** — თავიდან sidebar-ის ბოლოში იყო (არასასურველი სივრცე), შემდეგ
  fixed top-right (ედებოდა Products-ის Import/Excel/PDF ღილაკებს) → საბოლოოდ გადავიდა
  app-chrome-ში (sidebar-ის brand-ხაზი დესკტოპზე, mobile topbar მობილურზე), position: fixed
  float-ის გარეშე, არასდროს არ ეჯახება გვერდის საკუთარ header-ს.
- **Toggle-ის დიზაინი** — მარტივი icon-ღილაკის ნაცვლად sun/moon pill/switch კომპონენტი
  (`components/ThemeToggleSwitch.tsx`), ერთი გაზიარებული იმპლემენტაცია ორივე ადგილას.
- **გლუვი გადასვლა** — თემის toggle-ზე მკვეთრი "ციმციმის" ნაცვლად smooth transition
  (`global.scss`: `*, *::before, *::after` — background-color/border-color/color/box-shadow,
  0.25s ease, დაბალი სპეციფიკურობით, არსებული component-level transition-ების გარეშე).
- **სამი კონტრასტის ბაგი** — native `<input type="date">`-ის calendar ხატულა (Chrome-ში მუდამ
  შავი SVG, dark ფონზე უჩინარი) → `--date-icon-filter` token; Recharts-ის chart tooltip-ის
  label-ი (`ExecutiveDashboard.tsx`) `--color-text-primary`-ს (თითქმის თეთრი dark-ზე) იმემკვიდრებდა
  თეთრ tooltip-ის ფონზე → ცალსახა `labelStyle`/`contentStyle`; Products-ის "ყურადღება" ბანერის
  ტექსტი hardcoded `#92400E` იყო (მხოლოდ light-ისთვის) → `--color-warning-text` /
  `--color-warning-banner-bg` token-ები.
- **Dark პალიტრის დაბალანსება** — ფონი (`bg-page`/`bg-card`/`bg-subtle`) დამუქდა შავთან უფრო
  ახლოს (`#0F1115` → `#060607`), აქცენტის ფერები (danger/warning/success/info) ოდნავ
  დაბალსატურირდა, რომ status ღილაკები/badge-ები ნაკლებად "იყვირონ". MANAGER/CASHIER
  role-badge-ების ტექსტიც (`#854D0E`/`#166534`) იგივე hardcoded-text ბაგს იზიარებდა —
  `--color-role-manager-text` / `--color-role-cashier-text` token-ებით გასწორდა.

სულ 7 commit (`900ad25`-დან `4d56516`-მდე), ყველა push-ილი და production-ზე დეპლოილი.

---

## შენიშვნა პრიორიტეტზე

ორივე ფიჩერი **დამოუკიდებელია** Render migration-ისგან და ერთმანეთისგანაც — ცალ-ცალკე, ნებისმიერი თანმიმდევრობით შეიძლება დაიწყოს. Migration-ის მიმდინარე მონიტორინგის პერიოდის (`vercel.json` cleanup, Starter plan, `JWT_SECRET` fallback) დასრულებამდე რეკომენდირებულია ახალ ფიჩერებზე არ გადასვლა, რომ production-ის სტაბილურობაზე ყურადღება არ გაიფანტოს.

---

**წყარო საუბარი:** Claude Cowork session, 02.09.2026
