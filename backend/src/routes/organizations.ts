// backend/src/routes/organizations.ts
//
// 🏢 Multi-Tenant SaaS STEP 3 (Roadmap "23.08.2026") — კომპანიის
// self-service რეგისტრაცია. STEP 1-მდე (migration 013) ერთადერთი
// "org-შემქმნელი" მექანიზმი migration-ის საკუთარი, ერთჯერადი "default"
// org-ის backfill იყო — production-ზე ახალი, ცალკე კომპანიის დამატება
// მხოლოდ ხელით, SQL-ით შეიძლებოდა. ეს endpoint ხურავს ამ ხარვეზს:
// საჯარო (ავტორიზაციის გარეშე — თავად ორგანიზაცია/ადმინი ჯერ არ
// არსებობს), მაგრამ rate-limited, ერთ ტრანზაქციაში ქმნის ორგანიზაციასაც
// და მის პირველ (admin როლის) user-საც ერთად.

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../index';
import {
  getRegistrationRateLimitKey,
  checkRegistrationRateLimit,
  registerRegistrationAttempt,
} from '../middleware/registrationRateLimit';
import {
  getOrgResolveRateLimitKey,
  checkOrgResolveRateLimit,
  registerOrgResolveAttempt,
} from '../middleware/orgResolveRateLimit';

const router = Router();

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'უცნობი შეცდომა');

// 🔤 slug — subdomain-კანდიდატი (Roadmap STEP 7-ისთვის, jერ routing-ის
// გარეშე), ამიტომ URL-უსაფრთხო ფორმატი მკაცრადაა შეზღუდული: მხოლოდ
// პატარა ლათინური ასოები, ციფრები და დეფისი, 3-40 სიმბოლო, არც
// დასაწყისში/ბოლოში დეფისი.
const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;

// 📧 საკმარისად მკაცრი, მაგრამ არა overengineered ვალიდაცია — ნამდვილი
// RFC 5322-ის სრული დაცვა აქ overkill-ია, საკმარისია აშკარად
// არასწორის (space-ის, @/domain-ის არქონის) გაფილტვრა.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// 🏢 POST /organizations/register — ახალი კომპანია + პირველი (admin) user
router.post('/organizations/register', async (req: Request, res: Response) => {
  // 🔒 Rate limiting (Roadmap "23.08.2026") — ეს endpoint ავტორიზაციის
  // გარეშეა ხელმისაწვდომი, ამიტომ ინტერნეტიდან ნებისმიერს შეუძლია
  // მასზე მიმართვა (spam/abuse რისკი).
  const rateLimitKey = getRegistrationRateLimitKey(req);
  const rateLimit = checkRegistrationRateLimit(rateLimitKey);
  if (rateLimit.limited) {
    return res.status(429).json({
      error: `ძალიან ბევრი მცდელობა — გთხოვთ სცადოთ ${rateLimit.retryAfterSeconds} წამში.`,
    });
  }
  registerRegistrationAttempt(rateLimitKey);

  const { companyName, slug: slugInput, adminName, email, password } = req.body;

  // 1. ვალიდაცია
  if (!companyName || !slugInput || !adminName || !email || !password) {
    return res.status(400).json({ error: 'ყველა ველი სავალდებულოა!' });
  }

  const trimmedCompanyName = String(companyName).trim();
  if (trimmedCompanyName.length < 2) {
    return res.status(400).json({ error: 'კომპანიის სახელი ძალიან მოკლეა!' });
  }

  const slug = slugify(String(slugInput));
  if (!SLUG_REGEX.test(slug)) {
    return res.status(400).json({
      error: 'subdomain არავალიდურია — მხოლოდ პატარა ლათინური ასოები, ციფრები და დეფისი (3-40 სიმბოლო)',
    });
  }

  const trimmedAdminName = String(adminName).trim();
  if (trimmedAdminName.length < 2) {
    return res.status(400).json({ error: 'ადმინის სახელი ძალიან მოკლეა!' });
  }

  const trimmedEmail = String(email).trim().toLowerCase();
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    return res.status(400).json({ error: 'Email არავალიდურია!' });
  }

  // 🔐 საჯარო self-service registration-ისთვის internal POST /users-ის
  // (4 სიმბოლო — auth.ts) მინიმუმზე მკაცრი მინიმუმი ვამყარეთ, რადგან ეს
  // ანგარიში ინტერნეტიდან ნებისმიერისთვის მისაწვდომია, არა მხოლოდ
  // უკვე ავტორიზებული ადმინის მიერ დამატებული internal staff-ისთვის.
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'პაროლი უნდა შედგებოდეს მინიმუმ 8 სიმბოლოსგან!' });
  }

  const client = await db.connect();
  try {
    // 2. წინასწარი, მეგობრული უნიკალურობის შემოწმებები (products.ts-ის
    // dupCheck-ის იგივე პატერნი) — 23505 catch ქვემოთ მაინც დარჩება
    // race-condition-ის fallback-ად.
    const slugCheck = await client.query('SELECT id FROM organizations WHERE slug = $1', [slug]);
    if (slugCheck.rows.length > 0) {
      return res.status(409).json({ error: 'ეს subdomain უკვე დაკავებულია!' });
    }

    const emailCheck = await client.query('SELECT id FROM users WHERE LOWER(email) = $1', [trimmedEmail]);
    if (emailCheck.rows.length > 0) {
      return res.status(409).json({ error: 'ამ email-ით ანგარიში უკვე არსებობს!' });
    }

    // 🏢 Roadmap "24.08.2026" — username-ის წინასწარი უნიკალურობის
    // შემოწმება აქედან მოშორებულია: migration 016-ის შემდეგ `users.name`
    // per-org unique-ია (`uq_users_org_name`), ახალი org კი ამ
    // ტრანზაქციაშივე იქმნება ცარიელი — ანუ ამ org-ის შიგნით
    // username-კონფლიქტი სტრუქტურულადვე შეუძლებელია (ორი კომპანიის
    // ადმინს ახლა თავისუფლად შეუძლია ერთი და იმავე username-ის ("admin")
    // არჩევა, თითოეული საკუთარ org-ში).

    const hashedPassword = await bcrypt.hash(String(password), 10);

    await client.query('BEGIN');

    const orgResult = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, status, trial_ends_at)
       VALUES ($1, $2, 'trial', NOW() + INTERVAL '14 days')
       RETURNING id`,
      [trimmedCompanyName, slug]
    );
    const organizationId = orgResult.rows[0].id;

    const userResult = await client.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash, role, status, requires_password_reset, organization_id)
       VALUES ($1, $2, $3, 'admin', 'active', false, $4)
       RETURNING id`,
      [trimmedAdminName, trimmedEmail, hashedPassword, organizationId]
    );
    const userId = userResult.rows[0].id;

    await client.query('COMMIT');

    // 3. Auto-login — POST /login-ის იგივე JWT payload-ფორმა, რომ App.tsx-ის
    // არსებულმა session-restore/interceptor ლოგიკამ ამ token-იც უცვლელად
    // მიიღოს (იხ. frontend/src/App.tsx-ის getUserFromStoredToken).
    const token = jwt.sign(
      { id: userId, username: trimmedAdminName, role: 'admin', organizationId },
      process.env.JWT_SECRET || 'super-secret-key',
      { expiresIn: '1d' }
    );

    res.status(201).json({
      token,
      requiresPasswordReset: false,
      user: {
        id: userId,
        username: trimmedAdminName,
        role: 'admin',
        status: 'active',
        can_view_history: true,
        requires_password_reset: false,
      },
      organization: { id: organizationId, name: trimmedCompanyName, slug },
    });
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);

    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr.code === '23505') {
      if (pgErr.constraint === 'uq_organizations_slug') {
        return res.status(409).json({ error: 'ეს subdomain უკვე დაკავებულია!' });
      }
      if (pgErr.constraint === 'uq_users_email') {
        return res.status(409).json({ error: 'ამ email-ით ანგარიში უკვე არსებობს!' });
      }
      // ⚠️ `uq_users_org_name` (migration 016) ამ flow-ში სტრუქტურულად
      // ვერასდროს დაეჯახება — ახალი org ამ ტრანზაქციაშივე იქმნება
      // ცარიელი, ანუ username-კონფლიქტი მასში მათემატიკურად შეუძლებელია.
      // fallback branch (ქვემოთ) მაინც საკმარისია, თუ რამე მოულოდნელი მოხდა.
      return res.status(409).json({ error: 'ეს მონაცემი უკვე დაკავებულია!' });
    }

    res.status(500).json({ error: 'სერვერის შეცდომა: ' + getErrorMessage(err) });
  } finally {
    client.release();
  }
});

