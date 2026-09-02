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

### გადასაწყვეტი კითხვები (დაწყებამდე)
- [ ] დუბლირებული barcode: **skip**, **overwrite**, თუ **reject მთელი ფაილი**?
- [ ] წარუმატებელი row-ების დამუშავება: **partial import** (რაც გავიდა გავიდა) თუ **all-or-nothing**?
- [ ] წვდომის შეზღუდვა: მხოლოდ **manager/admin**, თუ **cashier**-საც შეეძლოს?

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

### გადასაწყვეტი კითხვები (დაწყებამდე)
- [ ] Dark mode ყველა გვერდზე ერთდროულად, თუ ეტაპობრივად (გვერდი-გვერდზე)?
- [ ] "დიზაინის დახვეწა" — კონკრეტულად რომელი გვერდები/კომპონენტები ჯერ? მაგალითი/reference თუ არსებობს?

---

## შენიშვნა პრიორიტეტზე

ორივე ფიჩერი **დამოუკიდებელია** Render migration-ისგან და ერთმანეთისგანაც — ცალ-ცალკე, ნებისმიერი თანმიმდევრობით შეიძლება დაიწყოს. Migration-ის მიმდინარე მონიტორინგის პერიოდის (`vercel.json` cleanup, Starter plan, `JWT_SECRET` fallback) დასრულებამდე რეკომენდირებულია ახალ ფიჩერებზე არ გადასვლა, რომ production-ის სტაბილურობაზე ყურადღება არ გაიფანტოს.

---

**წყარო საუბარი:** Claude Cowork session, 02.09.2026
