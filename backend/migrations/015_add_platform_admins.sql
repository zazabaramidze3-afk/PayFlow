-- ==========================================
-- Migration 015: platform_admins + superadmin_audit_logs (Multi-Tenant SaaS STEP 8 — Superadmin Panel)
-- ==========================================
-- Roadmap: `ROADMAP - Multi-Tenant SaaS - 23.08.2026.md`-ის გაგრძელება,
-- STEP 3-ის (Company Self-Registration) დასრულების შემდეგ ლოგიკური
-- შემდეგი ნაბიჯი — მომხმარებლის კითხვა: "ეს კომპანიები ემატება და
-- იზოლირებულია, მაგრამ საჭიროა მთლიანი მენეჯმენტი კომპანიების მიხედვით,
-- ანუ Superadmin User?".
--
-- გადაწყვეტილების წერტილი (მომხმარებელთან შეთანხმებული, 24.08.2026):
--   1) platform_admins — **ცალკე, დამოუკიდებელი ცხრილი** (არა users-ის
--      ახალი როლი). მიზეზი: users.organization_id NOT NULL-ია (migration
--      013) და STEP 2-ის ყველა tenant-scoped route `WHERE organization_id
--      = $1`-ს ეყრდნობა — superadmin-ს, განსაზღვრებით, ერთი კონკრეტული
--      org არ გააჩნია. ცალკე ცხრილი + ცალკე auth-მექანიზმი (იხ.
--      middleware/platformAdminAuth.ts) ნიშნავს, რომ ჩვეულებრივი
--      route-ების tenant-scoping ინვარიანტები ხელუხლებელი რჩება — არცერთ
--      არსებულ query-ს არ სჭირდება "თუ superadmin-ია, ყველა org-ს
--      აჩვენე" ტიპის განშტოება.
--   2) პირველი ვერსიის scope: კომპანიების სია + სტატუსი, Suspend/Activate
--      + trial გაგრძელება, cross-org აუდიტი/სტატისტიკა, superadmin
--      action-ების log.
--
-- ⚠️ იდემპოტენტურობა: migration 013/014-ის კონვენციით.
-- ==========================================

BEGIN;

-- ==========================================
-- 0) იდემპოტენტურობის დაცვა
-- ==========================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'platform_admins'
  ) THEN
    RAISE EXCEPTION 'Migration 015 უკვე გატარებულია — platform_admins ცხრილი უკვე არსებობს. ხელახლა გაშვება უსაფრთხოდ გაუქმდა.';
  END IF;
END $$;

-- ==========================================
-- 1) PLATFORM_ADMINS — Superadmin ანგარიშები, users-ისგან სრულად
--    დამოუკიდებელი (organization_id არ გააჩნია განზრახ).
-- ==========================================
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- users.email-ის იგივე კონვენცია (migration 014) — LOWER(email)-ზე
-- უნიკალურობა, case-insensitive login-ისთვის.
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_admins_email ON public.platform_admins (LOWER(email));

-- ==========================================
-- 2) SUPERADMIN_AUDIT_LOGS — ვინ, როდის, რა ჩაატარა superadmin პანელიდან
--    (suspend/activate, trial გაგრძელება და ა.შ.) — accountability,
--    audit_logs (STEP-ის tenant-scoped ცხრილისგან) ცალკე, რადგან ეს
--    ჩანაწერები კონკრეტულ org-ს არ ეკუთვნის, პლატფორმის დონეზეა.
-- ==========================================
CREATE TABLE IF NOT EXISTS public.superadmin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id UUID NOT NULL REFERENCES public.platform_admins(id),
  action TEXT NOT NULL,
  -- ⚠️ ON DELETE SET NULL განზრახ — თუ ოდესმე org წაიშლება (ამ ეტაპზე
  -- საერთოდ არ არსებობს DELETE org route), აუდიტის ისტორია მაინც
  -- შენარჩუნდეს, თარგეთის დაკარგვის მიუხედავად.
  target_organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  details TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_superadmin_audit_logs_admin ON public.superadmin_audit_logs (platform_admin_id);
CREATE INDEX IF NOT EXISTS idx_superadmin_audit_logs_org ON public.superadmin_audit_logs (target_organization_id);
CREATE INDEX IF NOT EXISTS idx_superadmin_audit_logs_created_at ON public.superadmin_audit_logs (created_at DESC);

COMMIT;
