-- ==========================================
-- Migration 006: Void Receipt & Clear Cart Permissions
-- ==========================================
-- ემატება public.users-ს ორი ახალი BOOLEAN სვეტი — can_view_history/
-- can_use_discount-ის ზუსტი ანალოგიით:
--   • can_void_receipt — უფლება, გააუქმოს უკვე გატარებული ჩეკი
--     (POST /api/payments/:id/void). Roadmap ეტაპი 4.
--   • can_clear_cart    — უფლება, გაასუფთაოს აქტიური კალათა/წაშალოს
--     უკვე დამატებული პროდუქტი POS ეკრანზე. Roadmap ეტაპი 5.
--
-- DEFAULT false (განსხვავებით can_view_history/can_use_discount-ის
-- DEFAULT true-სგან) — ორივე მოქმედება დესტრუქციულია (მარაგის
-- დაბრუნება/კალათის დაკარგვა), ამიტომ ცალსახად unsafe-by-default:
-- ახალ და უკვე არსებულ მოლარეებს ეს უფლება გამორთული ექნებათ, სანამ
-- ADMIN/MANAGER პირდაპირ არ ჩართავს Users Control პანელიდან.
--
-- უფლების არქონისას მოლარეს მაინც შეუძლია მოქმედება Manager PIN
-- Override-ით (იხ. middleware/managerOverride.ts) — იგივე მექანიზმი,
-- რაც can_use_discount-ს იცავს POST /api/payments-ზე.
--
-- IF NOT EXISTS-ის წყალობით უსაფრთხოა გაშვება მაშინაც, თუ ეს
-- სვეტები უკვე დამატებულია.
-- ==========================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_void_receipt BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_clear_cart BOOLEAN NOT NULL DEFAULT false;

COMMIT;
