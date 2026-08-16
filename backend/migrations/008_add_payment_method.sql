-- ==========================================
-- Migration 008: Payment Method Differentiation
-- ==========================================
-- Roadmap ეტაპი 8 — POS checkout-ში აქამდე არ არსებობდა ნაღდი/ბარათის
-- დიფერენციაცია: ყოველი გაყიდვა ისე ინახებოდა, თითქოს 100% ნაღდი ყოფილიყო.
-- ამის გამო PUT /shifts/close-ის "მოსალოდნელი" თანხა (end_amount_expected)
-- ყოველთვის მთელ ბრუნვას ითვლიდა სალაროში ფაქტობრივად არსებულ ნაღდ
-- ფულად — თუნდაც ნახევარი გაყიდვა ბარათით ყოფილიყო გადახდილი.
--
-- payment_method TEXT NOT NULL DEFAULT 'cash' — ძველი ჩანაწერები (migration-მდე
-- გაკეთებული ყველა გაყიდვა) ავტომატურად 'cash'-ად ითვლება, რაც ისტორიულად
-- ზუსტად ასეც იყო რეალურადაც (სხვა მეთოდი მანამდე საერთოდ არ არსებობდა).
--
-- cash_received — ივსება მხოლოდ მაშინ, როცა მოლარემ ის ფაქტობრივად შეიყვანა
-- (ხურდის დასათვლელად); 'card' ჩეკზე და "ცარიელი" შემთხვევაში NULL რჩება.
--
-- payment_splits — 'split' ჩეკის ორი ხაზი: რამდენი ნაღდით, რამდენი ბარათით.
-- ON DELETE CASCADE — ჩეკის (თეორიულად) წაშლისას ნაშთი ხაზებიც გაქრება.
-- UNIQUE (payment_id, method) — ერთ ჩეკს ერთი 'cash' და ერთი 'card' ხაზი
-- ჰყავს მაქსიმუმ, დუბლირება SQL დონეზევე დაცულია.
--
-- ⚠️ migrate.ts-ის კონვენციით: ADD COLUMN IF NOT EXISTS უსაფრთხოა განმეორებით
-- გაშვებაზეც, მაგრამ ADD CONSTRAINT-ს (chk_payment_method) IF NOT EXISTS არ
-- აქვს PostgreSQL-ში — თუ ეს მიგრაცია უკვე გაშვებულია, მეორედ გაშვებაზე
-- ამ კონკრეტულ ბლოკზე "constraint already exists" შეცდომას ნახავთ, რაც
-- მოსალოდნელია (იხ. migration 002-ის იგივე შენიშვნა).
-- ==========================================

BEGIN;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS cash_received real;

ALTER TABLE public.payments
  ADD CONSTRAINT chk_payment_method
    CHECK (payment_method IN ('cash', 'card', 'split'));

CREATE TABLE IF NOT EXISTS public.payment_splits (
  id SERIAL PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cash', 'card')),
  amount real NOT NULL CHECK (amount > 0),
  UNIQUE (payment_id, method)
);

CREATE INDEX IF NOT EXISTS idx_payment_splits_payment_id
  ON public.payment_splits (payment_id);

CREATE INDEX IF NOT EXISTS idx_payments_payment_method
  ON public.payments (payment_method);

COMMIT;
