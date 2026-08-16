-- ==========================================
-- Migration 009: UUID Primary Keys & Multi-POS (Registers)
-- ==========================================
-- Roadmap STEP 1 — მოსამზადებელი ეტაპი Offline Mode-ისთვის (PWA/IndexedDB)
-- და Multi-POS კონფიგურაციისთვის.
--
-- რატომ UUID: ოფლაინ რეჟიმში თითოეული სალარო (Register) ჩეკს ქმნის
-- ლოკალურად, ინტერნეტის გარეშე — SERIAL/Integer PK-ით ორ სხვადასხვა
-- სალაროზე თანხვედრით შექმნილ ჩანაწერებს ერთი და იგივე ID დაემთხვეოდა
-- (ID Collision) სინქრონიზაციისას. UUIDv4 (gen_random_uuid()) კი
-- გენერირდება კლიენტის მხარეზეც (crypto.randomUUID()) და პრაქტიკულად
-- არასდროს ემთხვევა — Offline-ში შექმნილი ჩეკის ID უცვლელი რჩება
-- სერვერზე სინქრონიზაციის შემდეგაც.
--
-- მიდგომა (ცხრილების დესტრუქციული გადაწერის ნაცვლად, მონაცემების
-- დაკარგვის გარეშე):
--   1) ემატება ახალი UUID სვეტი (uuid_id/*_uuid) ძველი INTEGER PK/FK-ის
--      გვერდით, gen_random_uuid()-ით.
--   2) FK სვეტები ივსება (backfill) უკვე დაკავშირებული მშობელი
--      ჩანაწერის ახლად გენერირებული UUID-ით (join ძველ INTEGER ID-ზე).
--   3) ძველი INTEGER სვეტები (PK-ებიც, FK-ებიც) იშლება CASCADE-ით და
--      ახალი UUID სვეტები გადაერქმევა ორიგინალ სახელებზე.
--   4) PK/FK constraint-ები და ინდექსები ხელახლა იქმნება UUID სვეტებზე.
--
-- ⚠️ products ცხრილს PK ტიპი (INTEGER/SERIAL) *არ* ეხება ეს მიგრაცია —
-- Roadmap-ის სია (payments, payment_items, payment_splits, shifts,
-- users, audit_logs) products-ს არ ითვალისწინებს, და payment_items.product_id
-- კვლავ INTEGER რჩება (products.id-ზე მიბმული).
--
-- ⚠️ იმისთვის, რომ ეს ფაილი უსაფრთხოდ იყოს ხელახლა გასაშვები (migrate.ts-ის
-- კონვენციით — IF NOT EXISTS ყველგან სადაც შესაძლებელია), ყველა ბლოკი
-- ამოწმებს, ხომ არ არის უკვე შესრულებული (ახალი UUID-ტიპის სვეტების
-- არსებობით).
-- ==========================================

BEGIN;

-- gen_random_uuid() PostgreSQL 13+-ში ბირთვშივეა (pgcrypto საჭირო აღარაა),
-- მაგრამ ძველი/სხვა გარემოსთვის დამატებითი უსაფრთხოების ბადეა.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ⚠️ იდემპოტენტურობის დაცვა: ამ ფაილის დანარჩენი ნაწილი (IF NOT EXISTS-ებით)
-- ტექნიკურად "წარმატებით" ხელახლა გაეშვებოდა ისე, რომ users.id უკვე UUID-ია —
-- ეს კი ახალ, არარელევანტურ UUID-ებს დააგენერირებდა და ჩუმად დაამტვრევდა
-- ყველა FK-კავშირს (ხმაურიანი შეცდომის მაგივრად). ამიტომ, migrations 002/008-ის
-- კონვენციის ანალოგიურად ("ერთხელ გაშვებადი, მეორედ — მოსალოდნელი შეცდომა"),
-- პირველივე ნაბიჯზე ცალსახად ვამოწმებთ და თუ უკვე გატარებულია, მთელი
-- ტრანზაქცია (BEGIN...COMMIT) იქვე უსაფრთხოდ ROLLBACK-დება.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
      AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Migration 009 უკვე გატარებულია — users.id უკვე UUID-ია. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

-- ==========================================
-- 1) USERS — root ცხრილი, არაფერზე არ არის დამოკიდებული
-- ==========================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS uuid_id UUID DEFAULT gen_random_uuid();
UPDATE public.users SET uuid_id = gen_random_uuid() WHERE uuid_id IS NULL;
ALTER TABLE public.users ALTER COLUMN uuid_id SET NOT NULL;

-- ==========================================
-- 2) SHIFTS — დამოკიდებულია users-ზე (cashier_id)
-- ==========================================
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS uuid_id UUID DEFAULT gen_random_uuid();
UPDATE public.shifts SET uuid_id = gen_random_uuid() WHERE uuid_id IS NULL;
ALTER TABLE public.shifts ALTER COLUMN uuid_id SET NOT NULL;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS cashier_uuid UUID;
UPDATE public.shifts s SET cashier_uuid = u.uuid_id
  FROM public.users u WHERE u.id = s.cashier_id AND s.cashier_uuid IS NULL;

-- ==========================================
-- 3) REGISTERS — ახალი ცხრილი (Multi-POS, Roadmap STEP 1.2)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.registers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 🖥️ არსებული (Local Dev) მონაცემებისთვის — ერთი საწყისი "Register #1",
-- რომ უკვე არსებულმა shifts/payments ჩანაწერებმა ცარიელი register_id
-- აღარ დატოვონ. ახალი ფიზიკური სალაროები STEP 2-ის Pairing Flow-ით
-- (POST /api/registers/pair) დაემატება.
INSERT INTO public.registers (name, is_active)
SELECT 'Register #1', true
WHERE NOT EXISTS (SELECT 1 FROM public.registers);

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS register_id UUID
  REFERENCES public.registers(id);
UPDATE public.shifts SET register_id = (SELECT id FROM public.registers ORDER BY created_at ASC LIMIT 1)
  WHERE register_id IS NULL;
ALTER TABLE public.shifts ALTER COLUMN register_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shifts_register_id ON public.shifts (register_id);
-- 🔐 STEP 2.1 — "მხოლოდ ერთი აქტიური Shift" წესი ახლა Per Register მუშაობს:
-- ერთსა და იმავე register_id-ზე ერთდროულად მაქსიმუმ ერთი 'open' shift.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_open_shift_per_register
  ON public.shifts (register_id) WHERE (status = 'open');

-- ==========================================
-- 4) PAYMENTS — დამოკიდებულია users-ზე (cashier_id, voided_by) და shifts-ზე
-- ==========================================
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS uuid_id UUID DEFAULT gen_random_uuid();
UPDATE public.payments SET uuid_id = gen_random_uuid() WHERE uuid_id IS NULL;
ALTER TABLE public.payments ALTER COLUMN uuid_id SET NOT NULL;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS cashier_uuid UUID;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS shift_uuid UUID;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS voided_by_uuid UUID;

UPDATE public.payments p SET cashier_uuid = u.uuid_id
  FROM public.users u WHERE u.id = p.cashier_id AND p.cashier_uuid IS NULL;
UPDATE public.payments p SET shift_uuid = s.uuid_id
  FROM public.shifts s WHERE s.id = p.shift_id AND p.shift_uuid IS NULL;
UPDATE public.payments p SET voided_by_uuid = u.uuid_id
  FROM public.users u WHERE u.id = p.voided_by AND p.voided_by_uuid IS NULL;

-- register_id — STEP 1.3: payments-იც პირდაპირ იმ Register-ს რეფერენსდება,
-- საიდანაც ჩეკი გატარდა (არა მხოლოდ shift_id-ის გავლით — Z-Report/სინქრონიზაცია
-- ორივე ველს დამოუკიდებლად იყენებს).
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS register_id UUID
  REFERENCES public.registers(id);
UPDATE public.payments p SET register_id = s.register_id
  FROM public.shifts s WHERE s.uuid_id = p.shift_uuid AND p.register_id IS NULL;
UPDATE public.payments SET register_id = (SELECT id FROM public.registers ORDER BY created_at ASC LIMIT 1)
  WHERE register_id IS NULL;
ALTER TABLE public.payments ALTER COLUMN register_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_register_id ON public.payments (register_id);

-- ==========================================
-- 5) PAYMENT_ITEMS — დამოკიდებულია payments-ზე. product_id INTEGER-ად რჩება.
-- ==========================================
ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS uuid_id UUID DEFAULT gen_random_uuid();
UPDATE public.payment_items SET uuid_id = gen_random_uuid() WHERE uuid_id IS NULL;
ALTER TABLE public.payment_items ALTER COLUMN uuid_id SET NOT NULL;

ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS payment_uuid UUID;
UPDATE public.payment_items pi SET payment_uuid = p.uuid_id
  FROM public.payments p WHERE p.id = pi.payment_id AND pi.payment_uuid IS NULL;

-- ==========================================
-- 6) PAYMENT_SPLITS — დამოკიდებულია payments-ზე
-- ==========================================
ALTER TABLE public.payment_splits ADD COLUMN IF NOT EXISTS uuid_id UUID DEFAULT gen_random_uuid();
UPDATE public.payment_splits SET uuid_id = gen_random_uuid() WHERE uuid_id IS NULL;
ALTER TABLE public.payment_splits ALTER COLUMN uuid_id SET NOT NULL;

ALTER TABLE public.payment_splits ADD COLUMN IF NOT EXISTS payment_uuid UUID;
UPDATE public.payment_splits ps SET payment_uuid = p.uuid_id
  FROM public.payments p WHERE p.id = ps.payment_id AND ps.payment_uuid IS NULL;

-- ==========================================
-- 7) AUDIT_LOGS — დამოკიდებულია users-ზე (actor_id, target_id)
-- ==========================================
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS uuid_id UUID DEFAULT gen_random_uuid();
UPDATE public.audit_logs SET uuid_id = gen_random_uuid() WHERE uuid_id IS NULL;
ALTER TABLE public.audit_logs ALTER COLUMN uuid_id SET NOT NULL;

ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS actor_uuid UUID;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS target_uuid UUID;
UPDATE public.audit_logs a SET actor_uuid = u.uuid_id
  FROM public.users u WHERE u.id = a.actor_id AND a.actor_uuid IS NULL;
UPDATE public.audit_logs a SET target_uuid = u.uuid_id
  FROM public.users u WHERE u.id = a.target_id AND a.target_uuid IS NULL;

-- ==========================================
-- 8) ძველი INTEGER PK/FK სვეტების ჩამოშლა (CASCADE-ით — ავტომატურად
--    შლის მათზე დამოკიდებულ constraint-ებს/ინდექსებს, მაგ.
--    payment_splits-ის UNIQUE(payment_id, method)), შემდეგ ახალი UUID
--    სვეტების გადარქმევა საბოლოო სახელებზე.
--    თანმიმდევრობა: ჯერ "შვილი" ცხრილები (payment_items, payment_splits),
--    მერე payments, მერე shifts, ბოლოს users/audit_logs.
-- ==========================================

ALTER TABLE public.payment_items DROP COLUMN IF EXISTS id CASCADE;
ALTER TABLE public.payment_items DROP COLUMN IF EXISTS payment_id CASCADE;
ALTER TABLE public.payment_splits DROP COLUMN IF EXISTS id CASCADE;
ALTER TABLE public.payment_splits DROP COLUMN IF EXISTS payment_id CASCADE;
ALTER TABLE public.payments DROP COLUMN IF EXISTS id CASCADE;
ALTER TABLE public.payments DROP COLUMN IF EXISTS cashier_id CASCADE;
ALTER TABLE public.payments DROP COLUMN IF EXISTS shift_id CASCADE;
ALTER TABLE public.payments DROP COLUMN IF EXISTS voided_by CASCADE;
ALTER TABLE public.shifts DROP COLUMN IF EXISTS id CASCADE;
ALTER TABLE public.shifts DROP COLUMN IF EXISTS cashier_id CASCADE;
ALTER TABLE public.audit_logs DROP COLUMN IF EXISTS id CASCADE;
ALTER TABLE public.audit_logs DROP COLUMN IF EXISTS actor_id CASCADE;
ALTER TABLE public.audit_logs DROP COLUMN IF EXISTS target_id CASCADE;
ALTER TABLE public.users DROP COLUMN IF EXISTS id CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='uuid_id') THEN
    ALTER TABLE public.users RENAME COLUMN uuid_id TO id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='shifts' AND column_name='uuid_id') THEN
    ALTER TABLE public.shifts RENAME COLUMN uuid_id TO id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='shifts' AND column_name='cashier_uuid') THEN
    ALTER TABLE public.shifts RENAME COLUMN cashier_uuid TO cashier_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='uuid_id') THEN
    ALTER TABLE public.payments RENAME COLUMN uuid_id TO id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='cashier_uuid') THEN
    ALTER TABLE public.payments RENAME COLUMN cashier_uuid TO cashier_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='shift_uuid') THEN
    ALTER TABLE public.payments RENAME COLUMN shift_uuid TO shift_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='voided_by_uuid') THEN
    ALTER TABLE public.payments RENAME COLUMN voided_by_uuid TO voided_by;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_items' AND column_name='uuid_id') THEN
    ALTER TABLE public.payment_items RENAME COLUMN uuid_id TO id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_items' AND column_name='payment_uuid') THEN
    ALTER TABLE public.payment_items RENAME COLUMN payment_uuid TO payment_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_splits' AND column_name='uuid_id') THEN
    ALTER TABLE public.payment_splits RENAME COLUMN uuid_id TO id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='payment_splits' AND column_name='payment_uuid') THEN
    ALTER TABLE public.payment_splits RENAME COLUMN payment_uuid TO payment_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_logs' AND column_name='uuid_id') THEN
    ALTER TABLE public.audit_logs RENAME COLUMN uuid_id TO id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_logs' AND column_name='actor_uuid') THEN
    ALTER TABLE public.audit_logs RENAME COLUMN actor_uuid TO actor_id;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_logs' AND column_name='target_uuid') THEN
    ALTER TABLE public.audit_logs RENAME COLUMN target_uuid TO target_id;
  END IF;
END $$;

-- ==========================================
-- 9) PK/FK/UNIQUE constraint-ების და ინდექსების ხელახლა შექმნა UUID სვეტებზე
-- ==========================================
ALTER TABLE public.users ADD PRIMARY KEY (id);
ALTER TABLE public.shifts ADD PRIMARY KEY (id);
ALTER TABLE public.payments ADD PRIMARY KEY (id);
ALTER TABLE public.payment_items ADD PRIMARY KEY (id);
ALTER TABLE public.payment_splits ADD PRIMARY KEY (id);
ALTER TABLE public.audit_logs ADD PRIMARY KEY (id);

ALTER TABLE public.users ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.shifts ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.payments ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.payment_items ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.payment_splits ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.audit_logs ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES public.users(id);

ALTER TABLE public.payments
  ADD CONSTRAINT payments_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES public.users(id),
  ADD CONSTRAINT payments_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id),
  ADD CONSTRAINT payments_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.users(id);

-- 🆕 payment_items.payment_id-ს აქამდე საერთოდ არ ჰქონდა DB-დონის FK
-- constraint (მხოლოდ აპლიკაციური ლოგიკით იყო "ნაგულისხმევი" foreign key,
-- იხ. migrations/001) — ვინაიდან ტიპს ისედაც ვცვლით, სისუფთავისთვის
-- (Clean Architecture/data-integrity) ვამატებთ ცალსახა FK-ს, ON DELETE
-- CASCADE-ით — payment_splits-ის უკვე არსებული პატერნის ანალოგიით.
ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_payment_id_fkey FOREIGN KEY (payment_id)
    REFERENCES public.payments(id) ON DELETE CASCADE;

ALTER TABLE public.payment_splits
  ADD CONSTRAINT payment_splits_payment_id_fkey FOREIGN KEY (payment_id)
    REFERENCES public.payments(id) ON DELETE CASCADE;
ALTER TABLE public.payment_splits
  ADD CONSTRAINT payment_splits_payment_id_method_key UNIQUE (payment_id, method);

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id),
  ADD CONSTRAINT audit_logs_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS idx_payment_items_payment_id ON public.payment_items (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_splits_payment_id ON public.payment_splits (payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_cashier_id ON public.payments (cashier_id);
CREATE INDEX IF NOT EXISTS idx_payments_shift_id ON public.payments (shift_id);
CREATE INDEX IF NOT EXISTS idx_shifts_cashier_id ON public.shifts (cashier_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_id ON public.audit_logs (target_id);

COMMIT;
