# UI მინიმალისტური რედიზაინი + ბაგ-ფიქსები — Roadmap

**სტატუსი:** 🟢 დასრულებულია, production-ზეა
**თარიღი:** 06.09.2026
**კონტექსტი:** HoReCa STEP 4-ის (ჩეკის გაყოფა + მიმტანის როლი/tips)
production-დადასტურების შემდეგ, იმავე სესიაში დაწყებული UI/UX
გამართვის ბლოკი — emoji-იკონების მინიმალისტურ SVG-ებზე გადაყვანა,
რამდენიმე ვიზუალური/ლოგიკური ბაგის ფიქსი, რომლებიც ტესტირებისას
გამოვლინდა.

---

## 1. მინიმალისტური SVG icon სისტემა

**რა გაკეთდა:** ახალი გაზიარებული `frontend/src/components/Icons.tsx`
— feather-style, `currentColor`-ზე დამოკიდებული stroke-based SVG
კომპონენტები, რომლებიც ავტომატურად მისდევენ თემას (light/dark) და
ტექსტის/hover/active ფერს, OS-დამოუკიდებელი emoji-ების ნაცვლად.

**შეცვლილი გვერდები/ადგილები:**
- **Tables.tsx** — edit/delete ღილაკები, capacity-ხატულა, სტატუსის
  ფერადი dot-ინდიკატორები.
- **Modifiers.tsx / Ingredients.tsx** — edit/delete/restock/save/
  cancel ღილაკები.
- **Products.tsx** — ცხრილის edit/delete + recipe-builder-ის
  "remove row" ღილაკი.
- **UsersManagement.tsx** — სტატუსის toggle (🔓/🔒), პაროლი (🔑), PIN
  (🔢 keypad-ხატულა), წაშლა — ყველა ბექგრაუნდის-გარეშე icon-ღილაკზეა
  გადაყვანილი (`.iconBtn`/`.statusIconBtn`).
- **App.tsx (sidebar)** — Dashboard/Products/Sales/მაგიდები/
  სამზარეულო/მოდიფაიერები/ინგრედიენტები/Users Control/გამოსვლა —
  ყველა ნავიგაციის emoji ჩანაცვლდა მონოქრომული SVG-ით (Vercel-ის
  sidebar-ის სტილის მიბაძვით — bar-chart/package/cart/grid/monitor/
  sliders/layers/users/log-out).
- **Dashboard.tsx** — გვერდის სათაურის 📊-იც იგივე `DashboardIcon`-ზეა.

**Commits:** `1b9cca2`, `6ffc5e1`, `ddd10cb`

---

## 2. Tables.tsx ქარდების რედიზაინი

- ქარდები დამსხვილებულია, `grid-template-columns: repeat(auto-fill,
  minmax(240px, 1fr))`.
- Hover-ზე ქარდი წამოიწევს წინ (`translateY(-6px) scale(1.02)`,
  spring-ის მსგავსი `cubic-bezier(0.34, 1.56, 0.64, 1)`) და სტატუსის
  ფერადი **ხაზი ტრიალებს ქარდის სტატიკურ მართკუთხა ჩარჩოს გარშემო**
  (`conic-gradient` + `mask-composite: exclude`, `@property
  --spin-angle` რომ მხოლოდ გრადიენტი ტრიალდეს — ავტორიზაციის გვერდის
  spinner-ის სტილში, ჩარჩოს დამახინჯების გარეშე).

**Commit:** `1b9cca2`

---

## 3. Dark/Light თემის toggle-ის რედიზაინი

- ცისფერი/navy pill → შავი (dark) / თეთრი-ნაცრისფერი (light)
  მინიმალისტური pill, border მოხსნილია.
- ორი ცალკე absolute ☀️/🌙 emoji → ორივე SVG აიკონი (`SunIcon`/
  `MoonIcon`) მუდმივად thumb-ის შიგნით, opacity+rotate+scale
  crossfade-ით ერთმანეთს enfold-ავს.
- Thumb-ის სრიალი "ხისტი" ease-ის ნაცვლად დაბალანსებული, სიმეტრიული
  `cubic-bezier(0.65, 0, 0.35, 1)` მრუდით (spring/bounce-ის გარეშე).

**Commit:** `6ffc5e1`

---

## 4. Dashboard stat card-ების hover "glow"

- ახალი თემაზე-რეაგირებადი token `--color-glow-hover` (`_theme.scss`)
  — light-ზე მუქი (`rgba(17,17,17,0.14)`), dark-ზე თეთრი
  (`rgba(255,255,255,0.16)`).
- `ExecutiveDashboard.module.scss`-ის `.statCard:hover`-ს დაემატა
  `0 0 24px $color-glow-hover` glow (არსებულ lift+shadow ეფექტთან
  ერთად), scope-შემოსაზღვრული მხოლოდ ამ card-ებზე — არა საერთო
  `card-hover` mixin-ზე (რომ სხვა card-ებზე აპლიკაციაში გავლენა არ
  იქონიოს).

**Commit:** `ddd10cb`

---

## 5. ბაგ-ფიქსები

### 5.1 Admin row-ის disable-ლოგიკა (UsersManagement.tsx)

**ბაგი:** `user.username === 'admin'` ჰარდქოდით იყო შემოწმებული
role-select/checkbox-ები/სტატუსი/PIN/წაშლა — მხოლოდ Retail org-ზე
მუშაობდა (სადაც admin-ის literal username სინამდვილეშიც `"admin"`
არის). Multi-tenant HoReCa org-ებში admin-ის username სხვაა (მაგ.
`admin-horeca`), ამიტომ დაცვა საერთოდ არ ირთვებოდა — ადმინის
საკუთარი row-ის ყველა ველი აქტიური რჩებოდა.

