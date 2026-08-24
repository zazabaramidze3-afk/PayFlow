-- ==========================================
-- Migration 017: Row-Level Security — PILOT (sales.ts), 24.08.2026
-- ==========================================
-- Roadmap: "🔒 RLS Pilot — sales.ts" სექცია, "STEP 2.2 (RLS)" (item #9,
-- roadmap-ის "განახლებული პრიორიტეტების რიგი"-ში ღიად მონიშნული,
-- defense-in-depth შრედ route-level `WHERE organization_id`-ის თავზე).
--
-- ამ მიგრაციამდე org-იზოლაცია მთლიანად route-level `WHERE organization_id
-- = $1`-ზეა დამოკიდებული — ერთი დავიწყებული WHERE საკმარისია მონაცემების
-- გაჟონვისთვის. RLS დამატებით, DB-level "safety net"-ს ამატებს: თუნდაც
-- route-ის query-ში შეცდომა იყოს, თავად Postgres აღარ დაუშვებს სხვა
-- org-ის row-ების დაბრუნებას/შეცვლას.
--
-- ⚠️ ᲛᲜᲘᲨᲕᲜᲔᲚᲝᲕᲐᲜᲘ — fail-open escape hatch (განზრახ, დროებითი):
-- ყველა policy-ს აქვს `current_setting('app.current_org_id', true) IS
-- NULL OR ...` პირობა. ეს ნიშნავს, რომ RLS **მხოლოდ** იმ connection-ებზე
-- ამოქმედდება, სადაც app-ის კოდმა ცხადად დააყენა `app.current_org_id`
-- (ახლა მხოლოდ `backend/src/routes/sales.ts`, `withOrgContext()`
-- helper-ის საშუალებით, `backend/src/db.ts`). ეს ცხრილები (users,
-- products, payments და სხვ.) კვლავ გამოიყენება სხვა route-ებშიც
-- (auth.ts, products.ts, registers.ts, dashboard.ts, notifications.ts,
-- platformAdmin.ts, organizations.ts) — ისინი ჯერ არ არიან გადასული
-- `withOrgContext`-ზე, ანუ მათ connection-ებზე `app.current_org_id`
-- დაყენებული არასდროს იქნება. Fail-closed policy production-ს მყისიერად
-- დაამტვრევდა ამ ყველა route-ისთვის migration-ის გატარებისთანავე.
-- fail-open დიზაინი საშუალებას იძლევა RLS ეტაპობრივად, route-route-ზე
-- ჩაირთოს უსაფრთხოდ. **TODO (მომავალი ფაზა):** ყველა route-ის
-- `withOrgContext`-ზე გადასვლის შემდეგ, ცალკე მიგრაციით მოსაშორებელია
-- ეს "IS NULL OR" ნაწილი policy-ებიდან — fail-closed-ის სასარგებლოდ.
--
-- ⚠️ FORCE ROW LEVEL SECURITY — საჭიროა, რადგან `DATABASE_URL`-ის
-- connection role დიდი ალბათობით ამ ცხრილების owner-ია (migration-ები
-- ამავე role-ით შესრულდა) — უბრალო `ENABLE ROW LEVEL SECURITY`-ს
-- **არანაირი ეფექტი არ ექნებოდა** table owner-ის query-ებზე (Postgres-ის
-- default: owner ავტომატურად უვლის RLS-ს გვერდი). `FORCE`-ს არ აქვს
-- უარყოფითი გვერდითი ეფექტი non-owner role-ისთვისაც (მათზე ისედაც
-- სრულად მოქმედებს ENABLE), ამიტომ უსაფრთხო, უნივერსალური არჩევანია.
--
-- 🏢 scope — მხოლოდ ის ცხრილები, რასაც `sales.ts` პირდაპირ ეხება:
-- users, products, shifts, payments, payment_items, payment_splits,
-- shift_amendments, stock_deficit_notifications. `audit_logs`
-- **განზრახ გამორიცხულია** ამ ეტაპზე — `writeAuditLog()` (auth.ts)
-- კვლავ პირდაპირ `db.query`-ს იყენებს, კონტექსტის დაყენების გარეშე.
--
-- ⚠️ იდემპოტენტურობა: migration 009/013/014/016-ის კონვენციით.
-- ==========================================

BEGIN;

-- ==========================================
-- 0) იდემპოტენტურობის დაცვა
-- ==========================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payments' AND policyname = 'org_isolation_payments'
  ) THEN
    RAISE EXCEPTION 'Migration 017 უკვე გატარებულია — org_isolation_payments policy უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

-- ==========================================
-- 1) პირდაპირ organization_id სვეტის მქონე ცხრილები
-- ==========================================
-- 🧩 helper-ის მსგავსი, ხელით გამეორებული policy თითოეულ ცხრილზე
-- (Postgres-ს არ აქვს policy-template/loop-სინტაქსი DDL-ის დონეზე).

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_users ON public.users
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

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_products ON public.products
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

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_shifts ON public.shifts
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

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_payments ON public.payments
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

ALTER TABLE public.shift_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_amendments FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_shift_amendments ON public.shift_amendments
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

ALTER TABLE public.stock_deficit_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_deficit_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_stock_deficit_notifications ON public.stock_deficit_notifications
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

-- ==========================================
-- 2) child ცხრილები (payment_items, payment_splits) — organization_id
--    პირდაპირ არ აქვთ, `payment_id` FK-ით მიბმულია `payments.id`-ზე
--    (migration 009). policy-ს EXISTS-subquery სჭირდება.
-- ==========================================

ALTER TABLE public.payment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_items FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_payment_items ON public.payment_items
  FOR ALL
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_items.payment_id
        AND p.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_items.payment_id
        AND p.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

ALTER TABLE public.payment_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_splits FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_payment_splits ON public.payment_splits
  FOR ALL
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_splits.payment_id
        AND p.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  )
  WITH CHECK (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_splits.payment_id
        AND p.organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );

COMMIT;
