// ==========================================
// საერთო TypeScript ტიპები — public.users ცხრილი
// ==========================================
// ერთადერთი წყარო users ცხრილის row-ის ფორმისთვის ბექენდზე.
// სვეტების ნუსხა უნდა ემთხვეოდეს backend/migrations/*.sql-ს
// (ბოლო: 013_add_organizations_and_tenant_scope.sql). ახალი მიგრაციის
// დამატებისას აქაც უნდა აისახოს შესაბამისი ველი — "any"-ის ნაცვლად
// ყოველთვის ეს ინტერფეისი გამოვიყენოთ db.query-ის generic ტიპად.
//
// 🆔 UUID მიგრაცია (Roadmap STEP 1, migration 009): ყველა PK/FK, რომელიც
// აქამდე SERIAL/INTEGER იყო (users.id-ის ჩათვლით), ახლა UUID-ია (string
// TypeScript-ის მხარეს) — Offline Mode-ში სხვადასხვა Register-ზე
// კლიენტის მიერ დამოუკიდებლად გენერირებული ID-ების კოლიზიის
// თავიდან ასაცილებლად.
//
// 🏢 Multi-Tenant SaaS STEP 1 (migration 013): `organizations` ცხრილი +
// `organization_id` FK ემატება ყველა ქვემოთა ინტერფეისს, გარდა
// `ActivationCode`-ისა (იხ. მისი განსხვავებული, nullable ტიპი და
// კომენტარი ქვემოთ — migration 013-ის თავსართის იგივე დასაბუთებით).
// STEP 2-მდე (route-level `WHERE organization_id = $1` scoping) ეს ველი
// ჯერ არცერთ routes/*.ts ფაილში არ გამოიყენება — მხოლოდ ტიპის დონეზეა
// უკვე ასახული, რომ STEP 2-ის route-review მას მზად დახვდეს.

export type UserRole = 'admin' | 'manager' | 'cashier';

export interface User {
  id: string;
  name: string;
  password_hash: string;
  role: UserRole;
  // ⚠️ ისტორიულად ბაზაში/ფრონტენდში სტატუსის სტრინგები არაერთგვაროვანია
  // (მაგ. 'active'/'inactive' vs ქართული ვარიანტები ჰარეშ ჩანართებით),
  // ამიტომ განზრახ არ ვზღუდავთ სტრიქტ union-ით — არსებული routes კოდი
  // ამას სხვადასხვანაირად ადარებს და მკაცრმა ტიპმა შეიძლება ცრუ compile
  // შეცდომები გამოიწვიოს.
  status: string;
  can_view_history: boolean;
  can_use_discount: boolean;
  // 🧾 Roadmap ეტაპი 4: უფლება, გააუქმოს უკვე გატარებული ჩეკი
  // (POST /api/payments/:id/void). DEFAULT false — დესტრუქციული
  // მოქმედება, unsafe-by-default (იხ. migration 006).
  can_void_receipt: boolean;
  // 🛒 Roadmap ეტაპი 5: უფლება, გაასუფთაოს აქტიური კალათა ან წაშალოს
  // უკვე დამატებული პროდუქტი POS ეკრანზე. DEFAULT false იმავე მიზეზით.
  can_clear_cart: boolean;
  requires_password_reset: boolean;
  // 🔐 bcrypt ჰეში (10 salt rounds), არასდროს plain text. NULL == PIN
  // ჯერ არ დაუყენებია ადმინს ამ მენეჯერისთვის (Roadmap ეტაპი 2).
  manager_pin: string | null;
  // 🏢 Multi-Tenant SaaS STEP 1 (migration 013) — NOT NULL, ბექფილილი
  // ერთი "default" org-ით ყველა არსებული production მომხმარებლისთვის.
  organization_id: string;
  // 🏢 Multi-Tenant SaaS STEP 3 (migration 014) — NULLABLE: ისტორიულ
  // user-ებს (STEP 3-მდე შექმნილებს) email არასდროს ჰქონიათ. მხოლოდ
  // ახალი, self-service რეგისტრაციით შექმნილ ორგანიზაციის ადმინებს
  // ავალდებულებს (routes/organizations.ts). უნიკალურია მთელი
  // პლატფორმის მასშტაბით (`uq_users_email`), არა per-org.
  email: string | null;
}

