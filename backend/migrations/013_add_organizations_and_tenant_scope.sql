-- ==========================================
-- Migration 013: Organizations & Tenant Scope (Multi-Tenant SaaS STEP 1)
-- ==========================================
-- Roadmap: `ROADMAP - Multi-Tenant SaaS - 14.08.2026.md`, STEP 1 (Tenant
-- Data Model & Migration) + `ROADMAP - Multi-Tenant SaaS - 19.08.2026.md`
-- (Priority Queue პუნქტი 5). ეს არის STEP 0 (Sentry/CORS/security
-- hardening) და STEP 2.3-ის (isolation ტესტების ჩონჩხი,
-- backend/tests/isolation/) შემდეგი ეტაპი.
--
-- რას აკეთებს:
--   1) ახალი `organizations` ცხრილი.
--   2) ერთი "default" org row — არსებული, უკვე production-ში მყოფი
--      ბიზნესის წარმომადგენელი (ნულოვანი downtime backfill target).
--   3) `organization_id` (UUID, FK → organizations.id) ემატება ყველა
--      "გლობალურ" ცხრილს: users, registers, shifts, payments, products,
--      audit_logs, stock_deficit_notifications, shift_amendments — და
--      ბექფილავს არსებულ row-ებს ამ default org-ის id-ით.
--      (payment_items/payment_splits განზრახ გამოტოვებულია — roadmap-ის
--      მიხედვით ისინი არაპირდაპირ, payment_id-ის FK-ით არიან დაცული,
--      სანამ ყოველი query payments-ზე join-ავს — STEP 2-ის route-review
--      ამას ცალსახად უნდა შეინარჩუნოს.)
--   4) `products.barcode`/`products.name` — გლობალური UNIQUE-დან
--      (organization_id, barcode)/(organization_id, name)-ზე, რომ ორ
--      სხვადასხვა ბიზნესს ერთი და იგივე ბარკოდი/სახელი შეეძლოს.
--
-- ⚠️ განზრახ გამონაკლისი — `activation_codes.organization_id` NULLABLE-ად
-- რჩება (არა NOT NULL, დანარჩენი 8 ცხრილისგან განსხვავებით): migration
-- 010-ის დოკუმენტირებული flow-ის მიხედვით POST /api/registers/generate-code
-- გამოიძახება *ავტორიზაციის გარეშე* (ახალი, jერ დაუკავშირებელი მოწყობილობა
-- — org-ის JWT context ჯერ არ არსებობს request-ის დროს). NOT NULL რომ
-- დაგვედო, STEP 2-ის ეს ენდპოინტი ვერასდროს შეძლებდა ახალი 'pending'
-- row-ის ჩაწერას. ისტორიული (უკვე დადასტურებული) row-ები მაინც ბექფილავს
-- default org-ით — მხოლოდ *ახალი*, jერ დაუდასტურებელი კოდები დარჩება
-- საწყისად NULL org-ით, სანამ STEP 2 არ გადაწყვეტს ზუსტად როდის/როგორ
-- უნდა მიენიჭოთ org (სავარაუდოდ pairing-ის დადასტურების მომენტში,
-- register_id-ის მსგავსად — ეს route-level დიზაინის გადაწყვეტილებაა,
-- არა ამ migration-ის ფარგლები).
--
-- ⚠️ იდემპოტენტურობა: migration 009-ის კონვენციის მიხედვით, პირველივე
-- ნაბიჯზე ცალსახად ვამოწმებთ უკვე გატარებულია თუ არა — თუ კი,
-- RAISE EXCEPTION-ით მთელი ტრანზაქცია უსაფრთხოდ ROLLBACK-დება (და
-- migrate.ts-ის კონვენციით ეს "მოსალოდნელი" შეცდომაა მეორედ გაშვებაზე,
-- დანარჩენ ფაილებს არ აჩერებს).
--
-- 🧪 ეს migration ჯერ Neon Database Branch-ზე უნდა გაეშვას და
-- backend/tests/isolation/tenant-isolation.test.ts-ის
-- "Cross-tenant data isolation" ბლოკით დადასტურდეს, სანამ production-ს
-- შეეხება (Roadmap "16.08.2026", ცვლილება #2).
-- ==========================================

BEGIN;

-- ==========================================
-- 0) იდემპოტენტურობის დაცვა
-- ==========================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'organizations'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'organization_id'
  ) THEN
    RAISE EXCEPTION 'Migration 013 უკვე გატარებულია — organizations ცხრილი და users.organization_id უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

-- ==========================================
-- 1) ORGANIZATIONS — root ცხრილი ტენანტებისთვის
-- ==========================================
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  -- subdomain/URL-ისთვის (Roadmap STEP 7 — custom subdomain per tenant).
  -- ჯერჯერობით მხოლოდ უნიკალური იდენტიფიკატორია, routing არ არსებობს.
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('trial', 'active', 'suspended', 'cancelled')),
  -- TEXT ჯერჯერობით (არა FK ცალკე `plans`-ცხრილზე) — Roadmap STEP 1.1-ის
  -- ცალსახა დათქმა ("plan (FK მომავალი plans-ზე ან უბრალო TEXT ჯერჯერობით)").
  plan TEXT NOT NULL DEFAULT 'default',
  trial_ends_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_slug ON public.organizations (slug);

