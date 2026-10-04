# Multi-Language (i18n) — Roadmap

**სტატუსი:** 🟢 გვერდების page-by-page rollout დასრულებულია (11 გვერდი) და Backend error-message i18n (error-codes არქიტექტურა) გავრცელებულია ძირითად route-ებზე/გვერდებზე (STEP 1 pilot + STEP 2 — იხ. სექციები 13-14). დარჩენილი მცირე ღია საკითხები — იხ. "⏳ ცალკე ფენა".
**თარიღი:** 03.10.2026 (განახლდა)
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

### 4. OrderScreen.tsx (HoReCa შეკვეთის ეკრანი) + SplitBillModal.tsx
**Commit:** `9988fcd` — `feat(i18n): translate OrderScreen.tsx (HoReCa order screen) + SplitBillModal`

- სრულად გადათარგმნილია: შეკვეთის გახსნა, პროდუქტის დამატება (მოდიფაიერებით), item-ების ცხრილი, checkout (ფასდაკლება, გადახდის მეთოდი, split, tip, Manager PIN Override), item/order void + ConfirmModal-ები.
- `SplitBillModal.tsx` (ჩეკის გაყოფის მოდალი) — mode-გადამრთველი (თანაბრად/სტუმრების მიხედვით), თითო ნაწილის cash/card ფორმა.
- Checkout-ლოგიკა კოდშივე დოკუმენტირებულია როგორც "Sales.tsx-ის იდენტური" — შესაბამისად მაქსიმალურად გამოყენებულია არსებული `sales.*`/`common.*` key-ები ახალი დუბლიკატების მაგივრად.
- ახალი გაზიარებული key: `common.kitchenStatus.*` (pending/sent/preparing/ready/served/voided) — გამოსადეგი იქნება `KitchenDisplay.tsx`-ისთვისაც.
- ტესტირებულია მომხმარებლის მიერ ორივე ენაზე, ორივე თემაზე — შეკვეთის სრული flow, PIN-modal, split checkout (თანაბრად + სტუმრების მიხედვით).

### 5. UsersManagement.tsx (მომხმარებლების/უფლებების მართვა)
**Commit:** `21c5441` — `feat(i18n): translate UsersManagement.tsx (user/permission management)`

- სრულად გადათარგმნილია: header, მობილური card view + desktop ცხრილი (გაზიარებული key-ები ორივესთვის), როლის შეცვლის select, უფლებების toggle-ები (history/discount/void/clear-cart), სტატუსის toggle, action ღილაკები.
- მოდალები: create-user, pair-register (+ errors), password-change, PIN-change, გაზიარებული confirm-modal (მომხმარებლის წაშლა / ისტორიის გასუფთავება).
- Module-level `renderAuditLogLine` + `PERMISSION_TOGGLE_LABELS` გადავიდა `i18n.t()`-ზე; audit-log ხაზებში `<strong>`-ბოლდინგი განზრახ მოშორდა (plain interpolated წინადადებებით ჩანაცვლდა), რადგან `<Trans>` პროექტში არსად გამოიყენება.
- **მნიშვნელოვანი დეტალი:** `UserPermission.status`-ის raw data value (`'ა ქ ტ ი უ რ ი '`/`'და ბ ლო კ ი ლი '`, backend contract, spaces-ით) **უცვლელად დარჩა** — ითარგმნა მხოლოდ ეკრანზე ნაჩვენები ლეიბლი/tooltip/toast, ცალკე mapping-ის საშუალებით.
- ახალი `usersManagement.*` namespace (102 გამოყენებული key), მაქსიმალურად გამოყენებულია `login.*`/`nav.*`/`common.*`/`tables.*` ზუსტი დამთხვევებისთვის.
- ამ გვერდს ცალკე child/modal კომპონენტები არ აქვს (მხოლოდ `Icons.tsx` არის imported) — SplitBillModal-ისნაირი "გამოტოვების" რისკი აქ არ არსებობდა.
- ტესტირებულია მომხმარებლის მიერ ორივე ენაზე, ორივე თემაზე.

**⚠️ ცალკე აღმოჩენილი (i18n scope-ის გარეთ):** UsersManagement.tsx-ის შესწავლისას აღმოჩნდა, რომ "დაბლოკვის" toggle წერს `'და ბ ლო კ ი ლი '` (spaces-ით), მაგრამ `backend/src/routes/auth.ts`-ის login-blocking შემოწმება (107, 316 ხაზები) მხოლოდ `'inactive'`/`'დაბლოკილი'`-ს (spaces-ის გარეშე) ადარებს — ანუ UI-დან დაბლოკვა რეალურად ვერ უშლის ხელს login-ს. Security-related ბაგია, ცალკე გადასაწყვეტია.

