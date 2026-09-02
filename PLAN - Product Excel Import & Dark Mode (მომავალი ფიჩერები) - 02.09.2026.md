# მომავალი ფიჩერები — Product Excel Import & Dark/Light Mode
**სტატუსი:** 📋 დაგეგმილი, **არ არის საჭირო დღეისთვის**
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

---

## შენიშვნა პრიორიტეტზე

ორივე ფიჩერი **დამოუკიდებელია** Render migration-ისგან და ერთმანეთისგანაც — ცალ-ცალკე, ნებისმიერი თანმიმდევრობით შეიძლება დაიწყოს. Migration-ის მიმდინარე მონიტორინგის პერიოდის (`vercel.json` cleanup, Starter plan, `JWT_SECRET` fallback) დასრულებამდე რეკომენდირებულია ახალ ფიჩერებზე არ გადასვლა, რომ production-ის სტაბილურობაზე ყურადღება არ გაიფანტოს.

---

**წყარო საუბარი:** Claude Cowork session, 02.09.2026