// ==========================================
// public.organizations ცხრილი — Multi-Tenant SaaS STEP 1 (migration 013)
// ==========================================
// Root ცხრილი ტენანტებისთვის — `users`/`registers`/`shifts`/`payments`/
// `products`/`audit_logs`/`stock_deficit_notifications`/`shift_amendments`-ის
// `organization_id` FK-ები ყველა აქ მიუთითებს.
export type OrganizationStatus = 'trial' | 'active' | 'suspended' | 'cancelled';

// 🍽️ HoReCa Module STEP 1 (Roadmap "03.09.2026", migration 019) — ერთი
// კოდბაზა/ერთი DB, ორივე ბიზნეს-ტიპისთვის. ნაგულისხმევი 'retail' —
// ყველა არსებული org უცვლელი რჩება. განსაზღვრავს, ხედავს თუ არა
// frontend-ის ნავიგაცია Tables/Orders/KDS გვერდებს (`requireBusinessType`
// middleware ბექენდზეც ამავე ველზეა აგებული).
export type BusinessType = 'retail' | 'horeca';

export interface Organization {
  id: string;
  name: string;
  // subdomain/URL-ისთვის (Roadmap STEP 7) — ჯერჯერობით მხოლოდ უნიკალური
  // იდენტიფიკატორია, routing ჯერ არ არსებობს.
  slug: string;
  status: OrganizationStatus;
  // TEXT ჯერჯერობით (არა FK ცალკე `plans`-ცხრილზე) — STEP 4-ის (Stripe
  // billing) წინაპირობა, STEP 1-ის დათქმის მიხედვით.
  plan: string;
  trial_ends_at: string | null;
  created_at: string;
  // 🍽️ HoReCa Module STEP 1 (migration 019) — NOT NULL, DEFAULT 'retail'.
  business_type: BusinessType;
}

// PIN-ის ვერიფიკაციისთვის საკმარისი მინიმალური ველების ქვესიმრავლე —
// bcrypt.compare-ს მხოლოდ ეს სჭირდება, არ ვწერთ მთელ User-ს ყოველ query-ში.
export type ManagerPinCandidate = Pick<User, 'id' | 'name' | 'manager_pin'>;

// ==========================================
// public.platform_admins ცხრილი — Multi-Tenant SaaS STEP 8 (Superadmin
// Panel, migration 015)
// ==========================================
// ორგანიზაციებისგან (tenant-ებისგან) სრულად დამოუკიდებელი ცხრილი/auth-
// მექანიზმი — არ არის users-ის ნაწილი, არ გააჩნია organization_id
// (განზრახ გადაწყვეტილება — იხ. migration 015-ის თავსართი). platform
// admin-ს ყველა org-ზე წვდომა სჭირდება, ამიტომ ცალკე auth (იხ.
// middleware/platformAdminAuth.ts) იცავს STEP 2-ის route-level
// tenant-scoping ინვარიანტებს — ჩვეულებრივ, org-ცნობიერ route-ებს
// საერთოდ არ ეხება ეს ცხრილი.
export interface PlatformAdmin {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  is_active: boolean;
  created_at: string;
}

// ==========================================
// public.superadmin_audit_logs ცხრილი — STEP 8 (migration 015)
// ==========================================
export interface SuperadminAuditLog {
  id: string;
  platform_admin_id: string;
  action: string;
  target_organization_id: string | null;
  details: string | null;
  created_at: string;
}

// ==========================================
// public.registers ცხრილი — Roadmap STEP 1.2 (Multi-POS)
// ==========================================
// თითოეული ფიზიკური სალარო აპარატი/ტერმინალი ერთ registers-ჩანაწერს
// შეესაბამება. id გამოიყენება shifts.register_id/payments.register_id
// FK-ებში და middleware/registerAuth.ts-ის register_token-ის payload-ში.
export interface Register {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  // 🏢 Multi-Tenant SaaS STEP 1 (migration 013) — NOT NULL, ბექფილილი.
  organization_id: string;
}

// ==========================================
// public.activation_codes ცხრილი — Roadmap STEP 2.2 (Device Pairing)
// ==========================================
export type ActivationCodeStatus = 'pending' | 'confirmed' | 'expired';