### 6. Dashboard.tsx (გაყიდვების მართვის პანელი) + ExecutiveDashboard.tsx (Analytics ტაბი) + PrintableZReport.tsx
**Commit:** `67f65aa` — `feat(i18n): translate Dashboard, ExecutiveDashboard and PrintableZReport`

- **Dashboard.tsx** — სრულად გადათარგმნილია: header, 3 ტაბის ღილაკი (Analytics/Sales History/Cashier Shifts), revenue card, ყველა ფილტრი (მოლარე/პროდუქტი/თარიღი/გადახდა/სტატუსი/ფასდაკლება/გვერდის ზომა), Excel/PDF export, გაყიდვების ცხრილის headers + ცარიელი მდგომარეობა, item-დეტალების ხაზები (split-bill-ის "გაზიარებული დეტალები" შენიშვნის ჩათვლით), ფასდაკლების დეტალის ხაზი, split-breakdown, პაგინაცია, ცვლების ცხრილის headers, სტატუსის ბეიჯი, "შესწორებული" ბეიჯი + tooltip, "ხელახლა დაბეჭდვა" ღილაკი.
- **ExecutiveDashboard.tsx** (Dashboard-ის "Analytics" ტაბში ჩართული, ცალკე ფაილი) — ტესტირებისას აღმოჩნდა, რომ ვიზუალურად ამ გვერდის ნაწილია, ამიტომ roadmap-ის ცალკე item-ის მაგივრად ერთად ითარგმნა: loading/error states, 4+3+2 სტატისტიკის ბარათი (დღევანდელი/გადახდის მეთოდით/გაუქმებული), Stock Deficit და Z-Report Amendment შეტყობინებების პანელები, სამივე გრაფიკის სათაური/empty-state/Tooltip/Legend ლეიბლები (Recharts-ის `formatter` callback-ებში `t()` პირდაპირ გამოიყენება, hook-ის closure-იდან).
- **PrintableZReport.tsx** (child კომპონენტი — Dashboard-ის Z-Report reprint ფუნქციისთვის) — ცალკე ბეჭდვადი შაბლონია (ეკრანზე დამალული, მხოლოდ `window.print()`-ზე ჩნდება); სრულად ითარგმნა (subtitle, header-info ხაზები, receipt-row label-ები, ხელმოწერის ხაზი).
- ახალი `dashboard.*` namespace (Dashboard.tsx + `dashboard.zReportPrint.*` PrintableZReport-ისთვის) და `dashboard.analytics.*` sub-namespace (ExecutiveDashboard.tsx). მაქსიმალურად გამოყენებულია არსებული `sales.*` key-ები ზუსტი დამთხვევებისთვის (`paymentBadge.*`, `voided`, `splitBreakdownLabel/splitCashLine/splitCardLine`, `prevPage/pageInfo/nextPage`); ახალი გაზიარებული key: `common.unknown`.
- **paymentMethodBadge** (Dashboard.tsx-ის module-level ფუნქცია) გადავიდა `i18n.t()` singleton-ზე — იგივე პატერნი, რაც Sales.tsx-ში.
- თარიღების ლოკალზე-დამოკიდებული ფორმატირება (`toLocaleDateString('ka-GE', ...)`) განზრახ დარჩა უცვლელი — ეს ფორმატირების ლოგიკაა და არა UI ტექსტი.
- ტესტირებულია მომხმარებლის მიერ ორივე ენაზე, ორივე თემაზე — სამივე ტაბი Dashboard.tsx-ზე, Analytics ტაბის ყველა ბარათი/გრაფიკი.

### 7. Products.tsx (პროდუქტების მართვა)
**Commit:** `0e1a383` — `feat(i18n): translate Products.tsx (product management page)`