**ფიქსი:** `user.username === 'admin'` → `user.role === 'admin'`
(ტიპიზებული `'admin' | 'manager' | 'cashier' | 'waiter'` ველი,
org-ის მიუხედავად სანდო). Retail-ზეც გადამოწმდა — უცვლელად სწორად
მუშაობს. Backend-ის `DELETE /users/:id` თავადაც იცავს self-delete-ს
(`id`-ის შედარებით) — ეს მხოლოდ frontend UI-ის ხილვადობის ფიქსია.

### 5.2 Audit-log-ის დროის ცდომილება (4 საათი, ლოკალურად)

**ბაგი:** `audit_logs.created_at`-ის DEFAULT
(`TO_CHAR(CURRENT_TIMESTAMP, ...)`) Postgres session-ის default
timezone-ზეა დამოკიდებული — Render production-ზე UTC-ია, მაგრამ
ლოკალურ Windows Postgres-ზე ხშირად `Asia/Tbilisi` (OS-ის მიხედვით).
`formatTbilisiTimestamp()`-ის read-time +4 კონვერტაცია ორივე
შემთხვევაში ერთნაირად ხდებოდა, რაც ლოკალურად ორმაგ წანაცვლებას
(+4 საათი რეალურ დროზე წინ) იძლეოდა.

**ფიქსი:**
- `backend/src/routes/auth.ts` (`writeAuditLog`) — INSERT-ში
  `created_at` ცალსახად `TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE
  'UTC', ...)`-ით გამოითვლება, session timezone-ის მიუხედავად.
- ახალი **Migration 025**
  (`backend/migrations/025_fix_audit_logs_utc_default.sql`) —
  column-ის DEFAULT-საც იგივეზე აფიქსირებს (მეორე დაცვის შრე).
- **გაშვებულია** ლოკალურ `payflow_db`-ზეც და **Neon Production**-ზეც
  (pgAdmin, `ALTER TABLE` წარმატებული).
- ცნობილი გვერდითი ეფექტი (მოსალოდნელი, არა ბაგი): ძველი,
  migration-მდე დაწერილი ჩანაწერები (არასწორი +4 დროით) `TEXT`
  column-ის ტექსტური `ORDER BY ... DESC` სორტირების გამო შეიძლება
  სიის თავში დარჩეს ახალ, სწორ ჩანაწერებზე მაღლა — მხოლოდ ლოკალურ
  სატესტო მონაცემებზე ("ისტორიის გასუფთავება" ღილაკით წყდება).

### 5.3 მაგიდების არასწორი თანმიმდევრობა (Tables.tsx)

**ბაგი:** `GET /tables` მაგიდებს `ORDER BY section ASC, name ASC`-ით
აბრუნებდა — სექციის ტექსტის ანბანურად იჯგუფებოდა (დარბაზი/კუბე/
ტერასა), რაც სხვადასხვა სექციის მაგიდებს შექმნის თანმიმდევრობის
საწინააღმდეგოდ არეულად აწყობდა (მაგ. მაგიდა_1 ბოლოში ჩნდებოდა).

**ფიქსი:** `ORDER BY created_at ASC, name ASC` — მაგიდები დამატების
თანმიმდევრობით ჩნდება, სექციის მიუხედავად.

### 5.4 "History" ღილაკის უხილავი ტექსტი + შეუსაბამო hover (UsersManagement.module.scss)

**ბაგი:** `.historyBtn.active`-ს `color: #fff` ჰარდქოდილი ჰქონდა,
`background`-ად კი `$color-text-primary` (dark თემაზე თითქმის თეთრი,
`#E5E7EB`) — "History" წარწერა panel-ის გახსნისას თითქმის უჩინარი
იყო. დამატებით, `btn-secondary`-ს ნაგულისხმევი hover
(`background: $color-border`) active-ის მყარ ავსებას abrupt-ად
არღვევდა.

**ფიქსი:** `color` → `$color-bg-card` (თემის ნამდვილი საპირისპირო
ფერი, ორივე თემაზე კონტრასტული). `&.active:hover` ცალკე გამოცხადდა —
იგივე მყარი ფონი/ტექსტი რჩება, მხოლოდ `opacity: 0.85` ემატება.

### 5.5 CRLF line-ending შემთხვევითი დაკარგვა (`auth.ts`)

ხელით (python heredoc) პატჩვისას `backend/src/routes/auth.ts`
text-mode-ში ჩაიწერა, რამაც repo-ს CRLF კონვენცია LF-ზე გადაიყვანა
მთელი ფაილისთვის (commit-ის diff 1600+ ხაზად გაბერა 9-ხაზიანი
ცვლილება). ცალკე commit-ით აღდგენილია (კონტენტი უცვლელი).

**Commits:** `f521240`, `651feac`

---

## Deployment სტატუსი

**✅ Git:** ყველა ზემოთხსენებული commit push-დებულია
(`git push origin main`) — `1b9cca2` → `ddd10cb` (6 commit).

**✅ Migration 025:** ორივეგან გაშვებულია — ლოკალურად (`payflow_db`)
და **Neon Production**-ზე (`neondb`).

**✅ Production:** მომხმარებლის დადასტურებით, აიტვირთა/deploy-დებულია
production-ზე (Vercel frontend + Render backend).
