import { Router, Request, Response } from 'express';
import crypto from 'crypto';
// შემოგვაქვს მზა PostgreSQL პული ძირითადი ფაილიდან
import { db } from '../index';
import { authenticateToken, CustomRequest } from './auth';
import { requireAnyRole } from '../middleware/requireRole';
import { signRegisterToken } from '../middleware/registerAuth';
// 🔒 Roadmap STEP 2.2 (RLS Full Rollout, "30.08.2026") — registers.ts,
// ბლოკი 5 (RLS rollout-ის ბოლო route-ფაილი). Migration 018-მა registers/
// activation_codes-ს RLS policy დაამატა (defense-in-depth, route-level
// `WHERE organization_id`-ის თავზე) — ამ ფაილშიც იმავე `withOrgContext`
// pattern-ზე გადავდივართ, რაც უკვე გატარებულია sales.ts (pilot),
// auth.ts, products.ts, dashboard.ts, notifications.ts-ში.
import { withOrgContext } from '../db';

const router = Router();

// ==========================================
// 🖥️ Device Pairing & Activation Flow — Roadmap STEP 2.2
// ==========================================
// იხ. backend/migrations/010_add_activation_codes.sql ნაკადის სრული
// აღწერისთვის. მოკლედ:
//   1) Unlinked ბრაუზერი → POST /registers/generate-code (ავტორიზაციის გარეშე)
//   2) Unlinked ბრაუზერი პოლინგავს → GET /registers/pairing-status/:code
//   3) Manager/Admin (სხვა, უკვე დაწყვილებულ მოწყობილობაზე) → POST /registers/pair

const CODE_TTL_MINUTES = 10;

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'უცნობი შეცდომა');

// 🎲 crypto.randomInt — უსაფრთხო (არაპროგნოზირებადი) შემთხვევითი რიცხვი,
// Math.random()-ისგან განსხვავებით. padStart უზრუნველყოფს ზუსტად 6 ციფრს
// (მაგ. 000042), თორემ პატარა რიცხვები მოკლე სტრიქონად დაიბეჭდებოდა.
function generateSixDigitCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// ==========================================
// 1) კოდის გენერირება — Unlinked ბრაუზერისთვის (ავტორიზაცია არ სჭირდება,
//    რადგან ამ მოწყობილობას ჯერ არავითარი session/token არ გააჩნია).
// ==========================================
// 🔒 RLS შენიშვნა: ეს route **განზრახ რჩება** პირდაპირ `db.query`-ზე —
// req.user აქ არ არსებობს (pre-auth), ანუ organizationId-იც არა გვაქვს
// გადასაცემი `withOrgContext`-ში. იგივე მიზეზი, რაც auth.ts-ის
// POST /login-სა და POST /auth/reset-password-initial-ში. activation_codes
// row ისედაც NULL org-ით იქმნება (migration 013/018-ის დოკუმენტირებული,
// NULLABLE დიზაინი) — RLS policy-ის `organization_id IS NULL` escape
// ამას აწესრიგებს DB-ის მხარეს.
router.post('/registers/generate-code', async (_req: Request, res: Response) => {
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  try {
    let code = '';
    let inserted = false;
    let attempts = 0;

    // 🔁 კოლიზიის (ორი 'pending' კოდი ერთდროულად ემთხვევა) შანსი
    // პრაქტიკულად ნულოვანია (1-დან-მილიონზე + 10წთ TTL), მაგრამ
    // uq_activation_codes_pending_code ინდექსი დაცვას მაინც უზრუნველყოფს —
    // კოლიზიაზე უბრალოდ ახალ კოდს ვცდით, მაქსიმუმ 5-ჯერ.
    while (!inserted && attempts < 5) {
      code = generateSixDigitCode();
      try {
        await db.query(
          `INSERT INTO activation_codes (code, status, expires_at) VALUES ($1, 'pending', $2)`,
          [code, expiresAt]
        );
        inserted = true;
      } catch (err: any) {
        if (err.code === '23505') {
          attempts++;
          continue;
        }
        throw err;
      }
    }

    if (!inserted) {
      return res.status(503).json({ error: 'კოდის გენერირება ვერ მოხერხდა — სცადეთ ხელახლა' });
    }

    res.status(201).json({
      code,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: CODE_TTL_MINUTES * 60,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + getErrorMessage(err) });
  }
});

