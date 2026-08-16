-- ==========================================
-- Migration 002: Discount System
-- ==========================================
-- ✅ ეს მიგრაცია უკვე გაშვებულია production-ზე (იხ. root-ში
-- migration_add_discount.sql — ეს ფაილი მისი ასლია, გადმოტანილი
-- migrations/ ფოლდერში თანმიმდევრობის დასაცავად ახალი
-- environment-ебისთვის, სადაც ჯერ არაა გაშვებული).
--
-- გაუშვი pgAdmin-ში ან psql-ით production DB-ს დაზიანების გარეშე.
-- ==========================================

BEGIN;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS subtotal_amount real,
  ADD COLUMN IF NOT EXISTS discount_type text,
  ADD COLUMN IF NOT EXISTS discount_value real DEFAULT 0;

-- backfill: ძველი ჩანაწერებისთვის, სადაც ფასდაკლება არ არსებობდა,
-- subtotal_amount = total_amount (discount_value უკვე 0-ია)
UPDATE public.payments
SET subtotal_amount = total_amount
WHERE subtotal_amount IS NULL;

ALTER TABLE public.payments
  ALTER COLUMN subtotal_amount SET NOT NULL,
  ALTER COLUMN discount_value SET NOT NULL;

ALTER TABLE public.payments
  ADD CONSTRAINT chk_discount_type
    CHECK (discount_type IS NULL OR discount_type IN ('percent', 'fixed'));

ALTER TABLE public.payments
  ADD CONSTRAINT chk_discount_value_positive
    CHECK (discount_value >= 0);

ALTER TABLE public.payments
  ADD CONSTRAINT chk_subtotal_positive
    CHECK (subtotal_amount >= 0);

COMMIT;

-- ==========================================
-- Discount System — On/Off Permission Toggle
-- users ცხრილის მიგრაცია (can_view_history-ის ანალოგიურად)
-- IF NOT EXISTS-ის წყალობით უსაფრთხოდ გაეშვება მაშინაც, თუ ზემოთა
-- payments-ის ცვლილება უკვე production-ზეა გატარებული.
-- ==========================================

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_use_discount BOOLEAN NOT NULL DEFAULT true;

COMMIT;
