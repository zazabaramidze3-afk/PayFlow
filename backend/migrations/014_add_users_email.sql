-- ==========================================
-- Migration 014: users.email (Multi-Tenant SaaS STEP 3 — Company Self-Registration)
-- ==========================================
-- Roadmap: `ROADMAP - Multi-Tenant SaaS - 23.08.2026.md`, STEP 2-ის
-- დასრულების შემდეგ გადაწყვეტილი "SaaS vs Multi-Store" შეკითხვის SaaS
-- მიმართულება — ახალი კომპანიების self-service რეგისტრაცია
-- (POST /api/organizations/register) მოითხოვს ადმინის email-ს.
--
-- რას აკეთებს:
--   1) `users.email` — TEXT, NULLABLE (არსებულ user-ებს email არასდროს
--      ჰქონიათ — NOT NULL ამ ეტაპზე ვერ დაისმება ისტორიული row-ების
--      backfill-ის გარეშე, რომელიც შეუძლებელია, რადგან ნამდვილი email
--      არსად არსებობს ამ user-ებისთვის).
--   2) უნიკალურობა — **მთელი პლატფორმის მასშტაბით** (არა per-org),
--      მომხმარებლის გადაწყვეტილებით: ერთი ადამიანის email ერთხელ
--      მხოლოდ ერთ org-ში შეიძლება იყოს ადმინის ანგარიშის საიდენტიფიკაციო
--      email-ად რეგისტრირებული — მარტივი password-recovery/ორგანიზაციის
--      იდენტიფიკაციის მოდელისთვის. Partial unique index (`WHERE email IS
--      NOT NULL`) — NULL-ები (ძველი, email-ის გარეშე user-ები) ერთმანეთს
--      არ ეჯახება, PostgreSQL-ის სტანდარტული NULL-uniqueness ქცევის
--      მიხედვითაც ეს ასეც იქნებოდა, მაგრამ აქ ცალსახად, `LOWER(email)`-ით
--      (login-ის `LOWER(name)`-ის იგივე კონვენცია — case-insensitive).
--
-- ⚠️ იდემპოტენტურობა: migration 009/013-ის კონვენციით.
-- ==========================================

BEGIN;

-- ==========================================
-- 0) იდემპოტენტურობის დაცვა
-- ==========================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email'
  ) THEN
    RAISE EXCEPTION 'Migration 014 უკვე გატარებულია — users.email უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

-- ==========================================
-- 1) users.email — nullable, პლატფორმა-მასშტაბით უნიკალური (NULL-ების გარეშე)
-- ==========================================
ALTER TABLE public.users ADD COLUMN email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email ON public.users (LOWER(email)) WHERE email IS NOT NULL;

COMMIT;
