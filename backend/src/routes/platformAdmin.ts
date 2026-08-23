// backend/src/routes/platformAdmin.ts
//
// 🏢 Multi-Tenant SaaS STEP 8 (Roadmap "24.08.2026") — Superadmin Panel.
// STEP 3-ის (Company Self-Registration) ბუნებრივი გაგრძელება: კომპანიები
// უკვე თავად რეგისტრირდებიან და ერთმანეთისგან იზოლირებულები არიან, მაგრამ
// პლატფორმის მხარეს არცერთი მექანიზმი არ არსებობდა ყველა კომპანიის
// სანახავად/სამართავად — მხოლოდ pgAdmin-ში ხელით SQL. ეს router ხურავს
// ამ ხარვეზს: ცალკე auth-მექანიზმით (`platformAdminAuth.ts`, `users`
// ცხრილისგან სრულად დამოუკიდებელი — იხ. migration 015-ის თავსართი),
// ორგანიზაციების სია/დეტალები/სტატისტიკა, suspend/activate, trial
// გაგრძელება და ყველა ამ action-ის audit log.

import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../index';
import { OrganizationStatus } from '../types';
import {
  authenticatePlatformAdmin,
  signPlatformAdminToken,
  PlatformAdminRequest,
} from '../middleware/platformAdminAuth';
import {
  getPlatformAdminRateLimitKey,
  checkPlatformAdminRateLimit,
  registerPlatformAdminFailedAttempt,
  clearPlatformAdminAttempts,
} from '../middleware/platformAdminLoginRateLimit';

const router = Router();

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'უცნობი შეცდომა');

// 📧 organizations.ts-ის იგივე, საკმარისად მკაცრი (მაგრამ არა overengineered) ვალიდაცია.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// migration 013-ის CHECK constraint-ის ზუსტი ასლი — client-მხრიდან
// არავალიდურ სტატუსზე ცხადი 400-ის დასაბრუნებლად, ნაცვლად DB-ის "შიშველი"
// constraint-violation შეცდომისა.
const VALID_ORG_STATUSES: readonly OrganizationStatus[] = ['trial', 'active', 'suspended', 'cancelled'];

// UUID-ის მსუბუქი ფორმატის შემოწმება (v4-ის მკაცრი ვერსიის დაცვის გარეშე,
// migration 009/013-ის gen_random_uuid()-ის ნებისმიერი ვარიანტისთვის საკმარისი) —
// route-ის param-ში აშკარად არასწორი მნიშვნელობა ცხადი 400-ით ჩერდება,
// DB-ის "invalid input syntax for type uuid" 500-ის ნაცვლად.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 📝 ყველა superadmin action ერთი წერტილიდან იწერება ბაზაში — რომ
// route-ების შორის ლოგირების ფორმატი/ველები არასდროს დაცილდეს ერთმანეთს.
async function writeSuperadminAuditLog(
  platformAdminId: string,
  action: string,
  targetOrganizationId: string | null,
  details: string
): Promise<void> {
  await db.query(
    `INSERT INTO superadmin_audit_logs (platform_admin_id, action, target_organization_id, details)
     VALUES ($1, $2, $3, $4)`,
    [platformAdminId, action, targetOrganizationId, details]
  );
}

// ==========================================
// 🔓 POST /platform-admin/login
// ==========================================
router.post('/platform-admin/login', async (req, res: Response) => {
  const { email, password } = req.body;

  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'Email და პაროლი სავალდებულოა!' });
  }

  const trimmedEmail = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    return res.status(400).json({ error: 'Email არავალიდურია!' });
  }

  const rateLimitKey = getPlatformAdminRateLimitKey(req, trimmedEmail);
  const rateLimit = checkPlatformAdminRateLimit(rateLimitKey);
  if (rateLimit.limited) {
    return res.status(429).json({
      error: `ძალიან ბევრი წარუმატებელი მცდელობა — გთხოვთ სცადოთ ${rateLimit.retryAfterSeconds} წამში.`,
    });
  }

  try {
    const result = await db.query<{ id: string; name: string; email: string; password_hash: string; is_active: boolean }>(
      `SELECT id, name, email, password_hash, is_active FROM platform_admins WHERE LOWER(email) = $1 LIMIT 1`,
      [trimmedEmail]
    );

    if (result.rows.length === 0) {
      registerPlatformAdminFailedAttempt(rateLimitKey);
      return res.status(401).json({ error: 'არასწორი Email ან პაროლი!' });
    }

    const admin = result.rows[0];

    if (!admin.is_active) {
      // ⚠️ განზრახ არ ვითვლით rate-limit-ის მცდელობად — ეს ანგარიშის
      // მდგომარეობაა (superadmin-მა თავად, თანამშრომლის დათხოვნისას),
      // არა brute-force-ის ნიშანი.
      return res.status(403).json({ error: 'ეს ანგარიში დეაქტივირებულია!' });
    }

    const isPasswordCorrect = await bcrypt.compare(password, admin.password_hash);
    if (!isPasswordCorrect) {
      registerPlatformAdminFailedAttempt(rateLimitKey);
      return res.status(401).json({ error: 'არასწორი Email ან პაროლი!' });
    }

    clearPlatformAdminAttempts(rateLimitKey);

    const token = signPlatformAdminToken({ id: admin.id, name: admin.name, email: admin.email });

    res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
  } catch (err: unknown) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + getErrorMessage(err) });
  }
});

