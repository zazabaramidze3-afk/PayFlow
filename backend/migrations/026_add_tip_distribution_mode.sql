-- ==========================================
-- Migration 026: organizations.tip_distribution_mode
-- ==========================================
-- Roadmap: `ROADMAP - HoReCa Open Items - 06.09.2026.md`, #3 (Tips-ის
-- განაწილება). ეს არის მხოლოდ "setting-infrastructure" ეტაპი — ნამდვილი
-- pooled-განაწილების ალგორითმი (shift-close-ზე tip_total-ის დაყოფა
-- აქტიურ waiter-ებზე) ცალკე, მომავალი ეტაპის ამოცანაა.
--
-- რას აკეთებს:
--   `organizations.tip_distribution_mode` ('individual' | 'pooled') —
--   Multi-Tenant SaaS პრინციპის დაცვით (თითოეულ org-ს თავისი მოდელი,
--   არა პლატფორმის დონეზე hardcoded გადაწყვეტილება — იგივე pattern,
--   რაც `business_type`-ს აქვს, migration 019).
--
-- ⚠️ ნულოვანი გავლენა production-ზე: DEFAULT 'individual' ზუსტად
-- ამჟამინდელ production-ქცევას ემთხვევა (checkout-ზე მთელი tip იმ
-- waiter-ს ეკუთვნის, ვინც checkout გაატარა — `sales.ts`-ის
-- `waiter_id = req.user?.id`). ეს migration checkout-ის ლოგიკას არ
-- ცვლის — მხოლოდ column-ს ამატებს, რომელსაც მომავალი ეტაპი წაიკითხავს.
--
-- ⚠️ იდემპოტენტურობა: migration 009/013/017/019-ის კონვენციით.
-- ==========================================

BEGIN;

-- ==========================================
-- 0) იდემპოტენტურობის დაცვა
-- ==========================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'tip_distribution_mode'
  ) THEN
    RAISE EXCEPTION 'Migration 026 უკვე გატარებულია — organizations.tip_distribution_mode უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

-- ==========================================
-- 1) organizations.tip_distribution_mode
-- ==========================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS tip_distribution_mode TEXT NOT NULL DEFAULT 'individual'
    CHECK (tip_distribution_mode IN ('individual', 'pooled'));

COMMIT;
