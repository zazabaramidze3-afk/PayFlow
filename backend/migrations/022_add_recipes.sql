-- ==========================================
-- Migration 022: რეცეპტი-საწყობი (BOM) — ingredients/recipe_items +
-- products.is_recipe_based
-- ==========================================
-- Roadmap: `ROADMAP - HoReCa Module - 03.09.2026.md`, STEP 3.2
-- (მოდიფაიერებისგან — STEP 3.1, migration 021 — განზრახ გამიჯნული,
-- იხ. 021-ის header-კომენტარი).
--
-- მოტივაცია (05.09.2026, მომხმარებლის დაკვირვება production QA-ზე):
-- HoReCa-ში ამჟამად ყველა პროდუქტს (სასმელიც და კერძიც) ერთნაირად
-- ცალობაში აქვს `products.stock` მითითებული — სასმელისთვის (ბოთლი)
-- ეს ლოგიკურია, კერძისთვის (სტეიკი, ბურგერი) კი არა, რადგან კერძს
-- საკუთარი "მარაგი" არ აქვს — ის ნედლეულისგან (ხორცი, პური და ა.შ.)
-- მზადდება, რომლის ცალკეული ნაშთის აღრიცხვა სჭირდება.
--
-- რას აკეთებს:
--   1) `ingredients` — ნედლეული, საკუთარი `stock`-ით (ერთი, საბაზისო
--      ერთეულით — `unit`, მაგ. "კგ"/"ლ"/"ცალი"; v1-ში unit-კონვერტაცია
--      არ არის, ღია საკითხების ჩამონათვალიდან გადაწყვეტილია
--      მომხმარებელთან — იხ. roadmap).
--   2) `recipe_items` — კონკრეტულ პროდუქტს რომელი ინგრედიენტი და რა
--      რაოდენობით სჭირდება ერთი ულუფისთვის (M:N, `quantity_required`).
--   3) `products.is_recipe_based` — `false`-ზე ძველი ქცევა ზუსტად
--      უცვლელია (checkout `products.stock`-ს აკლებს, ისევე როგორც
--      აქამდე); `true`-ზე checkout `recipe_items`-ის მიხედვით
--      `ingredients.stock`-ს აკლებს, `products.stock` საერთოდ აღარ
--      იხმარება ამ პროდუქტისთვის (routes/sales.ts).
--   4) RLS policy-ები, migration 021-ის იდენტური fail-open pattern-ით.
--
-- ⚠️ Insufficient-stock პოლიტიკა (მომხმარებელთან გადაწყვეტილი,
-- 05.09.2026): checkout **იბლოკება** (ტრანზაქცია მთლიანად უკან
-- ბრუნდება, ისევე როგორც products.stock-ის ამჟამინდელი "არასაკმარისი
-- მარაგის" ქცევა), oversell/warning-რეჟიმის გარეშე.
--
-- ⚠️ `recipe_items.ingredient_id`-ს განზრახ **არ** აქვს ON DELETE
-- CASCADE — განსხვავებით migration 021-ის `product_modifier_groups`-ის
-- ორივე FK-სგან (იქ ორივე მხარე "სუფთა კონფიგი" იყო). აქ ინგრედიენტის
-- წაშლა, სანამ ის რომელიმე რეცეპტშია გამოყენებული, საფრთხეს უქმნის
-- checkout-ის stock-decrement სისწორეს (routes/ingredients.ts 409-ით
-- აბრუნებს, tables.ts/modifiers.ts-ის "დაკავშირებული ისტორია/კონფიგი"
-- პატერნის ანალოგიით) — `product_id`-ს კი აქვს CASCADE (პროდუქტის
-- წაშლისას მისი რეცეპტი უაზრობაა, ლეგიტიმურად უნდა გაქრეს).
--
-- ⚠️ ნულოვანი გავლენა Retail-ზე: `is_recipe_based` ყოველთვის `false`-ია
-- (DEFAULT), checkout-ის ახალი branch საერთოდ არ სრულდება.
--
-- ⚠️ იდემპოტენტურობა: migration 009/013/019/020/021-ის კონვენციით.
-- ==========================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ingredients'
  ) THEN
    RAISE EXCEPTION 'Migration 022 უკვე გატარებულია — ingredients უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

-- ==========================================
-- 1) ingredients
-- ==========================================
CREATE TABLE public.ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  stock NUMERIC(10,3) NOT NULL DEFAULT 0 CHECK (stock >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ingredients_organization_id ON public.ingredients (organization_id);

-- products.uq_products_org_name-ის იგივე კონვენცია — ერთ org-ში ორი
-- ერთსახელიანი ინგრედიენტი არ უნდა შეიქმნას (case-insensitive).
CREATE UNIQUE INDEX uq_ingredients_org_name ON public.ingredients (organization_id, LOWER(name));

-- ==========================================
-- 2) recipe_items (M:N, product_id CASCADE / ingredient_id — არა, იხ. header)
-- ==========================================
CREATE TABLE public.recipe_items (
  product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id),
  quantity_required NUMERIC(10,3) NOT NULL CHECK (quantity_required > 0),
  PRIMARY KEY (product_id, ingredient_id)
);

CREATE INDEX idx_recipe_items_ingredient_id ON public.recipe_items (ingredient_id);

-- ==========================================
-- 3) products.is_recipe_based
-- ==========================================
ALTER TABLE public.products ADD COLUMN is_recipe_based BOOLEAN NOT NULL DEFAULT false;

-- ==========================================
-- 4) RLS — migration 021-ის იდენტური fail-open pattern
-- ==========================================

ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_ingredients ON public.ingredients
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

-- recipe_items-ს პირდაპირ organization_id არ აქვს — EXISTS-subquery
-- products-ზე (products.organization_id უკვე დაცულია migration 013-ის
-- RLS-ით, აქ იმავე ცხრილს ვეყრდნობით).
ALTER TABLE public.recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_items FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_recipe_items ON public.recipe_items
  FOR ALL
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = recipe_items.product_id
        AND p.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = recipe_items.product_id
        AND p.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

COMMIT;
