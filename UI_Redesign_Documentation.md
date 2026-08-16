# PayFlow — UI/UX რედიზაინის დოკუმენტაცია

Frontend stack: Vite + React + TypeScript, CSS Modules (`.module.scss`, Dart Sass `@use` syntax), Recharts.

---

## 1. დიზაინის სისტემა (Design Tokens)

ცენტრალიზებული, ერთი წყაროდან მართული დიზაინის სისტემა:

- **`src/styles/_variables.scss`** — ფერთა პალიტრა (`$color-primary: #2563EB`, `$color-danger: #DC2626`, `$color-warning: #F59E0B`, `$color-success: #10B981` და მათი soft/hover ვარიანტები), spacing/radius/shadow/transition ტოკენები, breakpoints — `$bp-mobile: 640px`, `$bp-tablet: 1024px`.
- **`src/styles/_mixins.scss`** — გადამწყვეტი, ხელახლა გამოყენებადი მიქსინები: `card`, `card-hover`, `input-base`, `btn-base` (+ `btn-primary/danger/success/secondary/ghost`), `badge`, `table-base`, `modal-overlay`, `modal-body`, და რესპონსივი helper-ები `mobile`/`tablet`.
- **`src/styles/global.scss`** — reset-ები, გლობალური keyframe ანიმაციები (`fadeInUp`, `pulse-subtle`, `overlayFadeIn`), `overflow-x: hidden` `html`/`body`-ზე (გვერდის დონეზე ჰორიზონტალური სქროლის საწინააღმდეგო "safety net").

---

## 2. გვერდების რედიზაინი

| გვერდი | ცვლილება |
|---|---|
| **App.tsx** (Layout/Sidebar) | სრული sidebar/layout რედიზაინი, მობილური hamburger ნავიგაცია (`mobileNavOpen` state), overlay + slide-in მენიუ ≤640px-ზე. |
| **Login.tsx** | ახალი card-based დიზაინი, ბრენდი "PayFlow", GSAP staggered entrance ანიმაცია, animated border ring. |
| **Dashboard.tsx** | გადაწყობილი tabs, revenue card, filters, ცხრილი expandable row-ებით (ტრანზაქციის დეტალები), პაგინაცია. |
| **ExecutiveDashboard.tsx** | უნიფიცირებული stat card-ები (icon-ის soft-background helper), Recharts-ის ფერების განახლება, GSAP count-up + bar chart stagger ანიმაცია. |
| **Products.tsx** | გადაწყობილი ცხრილი/ფორმა/მოდალები, ფიქსირებული სიგანეები `max-width`-ზე გადავიდა. |
| **Sales.tsx (POS/სალარო)** | სრული UI გადაწყობა — checkout flow, cart table, payment methods, split payment, ცვლის დახურვის/PIN/void-confirm მოდალები. |
| **UsersManagement.tsx** | ცხრილი + audit log panel + user/password/PIN მოდალები, ≤640px-ზე **card-based ალტერნატიული ხედი** (იხ. თავი 3.4). |

---

## 3. რესპონსივობის ფიქსები

დიზაინი გატესტილია და გასწორებულია მრავალ device/viewport ზომაზე (iPhone SE/12 Pro, Pixel, tablet, desktop).

### 3.1 Layout-ის ძირითადი ბაგები
- **`.appShell`-ს აკლდა `flex-direction: column`** მობილურზე — `.mobileTopbar` და `.content` flex-row-ად რჩებოდნენ, კონტენტს "აჭყლეტდნენ" (ვიწრო კონტენტი + უზარმაზარი თეთრი სივრცეები). გასწორდა `@include m.mobile` ბლოკში.
- ფიქსირებული-სიგანის მოდალები (`width: 400px` ტიპის) გადავიდა `max-width`-ზე — ვიწრო ეკრანზე overflow-ს აღარ იწვევენ.

### 3.2 ღილაკები/ტექსტის overflow
- `btn-base` მიქსინის `white-space` თვისება რამდენჯერმე იტესტა: `nowrap` (default, ცხრილის action-ღილაკებისთვის საჭირო — თორემ ვიწრო სვეტში ტექსტი ასო-ასო იშლება ვერტიკალურად) vs `normal` (სოლო, გრძელტექსტიანი ღილაკებისთვის, მაგ. POS checkout ღილაკი). **საბოლოო გადაწყვეტა**: `btn-base` default `nowrap`-ზეა, სოლო გამონაკლისებზე (checkout ღილაკი) `white-space: normal` წერტილოვნად, inline style-ით ემატება.
- ყველა inline flex-კონტეინერს (Sales.tsx-ის action-ღილაკების მწკრივები, payment method radiogroup, split cash/card ველები, მოდალის ღილაკები) დაემატა `flexWrap: 'wrap'`.

### 3.3 ცხრილები
- Sales.tsx-ის cart table შეიფუთა `.cartTableWrapper`-ში (`overflow-x: auto`, `min-width: 0`), ფასი/რაოდენობა/ჯამის სვეტებს დაემატა `white-space: nowrap` (`.nowrapCell`).
- Sales.module.scss-ის `.mainGrid`/`.leftSide`/`.rightSide` — flex + `overflow: auto` კომბინაციის კონტეინირებისთვის საჭირო გახდა ცალსახად `width: 100%; min-width: 0;` (ნაცვლად მემკვიდრეობითი `stretch`-ის).
- Dashboard/UsersManagement ცხრილების `.tableWrapper`-ს აქვს `overflow-x: auto` — ეს **განზრახ, სტანდარტული** ქცევაა (არა ბაგი) დიდი, ბევრსვეტიანი ცხრილებისთვის ვიწრო ეკრანზე.

