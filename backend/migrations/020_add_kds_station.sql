-- ==========================================
-- Migration 020: KDS routing — products.station
-- ==========================================
-- Roadmap: `ROADMAP - HoReCa Module - 03.09.2026.md`, STEP 2 (სამზარეულო/
-- ბარის routing). `order_items.station` (migration 019) უკვე არსებობს,
-- როგორც STEP 2-ის "წინსწრებით" შექმნილი, ჯერ ყოველთვის NULL სვეტი —
-- ეს migration ამატებს მის წყაროს: `products.station`, საიდანაც STEP 2-ის
-- routes/orders.ts (POST /orders/:id/items) სნეპშოტს იღებს item-ის
-- დამატების მომენტში.
--
-- ⚠️ `product_categories`/`products.category_id` (roadmap-ში ნახსენები
-- მენიუს კატეგორიზაციისთვის) განზრახ არაა ამ migration-ში — KDS routing-ს
-- მხოლოდ `station` სჭირდება ფუნქციონირებისთვის, კატეგორია ცალკე, მომავალი
-- menu-organization ფიჩერია.
--
-- ⚠️ ნულოვანი გავლენა Retail-ზე: სვეტი NULLABLE-ია, ნაგულისხმევი NULL —
-- არსებულ პროდუქტებს (retail-საც, horeca-საც) სტატუსი უცვლელი რჩება,
-- სანამ ადმინი ხელით არ მიანიჭებს station-ს (Products.tsx).
--
-- ⚠️ იდემპოტენტურობა: migration 009/013/019-ის კონვენციით.
-- ==========================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'station'
  ) THEN
    RAISE EXCEPTION 'Migration 020 უკვე გატარებულია — products.station უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS station TEXT
    CHECK (station IN ('kitchen', 'bar'));

COMMIT;
