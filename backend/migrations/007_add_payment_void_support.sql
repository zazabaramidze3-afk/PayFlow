-- ==========================================
-- Migration 007: Payment Void Support
-- ==========================================
-- Roadmap ეტაპი 4 (Void Receipt) — POST /api/payments/:id/void-ს სჭირდება
-- სად "აღნიშნოს" გაუქმებული ჩეკი. 006-ში დამატებული users.can_void_receipt
-- მხოლოდ უფლებაა, ფაქტობრივი გაუქმების მდგომარეობა კი payments ცხრილშივე
-- უნდა ინახებოდეს — ისე, რომ:
--   • ერთი ჩეკი ორჯერ ვერ გაუქმდეს (ვამოწმებთ is_voided-ს ენდპოინტში),
--   • დარჩეს კვალი, ვინ და როდის გააუქმა (voided_by/voided_at).
--
-- is_voided BOOLEAN NOT NULL DEFAULT false — ძველი ჩანაწერები ავტომატურად
-- "აქტიურად" ითვლება, არაფერი გატყდება.
-- voided_at TEXT — created_at-ის იგივე TO_CHAR('YYYY-MM-DD HH24:MI:SS')
-- ფორმატის კონვენციით (ამ პროექტში თარიღები TEXT-ადაა ნახმარი, timestamptz
-- არსად გვხვდება — ვინარჩუნებთ თანმიმდევრულობას).
-- voided_by INTEGER REFERENCES users(id) — რომელმა მოლარემ/მენეჯერმა
-- ჩაატარა ფაქტობრივი გაუქმების მოქმედება (override-ის შემთხვევაშიც ეს
-- მოლარეა, არა მენეჯერი — მენეჯერის ID ცალკე აუდიტ-ლოგშია, იხ. sales.ts).
--
-- IF NOT EXISTS-ის წყალობით უსაფრთხოა გაშვება მაშინაც, თუ ეს
-- სვეტები უკვე დამატებულია.
-- ==========================================

BEGIN;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS is_voided BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at TEXT,
  ADD COLUMN IF NOT EXISTS voided_by INTEGER REFERENCES public.users(id);

COMMIT;