// ==========================================
// 2) Polling — Unlinked ბრაუზერი ამით ამოწმებს, დაადასტურა თუ არა
//    მენეჯერმა/ადმინმა დაწყვილება. ავტორიზაცია არ სჭირდება იმავე მიზეზით.
// ==========================================
// 🔒 RLS შენიშვნა: იგივე მიზეზით რჩება db.query-ზე, რაც ზემოთა
// generate-code-ში — pre-auth, organizationId არ არსებობს.
router.get('/registers/pairing-status/:code', async (req: Request, res: Response) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'კოდი უნდა შედგებოდეს ზუსტად 6 ციფრისგან!' });
  }

  try {
    const result = await db.query(
      `SELECT id, status, register_id, register_token, expires_at
       FROM activation_codes WHERE code = $1
       ORDER BY created_at DESC LIMIT 1`,
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'კოდი ვერ მოიძებნა — დააგენერირეთ ახალი' });
    }

    const row = result.rows[0];

    // ⏳ ვადაგასული 'pending' კოდი — ზარმაცი ("lazy") ექსპირაცია: მხოლოდ
    // ვინმემ რომ სთხოვოს status ამ კონკრეტულ კოდზე, მაშინ ვნიშნავთ
    // 'expired'-ად ბაზაშივე (cron/scheduled job ცალკე არ გვჭირდება ამ
    // მასშტაბზე).
    if (row.status === 'pending' && new Date(row.expires_at).getTime() < Date.now()) {
      await db.query(`UPDATE activation_codes SET status = 'expired' WHERE id = $1`, [row.id]);
      return res.json({ status: 'expired' });
    }

    if (row.status === 'confirmed') {
      return res.json({
        status: 'confirmed',
        registerId: row.register_id,
        registerToken: row.register_token,
      });
    }

    return res.json({ status: row.status });
  } catch (err: unknown) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + getErrorMessage(err) });
  }
});

