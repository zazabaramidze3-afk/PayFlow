-- ==========================================
-- Migration 018: Row-Level Security — registers + activation_codes, 30.08.2026
-- ==========================================
-- Roadmap: "STEP 2.2 RLS Full Rollout" checklist-ის ბოლო ღია item —
-- "migration 018 — RLS registers + activation_codes-ზე" (იხ. "ROADMAP -
-- Multi-Tenant SaaS - 28.08.2026.md", სესია #2 დამატება). Migration
-- 017-მა (RLS Pilot) განზრახ გამოტოვა ეს ორი ცხრილი — registers.ts ჯერ
-- არ იყო `withOrgContext`-ზე გადასული, ანუ policy-ს fail-open escape
-- hatch-იც კი ვერაფერს შველოდა, თუ `withOrgContext` context არასდროს
-- დაყენდებოდა ამ ცხრილებზე. ეს მიგრაცია მხოლოდ DDL-ს (policy-ებს)
-- ამატებს — `backend/src/routes/registers.ts`-ის route-ების ცალკე,
-- ამავე commit/PR-ის ფარგლებში, `withOrgContext`-ზე გადაყვანა ხდება.
--
-- ⚠️ FORCE ROW LEVEL SECURITY — იგივე მიზეზით, რაც migration 017-ში
-- (connection role table owner-ია, უბრალო ENABLE-ს ეფექტი არ ექნებოდა).
--
-- 🏢 scope — ორი ცხრილი:
--   1) registers — organization_id NOT NULL (migration 013). ჩვეულებრივი
--      policy, migration 017-ის users/products/payments-ის იდენტური
--      pattern-ით.
--   2) activation_codes — organization_id NULLABLE (**განზრახ**, migration
--      013-ის დოკუმენტირებული მიზეზით: POST /registers/generate-code
--      გამოიძახება ავტორიზაციის გარეშე, org-კონტექსტის გარეშე — ახალი
--      'pending' კოდები NULL org-ით იქმნება და ასეთადვე რჩება მთელი
--      ცხოვრების ციკლის განმავლობაში, POST /registers/pair-იც არ წერს
--      მასზე organization_id-ს). ამიტომ ამ ცხრილის policy-ს
--      **დამატებითი** `OR organization_id IS NULL` პირობა სჭირდება
--      (fail-open ორ დონეზე ერთდროულად — სესიის დონეზე, თუ context
--      საერთოდ არ დაყენებულა, და row-ის დონეზე, თუ თავად row-ს არა
--      აქვს org). ამის გარეშე, migration 017-ის pilot pattern-ის
--      პირდაპირი კოპირება ამ ცხრილზე დაბლოკავდა ყველა აქტიურ
--      registration/pairing flow-ს, რადგან ფაქტობრივად ყველა row
--      NULL org-ითაა.
--
-- ⚠️ იდემპოტენტურობა: migration 009/013/014/016/017-ის კონვენციით.
-- ==========================================

BEGIN;

-- ==========================================
-- 0) იდემპოტენტურობის დაცვა
-- ==========================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'registers' AND policyname = 'org_isolation_registers'
  ) THEN
    RAISE EXCEPTION 'Migration 018 უკვე გატარებულია — org_isolation_registers policy უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

-- ==========================================
-- 1) registers — organization_id NOT NULL, migration 017-ის იდენტური pattern
-- ==========================================
ALTER TABLE public.registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registers FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_registers ON public.registers
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
-- 2) activation_codes — organization_id NULLABLE (განზრახ, იხ. თავსართი) —
--    დამატებითი `organization_id IS NULL` escape ორივე (USING/WITH CHECK) მხარეს.
-- ==========================================
ALTER TABLE public.activation_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activation_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_activation_codes ON public.activation_codes
  FOR ALL
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR organization_id IS NULL
    OR organization_id = current_setting('app.current_org_id', true)::uuid
  )
  WITH CHECK (
    current_setting('app.current_org_id', true) IS NULL
    OR current_setting('app.current_org_id', true) = ''
    OR organization_id IS NULL
    OR organization_id = current_setting('app.current_org_id', true)::uuid
  );

COMMIT;
