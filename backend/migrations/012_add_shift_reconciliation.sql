-- ==========================================
-- Migration 012: Shift Reconciliation (Z-Report Late-Sync Amendment)
-- ==========================================
-- Roadmap-ის მიღმა (PROGRESS - 12.08.2026.md-ის "ცნობილი, დაუხურავი
-- საკითხი"): თუ მოლარემ ცვლა უკვე დახურა online-ზე დაბრუნებისა და
-- სინქრონიზაციის დასრულებას შორის მონაკვეთში, POST /api/payments/sync-offline
-- (backend/src/routes/sales.ts, syncSingleOfflineReceipt) ამ ჩეკს მაინც
-- ჩაწერს ამ (უკვე დახურულ) shift_id-ზე — ფინანსური სიზუსტისთვის (ფული
-- რეალურად ამ ცვლაზე იქნა აღებული). აქამდე ეს ნიშნავდა, რომ ცვლის
-- დახურვისას დაბეჭდილი Z-Report (shifts.end_amount_expected/difference)
-- საბოლოოდ არაზუსტი რჩებოდა — არავინ იტყობინებოდა.
--
-- ეს მიგრაცია არჩევანს აკეთებს "server-side ბლოკირების" (ტექნიკურად
-- შეუძლებელია — ბექენდს არ სწვდება კლიენტის IndexedDB-ის queue) ნაცვლად
-- "post-hoc reconciliation"-ზე: როცა დაგვიანებული ჩეკი უკვე დახურულ
-- ცვლას სინქრონდება, shifts.end_amount_expected/difference ავტომატურად
-- ხელახლა გამოითვლება (payments.end_amount_actual — მოლარის მიერ ფიზიკურად
-- დათვლილი თანხა — უცვლელი რჩება, მხოლოდ "მოსალოდნელი" ნაწილი
-- განახლდება), ორიგინალური (პირველად დაბეჭდილი) მნიშვნელობები
-- ინახება original_*-ში შედარებისთვის, და მენეჯერს ჩნდება Manager
-- Dashboard-ის ნოტიფიკაცია — იგივე Stock Deficit-ის პატერნის (migration
-- 011) მიხედვით — რომ იცოდეს, კონკრეტული ცვლის Z-Report ხელახლა უნდა
-- დაიბეჭდოს.
-- ==========================================

BEGIN;

-- 1) shifts — reconciliation-ის თვალთვალის ველები.
--    receipt_count/card_total აქამდე მხოლოდ PUT /shifts/close-ის
--    response-ში ითვლებოდა და არსად ინახებოდა — ახლა შენახულია, რომ
--    history/reprint-ს ცალკე recompute არ დასჭირდეს.
--    TEXT last_amended_at — shifts.opened_at/closed_at-ის იგივე
--    ლექსიკოგრაფიული 'YYYY-MM-DD HH24:MI:SS' კონვენცია (ORDER BY-ის
--    STEP 5-ის UUID-ბაგის ფიქსის სულისკვეთებით), არა TIMESTAMP ტიპი.
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS receipt_count INTEGER,
  ADD COLUMN IF NOT EXISTS card_total REAL,
  ADD COLUMN IF NOT EXISTS is_amended BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_amended_at TEXT,
  ADD COLUMN IF NOT EXISTS original_end_amount_expected REAL,
  ADD COLUMN IF NOT EXISTS original_difference REAL;

-- 2) shift_amendments — ერთი ჩანაწერი ყოველ დაგვიანებულ სინქზე, რომელმაც
--    უკვე დახურული ცვლის თანხები შეცვალა. Migration 011-ის
--    stock_deficit_notifications-ის ზუსტი პატერნი: row არ იშლება
--    (ისტორია), is_resolved/resolved_by/resolved_at მენეჯერს აძლევს
--    საშუალებას მონიშნოს "Z-Report ხელახლა დავბეჭდე".
CREATE TABLE IF NOT EXISTS public.shift_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  cashier_id UUID REFERENCES public.users(id),
  register_id UUID REFERENCES public.registers(id),
  previous_expected REAL NOT NULL,
  new_expected REAL NOT NULL,
  previous_difference REAL NOT NULL,
  new_difference REAL NOT NULL,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by UUID REFERENCES public.users(id),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shift_amendments_is_resolved
  ON public.shift_amendments (is_resolved);
CREATE INDEX IF NOT EXISTS idx_shift_amendments_shift_id
  ON public.shift_amendments (shift_id);

COMMIT;