- სრულად გადათარგმნილია: header (სათაური, ნიმუშის ჩამოტვირთვა, Import/Excel/PDF ღილაკები, "მხოლოდ ამოწურვადი" ტოგლი), კრიტიკული მარაგის warning banner, დამატება/რედაქტირების ფორმა (KDS station select-ის ჩათვლით), 🧩 მიბმული მოდიფაიერების პანელი, 🍲 რეცეპტის (BOM) პანელი, პროდუქტების ცხრილი, შტრიხკოდის სკანერის მოდალი (restock + ახალი პროდუქტის რეგისტრაცია), confirm-modal, Excel Import-ის შედეგის მოდალი, 24 toast შეტყობინება.
- ამ გვერდსაც ცალკე child/modal კომპონენტები არ აქვს (მხოლოდ `Icons.tsx` — UsersManagement.tsx-ის იგივე შემთხვევა) — ყველა მოდალი ინლაინაა ფაილშივე.
- ახალი `products.*` namespace, მაქსიმალურად გამოყენებულია `nav.loading`/`common.close`/`common.cancel`/`dashboard.unitPcs` ზუსტი დამთხვევებისთვის.
- ახალი გაზიარებული key-ები `common.edit`/`common.delete` — დაემატა Edit/Delete row-action-ებისთვის, სპეციალურად შემდეგი გვერდებისთვის განკუთვნილი (Modifiers.tsx/Ingredients.tsx/Register.tsx-საც სავარაუდოდ ექნება იგივე აქციები).
- Warning banner-ში `<strong>`-ბოლდინგი (რიცხვის გარშემო) განზრახ მოშორდა — იგივე "sentence-style ტექსტს `<Trans>`-ის გარეშე არ აქვს ინლაინ bold" გადაწყვეტილება, რაც UsersManagement.tsx-ის audit-log-ში.
- ტესტირებულია მომხმარებლის მიერ ორივე ენაზე, ორივე თემაზე.

### 8. Modifiers.tsx (მოდიფაიერების მართვა — HoReCa)
**Commit:** `d85aea0` — `feat(i18n): translate Modifiers.tsx (groups, options, confirm modals)`

- სრულად გადათარგმნილია: header + subtitle, ჯგუფების სია (empty state, badge-ები, action ღილაკები), ინლაინ ოფციების სია (empty state, ინლაინ რედაქტირება/დამატების ფორმები), ჯგუფის create/edit მოდალი (name, selection-type select, required checkbox), ორივე წაშლის confirm-modal (ჯგუფი/ოფცია, `{{name}}` ინტერპოლაციით), 14 toast შეტყობინება.
- `SELECTION_LABEL` module-level constant გადავიდა `SELECTION_LABEL_KEYS`-ზე (key-path-ები, `t()`-ით რეზოლვდება render-ზე) — იგივე პატერნი, რაც UsersManagement.tsx-ის `PERMISSION_LABEL_KEYS`.
- ახალი `modifiers.*` namespace (34 key), მაქსიმალურად გამოყენებულია არსებული key-ები ზუსტი დამთხვევებისთვის: `common.edit`/`common.delete`/`common.cancel`, `products.modifierPanel.requiredTag`, `tables.save`, `products.savingEllipsis`, `nav.loading`.
- `ConfirmModal.tsx` (გაზიარებული child კომპონენტი) გადამოწმდა — უკვე სრულად ნათარგმნი იყო (Tables.tsx-ის სესიიდან), დამატებითი ცვლილება არ დასჭირდა.
- ამ გვერდსაც ცალკე child/modal კომპონენტები არ აქვს `ConfirmModal.tsx`-ის გარდა (მხოლოდ `Icons.tsx` დამატებით imported) — ყველა სხვა მოდალი/ფორმა ინლაინაა ფაილშივე.
- ტესტირებულია მომხმარებლის მიერ (English/dark) — ჯგუფების სია, ბეჯები, "New Group" მოდალი, ფორმის ველები.

### 9. KitchenDisplay.tsx (KDS — სამზარეულოს/ბარის ეკრანი)
**Commit:** `1af4898` — `feat(i18n): translate KitchenDisplay.tsx (KDS screen)`

- სრულად გადათარგმნილია: header + subtitle, station-ტაბები (🍳 სამზარეულო / 🍹 ბარი), loading/empty states, ტიკეტ-ბარათები (მაგიდის სახელი vs. Takeaway/ბარი ლეიბლი, ადგილის ნომერი, გასული დროის ბეჯი), advance-action ღილაკები (დაწყება/მზადაა/მიტანილია), 2 toast შეტყობინება.
- ამ გვერდსაც ცალკე child/modal კომპონენტები არ აქვს (მხოლოდ `getSocket` — `lib/socket.ts`, არა UI კომპონენტი).
- `STATION_TABS`/`NEXT_ACTION`/`STATUS_LABEL` module-level constant-ები გადავიდა key-path პატერნზე (იგივე `SELECTION_LABEL_KEYS`/`PERMISSION_LABEL_KEYS` მიდგომა).
- ახალი `kitchenDisplay.*` namespace (14 key). გამოყენებულია არსებული გაზიარებული `common.kitchenStatus.*` (OrderScreen.tsx-ის სესიიდან) 5 სტატუსისთვის ზუსტი დამთხვევით (pending/preparing/ready/served/voided) — **გარდა** `sent`-ისა, რომელიც KDS-ზე "ახალი"-დ ჩანს (არა "გაგზავნილია", რასაც OrderScreen.tsx-ის ბეჯი წერს), ამიტომ ცალკე `kitchenDisplay.statusLabel.sent` key შეიქმნა ამ ერთი განსხვავებისთვის.
- ტესტირებულია მომხმარებლის მიერ ორივე ენაზე, ორივე თემაზე — station-ტაბები, ტიკეტების ბარათები, advance-flow.

