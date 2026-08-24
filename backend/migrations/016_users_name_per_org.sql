-- ==========================================
-- Migration 016: users.name — გლობალურიდან per-org unique
-- (Multi-Tenant SaaS, "24.08.2026"-ის სესია — STEP 7-ის წინაპირობა)
-- ==========================================
-- Roadmap: "🔒 გადაწყვეტილება — users.name uniqueness" სექცია
-- (`ROADMAP - Multi-Tenant SaaS - 23.08.2026.md`) — მანამდე users.name
-- განზრახ დარჩა გლობალურად unique (`users_name_key`, migration 001-იდან),
-- რადგან POST /login user-ს მხოლოდ username-ით პოულობდა, org-ის
-- კონტექსტის გარეშე (`LIMIT 1` ambiguity-ის რისკი).
--
-- ეს migration მხოლოდ იმ ცვლილების ნაწილია, სადაც login-ის query-საც
-- ემატება slug-ით ჯერ org-ის ცალსახა resolution, მერე user-ის ძებნა
-- იმ org-ის შიგნით (auth.ts, POST /login) — ორივე ცვლილება ერთად
-- deploy-დება, არასდროს ცალ-ცალკე.
--
-- რას აკეთებს:
--   1) `users_name_key` (global UNIQUE(name)) იშლება.
--   2) ახალი, per-org, case-insensitive unique index —
--      UNIQUE(organization_id, LOWER(name)) — products.name-ის
--      (migration 013) იგივე პატერნის მიხედვით, უბრალოდ
--      case-insensitive (login-ის `LOWER(u.name) = LOWER($1)`-ის
--      კონვენციასთან შესაბამისობაში — email-ის migration 014-ის
--      იგივე მიდგომა).
--
-- ⚠️ იდემპოტენტურობა: migration 009/013/014-ის კონვენციით.
-- ==========================================

BEGIN;

-- ==========================================
-- 0) იდემპოტენტურობის დაცვა
-- ==========================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'users' AND indexname = 'uq_users_org_name'
  ) THEN
    RAISE EXCEPTION 'Migration 016 უკვე გატარებულია — uq_users_org_name უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

-- ==========================================
-- 1) users.name — გლობალური UNIQUE → per-org, case-insensitive UNIQUE
-- ==========================================
-- ⚠️ constraint-ის ორიგინალი სახელი (users_name_key) Postgres-ის
-- ავტომატური სახელდებაა `UNIQUE` column-constraint-იდან (migration 001)
-- — DROP CONSTRAINT IF EXISTS უსაფრთხოა, migration 013-ის products.name
-- ცვლილების იგივე კონვენციით.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_org_name ON public.users (organization_id, LOWER(name));

COMMIT;
