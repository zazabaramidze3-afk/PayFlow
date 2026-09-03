// backend/src/routes/tables.ts
//
// 🍽️ HoReCa Module STEP 1 — მაგიდების მართვა (Roadmap "03.09.2026",
// migration 019). ყველა ენდპოინტი `requireBusinessType('horeca')`-ს
// უკან დგას — Retail org-ს ამ ცხრილზე საერთოდ არ ექნება წვდომა
// (და, migration 019-ის default-ის გამო, არც row-ები).

import { Router, Response } from 'express';
import { authenticateToken, CustomRequest } from './auth';
import { requireAnyRole } from '../middleware/requireRole';
import { requireBusinessType } from '../middleware/requireBusinessType';
import { withOrgContext } from '../db';
import { RestaurantTable, TableStatus } from '../types';

const router = Router();

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'უცნობი შეცდომა');

const VALID_STATUSES: TableStatus[] = ['free', 'occupied', 'reserved', 'dirty'];

// ==========================================
// 🟢 GET /tables — მაგიდების სია (floor plan)
// ==========================================
// ყველა როლისთვის ხელმისაწვდომია (cashier-ის ჩათვლით) — STEP 1-ში
// მაგიდის ხედვა/შერჩევა ნებისმიერ სალაროზე მომუშავე თანამშრომელს
// სჭირდება, ისევე როგორც Retail-ში Products-ის სია.
router.get(
  '/tables',
  authenticateToken,
  requireBusinessType('horeca'),
  async (req: CustomRequest, res: Response) => {
    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query<RestaurantTable>(
          'SELECT * FROM tables WHERE organization_id = $1 ORDER BY section ASC NULLS LAST, name ASC',
          [req.user?.organizationId]
        )
      );
      res.json(result.rows);
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// 🆕 POST /tables — ახალი მაგიდის დამატება (manager/admin)
// ==========================================
router.post(
  '/tables',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    const { name, section, capacity } = req.body as { name?: unknown; section?: unknown; capacity?: unknown };

    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'მაგიდის სახელი სავალდებულოა' });
    }

    const sectionValue = typeof section === 'string' && section.trim().length > 0 ? section.trim() : null;

    let capacityValue: number | null = null;
    if (capacity !== undefined && capacity !== null && capacity !== '') {
      const parsedCapacity = Number(capacity);
      if (!Number.isFinite(parsedCapacity) || parsedCapacity <= 0) {
        return res.status(400).json({ error: 'capacity არავალიდურია' });
      }
      capacityValue = Math.floor(parsedCapacity);
    }

    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query<RestaurantTable>(
          `INSERT INTO tables (organization_id, name, section, capacity)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [req.user?.organizationId, name.trim(), sectionValue, capacityValue]
        )
      );
      res.status(201).json(result.rows[0]);
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// ✏️ PUT /tables/:id — მაგიდის რედაქტირება (manager/admin)
// ==========================================
router.put(
  '/tables/:id',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    const { name, section, capacity } = req.body as { name?: unknown; section?: unknown; capacity?: unknown };

    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'მაგიდის სახელი სავალდებულოა' });
    }

    const sectionValue = typeof section === 'string' && section.trim().length > 0 ? section.trim() : null;

    let capacityValue: number | null = null;
    if (capacity !== undefined && capacity !== null && capacity !== '') {
      const parsedCapacity = Number(capacity);
      if (!Number.isFinite(parsedCapacity) || parsedCapacity <= 0) {
        return res.status(400).json({ error: 'capacity არავალიდურია' });
      }
      capacityValue = Math.floor(parsedCapacity);
    }

    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query<RestaurantTable>(
          `UPDATE tables SET name = $1, section = $2, capacity = $3
           WHERE id = $4 AND organization_id = $5
           RETURNING *`,
          [name.trim(), sectionValue, capacityValue, req.params.id, req.user?.organizationId]
        )
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'მაგიდა ვერ მოიძებნა' });
      }

      res.json(result.rows[0]);
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// 🔄 PATCH /tables/:id/status — სტატუსის ცვლილება
// ==========================================
// ⚠️ 'occupied'-ზე/'free'-ზე გადასვლას ჩვეულებრივ `routes/orders.ts`
// (POST /orders, POST /payments-ის order-close ნაკადი) ავტომატურად
// განაგებს — ეს ენდპოინტი ხელით მარკირებისთვისაა (ჯავშანი/დასუფთავება),
// ამიტომ ყველა როლისთვის ღიაა, manager-ითვის დათქმის გარეშე.
router.patch(
  '/tables/:id/status',
  authenticateToken,
  requireBusinessType('horeca'),
  async (req: CustomRequest, res: Response) => {
    const { status } = req.body as { status?: unknown };

    if (typeof status !== 'string' || !VALID_STATUSES.includes(status as TableStatus)) {
      return res.status(400).json({ error: `status უნდა იყოს ერთ-ერთი: ${VALID_STATUSES.join(', ')}` });
    }

    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query<RestaurantTable>(
          `UPDATE tables SET status = $1 WHERE id = $2 AND organization_id = $3 RETURNING *`,
          [status, req.params.id, req.user?.organizationId]
        )
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'მაგიდა ვერ მოიძებნა' });
      }

      res.json(result.rows[0]);
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// 🗑️ DELETE /tables/:id — მაგიდის წაშლა (manager/admin)
// ==========================================
// ⚠️ `orders.table_id` FK (ON DELETE ღილაკის გარეშე, migration 019)
// ხელს შეუშლის წაშლას, თუ ამ მაგიდას ოდესმე ჰქონია შეკვეთა (ისტორიის
// შენარჩუნება, Retail-ის `products`-ის მსგავსად, სადაც `payment_items`
// წაშლილ პროდუქტსაც ინახავს) — 409-ით ვაბრუნებთ, ნაცვლად generic 500-ისა.
router.delete(
  '/tables/:id',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query('DELETE FROM tables WHERE id = $1 AND organization_id = $2 RETURNING id', [
          req.params.id,
          req.user?.organizationId,
        ])
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'მაგიდა ვერ მოიძებნა' });
      }

      res.status(204).send();
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      if (message.includes('foreign key') || message.includes('violates')) {
        return res.status(409).json({ error: 'ამ მაგიდას აქვს დაკავშირებული შეკვეთების ისტორია — წაშლა შეუძლებელია' });
      }
      res.status(500).json({ error: message });
    }
  }
);

export default router;