### 10. Ingredients.tsx (ნედლეულის მარაგის მართვა — HoReCa)
**Commit:** `529c99b` — `feat(i18n): translate Ingredients.tsx (raw material stock management)`

- სრულად გადათარგმნილია: header + subtitle, ინგრედიენტების სია (stock ბეჯები "ამოიწურა"/"იწურება"), ინლაინ restock ფორმა, create/edit მოდალი, delete confirm-modal (`{{name}}` ინტერპოლაციით), 9 toast შეტყობინება.
- ამ გვერდსაც ცალკე child/modal კომპონენტები არ აქვს `ConfirmModal.tsx`-ის გარდა (გადამოწმდა — უკვე ნათარგმნია, ცვლილება არ დასჭირდა).
- ახალი `ingredients.*` namespace (23 key). ფართო cross-page key reuse Modifiers.tsx-ის (STEP 3.1) namespace-იდან, სადაც ტექსტი ზუსტად ემთხვევა: `modifiers.toasts.saveFailed`/`modifiers.toasts.deleteFailed`, `modifiers.nameLabel`, `modifiers.addOptionAria` — ახალი დუბლიკატი key-ების გარეშე.
- ტესტირებულია მომხმარებლის მიერ ორივე ენაზე, ორივე თემაზე — დამატება/რედაქტირება/წაშლა, restock flow.

### 11. Register.tsx (კომპანიის თვით-რეგისტრაცია)
**Commit:** `14231ab` — `feat(i18n): translate Register.tsx (company self-registration page)`

- **შენიშვნა:** ეს გვერდი აღმოჩნდა კომპანიის თვით-რეგისტრაციის ფორმა (ახალი ორგანიზაციის sign-up, Login-ის წინ ჩანს, `App.tsx`-ის `showRegister` state-ტოგლით) — არა "სალარო/register" გვერდი, როგორც roadmap-ში თავდაპირველად მიახლოებით იყო ჩაწერილი (დარჩენილი-გვერდების სია ეფუძნებოდა მხოლოდ ფაილის სახელს, კონტენტის გარეშე). Login.tsx-ის მსგავსად, ავტორიზაციამდეც მუშაობს `useTranslation()`.
- სრულად გადათარგმნილია: subtitle, ყველა ველის label/placeholder (კომპანიის სახელი, საქმიანობის ტიპი Retail/HoReCa + hint-ები, Subdomain, ადმინის სახელი, Email, პაროლი, გაიმეორეთ პაროლი), submit ღილაკი, "← უკვე გაქვთ ანგარიში?" ლინკი, 7 ვალიდაციის შეცდომა.
- ახალი `register.*` namespace (28 key). ფართო cross-page key reuse `login.*` namespace-იდან ზუსტი დამთხვევებისთვის: `login.fillAllFields`, `login.passwordMismatch`, `login.slugLabel`/`login.slugPlaceholder`, `login.password`, `login.loading`.
- **მნიშვნელოვანი დეტალი:** `login.passwordTooShort` (მინ. 4 სიმბოლო, password-reset-ისთვის) და Register.tsx-ის საკუთარი წესი (მინ. 8 სიმბოლო) განზრახ **არ** გაერთიანდა ერთ key-ში — სხვადასხვა ბიზნეს-წესია, საერთო key ბაგს გამოიწვევდა.
- ტესტირებულია მომხმარებლის მიერ ორივე ენაზე, ორივე თემაზე — ორივე business-type არჩევანი (Retail/HoReCa hint-ების ჩათვლით).

### 12. Settings.tsx (ორგანიზაციის პარამეტრების გვერდი)
**Commit:** `ee652df` — `feat(i18n): translate Settings.tsx (organization settings page)`

