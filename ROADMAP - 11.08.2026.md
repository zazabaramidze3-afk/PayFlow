You are an expert software architect and full-stack engineer. ჩვენ ვაკეთებთ არსებული, ნაწილობრივ განვითარებული POS (Point of Sale) და Inventory Management სისტემის – **PayFlow**-ს რეფაქტორინგს.

### Tech Stack & Current State:
- **Frontend:** React, Vite, TypeScript
- **Backend:** Node.js, Express, TypeScript, PostgreSQL
- **Database Status:** სისტემა სრულად მუშაობს Local Development გარემოში (Production-ზე ჯერ არ არის ატვირთული). ამჟამად, Primary Keys (მაგალითად, `id` ცხრილში `payments`) იყენებს ავტო-ინკრემენტულ `Integer [PK]` (SERIAL) ტიპს.
- **Business Logic:** ამ ეტაპზე დანერგილია მკაცრი Shift Management (მხოლოდ ერთ მოლარეს აქვს უფლება გახსნას სალარო/ცვლა; მომდევნო მოლარე ვერ გაივლის Login-ს, სანამ მიმდინარე Shift არ დაიხურება).

### Objective:
მომავალი განვითარებისთვის და მასშტაბირებისთვის, გვინდა სისტემის არქიტექტურის გარდაქმნა, რათა მან მხარი დაუჭიროს Multi-POS კონფიგურაციას (რამდენიმე მოლარის პარალელურად მუშაობა სხვადასხვა ფიზიკურ სალაროზე), სტაბილურ **Offline Mode**-ს (PWA / IndexedDB-ს საშუალებით) და უსაფრთხო **Device Pairing Mechanism**-ს ფიზიკური სალარო აპარატების იდენტიფიცირებისთვის.

გთხოვთ, შეასრულოთ ეს რეფაქტორინგი Step-by-Step. დაწერეთ სუფთა, Type-Safe TypeScript კოდი.

---

### STEP 1: PostgreSQL Schema Refactoring (UUIDs & Multi-POS Setup)
1. **UUID Migration:** დააგენერირე SQL Migration სკრიპტები, რათა გადაიყვანო ყველა Primary Key (`id`) და შესაბამისი Foreign Keys ყველა საჭირო ცხრილში (მათ შორის `payments`, `payment_items`, `payment_splits`, `shifts`, `users`, `audit_logs`) `Integer/SERIAL`-იდან `UUIDv4`-ზე. ეს კრიტიკულია Offline რეჟიმში სხვადასხვა სალაროდან გამოგზავნილი ID Collisions-ის თავიდან ასაცილებლად.
2. **Registers Table:** შექმენი ახალი ცხრილი `registers`:
   - `id` (UUID, PK)
   - `name` (VARCHAR, მაგ: "Register #1", "Express Counter")
   - `is_active` (BOOLEAN)
   - `created_at` (TIMESTAMP)
3. **Shift & Payment Updates:** განაახლე `shifts` და `payments` სქემები, რათა დაამატო `register_id` (Foreign Key), რომელიც დარეფერენსდება `registers` ცხრილზე.
4. **Timestamp Audit:** გააკეთე ბექენდის Receipt-Processing Endpoint-ების რეფაქტორინგი, რათა მათ მიიღონ Client-Side-დან გამოგზავნილი ტაიმსტემპი `created_at` ველისთვის, ნაცვლად DB-ის `DEFAULT NOW()`-ის გამოყენებისა. ეს საჭიროა Offline გაყიდვების ზუსტი დროის შესანარჩუნებლად.

### STEP 2: Device Pairing & Activation Flow (Security Guard)
1. **Device Isolation:** შეცვალე უსაფრთხოების ბიზნეს ლოგიკა. წესი "მხოლოდ ერთი აქტიური Shift" უნდა მუშაობდეს **Per Register** (თითოეულ სალაროზე ლოკალურად) და არა გლობალურად მთელი მაღაზიისთვის. რამდენიმე მოლარეს უნდა შეეძლოს პარალელურად მუშაობა, თუ ისინი სხვადასხვა ფიზიკურ Register-ზე არიან შესულები.
2. **Activation Backend:** შექმენი დროებითი ვერიფიკაციის სისტემა (მაგალითად, `activation_codes` Table ან In-Memory Store) შესაბამისი Endpoint-ებით:
   - `POST /api/registers/generate-code`: აგენერირებს მოკლე 6-ნიშნა კოდს Unlinked ბრაუზერისთვის.
   - `POST /api/registers/pair`: აძლევს Manager/Admin-ს უფლებას დაადასტუროს ეს 6-ნიშნა კოდი და მიაბას ის კონკრეტულ `register_id`-ს ბაზიდან, რის შემდეგაც აბრუნებს უსაფრთხო `register_token`-ს და `register_id`-ს.
