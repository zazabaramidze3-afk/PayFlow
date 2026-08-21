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
}

// ==========================================
// public.organizations ცხრილი — Multi-Tenant SaaS STEP 1 (migration 013)
// ==========================================
// Root ცხრილი ტენანტებისთვის — `users`/`registers`/`shifts`/`payments`/
// `products`/`audit_logs`/`stock_deficit_notifications`/`shift_amendments`-ის
// `organization_id` FK-ები ყველა აქ მიუთითებს.
export type OrganizationStatus = 'trial' | 'active' | 'suspended' | 'cancelled';

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
}

// PIN-ის ვერიფიკაციისთვის საკმარისი მინიმალური ველების ქვესიმრავლე —
// bcrypt.compare-ს მხოლოდ ეს სჭირდება, არ ვწერთ მთელ User-ს ყოველ query-ში.
export type ManagerPinCandidate = Pick<User, 'id' | 'name' | 'manager_pin'>;

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