-- ==========================================
-- 2) DEFAULT ORGANIZATION — backfill-ის სამიზნე (არსებული production
--    ბიზნესი). სახელი/slug დროებითია — pgAdmin-იდან ხელით
--    განახლებადია (UPDATE organizations SET name = ..., slug = ...
--    WHERE slug = 'default'), production-ის რეალურ ბიზნეს-სახელზე,
--    STEP 1-ის merge-ის შემდეგ.
-- ==========================================
INSERT INTO public.organizations (name, slug, status)
SELECT 'PayFlow — Default Organization', 'default', 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.organizations);

-- ==========================================
-- 3) organization_id — 8 "გლობალურ" ცხრილზე (NOT NULL, ბექფილილი)
-- ==========================================

-- --- users ---------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
UPDATE public.users SET organization_id = (SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1)
  WHERE organization_id IS NULL;
ALTER TABLE public.users ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_organization_id ON public.users (organization_id);

-- --- registers -------------------------------------------------------------
ALTER TABLE public.registers
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
UPDATE public.registers SET organization_id = (SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1)
  WHERE organization_id IS NULL;
ALTER TABLE public.registers ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_registers_organization_id ON public.registers (organization_id);

-- --- shifts ----------------------------------------------------------------
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
UPDATE public.shifts SET organization_id = (SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1)
  WHERE organization_id IS NULL;
ALTER TABLE public.shifts ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shifts_organization_id ON public.shifts (organization_id);

-- --- payments ----------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
UPDATE public.payments SET organization_id = (SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1)
  WHERE organization_id IS NULL;
ALTER TABLE public.payments ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_organization_id ON public.payments (organization_id);

-- --- products ----------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
UPDATE public.products SET organization_id = (SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1)
  WHERE organization_id IS NULL;
ALTER TABLE public.products ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_organization_id ON public.products (organization_id);

-- --- audit_logs ----------------------------------------------------------------
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
UPDATE public.audit_logs SET organization_id = (SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1)
  WHERE organization_id IS NULL;
ALTER TABLE public.audit_logs ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_organization_id ON public.audit_logs (organization_id);

-- --- stock_deficit_notifications ---------------------------------------------
ALTER TABLE public.stock_deficit_notifications
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
UPDATE public.stock_deficit_notifications SET organization_id = (SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1)
  WHERE organization_id IS NULL;
ALTER TABLE public.stock_deficit_notifications ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_deficit_notifications_organization_id ON public.stock_deficit_notifications (organization_id);

-- --- shift_amendments ----------------------------------------------------------
ALTER TABLE public.shift_amendments
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
UPDATE public.shift_amendments SET organization_id = (SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1)
  WHERE organization_id IS NULL;
ALTER TABLE public.shift_amendments ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shift_amendments_organization_id ON public.shift_amendments (organization_id);

-- --- activation_codes (NULLABLE — იხ. ფაილის თავსართის ახსნა) -------------------
ALTER TABLE public.activation_codes
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);
-- მხოლოდ ისტორიული (უკვე არსებული) row-ები ბექფილავს — ახალი row-ები
-- STEP 2-მდე კვლავ NULL-ით შეიქმნება (route-ს ჯერ არ სჭირდება).
UPDATE public.activation_codes SET organization_id = (SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1)
  WHERE organization_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_activation_codes_organization_id ON public.activation_codes (organization_id);

-- ==========================================
-- 4) products — გლობალური UNIQUE(barcode)/UNIQUE(name) → per-org
-- ==========================================
-- ⚠️ constraint-ების ორიგინალი სახელები (products_barcode_key/
-- products_name_key) Postgres-ის ავტომატური სახელდებაა `UNIQUE`
-- column-constraint-იდან (migration 001). DROP CONSTRAINT IF EXISTS
-- უსაფრთხოა, თუნდაც სახელი გარემოში ოდნავ სხვანაირად აღმოჩნდეს
-- დაფიქსირებული — ამ შემთხვევაში ქვემოთა ADD CONSTRAINT მაინც
-- "constraint already exists"-ს გამოიტანდა, რაც migrate.ts-ის
-- კონვენციის მიხედვით (002/008-ის ანალოგიით) მოსალოდნელია მეორედ
-- გაშვებაზე.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_barcode_key;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_name_key;

-- NULL barcode კვლავ დაშვებულია (products.barcode NOT NULL არასდროს
-- ყოფილა) — Postgres-ის UNIQUE constraint-ი NULL-ებს ერთმანეთისგან
-- განსხვავებულად თვლის, ამიტომ ერთ org-ში მრავალი NULL-ბარკოდიანი
-- პროდუქტი კვლავ დაშვებულია, ისევე როგორც აქამდე გლობალურ დონეზე იყო.
ALTER TABLE public.products
  ADD CONSTRAINT uq_products_org_barcode UNIQUE (organization_id, barcode);
ALTER TABLE public.products
  ADD CONSTRAINT uq_products_org_name UNIQUE (organization_id, name);

COMMIT;
