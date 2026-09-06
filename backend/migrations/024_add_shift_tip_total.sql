-- ==========================================
-- Migration 024: Z-Report-ში ჯამური tip-ის ჩვენება
-- ==========================================
-- Roadmap: `ROADMAP - HoReCa Module - 03.09.2026.md`, STEP 4 (მიმტანის tips).
-- Migration 023-ით `payments.tip_amount` უკვე ინახება, მაგრამ ცვლის
-- დახურვის Z-Report-ში (PUT /shifts/close) არსად აჯამებდა — მოლარეს/
-- მენეჯერს არ ჰქონდა გზა, ცვლის ბოლოს ერთი შეხედვით დაენახა, რამდენი
-- tip შეგროვდა (reconciliation/payroll-ისთვის საჭირო).
--
-- რას აკეთებს:
--   `shifts`-ს ემატება `tip_total NUMERIC(10,2) NOT NULL DEFAULT 0`,
--   `card_total`/`receipt_count`-ის იგივე პატერნით — ცვლის დახურვისას
--   (და late-close ამენდმენტისას) გამოთვლილი ჯამური tip ინახება, რომ
--   Z-Report-ის ხელახლა ჩვენება/ბეჭდვა ისტორიულადაც სწორი დარჩეს.
--
-- ⚠️ ნულოვანი გავლენა არსებულ query-ებზე: სვეტი NOT NULL DEFAULT 0-ია,
-- არსებული shifts row-ები 0-ით ივსება ავტომატურად.
-- ==========================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shifts' AND column_name = 'tip_total'
  ) THEN
    RAISE EXCEPTION 'Migration 024 უკვე გატარებულია — shifts.tip_total უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

ALTER TABLE public.shifts
  ADD COLUMN tip_total NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (tip_total >= 0);

COMMIT;