### 3.4 Dashboard tab bar — "Dead Zone" (640–1024px)
**ბაგი**: `.tabBar`-ის `overflow-x: auto` მხოლოდ `@include m.mobile` (≤640px) ბლოკში იყო განსაზღვრული. 640px-სა და sidebar-ის სრულ-სიგანეზე გადართვის breakpoint-ს (1024px) შორის "შუალედურ ზონაში" ტაბებს overflow საერთოდ არ ჰქონდათ და მესამე ტაბი იჭრებოდა.
**ფიქსი**: `overflow-x: auto`, `max-width: 100%`, `display: flex` გახდა **ბაზური** (unconditional) `.tabBar`-ის სტილი.

### 3.5 UsersManagement — Table → Card View (≤640px)
9-სვეტიანი ცხრილი (username, role, select, checkbox-ები, status, action-ღილაკები) მობილურზე ჰორიზონტალური სქროლით მოუხერხებელი იყო ინტერაქტიული ელემენტების სიმრავლის გამო. გადაწყდა **card-based ალტერნატიული ხედი**:
- `.tableWrapper` → `display: none` ≤640px-ზე.
- ახალი `.userCardList`/`.userCard`/`.cardRow`/`.cardActions` → `display: flex` ≤640px-ზე. თითო user = ერთი card, ველები ლეიბლიანი row-ებით, action-ღილაკები `flex-wrap`-ით.
- 641px+-ზე ძველი table + horizontal scroll უცვლელად რჩება.

---

## 4. ანიმაციები

### 4.1 CSS keyframes (გლობალური)
- `fadeInUp` — გვერდების/card-ების/მოდალების mount-ზე entrance.
- `overlayFadeIn` — მოდალის overlay-ს fade-in.
- `pulse-subtle` — მსუბუქი pulse ეფექტი.

### 4.2 Login გვერდის "მოძრავი ხაზი" (Border Ring)
`conic-gradient` ბრუნავს ანიმირებადი CSS custom property-ით (`@property --angle`) — ვიწრო, ნათელი "კომეტისებრი" ხაზი მუდმივად ევლება ავტორიზაციის card-ის კონტურს (3.2წმ ციკლი). ტექნიკურად აგებულია `mask-composite: exclude`-ზე — ring ზუსტად 2px სისქეზეა შემოჭრილი, ყველგან სხვაგან სრულად გამჭვირვალეა, ამიტომ card-ის კონტენტს (ღილაკებს, ველებს) ვერასდროს ფარავს, stacking/z-index-ის მიუხედავად.

### 4.3 GSAP — მიზნობრივი, ორ გვერდზე
Bundle-ის წონის გამო GSAP **მთელ აპში არ დამატებულა** — მხოლოდ Login და ExecutiveDashboard გვერდებზეა isolated გამოყენებული (POS/სალაროს bundle-ს არ ეხება ცვლილება ლოგიკურად, თუმცა code-splitting jერ არ არის დანერგილი — იხ. თავი 6).

- **Login.tsx** — `gsap.context()` + `gsap.from('[data-gsap-field]', {...})`: სათაური, subtitle, ველები, ღილაკი თანმიმდევრობით (`stagger: 0.08`) ეშვება opacity+y ტრანსფორმით. `clearProps` + 1.2წმ safety-timer გარანტიას იძლევა, რომ ღილაკი StrictMode-ის double-effect-ის მიუხედავადაც ვერასდროს "გაიყინება" უხილავ მდგომარეობაში.
- **ExecutiveDashboard.tsx** — `StatCardView`-ში `gsap.to()` 0-დან რეალურ მნიშვნელობამდე ითვლის ("count-up", 1.1წმ, `power2.out`) ყველა stat card-ზე (შემოსავალი, ჩეკები, payment breakdown, გაუქმებული ჩეკები). Top-5 პროდუქტის Bar chart-ზე Recharts-ის ჩაშენებული ანიმაცია გამორთულია (`isAnimationActive={false}`), GSAP-ის `stagger` (0.12წმ) მართავს თითოეული ბარის `scaleX`/`opacity` reveal-ს.

---

## 5. ბრენდინგი

აპლიკაციის სახელი "ProjectPay" → **"PayFlow"** შეიცვალა ყველგან: Login.tsx, App.tsx (sidebar + mobile topbar brand), PrintableReceipt.tsx, PrintableZReport.tsx.

---

## 6. ცნობილი Follow-up / რეკომენდაცია

- GSAP-ის დამატებამ bundle გაზარდა ~688KB → ~760KB (gzip +28KB). პროექტს ჯერ არ აქვს per-page `React.lazy()` code-splitting, ამიტომ ეს წონა ტექნიკურად POS bundle-შიც შედის, თუმცა კოდი მხოლოდ Login/ExecutiveDashboard-ზეა გამოძახებული. საჭიროების შემთხვევაში შესაძლებელია ცალკე Task-ად დაინერგოს `React.lazy()` ამ ორი გვერდისთვის.
- Vite build აფრთხილებს "chunks larger than 500kB" — გრძელვადიან გეგმაში ღირს `build.rollupOptions.output.manualChunks`-ის განხილვა.
