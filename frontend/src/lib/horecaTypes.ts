// frontend/src/lib/horecaTypes.ts
//
// 🍽️ HoReCa Module STEP 1 (Roadmap "03.09.2026") — Tables.tsx-ს და
// OrderScreen.tsx-ს შორის გაზიარებული ტიპები. ბექენდის
// `backend/src/types.ts`-ის (`RestaurantTable`, `Order`, `OrderItem`)
// ანარეკლია — ველების სახელები/ტიპები ცალსახად ემთხვევა JSON
// response-ის ფორმას (`GET /tables`, `GET /orders`, `GET /orders/:id`).
//
// ⚠️ Clean Architecture / "არა `any`" წესის დაცვით — ორივე ახალი
// გვერდი (Tables.tsx, OrderScreen.tsx) ამ ერთი წყაროდან იმპორტავს ამ
// ტიპებს, ნაცვლად თითოეულში ცალკე დუბლირებისა (რაც Products.tsx/
// Sales.tsx-ის `interface Product`-ის არსებული კონვენციაა, მაგრამ იქ
// ეს ორი გვერდი ერთმანეთს არასდროს გადასცემს ობიექტს პირდაპირ —
// აქ კი Tables.tsx პირდაპირ გადასცემს არჩეულ მაგიდას OrderScreen.tsx-ს).

export type BusinessType = 'retail' | 'horeca';

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

export type KitchenStatus = 'pending' | 'sent' | 'preparing' | 'ready' | 'served' | 'voided';

export type OrderStation = 'kitchen' | 'bar' | null;

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
  // 🔎 GET /orders-ის LEFT JOIN-ით დამატებული ველი (GET /orders/:id-ს
  // ცალკე response-ს არ აქვს, მაგრამ ველი optional-ია სწორედ ამიტომ).
  table_name?: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: number;
  // 🔎 GET /orders/:id-ს JOIN-ით დამატებული ველი.
  product_name: string;
  quantity: number;
  unit_price: number;
  seat_number: number | null;
  course_number: number;
  kitchen_status: KitchenStatus;
  station: OrderStation;
  notes: string | null;
  sent_to_kitchen_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  // 🧩 STEP 3.1 (მოდიფაიერები, Roadmap "03.09.2026") — ამ item-ზე
  // არჩეული ოფციები (GET /orders/:id, POST /orders/:id/items).
  modifiers: OrderItemModifierSummary[];
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

// ==========================================
// 🍳 KDS routing (STEP 2, Roadmap "03.09.2026", migration 020) —
// GET /kitchen/tickets-ის row-ის ფორმა (backend/src/types.ts-ის
// KitchenTicket-ის ანარეკლი, Tables.tsx/OrderScreen.tsx-ის ზემოთა
// კონვენციით — ერთი წყარო KitchenDisplay.tsx-სთვის).
// ==========================================

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
  station: NonNullable<OrderStation>;
  notes: string | null;
  sent_to_kitchen_at: string | null;
  created_at: string;
  // 🧩 STEP 3.1 (მოდიფაიერები) — სამზარეულო/ბარმაც დაინახოს "medium
  // rare", "+ ყველი" და ა.შ.
  modifiers: OrderItemModifierSummary[];
}

// ==========================================
// 🧩 HoReCa STEP 3.1 — მოდიფაიერები (Roadmap "03.09.2026", migration 021)
// ==========================================
// backend/src/types.ts-ის იგივე ტიპების ანარეკლი (ModifierGroup,
// ModifierOption, ModifierGroupWithOptions, OrderItemModifierSummary).

export type ModifierSelectionType = 'single' | 'multiple';

export interface ModifierGroup {
  id: string;
  organization_id: string;
  name: string;
  selection_type: ModifierSelectionType;
  is_required: boolean;
  created_at: string;
}

export interface ModifierOption {
  id: string;
  modifier_group_id: string;
  name: string;
  price_delta: number;
  created_at: string;
}

export interface ModifierGroupWithOptions extends ModifierGroup {
  options: ModifierOption[];
}

export interface OrderItemModifierSummary {
  id: string;
  name: string;
  price_delta_snapshot: number;
}