export interface ActivationCode {
  id: string;
  code: string;
  status: ActivationCodeStatus;
  register_id: string | null;
  // 🔐 register_token საბოლოო კლიენტისკენ მხოლოდ GET /pairing-status/:code
  // საშუალებით გაედინება (status === 'confirmed' დროს) — არასდროს
  // ბრუნდება სხვა (მაგ. ადმინის) ენდპოინტიდან საჯაროდ.
  register_token: string | null;
  created_at: string;
  expires_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  // 🏢 Multi-Tenant SaaS STEP 1 (migration 013) — ⚠️ NULLABLE, დანარჩენი
  // ცხრილებისგან განსხვავებით: POST /api/registers/generate-code
  // ავტორიზაციის გარეშე გამოიძახება (ჯერ დაუკავშირებელი მოწყობილობა —
  // org context ჯერ არ არსებობს request-ის დროს), ამიტომ NOT NULL ვერ
  // დაიდგმება. STEP 2-მ უნდა გადაწყვიტოს, ზუსტად როდის (სავარაუდოდ
  // pairing-ის დადასტურების მომენტში, register_id-ის ანალოგიით)
  // მიენიჭება org.
  organization_id: string | null;
}

// ==========================================
// 📴 Background Sync Engine — Roadmap STEP 5
// ==========================================
// POST /api/payments/sync-offline-ის request/response ფორმა — ერთი
// წყარო ტიპებისთვის (routes/sales.ts), ისევე როგორც frontend-ის
// db/offlineDb.ts-ის OfflineReceipt-ი ერთი წყაროა კლიენტის მხარეს.
// ეს ორი ტიპი ცალკე ინახება (backend/frontend არ იზიარებენ საერთო
// პაკეტს), მაგრამ ველების ფორმა ცალსახად უნდა ემთხვეოდეს.

export interface OfflineSyncReceiptItem {
  productId: number;
  name: string;
  price: number;
  quantity: number;
}

export interface OfflineSyncReceiptSplits {
  cash: number;
  card: number;
}

// 🆔 id — crypto.randomUUID()-ით კლიენტის მხარეზე (Roadmap STEP 4.1)
// გენერირებული UUID, უცვლელად გამოიყენება payments.id-ად (ON CONFLICT
// DO NOTHING-ით იდემპოტენტურობისთვის — იხ. POST /payments/sync-offline).
export interface OfflineSyncReceiptPayload {
  id: string;
  shiftId: string;
  registerId: string;
  cashierId: string;
  items: OfflineSyncReceiptItem[];
  subtotalAmount: number;
  discountType: 'percent' | 'fixed' | null;
  discountValue: number;
  totalAmount: number;
  paymentMethod: 'cash' | 'card' | 'split';
  splits: OfflineSyncReceiptSplits | null;
  cashReceived: number | null;
  // 🕐 ISO 8601, კლიენტის საათი (Roadmap STEP 1.4-ის ანალოგიური
  // client-side timestamp audit) — sync-ის დროის ნაცვლად ეს ინახება.
  createdAt: string;
}

// 🔀 თითოეული ჩეკის დამოუკიდებელი შედეგი — ერთი ჩეკის ჩავარდნა
// (მაგ. FK constraint) დანარჩენების commit-ს არ აჩერებს (იხ.
// routes/sales.ts-ის SAVEPOINT-ზე დაფუძნებული per-item დამუშავება).
export type OfflineSyncItemStatus = 'synced' | 'duplicate' | 'failed';

export interface OfflineSyncResult {
  id: string;
  status: OfflineSyncItemStatus;
  error?: string;
  hadStockDeficit?: boolean;
  // 🧾 Migration 012 — true, თუ ეს ჩეკი უკვე დახურულ shift_id-ზე
  // სინქრონდა და shifts.end_amount_expected/difference ხელახლა
  // გამოითვალა (იხ. syncSingleOfflineReceipt, routes/sales.ts).
  causedShiftAmendment?: boolean;
}

// ==========================================
// public.stock_deficit_notifications ცხრილი — Roadmap STEP 5 (migration 011)
// ==========================================
// Offline sync-ის დროს აღმოჩენილი oversell — Manager Dashboard-ის
// (ExecutiveDashboard.tsx) ნოტიფიკაციის პანელის მონაცემთა წყარო.
export interface StockDeficitNotification {
  id: string;
  payment_id: string;
  product_id: number | null;
  product_name: string;
  register_id: string | null;
  cashier_id: string | null;
  requested_quantity: number;
  available_quantity: number;
  deficit_quantity: number;
  is_resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  // 🏢 Multi-Tenant SaaS STEP 1 (migration 013) — NOT NULL, ბექფილილი.
  organization_id: string;
}

