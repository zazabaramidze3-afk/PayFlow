-- ==========================================
-- Migration 021: მოდიფაიერები — modifier_groups/options + product/order_item links
-- ==========================================
-- Roadmap: `ROADMAP - HoReCa Module - 03.09.2026.md`, STEP 3.1
-- (მოდიფაიერები — BOM/რეცეპტი-საწყობი ცალკე, მომდევნო migration-შია
-- დაგეგმილი, roadmap-ის "STEP 3-ში მოდიფაიერები და BOM ერთად" გადაწყვეტილების
-- საწინააღმდეგოდ განზრახ გამიჯნული — BOM ცალკე მოსატესტია, checkout-ის
-- stock-decrement ლოგიკას ეხება).
--
-- რას აკეთებს:
--   1) `modifier_groups` — "ჯგუფი" (მაგ. "ხარისხი", "დანამატი"),
--      `selection_type` ('single'|'multiple') და `is_required`-ით.
--   2) `modifier_options` — ჯგუფის კონკრეტული ვარიანტი (მაგ. "medium",
--      "+ ყველი"), `price_delta`-ით (შეიძლება უარყოფითიც იყოს).
--   3) `product_modifier_groups` — M:N, რომელ პროდუქტს რომელი ჯგუფი აქვს
--      მიბმული (Products.tsx-ის ახალი UI-დან იმართება).
--   4) `order_item_modifiers` — კონკრეტულ order_item-ზე არჩეული
--      ოფციები, `price_delta_snapshot`-ით (მენიუს ფასი მერე რომ
--      შეიცვალოს, ძველი შეკვეთა უცვლელი დარჩეს — იგივე პრინციპი, რაც
--      `order_items.unit_price`-ს აქვს).
--   5) RLS policy-ები, migration 019/020-ის იდენტური fail-open pattern-ით.
--
-- ⚠️ ისტორიის დაცვა: `order_item_modifiers.modifier_option_id`-ს განზრახ
-- **არ** აქვს ON DELETE CASCADE — თუ ოფცია/ჯგუფი უკვე გამოყენებულია
-- არსებულ შეკვეთაში, მისი წაშლა DB-level FK-ით ილუსტრირდება (routes/
-- modifiers.ts 409-ით აბრუნებს, tables.ts-ის "დაკავშირებული ისტორია"
-- პატერნის იდენტურად) — `product_modifier_groups` კი სუფთა config-ია
-- (არა ისტორია), ამიტომ CASCADE-ია.
--
-- ⚠️ ნულოვანი გავლენა Retail-ზე და არსებულ HoReCa მონაცემებზეც: მხოლოდ
-- ახალი, დამატებითი ცხრილებია.
--
-- ⚠️ იდემპოტენტურობა: migration 009/013/019/020-ის კონვენციით.
-- ==========================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'modifier_groups'
  ) THEN
    RAISE EXCEPTION 'Migration 021 უკვე გატარებულია — modifier_groups უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

-- ==========================================
-- 1) modifier_groups
-- ==========================================
CREATE TABLE public.modifier_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  name TEXT NOT NULL,
  selection_type TEXT NOT NULL DEFAULT 'single'
    CHECK (selection_type IN ('single', 'multiple')),
  is_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_modifier_groups_organization_id ON public.modifier_groups (organization_id);

-- ==========================================
-- 2) modifier_options
-- ==========================================
CREATE TABLE public.modifier_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_group_id UUID NOT NULL REFERENCES public.modifier_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_delta REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_modifier_options_modifier_group_id ON public.modifier_options (modifier_group_id);

-- ==========================================
-- 3) product_modifier_groups (M:N, სუფთა config — არა ისტორია)
-- ==========================================
CREATE TABLE public.product_modifier_groups (
  product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  modifier_group_id UUID NOT NULL REFERENCES public.modifier_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, modifier_group_id)
);

-- ==========================================
-- 4) order_item_modifiers (ისტორია — price_delta_snapshot)
-- ==========================================
CREATE TABLE public.order_item_modifiers (
  order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  modifier_option_id UUID NOT NULL REFERENCES public.modifier_options(id),
  price_delta_snapshot REAL NOT NULL,
  PRIMARY KEY (order_item_id, modifier_option_id)
);

CREATE INDEX idx_order_item_modifiers_order_item_id ON public.order_item_modifiers (order_item_id);

-- ==========================================
-- 5) RLS — migration 019-ის იდენტური fail-open pattern
-- ==========================================

ALTER TABLE public.modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modifier_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_modifier_groups ON public.modifier_groups
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

-- modifier_options-ს პირდაპირ organization_id არ აქვს (order_items-ის
-- პატერნის ანალოგიით, migration 019) — EXISTS-subquery modifier_groups-ზე.
ALTER TABLE public.modifier_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modifier_options FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_modifier_options ON public.modifier_options
  FOR ALL
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.modifier_groups mg
      WHERE mg.id = modifier_options.modifier_group_id
        AND mg.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.modifier_groups mg
      WHERE mg.id = modifier_options.modifier_group_id
        AND mg.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

ALTER TABLE public.product_modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_modifier_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_product_modifier_groups ON public.product_modifier_groups
  FOR ALL
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.modifier_groups mg
      WHERE mg.id = product_modifier_groups.modifier_group_id
        AND mg.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.modifier_groups mg
      WHERE mg.id = product_modifier_groups.modifier_group_id
        AND mg.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

ALTER TABLE public.order_item_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_modifiers FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_order_item_modifiers ON public.order_item_modifiers
  FOR ALL
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.id = order_item_modifiers.order_item_id
        AND o.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.id = order_item_modifiers.order_item_id
        AND o.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

COMMIT;