- სრულად გადათარგმნილია: header + subtitle, 💰 Tips Distribution ბარათი (hint + ორივე radio ოფცია სათაურით/აღწერით — Individual/Pooled), save ღილაკი, 3 toast შეტყობინება (load-failed, saved, save-failed).
- ამ გვერდსაც ცალკე child/modal კომპონენტები არ აქვს (მხოლოდ `SettingsIcon` — `Icons.tsx`).
- ახალი `settings.*` namespace (11 key, `tipsCard.*`/`toasts.*` nested-ის ჩათვლით). Cross-page reuse ზუსტი დამთხვევებისთვის: `modifiers.toasts.saveFailed`, `nav.loading`, `products.savingEllipsis`, `tables.save`.
- ტესტირებულია მომხმარებლის მიერ ორივე ენაზე, ორივე თემაზე (light/dark) — Tip Distribution-ის ორივე ოფცია, save flow.
- **ეს იყო roadmap-ის დარჩენილი-გვერდების სიის ბოლო item** — ამ commit-ით `frontend/src/pages/`-ის page-by-page i18n rollout დასრულებულია.

### 13. Backend Error-Message i18n — STEP 1 (Pilot: Products.tsx + Ingredients.tsx)
**Commit:** `9b1d862` — `feat(i18n): add backend error-code pilot (Products + Ingredients)`

- **არქიტექტურა (გადაწყვეტილია, `AskUserQuestion`-ით):** backend-ის error-პასუხებს ემატება additive `code` ველი (მაგ. `PRODUCT_DUPLICATE_NAME`) — არსებული ჰარდკოდილი ქართული `error` ტექსტი უცვლელად რჩება (backward compatibility, ჯერ არარეფაქტორებული routes-ისთვის). ახალი `backend/src/constants/errorCodes.ts` — `ErrorCodes` კონსტანტა, `<ENTITY>_<REASON>` კონვენციით.
- **Frontend:** ახალი გაზიარებული `frontend/src/lib/errorMessages.ts` → `resolveErrorMessage(error, fallbackKey)`. `code`-ს `errors.<code>` i18n key-ზე გადაასქემატებს (თუ თარგმანი არსებობს); სხვა ნებისმიერ შემთხვევაში (code არ მოსულა/უცნობია) — fallback-key-ის ზოგადი, თარგმნილი შეტყობინება. **არასდროს** აღარ აბრუნებს backend-ის დაუთარგმნელ raw ტექსტს პირდაპირ.
- ახალი top-level `errors.*` namespace ორივე `ka.json`/`en.json`-ში: `PRODUCT_DUPLICATE_NAME`, `PRODUCT_DUPLICATE_BARCODE`, `INGREDIENT_DUPLICATE_NAME`, `INGREDIENT_IN_USE`.
- **Products.tsx** — `handleSaveProduct`-ისა და `handleCreateScannedProduct`-ის catch-ბლოკებმა ახლა რეალურად წაიკითხეს backend-ის error (მანამდე section 134-142-ში დაფიქსირებული ბაგით, ყოველთვის ზოგადი `saveFailed`/`productAddFailed` იყო, backend-ის კონკრეტული მიზეზი იკარგებოდა).
- **Ingredients.tsx** — ლოკალური `getErrorMessage` (`.error`-ის raw წაკითხვა, დაუთარგმნელად) მთლიანად ჩანაცვლდა გაზიარებული `resolveErrorMessage`-ით ყველა 4 catch-ბლოკში (load/save/delete/restock) — აქამდე section 134-142-ში დაფიქსირებული "specific-but-untranslated" ბაგი ამ გვერდზე მოგვარებულია.
- **ტესტირებულია მომხმარებლის მიერ ორივე ენაზე** (live browser, ka + en): Products.tsx-ზე დუბლირებული ბარკოდი → `409 { code: PRODUCT_DUPLICATE_BARCODE }` → სწორად თარგმნილი, კონკრეტული toast; Ingredients.tsx-ზე დუბლირებული სახელი → `INGREDIENT_DUPLICATE_NAME`; Ingredients.tsx-ზე რეცეპტში გამოყენებული ინგრედიენტის წაშლის მცდელობა → `INGREDIENT_IN_USE` — სამივე შემთხვევა კონკრეტული და თარგმნილია ორივე ენაზე.
- **Backward compatibility:** ორივე `products.ts`/`ingredients.ts`-ის დანარჩენი endpoint (404/400 ვალიდაცია და ა.შ.) და დანარჩენი ~13 route-ფაილი ჯერ `code`-ს არ აბრუნებს — მათზე `resolveErrorMessage` ავტომატურად fallback-key-ის ზოგად შეტყობინებაზე გადადის, ისე რომ არაფერი არ ტყდება.
- **`npx tsc --noEmit` სუფთაა** ორივე `frontend/`-სა და `backend/`-ში.
- **STEP 2** (დანარჩენი route-ებისა და გვერდების გავრცელება) შესრულდა 03.10.2026 — იხ. სექცია 14.

