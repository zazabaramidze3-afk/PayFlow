-- ==========================================
-- Migration 011: Background Sync Engine & Conflict Resolution
-- ==========================================
-- Roadmap STEP 5 — POST /api/payments/sync-offline-ს (backend/src/routes/sales.ts)
-- სჭირდება ორი ცვლილება ბაზის სქემაში:
--
--   1) products.stock-ის უარყოფით მნიშვნელობაზე დაშვება. მიზეზი: ორი
--      Register-მა შეიძლება Offline რეჟიმში (ერთმანეთისგან დამოუკიდებლად,
--      ინტერნეტის გარეშე) იმავე პროდუქტზე ერთმანეთს გადააჭარბონ მარაგი
--      (მაგ. მარაგში 5 ცალია, ორივე სალარომ ოფლაინში 4-4 ცალი გაყიდა).
--      STEP 5-ის სპეციფიკაციით (PROGRESS - 12.08.2026.md) ეს ტრანზაქცია
--      მაინც უნდა გატარდეს (ფული უკვე რეალურად აღებულია მოლარის მიერ),
--      ამიტომ migration 001-ის chk_stock_positive CHECK (stock >= 0)
--      constraint, რომელიც ამ INSERT/UPDATE-ს პირდაპირ დაბლოკავდა,
--      მოიხსნება. ნაცვლად ცხადი DB-level ბადისა, ონლაინ checkout
--      (POST /api/payments, routes/sales.ts) კვლავ საკუთარი UPDATE ...
--      WHERE stock >= $1-ით იცავს თავს oversell-ისგან — ეს constraint
--      მხოლოდ Offline sync-ის კონკრეტულ, განზრახ გამონაკლის სცენარს
--      ხელს უშლიდა. ხელით (Products.tsx) დამატება/რედაქტირება/restock კვლავ
--      დაცულია app-level ვალიდაციით (იხ. backend/src/routes/products.ts).
--
--   2) payments.is_offline_sync — ბულეანი ალამი, რომელი ჩეკი შეიქმნა
--      Offline Checkout-ის (Roadmap STEP 4.2) შემდეგ, Background Sync
--      Worker-ის მიერ. DEFAULT false — ონლაინ checkout (POST /payments)
--      ამ სვეტს საერთოდ არ ეხება, ძველი ქცევა უცვლელია.
--
--   3) stock_deficit_notifications — ახალი ცხრილი. ყოველ offline ჩეკის
--      ხაზზე, სადაც სინქრონიზაციის მომენტისთვის მარაგი მოთხოვნილ
--      რაოდენობაზე ნაკლები აღმოჩნდა, ინახება ერთი ჩანაწერი — Manager
--      Dashboard-ის (ExecutiveDashboard.tsx) "გადაუჭარბებელი oversell"
--      პანელისთვის. is_resolved/resolved_by/resolved_at — მენეჯერს
--      შეუძლია მონიშნოს, რომ საკითხი განხილულია (მაგ. მარაგი ხელით
--      გადაასწორა), ისე რომ ისტორია არ დაიკარგოს (row არ იშლება).
-- ==========================================

BEGIN;

-- 1) chk_stock_positive-ის მოხსნა — IF EXISTS-ით უსაფრთხოა ხელახლა
-- გაშვებაზეც (migrate.ts-ის კონვენცია).
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS chk_stock_positive;

-- 2) payments.is_offline_sync
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS is_offline_sync BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_payments_is_offline_sync
  ON public.payments (is_offline_sync);

-- 3) stock_deficit_notifications
CREATE TABLE IF NOT EXISTS public.stock_deficit_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  -- 🆔 product_id INTEGER-ია (products.id-ის ტიპის შესაბამისად, migration
  -- 009-ის კომენტარი — products ცხრილს UUID მიგრაცია არ შეხებია).
  -- ON DELETE SET NULL — თუ პროდუქტი მოგვიანებით წაიშალა, ისტორიული
  -- ნოტიფიკაცია მაინც უნდა დარჩეს (product_name snapshot ქვემოთ).
  product_id INTEGER REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  register_id UUID REFERENCES public.registers(id),
  cashier_id UUID REFERENCES public.users(id),
  requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
  -- 📉 stock-ის მდგომარეობა ზუსტად decrement-ის წინ (შეიძლება უარყოფითიც
  -- იყოს, თუ ეს უკვე მეორე/მესამე თანმიმდევრული oversell-ია).
  available_quantity INTEGER NOT NULL,
  deficit_quantity INTEGER NOT NULL CHECK (deficit_quantity > 0),
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by UUID REFERENCES public.users(id),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_deficit_notifications_is_resolved
  ON public.stock_deficit_notifications (is_resolved);
CREATE INDEX IF NOT EXISTS idx_stock_deficit_notifications_payment_id
  ON public.stock_deficit_notifications (payment_id);

COMMIT;
