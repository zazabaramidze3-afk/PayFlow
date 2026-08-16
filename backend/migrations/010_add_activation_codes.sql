-- ==========================================
-- Migration 010: Device Pairing — Activation Codes
-- ==========================================
-- Roadmap STEP 2.2 — დროებითი ვერიფიკაციის სისტემა ახალი (Unlinked)
-- ფიზიკური სალაროს (ბრაუზერის) დასაკავშირებლად კონკრეტულ registers.id-სთან.
--
-- ნაკადი:
--   1) ახალმა/დაცარიელებულმა ბრაუზერმა (RegisterGuard.tsx) გამოიძახა
--      POST /api/registers/generate-code (ავტორიზაციის გარეშე — ჯერ
--      არავითარი session/login არ არსებობს ამ მოწყობილობაზე) → იქმნება
--      ერთი 'pending' ჩანაწერი, ბრაუზერს რჩება მხოლოდ `code`.
--   2) ბრაუზერი აჩვენებს ამ 6-ნიშნა კოდს ეკრანზე და პარალელურად პოლინგავს
--      GET /api/registers/pairing-status/:code-ს.
--   3) მენეჯერი/ადმინი (უკვე დალოგინებული, სხვა — უკვე დაწყვილებულ —
--      მოწყობილობაზე) კითხულობს კოდს მოლარისგან და უშვებს
--      POST /api/registers/pair-ს, კონკრეტულ register_id-ს ურჩევს/ქმნის.
--      ეს ენდპოინტი აგენერირებს register_token-ს (გრძელვადიან JWT-ს) და
--      ინახავს ამ ჩანაწერშივე — token არასდროს ბრუნდება უშუალოდ
--      Unlinked ბრაუზერისკენ HTTP response-ის სახით (ის ხომ ჯერ არც კი
--      აგზავნის ცალკე მოთხოვნას ამ მომენტში), ის მხოლოდ აქ ინახება და
--      ბრაუზერი მას შემდეგი (2) ნაბიჯის Polling-ის საშუალებით იღებს.
--
-- ⚠️ register_token ინახება plain-text-ად ამ ცხრილში (და არა ჰეშირებული) —
-- ეს განსხვავებულია password_hash/manager_pin-ისგან, რადგან token თავად
-- არის საიდენტიფიკაციო "საიდუმლო", რომელიც უნდა გადაეცეს კლიენტს ისე,
-- როგორადაც არის; ცხრილის ეს row expires_at-ის შემდეგ საბოლოოდ კარგავს
-- მნიშვნელობას (short-lived), ამიტომ რისკი შეზღუდულია. ცალკე,
-- middleware/registerAuth.ts ამოწმებს ტოკენს როგორც ხელმოწერილ JWT-ს
-- (არა ამ ცხრილიდან ყოველი მოთხოვნისას წაკითხვით) — ეს row მხოლოდ
-- pairing-ის ერთჯერადი "handoff"-ისთვისაა საჭირო.
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.activation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(6) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'expired')),
  register_id UUID REFERENCES public.registers(id),
  register_token TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  confirmed_by UUID REFERENCES public.users(id),
  confirmed_at TIMESTAMP
);

-- ერთდროულად მაქსიმუმ ერთი 'pending' ჩანაწერი შეიძლება არსებობდეს
-- კონკრეტული 6-ნიშნა კოდით — 1-ში-მილიონზე ნაკლები კოლიზიის შანსსაც
-- კი აზუსტებს (generate-code ენდპოინტი ხელახლა სცდის კოლიზიაზე).
CREATE UNIQUE INDEX IF NOT EXISTS uq_activation_codes_pending_code
  ON public.activation_codes (code) WHERE (status = 'pending');

CREATE INDEX IF NOT EXISTS idx_activation_codes_expires_at
  ON public.activation_codes (expires_at);

COMMIT;
