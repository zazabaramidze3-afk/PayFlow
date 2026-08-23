import { Router, Response } from 'express';
// შემოგვაქვს მზა PostgreSQL პული ძირითადი ფაილიდან
import { db } from '../index';
import { authenticateToken, CustomRequest, writeAuditLog } from './auth';
import { requireAnyRole } from '../middleware/requireRole';
import { StockDeficitNotification, ShiftAmendmentNotification } from '../types';

const router = Router();

// ==========================================
// 🔔 Stock Deficit Notifications — Roadmap STEP 5 (Background Sync Engine)
// ==========================================
// POST /api/payments/sync-offline (routes/sales.ts) ინახავს ერთ ჩანაწერს
// public.stock_deficit_notifications-ში ყოველ offline ჩეკის ხაზზე, სადაც
// სინქრონიზაციის მომენტისთვის მარაგი მოთხოვნილ რაოდენობაზე ნაკლები
// აღმოჩნდა (ორი Register-ის დამოუკიდებელი oversell-ი). ეს ორი ენდპოინტი
// Manager Dashboard-ს (ExecutiveDashboard.tsx) აძლევს საშუალებას, ჯერ
// ნახოს გადაუჭარბებელი oversell-ები და მერე მონიშნოს განხილულად.
//
// 🛡️ წვდომა: authenticateToken + requireAnyRole('admin', 'manager') —
// dashboard.ts-ის GET /dashboard/stats-ის ზუსტი პატერნი.

// 📜 გადაუჭარბებელი (is_resolved = false) ნოტიფიკაციები, უახლესი პირველი.
// product_name/cashier_name/register_name — snapshot/join, რომ ცხადი
// ტექსტი დაუყოვნებლივ გამოჩნდეს ცხრილში დამატებითი round-trip-ების გარეშე.
// 🏢 Multi-Tenant SaaS STEP 2, ტიერი 4 (Roadmap "23.08.2026") —
// `AND sdn.organization_id = $1` დაემატა. ამის გარეშე ერთი org-ის
// admin/manager-ს ყველა org-ის oversell-ნოტიფიკაცია ეჩვენებოდა.
router.get(
  '/notifications/stock-deficits',
  authenticateToken,
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    try {
      const result = await db.query<StockDeficitNotification & { cashier_name: string | null; register_name: string | null }>(
        `SELECT
           sdn.id, sdn.payment_id, sdn.product_id, sdn.product_name, sdn.register_id, sdn.cashier_id,
           sdn.requested_quantity, sdn.available_quantity, sdn.deficit_quantity,
           sdn.is_resolved, sdn.resolved_by, sdn.resolved_at, sdn.created_at,
           u.name AS cashier_name,
           r.name AS register_name
         FROM stock_deficit_notifications sdn
         LEFT JOIN users u ON u.id = sdn.cashier_id
         LEFT JOIN registers r ON r.id = sdn.register_id
         WHERE sdn.is_resolved = false AND sdn.organization_id = $1
         ORDER BY sdn.created_at DESC
         LIMIT 100`,
        [req.user?.organizationId]
      );
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ✅ ერთი ნოტიფიკაციის "განხილულად" მონიშვნა — row არ იშლება (ისტორია
// შენარჩუნებულია), მხოლოდ is_resolved/resolved_by/resolved_at ივსება.
// 🏢 Multi-Tenant SaaS STEP 2, ტიერი 4 (Roadmap "23.08.2026", IDOR fix) —
// `AND organization_id = $3` დაემატა — ამის გარეშე ერთი org-ის
// admin/manager-ს შეეძლო სხვა org-ის ნოტიფიკაციის "განხილულად" მონიშვნა,
// notification id-ის გამოცნობით.
router.put(
  '/notifications/stock-deficits/:id/resolve',
  authenticateToken,
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    try {
      const result = await db.query(
        `UPDATE stock_deficit_notifications
         SET is_resolved = true,
             resolved_by = $1,
             resolved_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND is_resolved = false AND organization_id = $3
         RETURNING id`,
        [req.user?.id, req.params.id, req.user?.organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'ნოტიფიკაცია ვერ მოიძებნა ან უკვე განხილულია' });
      }

      await writeAuditLog(req.user?.id, undefined, 'stock-deficit-resolved', `notification:${req.params.id}`, req.user?.organizationId);

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ==========================================
// 🧾 Shift Amendment Notifications — Migration 012 (Z-Report Late-Sync
// Reconciliation)
// ==========================================
// POST /api/payments/sync-offline (routes/sales.ts, syncSingleOfflineReceipt)
// ინახავს ერთ ჩანაწერს shift_amendments-ში ყოველ დაგვიანებულ offline
// ჩეკზე, რომელმაც უკვე დახურული ცვლის end_amount_expected/difference
// შეცვალა — ზუსტად stock-deficits-ის ზემოთა ორი ენდპოინტის პატერნი.
// register_name/cashier_name JOIN-ით, რომ Manager Dashboard-ს დამატებითი
// round-trip არ დასჭირდეს.

// 🏢 Multi-Tenant SaaS STEP 2, ტიერი 4 (Roadmap "23.08.2026") —
// `AND sa.organization_id = $1` დაემატა (იხ. stock-deficits-ის იგივე
// კომენტარი ზემოთ).
router.get(
  '/notifications/shift-amendments',
  authenticateToken,
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    try {
      const result = await db.query<ShiftAmendmentNotification & { cashier_name: string | null; register_name: string | null }>(
        `SELECT
           sa.id, sa.shift_id, sa.payment_id, sa.cashier_id, sa.register_id,
           sa.previous_expected, sa.new_expected, sa.previous_difference, sa.new_difference,
           sa.is_resolved, sa.resolved_by, sa.resolved_at, sa.created_at,
           u.name AS cashier_name,
           r.name AS register_name
         FROM shift_amendments sa
         LEFT JOIN users u ON u.id = sa.cashier_id
         LEFT JOIN registers r ON r.id = sa.register_id
         WHERE sa.is_resolved = false AND sa.organization_id = $1
         ORDER BY sa.created_at DESC
         LIMIT 100`,
        [req.user?.organizationId]
      );
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ✅ "ხელახლა დავბეჭდე Z-Report" დადასტურება — row არ იშლება (ისტორია
// შენარჩუნებულია), მხოლოდ is_resolved/resolved_by/resolved_at ივსება.
// 🏢 Multi-Tenant SaaS STEP 2, ტიერი 4 (Roadmap "23.08.2026", IDOR fix) —
// `AND organization_id = $3` დაემატა (იხ. stock-deficits-ის resolve-ის
// იგივე კომენტარი ზემოთ).
router.put(
  '/notifications/shift-amendments/:id/resolve',
  authenticateToken,
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    try {
      const result = await db.query(
        `UPDATE shift_amendments
         SET is_resolved = true,
             resolved_by = $1,
             resolved_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND is_resolved = false AND organization_id = $3
         RETURNING id`,
        [req.user?.id, req.params.id, req.user?.organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'ნოტიფიკაცია ვერ მოიძებნა ან უკვე განხილულია' });
      }

      await writeAuditLog(req.user?.id, undefined, 'shift-amendment-resolved', `shift:${req.params.id}`, req.user?.organizationId);

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