3. **Frontend Register Guard:** შექმენი React Layout კომპონენტი (`RegisterGuard.tsx`), რომელიც შემოატარებს (Wrap) მთელ აპლიკაციას. მან უნდა შეამოწმოს `localStorage`-ში `payflow_register_id` და `payflow_register_token`.
   - თუ მონაცემები არ არის (ახალი მოწყობილობაა, Cache წაიშალა ან App Reinstall გაკეთდა), **სრულად დაბლოკე Login გვერდი**, დააგენერირე/გამოაჩინე 6-ნიშნა საიდენტიფიკაციო კოდი და დაელოდე Pairing Confirmation-ს (Polling-ით ან WebSockets-ით).
   - თუ მონაცემები არსებობს, ავტომატურად დააყოლე ეს მონაცემები Headers-ის სახით ყველა Axios/Fetch მოთხოვნას და ჩატვირთე Cashier Login ეკრანი.

### STEP 3: Frontend PWA & Service Worker Configuration (Vite)
1. დააინსტალირე და დააკონფიგურირე `@vite-pwa/plugin` ფაილში `vite.config.ts`.
2. გამართე **Workbox** კონფიგურაცია Core Frontend Assets-ის (`index.html`, `js`, `css`, UI graphics) Precaching-ისთვის, რათა `payflow.ge` სრულად ჩაიტვირთოს Offline-ში HTTPS-ის საშუალებით.
3. დაწერე Helper ფუნქცია ბრაუზერის `Persistent Storage API`-ს (`navigator.storage.persist()`) გამოყენებით, რათა ბრაუზერმა Disk Cleanup-ის დროს ავტომატურად არ წაშალოს ჩვენი ლოკალური მონაცემები (IndexedDB).

### STEP 4: Client-Side Offline Database (Dexie.js / IndexedDB)
1. გამართე **Dexie.js** React აპლიკაციაში. შექმენი ორი ლოკალური Store:
   - `cached_products`: აქ შეინახება პროდუქტები, შტრიხკოდები და ფასები (რომელიც სინქრონიზდება Cashier Login-ის ან Shift-ის დაწყებისას).
   - `offline_receipts`: აქ შეინახება Offline ტრანზაქციების Payload-ები, რომლებიც ზუსტად ემთხვევა ჩვენს განახლებულ UUID ბექენდ სქემას.
2. გააკეთე Checkout Submit Handler-ის რეფაქტორინგი: თუ აპლიკაცია დააფიქსირებს Offline სტატუსს, დააჰიჯაქე (Intercept) API Call, გამოიყენე `crypto.randomUUID()` Client-Side ID-ის შესაქმნელად, მიაბი მიმდინარე `shift_id` და `register_id`, ჩაწერე მონაცემები `offline_receipts`-ში და მოლარეს უჩვენე წარმატებული გაყიდვის UI State.

### STEP 5: Background Sync Engine & Conflict Resolution
1. შექმენი Custom React Hook `useNetworkStatus` (`navigator.onLine` კომბინირებული 10-წამიან ფონურ Heartbeat Ping-თან ჩვენს API-ზე), რათა დაადგინო ნამდვილი ინტერნეტ კავშირის არსებობა (True Internet Access).
2. ააწყვე Background Synchronization Worker, რომელიც გაეშვება მაშინვე, როცა სტატუსი შეიცვლება Offline-იდან Online-ზე. მან სათითაოდ (Sequentially) უნდა წაიკითხოს `offline_receipts` რიგი და გააგზავნოს ახალ ბექენდ ენდფოინთზე: `POST /api/payments/sync-offline`.
3. **Backend Sync Controller:** შექმენი ეს Endpoint Express-ში. მან უნდა დაამუშაოს მიღებული Offline ჩეკების მასივი მკაცრ PostgreSQL Transactions (`BEGIN/COMMIT`) ბლოკში. თუ რომელიმე ნივთის Inventory ჩამოცდება ნულს (Stock-ის დეფიციტი პარალელური ოფლაინ გაყიდვების გამო), მაინც გაატარე ტრანზაქცია (რადგან თანხა უკვე აღებულია) და მენეჯერის Dashboard-ზე გამოაჩინე Notification Flag მარაგების აცდენის შესახებ.

---

დავიწყოთ მკაცრად **STEP 1** და **STEP 2**-ით. შეამოწმე ჩვენი რეპოზიტორია, დაწერე SQL Migration სკრიპტები, შექმენი `RegisterGuard` კომპონენტი და ააწყვე ბექენდის Pairing API ენდფოინთები.
