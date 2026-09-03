-- ==========================================
-- Migration 019: HoReCa Core — business_type, tables, orders, order_items
-- ==========================================
-- Roadmap: `ROADMAP - HoReCa Module - 03.09.2026.md`, STEP 1 (Tables +
-- Orders — ბირთვი). ეს არის HoReCa მოდულის პირველი migration.
--
-- რას აკეთებს:
--   1) `organizations.business_type` ('retail' | 'horeca') — ნაგულისხმევი
--      'retail', ანუ ყველა არსებული org (და ყველა Retail row) სრულად
--      უცვლელი რჩება.
--   2) ახალი `tables` ცხრილი — HoReCa-ს ფიზიკური მაგიდები/სექციები.
--   3) ახალი `orders` ცხრილი — "ღია მაგიდის შეკვეთა" (Retail-ის
--      ერთჯერადი `payments`-ისგან განსხვავებით, დროში გაწელილი, თანდათან
--      შევსებადი). `closed_payment_id` ავსებს `sales.ts`-ის POST
--      /payments checkout-ის დროს, `order_id`-ის გადაცემისას.
--   4) ახალი `order_items` ცხრილი — შეკვეთის სტრიქონები, KDS-routing-ის
--      (`station`/`kitchen_status`) და ჩეკის გაყოფის (`seat_number`)
--      ველების ჩათვლით (STEP 2/STEP 4-ის წინსწრებით — სვეტები უკვე
--      აქ იქმნება, თუმცა ლოგიკა/API მათზე მომდევნო STEP-ებში ემატება).
--   5) RLS policy-ები ახალ ცხრილებზე, migration 017/018-ის იდენტური
--      fail-open pattern-ით (`org_isolation_*`, `current_setting(...)
--      IS NULL OR ...`) — ახალი route-ები (`tables.ts`/`orders.ts`)
--      თავიდანვე `withOrgContext`-ს იყენებენ, ამიტომ fail-open escape
--      hatch მათთვის პრაქტიკულად არასდროს ამოქმედდება, მაგრამ
--      კონსისტენტურობისთვის იგივე pattern ვიმეორებთ.
--
-- ⚠️ ნულოვანი გავლენა Retail-ზე: ახალი ცხრილები დამატებითია, არსებულ
-- `products`/`payments`/`payment_items`-ს არაფერს არ ცვლის ამ migration-ში.
--
-- ⚠️ იდემპოტენტურობა: migration 009/013/017-ის კონვენციით.
-- ==========================================

BEGIN;

-- ==========================================
-- 0) იდემპოტენტურობის დაცვა
-- ==========================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'business_type'
  ) THEN
    RAISE EXCEPTION 'Migration 019 უკვე გატარებულია — organizations.business_type უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

-- ==========================================
-- 1) organizations.business_type
-- ==========================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'retail'
    CHECK (business_type IN ('retail', 'horeca'));

-- ==========================================
-- 2) tables — HoReCa ფიზიკური მაგიდები
-- ==========================================
CREATE TABLE IF NOT EXISTS public.tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  name TEXT NOT NULL,
  section TEXT,
  capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'free'
    CHECK (status IN ('free', 'occupied', 'reserved', 'dirty')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tables_organization_id ON public.tables (organization_id);

-- ==========================================
-- 3) orders — ღია მაგიდის შეკვეთა
-- ==========================================
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  table_id UUID REFERENCES public.tables(id),          -- NULL = ბარი/takeaway
  register_id UUID NOT NULL REFERENCES public.registers(id),
  shift_id UUID NOT NULL REFERENCES public.shifts(id),
  opened_by UUID NOT NULL REFERENCES public.users(id), -- ოფიციანტი/მოლარე
  guest_count INTEGER,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'voided')),
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP,
  closed_payment_id UUID REFERENCES public.payments(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_organization_id ON public.orders (organization_id);
CREATE INDEX IF NOT EXISTS idx_orders_table_id ON public.orders (table_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders (status);

-- 🔐 ერთ მაგიდაზე ერთდროულად მაქსიმუმ ერთი ღია შეკვეთა — იმეორებს
-- `uq_one_open_shift_per_register`-ის (migration 009) პატერნს.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_open_order_per_table
  ON public.orders (table_id) WHERE (status = 'open' AND table_id IS NOT NULL);

-- ==========================================
-- 4) order_items — შეკვეთის სტრიქონები
-- ==========================================
CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES public.products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL,          -- დამატების მომენტში დაფიქსირებული ფასი
  seat_number INTEGER,               -- STEP 4 (ჩეკის გაყოფა)
  course_number INTEGER NOT NULL DEFAULT 1,
  kitchen_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (kitchen_status IN ('pending', 'sent', 'preparing', 'ready', 'served', 'voided')),
  station TEXT CHECK (station IN ('kitchen', 'bar')),  -- STEP 2 (KDS routing), ჯერ ყოველთვის NULL
  notes TEXT,
  sent_to_kitchen_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_by UUID REFERENCES public.users(id),
  void_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items (product_id);

-- ==========================================
-- 5) RLS — migration 017/018-ის იდენტური fail-open pattern
-- ==========================================

ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_tables ON public.tables
  FOR ALL
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR organization_id = current_setting('app.current_org_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR organization_id = current_setting('app.current_org_id', true)::uuid
  );

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_orders ON public.orders
  FOR ALL
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR organization_id = current_setting('app.current_org_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR organization_id = current_setting('app.current_org_id', true)::uuid
  );

-- order_items-ს პირდაპირ organization_id არ აქვს (payment_items-ის
-- პატერნის ანალოგიით, migration 017) — EXISTS-subquery `orders`-ზე.
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_order_items ON public.order_items
  FOR ALL
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND o.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND o.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

COMMIT;