---

### 14. Backend Error-Message i18n — STEP 2 (გავრცელება დანარჩენ route-ებზე/გვერდებზე)
**ბრენჩი:** `feature/validation-fixes-cloud` (ლოკალური, push არ გაკეთებულა). Commit-ები: `8a6bd40`, `2346c39`, `29571d6`, `eed6ce9`, `04fe04e`, `1627c37`, `569dc00`.

- **Backend:** იგივე additive `code` (+ საჭიროებისას `params` interpolation-ისთვის, მაგ. `{ name }`, `{ seconds }`, `{ paid, total }`) დაემატა: `modifiers.ts`, `organizations.ts`, `orders.ts`, `tables.ts`, `sales.ts` (POST /payments + /payments/split, ცვლები, void, ისტორია, override-ები, export-ები), `auth.ts` (login, მომხმარებლები, PIN, პაროლი), `registers.ts`, `kitchen.ts`, `notifications.ts`, `audit-logs.ts`, Products Excel import-ის ზედა დონის შეცდომები, და გაზიარებული middleware-ები (`checkShift`, `registerAuth`, `requireBusinessType`, `requireRole`). ქართული `error`/`message` ტექსტი ყველგან უცვლელია.
- **Frontend:** `resolveErrorMessage()` ახლა `params`-საც გადასცემს თარგმანს; ახალი `getErrorCode()` helper ლოგიკური შემოწმებებისთვის (OrderScreen-ის "მაგიდაზე უკვე არის ღია შეკვეთა" race-detection ქართული ტექსტის substring-ის ნაცვლად `ORDER_TABLE_HAS_OPEN_ORDER` კოდზე მუშაობს). გადავიდნენ: Modifiers, Settings, Register, Login (slug-ის ძებნა, შესვლა, პაროლის შეცვლა), OrderScreen, SplitBillModal, Sales, Tables (ცვლის widget-ის ჩათვლით), UsersManagement, KitchenDisplay, ExecutiveDashboard, Products import. ლოკალური `getErrorMessage` დუბლიკატები გაქრა. `errors.*` namespace ორივე `ka.json`/`en.json`-ში (~120 კოდი).
- **გვერდითი ბაგ-ფიქსები, ტესტირებისას აღმოჩენილი:**
  - Toast ექვს გვერდზე (Modifiers, Ingredients, Tables, Settings, OrderScreen, KitchenDisplay) მობილურზე ვიწროდ/header-ის ქვეშ ჩანდა: გვერდის `fadeInUp ... both` ანიმაცია transform-ს ტოვებდა, რაც `position: fixed`-ს container-ზე აბამდა. გასწორდა `createPortal`-ით `document.body`-ში (+ სრული სიგანე, max 480px).
  - არასწორი მენეჯერის PIN (401) global axios interceptor-ს "სესია ამოიწურა"-დ ესმოდა და login-ზე აგდებდა (OrderScreen-ზეც და Sales-ზეც). interceptor ახლა `PIN_INCORRECT` კოდზე logout-ს არ აკეთებს.
  - HoReCa ჩეკის დახურვისას "არ არის საკმარისი მარაგი პროდუქტზე" შეტყობინებაში ID ჩანდა სახელის ნაცვლად — ახლა სახელი იკითხება.