// 🔎 GET /organizations/resolve/:slug — საჯარო, login-ის 1-ლი ნაბიჯისთვის
// (Roadmap "24.08.2026", STEP 7-ის წინაპირობა). Login-ს (Login.tsx)
// მოსდის slug, ჯერ ამ endpoint-ით ადასტურებს, რომ ასეთი კომპანია
// არსებობს (და აჩვენებს მის სახელს) — მხოლოდ ამის შემდეგ ჩნდება
// username/password ველები. `users.name`-ის per-org uniqueness-ის
// (migration 016) გამო `POST /login`-საც ესაჭიროება ეს slug, რომ
// ცალსახად იცოდეს, რომელ org-ში ეძებოს user.
//
// ⚠️ არ ამოწმებს org.status-ს (suspended/cancelled) — ეს განზრახ
// POST /login-ისვე პასუხისმგებლობაა (იქ უკვე realizебულია), რომ
// resolve-ის პასუხი მინიმალური/predictable დარჩეს.
router.get('/organizations/resolve/:slug', async (req: Request, res: Response) => {
  const rateLimitKey = getOrgResolveRateLimitKey(req);
  const rateLimit = checkOrgResolveRateLimit(rateLimitKey);
  if (rateLimit.limited) {
    return res.status(429).json({
      error: `ძალიან ბევრი მცდელობა — გთხოვთ სცადოთ ${rateLimit.retryAfterSeconds} წამში.`,
    });
  }
  registerOrgResolveAttempt(rateLimitKey);

  const slug = slugify(String(req.params.slug ?? ''));
  if (!SLUG_REGEX.test(slug)) {
    return res.status(400).json({ error: 'subdomain არავალიდურია!' });
  }

  try {
    const result = await db.query<{ id: string; name: string; slug: string; status: string }>(
      'SELECT id, name, slug, status FROM organizations WHERE slug = $1',
      [slug]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'კომპანია ვერ მოიძებნა!' });
    }
    res.json(result.rows[0]);
  } catch (err: unknown) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + getErrorMessage(err) });
  }
});

export default router;