// ==========================================
// 3) დადასტურება — მხოლოდ Manager/Admin-ისთვის, უკვე დალოგინებული
//    (ანუ სხვა, წინასწარ დაწყვილებული) სესიიდან.
// ==========================================
router.post(
  '/registers/pair',
  authenticateToken,
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    const { code, registerId, newRegisterName } = req.body;

    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'კოდი უნდა შედგებოდეს ზუსტად 6 ციფრისგან!' });
    }

    const hasExistingRegisterId = typeof registerId === 'string' && registerId.trim().length > 0;
    const hasNewRegisterName = typeof newRegisterName === 'string' && newRegisterName.trim().length > 0;

    if (!hasExistingRegisterId && !hasNewRegisterName) {
      return res.status(400).json({
        error: 'აირჩიეთ არსებული სალარო (registerId) ან მიუთითეთ ახალი სალაროს სახელი (newRegisterName)!',
      });
    }

    try {
      // 🔒 activation_codes-ის code-ით ძებნა org-სპეციფიკური არ არის
      // (კოდი გლობალურად უნიკალურია, org ჯერ არ ჩანს row-ზე) — მაინც
      // withOrgContext-ში ვახვევთ, RLS defense-in-depth-ის ერთგვაროვნების
      // შესანარჩუნებლად (policy-ის `organization_id IS NULL` escape
      // ისედაც გაატარებდა).
      const codeResult = await withOrgContext(req.user?.organizationId, (client) =>
        client.query(
          `SELECT id, status, expires_at FROM activation_codes WHERE code = $1
         ORDER BY created_at DESC LIMIT 1`,
          [code]
        )
      );

      if (codeResult.rows.length === 0) {
        return res.status(404).json({ error: 'კოდი ვერ მოიძებნა' });
      }

      const activation = codeResult.rows[0];

      if (activation.status !== 'pending') {
        return res.status(400).json({ error: 'ეს კოდი უკვე დადასტურებულია ან ვადაგასულია' });
      }

      if (new Date(activation.expires_at).getTime() < Date.now()) {
        await withOrgContext(req.user?.organizationId, (client) =>
          client.query(`UPDATE activation_codes SET status = 'expired' WHERE id = $1`, [activation.id])
        );
        return res.status(400).json({ error: 'კოდის ვადა ამოიწურა — მოლარემ ახალი კოდი უნდა დააგენერიროს' });
      }

      let finalRegisterId: string;

      // 🏢 Multi-Tenant SaaS STEP 2, ტიერი 3 (Roadmap "23.08.2026") —
      // registers.ts-ს საერთოდ არ ჰქონდა org-ცნობიერება (migration 013
      // ამატებს registers.organization_id NOT NULL-ს, მაგრამ ეს ფაილი
      // მანამდე დაწერილი იყო). ორი ცალკე პრობლემა ერთდროულად:
      //   1) IDOR — არსებული registerId ნებისმიერი org-იდან შეიძლებოდა
      //      დაწყვილებულიყო, org-ის საკუთრების შემოწმების გარეშე.
      //   2) write-blocker — ახალი register-ის INSERT organization_id-ის
      //      გარეშე 500-ით ჩავარდებოდა (NOT NULL constraint, migration 013).
      // 🔒 STEP 2.2, ბლოკი 5 — orgId ახლა RLS-ის დამატებით შრესაც
      // გადის (migration 018), route-level `AND organization_id`-ის
      // თავზე.
      if (hasExistingRegisterId) {
        const regResult = await withOrgContext(req.user?.organizationId, (client) =>
          client.query(
            'SELECT id, is_active FROM registers WHERE id = $1 AND organization_id = $2',
            [registerId, req.user?.organizationId]
          )
        );
        if (regResult.rows.length === 0) {
          return res.status(404).json({ error: 'სალარო ვერ მოიძებნა' });
        }
        if (regResult.rows[0].is_active !== true) {
          return res.status(400).json({ error: 'ეს სალარო დეაქტივირებულია' });
        }
        finalRegisterId = regResult.rows[0].id;
      } else {
        const createResult = await withOrgContext(req.user?.organizationId, (client) =>
          client.query(
            `INSERT INTO registers (name, is_active, organization_id) VALUES ($1, true, $2) RETURNING id`,
            [String(newRegisterName).trim(), req.user?.organizationId]
          )
        );
        finalRegisterId = createResult.rows[0].id;
      }

      const registerToken = signRegisterToken(finalRegisterId);

      await withOrgContext(req.user?.organizationId, (client) =>
        client.query(
          `UPDATE activation_codes
         SET status = 'confirmed', register_id = $1, register_token = $2,
             confirmed_by = $3, confirmed_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
          [finalRegisterId, registerToken, req.user?.id, activation.id]
        )
      );

      res.json({ success: true, registerId: finalRegisterId, registerToken });
    } catch (err: unknown) {
      res.status(500).json({ error: 'სერვერის შეცდომა: ' + getErrorMessage(err) });
    }
  }
);

// ==========================================
// 4) სალაროების სია — Pairing UI-ს სჭირდება (Manager/Admin-მა უნდა
//    შეძლოს არჩევა უკვე არსებულ Register-ს შორის ან ახლის შექმნა).
// ==========================================
// 🏢 Multi-Tenant SaaS STEP 2, ტიერი 3-სთან ერთად გასწორდა (Roadmap
// "23.08.2026") — `WHERE organization_id = $1` დაემატა. ეს ტექნიკურად
// tier 4-ის (დარჩენილი read-only route-ები) ფარგლისაა, მაგრამ იმავე
// ფაილშია და პირდაპირ დაკავშირებულია ზემოთა POST /registers/pair-ის
// IDOR ფიქსთან — pairing UI-ს picker-ი წინააღმდეგ შემთხვევაში ყველა
// org-ის register-ს აჩვენებდა (data leak), მიუხედავად იმისა, რომ
// pair-ის დროს ახლა org-შემოწმება უკვე დგას.
// 🔒 STEP 2.2, ბლოკი 5 — withOrgContext დაემატა, RLS migration
// 018-ის დამატებით შრესთან ერთად.
router.get('/registers', authenticateToken, requireAnyRole('admin', 'manager'), async (req: CustomRequest, res: Response) => {
  try {
    const result = await withOrgContext(req.user?.organizationId, (client) =>
      client.query(
        'SELECT id, name, is_active, created_at FROM registers WHERE organization_id = $1 ORDER BY created_at ASC',
        [req.user?.organizationId]
      )
    );
    res.json(result.rows);
  } catch (err: unknown) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + getErrorMessage(err) });
  }
});

export default router;