- **ტესტირებულია მომხმარებლის მიერ (ka + en, მობილური 412px):** დახურული ცვლა, არასწორი PIN (OrderScreen), ნულოვანი ინგრედიენტის მარაგი, მაგიდის წაშლა ისტორიით (409), Retail POS-ის "არ არის საკმარისი მარაგი", Login-ის არასწორი პაროლი, Users-ის დუბლირებული username, Register-ის დაკავებული subdomain, Products import-ის ცარიელი ფაილი. `npx tsc --noEmit` სუფთაა ორივე მხარეს.
- **ჯერ არ არის ბრაუზერში გატესტილი (მხოლოდ tsc):** Register-ის დაკავებული email, Sales.tsx-ის (Retail) ფასდაკლების PIN.
- **STEP 2-ის გაგრძელება — `ingredients.ts` + `products.ts` (04.10.2026, ბრენჩი `feature/error-codes-ingredients-products`, commit-ები `5ff201d`, `1af24a7`):** დარჩენილ 29 error-პასუხს (14 + 15) დაემატა `code` — 9 ახალი კოდი (`INGREDIENT_FIELDS_REQUIRED`, `INGREDIENT_NOT_FOUND`, `RECIPE_INGREDIENT_INVALID`, `QUANTITY_MUST_BE_POSITIVE`, `PRODUCT_BARCODE_NOT_FOUND`, `PRODUCT_NAME_PRICE_REQUIRED`, `PRODUCT_STOCK_NEGATIVE`, `PRODUCT_STATION_INVALID`, `PRODUCT_DELETE_ADMIN_ONLY`) + არსებულები (`ACCESS_RESTRICTED`, `PRODUCT_NOT_FOUND`, `PRODUCT_INVALID_ID`, `INVALID_REQUEST`) + ka/en თარგმანები. ფრონტენდზე ცვლილება არ დასჭირდა (Ingredients.tsx/Products.tsx უკვე `resolveErrorMessage`-ს იყენებდა). ქართული `error` ტექსტი უცვლელია (პროგრამულად შემოწმდა: 29/29), ბარკოდის პასუხში `exists: false` შენარჩუნებულია. **გატესტილია მომხმარებლის მიერ API-დან (DevTools Console, ლოკალურად):** `PRODUCT_BARCODE_NOT_FOUND`, `INGREDIENT_NOT_FOUND`, `QUANTITY_MUST_BE_POSITIVE`, `PRODUCT_NAME_PRICE_REQUIRED`, `PRODUCT_STOCK_NEGATIVE`, `INGREDIENT_FIELDS_REQUIRED`. UI-დან ზოგი ვერ ჩნდება (მაგ. ფასის ვალიდაცია ბრაუზერშივე ბლოკდება). **გვერდით დაკვირვება:** ამ ორ ფაილში 500-იანი პასუხები ისევ `err.message`-ს (raw) აბრუნებს — რჩება "⏳ ცალკე ფენა"-ს გენერიკული 500-ების პუნქტში.


---

## ✅ გვერდების rollout დასრულებულია

ყველა `frontend/src/pages/`-ში არსებული UI-გვერდი გადათარგმნილია (იხ. სექციები 1–12 ზემოთ). დარჩენილი გვერდები აღარ არის.

**შენიშვნა:** გაზიარებული კომპონენტების (`frontend/src/components/`) გადამოწმება ხდებოდა თითოეული გვერდის თარგმნისას პარალელურად — `ConfirmModal.tsx` (Tables.tsx-ის დროს, მერე ხელახლა გადამოწმებული Modifiers.tsx/Ingredients.tsx-ზეც), `SplitBillModal.tsx` (OrderScreen.tsx-ის დროს), `PrintableZReport.tsx`/`ExecutiveDashboard.tsx` (Dashboard.tsx-ის დროს). თუ მომავალში ახალი გვერდი/კომპონენტი დაემატება პროექტს, იგივე პროცესი (თარგმანი → ლოკალური ტესტი → commit მხოლოდ დადასტურებით) გავრცელდება მასზეც.

## ⏳ ცალკე ფენა (out of scope ჯერჯერობით)