// ==========================================
// 📋 GET /platform-admin/organizations — ყველა კომპანიის სია + სტატისტიკა
// ==========================================
// ⚠️ განზრახ სამი ცალკე subquery (users/payments-ის ორჯერ), არა ერთი
// LEFT JOIN — organizations-ს ერთდროულად users-ზეც და payments-ზეც რომ
// დაერთოს, ორ დამოუკიდებელ "ერთი-ბევრთან" ურთიერთობას შორის Cartesian
// fan-out გამოიწვევდა (N users × M payments row ერთ org-ზე) და
// SUM(total_amount)/COUNT(*) რამდენჯერმე გაბერილს დააბრუნებდა. Subquery-ები
// ამ რისკს საერთოდ გამორიცხავს — თითოეული დამოუკიდებლად, ერთხელ ითვლის.
router.get('/platform-admin/organizations', authenticatePlatformAdmin, async (_req: PlatformAdminRequest, res: Response) => {
  try {
    const result = await db.query(
      `SELECT
         o.id, o.name, o.slug, o.status, o.plan, o.trial_ends_at, o.created_at,
         (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) AS user_count,
         (SELECT email FROM users u2 WHERE u2.organization_id = o.id AND u2.role = 'admin' ORDER BY u2.name ASC LIMIT 1) AS admin_email,
         (SELECT COALESCE(SUM(total_amount), 0) FROM payments p WHERE p.organization_id = o.id AND p.is_voided = false) AS total_revenue,
         (SELECT COUNT(*) FROM payments p WHERE p.organization_id = o.id AND p.is_voided = false) AS receipt_count
       FROM organizations o
       ORDER BY o.created_at DESC`
    );

    res.json(
      result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        plan: row.plan,
        trialEndsAt: row.trial_ends_at,
        createdAt: row.created_at,
        userCount: Number(row.user_count),
        adminEmail: row.admin_email,
        totalRevenue: Number(row.total_revenue),
        receiptCount: Number(row.receipt_count),
      }))
    );
  } catch (err: unknown) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + getErrorMessage(err) });
  }
});

// ==========================================
// 🔍 GET /platform-admin/organizations/:id — ერთი კომპანიის დეტალები
// ==========================================
router.get('/platform-admin/organizations/:id', authenticatePlatformAdmin, async (req: PlatformAdminRequest, res: Response) => {
  const { id } = req.params;
  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'არავალიდური ორგანიზაციის ID!' });
  }

  try {
    const orgResult = await db.query(
      `SELECT id, name, slug, status, plan, trial_ends_at, created_at FROM organizations WHERE id = $1`,
      [id]
    );
    if (orgResult.rows.length === 0) {
      return res.status(404).json({ error: 'ორგანიზაცია ვერ მოიძებნა!' });
    }
    const org = orgResult.rows[0];

    const usersResult = await db.query(
      `SELECT id, name, email, role, status FROM users WHERE organization_id = $1 ORDER BY name ASC`,
      [id]
    );

    const statsResult = await db.query(
      `SELECT
         COALESCE(SUM(total_amount), 0) AS total_revenue,
         COUNT(*) AS receipt_count
       FROM payments
       WHERE organization_id = $1 AND is_voided = false`,
      [id]
    );

    res.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      plan: org.plan,
      trialEndsAt: org.trial_ends_at,
      createdAt: org.created_at,
      users: usersResult.rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
      })),
      stats: {
        totalRevenue: Number(statsResult.rows[0].total_revenue),
        receiptCount: Number(statsResult.rows[0].receipt_count),
      },
    });
  } catch (err: unknown) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + getErrorMessage(err) });
  }
});

