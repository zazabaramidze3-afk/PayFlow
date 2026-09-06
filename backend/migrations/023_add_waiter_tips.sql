-- ==========================================
-- Migration 023: STEP 4 (ჩეკის გაყოფა + მიმტანის როლი/tips) — საფუძველი
-- ==========================================
-- Roadmap: `ROADMAP - HoReCa Module - 03.09.2026.md`, STEP 4.
-- (მოდიფაიერების — STEP 3.1, migration 021 — და BOM-ის — STEP 3.2,
-- migration 022 — იგივე idempotency/RLS pattern.)
--
-- გადაწყვეტილებები (Cowork session, 05.09.2026, AskUserQuestion-ით
-- დადასტურებული):
--   1) Tips — მთლიანად ერთ waiter-ს ერგება (არა pooled).
--   2) Item-ის void-ის ავტორიზაცია უცვლელი რჩება (cashier/waiter თავად,
--      manager PIN override არ ემატება).
--   3) Waiter-ის ორდერების scope — მხოლოდ საკუთარი (`opened_by`).
--   4) `payments.waiter_id` checkout-ზე ავტომატურად ვინც იხდის.
--
-- რას აკეთებს ეს migration:
--   1) `payments`-ს ემატება სამი ახალი, NULLABLE/DEFAULT სვეტი:
--      - `waiter_id UUID REFERENCES users(id)` — ვინც მაგიდას ემსახურებოდა
--        (Retail checkout-ზე ყოველთვის NULL, ნულოვანი გავლენა).
--      - `tip_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (>= 0)`.
--      - `order_id UUID REFERENCES orders(id)` — ერთი ორდერი, რამდენიმე
--        payments row (ჩეკის გაყოფის საფუძველი). `orders.closed_payment_id`
--        (migration 019) მარტოხელა checkout-ისთვის საკმარისი იყო
--        (ერთი-ერთზე), მაგრამ split-ისთვის საპირისპირო მიმართულების,
--        1:N ბმულიც სჭირდება.
--   2) `'waiter'` როლისთვის DB migration არ სჭირდება — `users.role`
--      (migration 001) plain TEXT-ია, CHECK constraint-ის გარეშე.
--
-- ⚠️ ნულოვანი გავლენა არსებულ checkout-ზე: სამივე ახალი სვეტი
-- NULLABLE/DEFAULT-იანია, არაფერი არსებული query არ ირღვევა.
-- ==========================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'waiter_id'
  ) THEN
    RAISE EXCEPTION 'Migration 023 უკვე გატარებულია — payments.waiter_id უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

ALTER TABLE public.payments
  ADD COLUMN waiter_id UUID REFERENCES public.users(id),
  ADD COLUMN tip_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (tip_amount >= 0),
  ADD COLUMN order_id UUID REFERENCES public.orders(id);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON public.payments (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_waiter_id ON public.payments (waiter_id);

COMMIT;