- **Backend error-message-ების i18n** — 🟢 **STEP 1 + STEP 2 დასრულებულია** (სექციები 13-14). დარჩენილი, განზრახ ამ scope-ს გარეთ: (1) Products import-ის შედეგის მოდალში გამოტოვებული სტრიქონების მიზეზები (`productImportService.ts`-ის `reason`) ისევ ქართულად მოდის — ეს error-პასუხი კი არა, შედეგის მონაცემია, ცალკე მიდგომა სჭირდება; (2) `RegisterGuard.tsx` (სალაროს დაწყვილების ეკრანი) და Platform Admin გვერდები საერთოდ არ არის i18n-ზე გადაყვანილი; (3) `code`-ის გარეშე დარჩა: `platformAdmin.ts` + `platformAdminAuth.ts` (სრულად), `auth.ts`/`registers.ts`/`organizations.ts`-ის გენერიკული 500 შეცდომები (`"სერვერის შეცდომა: " + err.message`) და login-ის რამდენიმე წარმატების `message`; (4) `App.tsx`-ის interceptor-ი ტოკენის/სალაროს ვადაგასვლას ჯერ ქართული ტექსტის substring-ით ამოიცნობს (`message.includes('ტოკენი')`) — უმჯობესია `TOKEN_INVALID`/`REGISTER_*` კოდებზე გადაყვანა.
- Dev-only `console.error()` ზარები და კოდის კომენტარები **განზრახ რჩება** ნათარგმნი — out of scope (დადგენილია პროექტის დასაწყისშივე).
- OrderScreen.tsx-ში ერთი backend-error substring-check (`message?.includes('ღია შეკვეთა')`) განზრახ დარჩა ჰარდკოდილი ქართულად — ეს backend-ის საპასუხო ტექსტს პარსავს (race-condition detection), არა UI-ს, ამიტომ frontend-ის ენას არ უნდა მისდევდეს backend i18n-ის დანერგვამდე.
- **⚠️ Live-ტესტირებით დადასტურებული დაკვირვება (11.09.2026, Products.tsx)** — გვერდებს შორის **ორი განსხვავებული, შეუთანხმებელი catch-error პატერნი** არსებობდა. **20.09.2026 განახლება: Products.tsx-ზე და Ingredients.tsx-ზე მოგვარებულია** (იხ. სექცია 13, STEP 1 pilot); დანარჩენ გვერდებზე ჯერ კვლავ ღიაა STEP 2-მდე:
  - **Products.tsx** — 🟢 **მოგვარებულია.** `handleSaveProduct`/`handleCreateScannedProduct` აღარ ეყრდნობა მხოლოდ generic-ს — `resolveErrorMessage`-ით backend-ის `code`-ს (როცა route მიგრირებულია) თარგმნილ, კონკრეტულ ტექსტად აჩვენებს. (მანამდე: `error.response.data.error`-ს საერთოდ არ კითხულობდა — duplicate barcode-ზეც კი მხოლოდ generic "Error saving data!" ჩანდა.)
  - **Ingredients.tsx** — 🟢 **მოგვარებულია.** ლოკალური `getErrorMessage` (raw, დაუთარგმნელი ტექსტი) ჩანაცვლდა `resolveErrorMessage`-ით.
  - **Modifiers.tsx/OrderScreen.tsx/Settings.tsx/SplitBillModal.tsx** — 🟢 **მოგვარებულია** (STEP 2, 03.10.2026): ყველა გადავიდა გაზიარებულ `resolveErrorMessage`-ზე.

---

## პროცესი / კონვენციები (გასაგრძელებლად)

- **ერთი გვერდი ერთ ჯერზე** — თარგმანი → ლოკალური ტესტი (ორივე ენა + ორივე თემა) → commit მხოლოდ მომხმარებლის დადასტურებით → push ყოველთვის მომხმარებელი.
- **Key namespace** გვერდის სახელის მიხედვით (`sales.*`, `tables.*`, `orderScreen.*`, `dashboard.*` და ა.შ.), საერთო key-ები (`common.*`, `nav.*`) — გამეორებადი ტექსტისთვის (ღილაკები, სტატუსები), key-ების დუბლირების ნაცვლად. თუ გვერდის ლოგიკა კოდის კომენტარებში მონიშნულია როგორც სხვა გვერდის "იდენტური" (მაგ. OrderScreen.tsx ↔ Sales.tsx), ეს ძლიერი სიგნალია — key-ების reuse იქ მაქსიმალურადაა გასაკეთებელი.
- **Module-level ფუნქციები/constant-ები** (კომპონენტის გარეთ, `useTranslation()` hook-ის გარეშე) იყენებენ `i18n.t()` singleton-ს (`import i18n from '../i18n'`), არა hook-ს.
- **Variable-shadowing შემოწმება სავალდებულოა** ყოველი გვერდის შემდეგ — `grep` `t =>`/`(t,`/`(t)` პატერნებზე, რომ `.map(t => ...)`-ისნაირმა callback-ებმა არ დაფაროს `useTranslation()`-ის `t`.
- **ვერიფიკაცია გვერდის დასრულებისას:** (1) დარჩენილი ქართული ტექსტის სკანი (კომენტარების გამოკლებით), (2) `tsc --noEmit` სუფთა უნდა იყოს, (3) გამოყენებული ყველა `t('...')` key არსებობს ორივე `ka.json`/`en.json`-ში.
- **გვერდთან დაკავშირებული modal/child კომპონენტები არ უნდა გამორჩეს** — გვერდის თარგმნის დროს გადასამოწმებელია ყველა მისგან გახსნილი მოდალიც/ჩართული კომპონენტიც (`../components/`-ში ან იმავე `../pages/`-ში, `Dashboard.tsx`↔`ExecutiveDashboard.tsx`-ის მსგავსად), რადგან ისინი ცალკე ფაილებია და pattern-scan-ში (Georgian text scan) არ ხვდება, თუ მხოლოდ მთავარი გვერდის ფაილს ვამოწმებთ.