// ==========================================
// 🚦 PATCH /platform-admin/organizations/:id/status — Suspend/Activate
// ==========================================
router.patch('/platform-admin/organizations/:id/status', authenticatePlatformAdmin, async (req: PlatformAdminRequest, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'არავალიდური ორგანიზაციის ID!' });
  }
  if (typeof status !== 'string' || !VALID_ORG_STATUSES.includes(status as OrganizationStatus)) {
    return res.status(400).json({ error: `სტატუსი უნდა იყოს ერთ-ერთი: ${VALID_ORG_STATUSES.join(', ')}` });
  }

  try {
    const result = await db.query(
      `UPDATE organizations SET status = $1 WHERE id = $2 RETURNING id, name, status`,
      [status, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ორგანიზაცია ვერ მოიძებნა!' });
    }

    const updated = result.rows[0];

    await writeSuperadminAuditLog(
      req.platformAdmin!.id,
      'organization.status_changed',
      id,
      `"${updated.name}" — სტატუსი შეიცვალა: ${status}`
    );

    res.json({ id: updated.id, name: updated.name, status: updated.status });
  } catch (err: unknown) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + getErrorMessage(err) });
  }
});

// ==========================================
// ⏳ PATCH /platform-admin/organizations/:id/trial — Trial-ის გაგრძელება
// ==========================================
// body: { extendDays: number } — GREATEST(მიმდინარე trial_ends_at, NOW())-ს
// ემატება extendDays დღე. GREATEST-ი აქ პრინციპულია: თუ trial უკვე
// ამოწურულია (trial_ends_at წარსულშია), "გაგრძელება" NOW()-დან ითვლის,
// არა უკვე გასული თარიღიდან — თორემ 7-დღიანი გაგრძელება
// კომპანიას, ვისაც trial 2 თვის წინ ამოეწურა, პრაქტიკულად არაფერს
// მისცემდა.
router.patch('/platform-admin/organizations/:id/trial', authenticatePlatformAdmin, async (req: PlatformAdminRequest, res: Response) => {
  const { id } = req.params;
  const { extendDays } = req.body;

  if (!UUID_REGEX.test(id)) {
    return res.status(400).json({ error: 'არავალიდური ორგანიზაციის ID!' });
  }
  const days = Number(extendDays);
  if (!Number.isInteger(days) || days <= 0 || days > 365) {
    return res.status(400).json({ error: 'extendDays უნდა იყოს მთელი რიცხვი, 1-დან 365-მდე!' });
  }

  try {
    const result = await db.query(
      `UPDATE organizations
       SET trial_ends_at = GREATEST(COALESCE(trial_ends_at, NOW()), NOW()) + ($1 || ' days')::interval
       WHERE id = $2
       RETURNING id, name, trial_ends_at`,
      [days, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ორგანიზაცია ვერ მოიძებნა!' });
    }

    const updated = result.rows[0];

    await writeSuperadminAuditLog(
      req.platformAdmin!.id,
      'organization.trial_extended',
      id,
      `"${updated.name}" — trial გაგრძელდა ${days} დღით, ახალი ვადა: ${updated.trial_ends_at}`
    );

    res.json({ id: updated.id, name: updated.name, trialEndsAt: updated.trial_ends_at });
  } catch (err: unknown) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + getErrorMessage(err) });
  }
});

// ==========================================
// 📜 GET /platform-admin/audit-logs — Superadmin action-ების ისტორია
// ==========================================
router.get('/platform-admin/audit-logs', authenticatePlatformAdmin, async (req: PlatformAdminRequest, res: Response) => {
  // 📄 მარტივი limit/offset გვერდვა — query param-ებით, პროექტში
  // დამკვიდრებული (audit-logs.ts-ის) კონვენციისგან დამოუკიდებლად
  // მინიმალურად საკმარისი ამ ეტაპისთვის.
  const limitRaw = Number(req.query.limit);
  const offsetRaw = Number(req.query.offset);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;
  const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

  try {
    const result = await db.query(
      `SELECT
         sal.id, sal.action, sal.details, sal.created_at,
         pa.name AS admin_name, pa.email AS admin_email,
         o.name AS organization_name
       FROM superadmin_audit_logs sal
       JOIN platform_admins pa ON pa.id = sal.platform_admin_id
       LEFT JOIN organizations o ON o.id = sal.target_organization_id
       ORDER BY sal.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json(
      result.rows.map((row) => ({
        id: row.id,
        action: row.action,
        details: row.details,
        createdAt: row.created_at,
        adminName: row.admin_name,
        adminEmail: row.admin_email,
        organizationName: row.organization_name,
      }))
    );
  } catch (err: unknown) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + getErrorMessage(err) });
  }
});

export default router;