// ==========================================
// public.shift_amendments ცხრილი — Migration 012 (Z-Report Late-Sync
// Reconciliation)
// ==========================================
// POST /api/payments/sync-offline-ის დროს, თუ დაგვიანებული offline ჩეკი
// უკვე დახურულ shift_id-ს ეხება, shifts.end_amount_expected/difference
// ავტომატურად ხელახლა გამოითვლება — ეს ჩანაწერი Manager Dashboard-ის
// (ExecutiveDashboard.tsx) ნოტიფიკაციის პანელის მონაცემთა წყაროა, იმავე
// stock_deficit_notifications-ის პატერნის მიხედვით (types.ts-ის ზემოთა
// ინტერფეისი).
export interface ShiftAmendmentNotification {
  id: string;
  shift_id: string;
  payment_id: string;
  cashier_id: string | null;
  register_id: string | null;
  previous_expected: number;
  new_expected: number;
  previous_difference: number;
  new_difference: number;
  is_resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  // 🏢 Multi-Tenant SaaS STEP 1 (migration 013) — NOT NULL, ბექფილილი.
  organization_id: string;
}
// ==========================================
// 🍽️ HoReCa Module STEP 1 — public.tables / public.orders / public.order_items
// (Roadmap "03.09.2026", migration 019)
// ==========================================
// `organization_id === 'retail'` org-ებს ამ ცხრილებში არასდროს ექნებათ
// row-ები (routes/tables.ts, routes/orders.ts ორივე `requireBusinessType
// ('horeca')`-ს უკან დგას) — მაგრამ ტიპები ორივე ბიზნეს-ტიპისთვის ერთი
// წყაროა, `business_type`-ზე პირობითი ხელმისაწვდომობის გარეშე.

export type TableStatus = 'free' | 'occupied' | 'reserved' | 'dirty';

export interface RestaurantTable {
  id: string;
  organization_id: string;
  name: string;
  section: string | null;
  capacity: number | null;
  status: TableStatus;
  created_at: string;
}

export type OrderStatus = 'open' | 'closed' | 'voided';

export interface Order {
  id: string;
  organization_id: string;
  table_id: string | null;
  register_id: string;
  shift_id: string;
  opened_by: string;
  guest_count: number | null;
  status: OrderStatus;
  opened_at: string;
  closed_at: string | null;
  closed_payment_id: string | null;
}

// 🍳 KDS routing (STEP 2) — 'pending' ჯერ ერთადერთი რეალურად
// გამოყენებადი მნიშვნელობაა STEP 1-ში ('sent'-ზე ზემოთ გადასვლა
// STEP 2-ის "გაგზავნა სამზარეულოში" ნაკადს ელოდება).
export type KitchenStatus = 'pending' | 'sent' | 'preparing' | 'ready' | 'served' | 'voided';

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: number;
  quantity: number;
  // შეკვეთაში დამატების მომენტში დაფიქსირებული ფასი (products.price-ის
  // შემდგომი ცვლილება უკვე დამატებულ item-ს აღარ ეხება).
  unit_price: number;
  seat_number: number | null;   // STEP 4 (ჩეკის გაყოფა)
  course_number: number;
  kitchen_status: KitchenStatus;
  station: 'kitchen' | 'bar' | null;   // STEP 2 — products.station-იდან სნეპშოტი დამატების მომენტში
  notes: string | null;
  sent_to_kitchen_at: string | null;
  created_at: string;
  voided_by: string | null;
  void_reason: string | null;
}

// ==========================================
// 🍳 KDS routing (STEP 2, Roadmap "03.09.2026", migration 020) —
// public.products.station
// ==========================================
// products-ს არსად არ ჰქონდა საკუთარი TypeScript ინტერფეისი (routes/
// products.ts მთლიანად `any`-ზეა აგებული, STEP 1-მდელი კოდი) — აქ
// მხოლოდ ის ველებია, რაც routes/kitchen.ts-ს/routes/orders.ts-ს
// სჭირდება (JOIN query-ების typed row shape-ისთვის), არა products.ts-ის
// სრული refactor STEP 2-ის scope-ში.
export type Station = 'kitchen' | 'bar';

export interface ProductStationLookup {
  price: number;
  station: Station | null;
}

// GET /kitchen/tickets-ის ერთი row — order_items + JOIN (products.name,
// orders.table_id, tables.name).
export interface KitchenTicket {
  id: string;
  order_id: string;
  table_id: string | null;
  table_name: string | null;
  product_id: number;
  product_name: string;
  quantity: number;
  seat_number: number | null;
  course_number: number;
  kitchen_status: KitchenStatus;
  station: Station;
  notes: string | null;
  sent_to_kitchen_at: string | null;
  created_at: string;
}
