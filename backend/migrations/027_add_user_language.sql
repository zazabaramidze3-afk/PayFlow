-- ==========================================
-- Migration 027: users.language
-- ==========================================
-- Multi-language support (i18n) — STEP 1: per-user ენის setting
-- infrastructure (react-i18next-ით, frontend). ეს migration მხოლოდ
-- column-ს ამატებს — UI-ის თარგმნა (login გვერდი + sidebar) ცალკე,
-- ეტაპობრივი commit-ებით მიმდინარეობს.
--
-- რას აკეთებს:
--   `users.language` ('ka' | 'en') — user-ის ინდივიდუალური არჩევანი,
--   არა org-level (განსხვავებით `tip_distribution_mode`-ისგან,
--   migration 026) — ერთ org-ში სხვადასხვა user-ს შეიძლება სხვადასხვა
--   ენა ერჩიოს (მაგ. უცხოელი მენეჯერი + ქართველი მოლარე).
--
-- ⚠️ ნულოვანი გავლენა production-ზე: DEFAULT 'ka' ამჟამინდელ
-- production-ქცევას ემთხვევა (მთელი UI ამჟამად მხოლოდ ქართულადაა).
--
-- ⚠️ იდემპოტენტურობა: migration 009/013/017/019/026-ის კონვენციით.
-- ==========================================

BEGIN;

-- ==========================================
-- 0) იდემპოტენტურობის დაცვა
-- ==========================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'language'
  ) THEN
    RAISE EXCEPTION 'Migration 027 უკვე გატარებულია — users.language უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

-- ==========================================
-- 1) users.language
-- ==========================================
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'ka'
    CHECK (language IN ('ka', 'en'));

COMMIT;
