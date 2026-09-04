// backend/src/routes/orders.ts
//
// 🍽️ HoReCa Module STEP 1 — ღია მაგიდის შეკვეთა (Roadmap "03.09.2026",
// migration 019). ეს ივსება (`orders`/`order_items`) იქამდე, სანამ ჩეკი
// საბოლოოდ დაიხურება — checkout თავად კვლავ არსებულ, უცვლელ
// `POST /api/payments`-ს გაივლის (`sales.ts`), მხოლოდ ახალი,
// არასავალდებულო `orderId`-ის გადაცემით (იხ. იქაური კომენტარი).

import { Router, Response } from 'express';
import { authenticateToken } from './auth';
import { checkActiveShift, CustomRequest } from './checkShift';
import { requireRegister } from '../middleware/registerAuth';
import { requireAnyRole } from '../middleware/requireRole';
import { requireBusinessType } from '../middleware/requireBusinessType';
import { withOrgContext } from '../db';
import { Order, OrderItem, OrderStatus, KitchenStatus } from '../types';

const router = Router();

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'უცნობი შეცდომა');

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505';

// ==========================================
// 🆕 POST /orders — ახალი შეკვეთის გახსნა
// ==========================================
// Retail-ის POST /payments-ის ანალოგიით — register/shift კონტექსტი
// სავალდებულოა (requireRegister + checkActiveShift), რადგან შეკვეთაც
// კონკრეტულ ფიზიკურ Register-ზე/ცვლაშია გახსნილი.
router.post(
  '/orders',
  authenticateToken,
  requireBusinessType('horeca'),
  requireRegister,
  checkActiveShift,
  async (req: CustomRequest, res: Response) => {
    const { tableId, guestCount } = req.body as { tableId?: unknown; guestCount?: unknown };

    let tableIdValue: string | null = null;
    if (tableId !== undefined && tableId !== null && tableId !== '') {
      if (typeof tableId !== 'string') {
        return res.status(400).json({ error: 'tableId არავალიდურია' });
      }
      tableIdValue = tableId;
    }

    let guestCountValue: number | null = null;
    if (guestCount !== undefined && guestCount !== null && guestCount !== '') {
      const parsed = Number(guestCount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res.status(400).json({ error: 'guestCount არავალიდურია' });
      }
      guestCountValue = Math.floor(parsed);
    }

    try {
      const order = await withOrgContext(req.user?.organizationId, async (client) => {
        if (tableIdValue) {
          const tableCheck = await client.query<{ status: string }>(
            'SELECT status FROM tables WHERE id = $1 AND organization_id = $2',
            [tableIdValue, req.user?.organizationId]
          );
          if (tableCheck.rows.length === 0) {
            throw new Error('მაგიდა ვერ მოიძებნა');
          }
          // 🩹 FIX (04.09.2026) — აქამდე მაგიდის სტატუსი საერთოდ არ
          // მოწმდებოდა: "occupied" ბუნებრივად იბლოკებოდა მხოლოდ
          // `orders`-ის unique constraint-ით (ქვემოთ, isUniqueViolation),
          // მაგრამ "reserved" (დაჯავშნილი) და "dirty" (დასალაგებელი)
          // მაგიდაზეც თავისუფლად იხსნებოდა ახალი შეკვეთა — რაც არასწორია:
          // დასალაგებელი მაგიდა ჯერ ხელით უნდა მოინიშნოს "თავისუფლად"
          // (დალაგების შემდეგ), დაჯავშნილიც კი მოსვლისას.
          if (tableCheck.rows[0].status !== 'free') {
            const statusLabels: Record<string, string> = {
              occupied: 'დაკავებული',
              reserved: 'დაჯავშნილი',
              dirty: 'დასალაგებელი',
            };
            const label = statusLabels[tableCheck.rows[0].status] ?? tableCheck.rows[0].status;
            throw new Error(`მაგიდა "${label}"-ია — ახალი შეკვეთის გახსნამდე დააყენეთ სტატუსი "თავისუფალი"`);
          }
        }

        const insertResult = await client.query<Order>(
          `INSERT INTO orders (organization_id, table_id, register_id, shift_id, opened_by, guest_count)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [req.user?.organizationId, tableIdValue, req.registerId, req.activeShiftId, req.user?.id, guestCountValue]
        );

        if (tableIdValue) {
          await client.query(`UPDATE tables SET status = 'occupied' WHERE id = $1`, [tableIdValue]);
        }

        return insertResult.rows[0];
      });

      res.status(201).json(order);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ error: 'ამ მაგიდაზე უკვე არსებობს ღია შეკვეთა' });
      }
      res.status(400).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// 🟢 GET /orders — ღია (ან სხვა სტატუსის) შეკვეთების სია
// ==========================================
router.get(
  '/orders',
  authenticateToken,
  requireBusinessType('horeca'),
  async (req: CustomRequest, res: Response) => {
    const statusParam = typeof req.query.status === 'string' ? req.query.status : 'open';
    const validStatuses: OrderStatus[] = ['open', 'closed', 'voided'];

    if (!validStatuses.includes(statusParam as OrderStatus)) {
      return res.status(400).json({ error: `status უნდა იყოს ერთ-ერთი: ${validStatuses.join(', ')}` });
    }

    try {
      const result = await withOrgContext(req.user?.organizationId, (client) =>
        client.query<Order & { table_name: string | null }>(
          `SELECT o.*, t.name AS table_name
           FROM orders o
           LEFT JOIN tables t ON t.id = o.table_id
           WHERE o.organization_id = $1 AND o.status = $2
           ORDER BY o.opened_at DESC`,
          [req.user?.organizationId, statusParam]
        )
      );
      res.json(result.rows);
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// 🔍 GET /orders/:id — ერთი შეკვეთა + სტრიქონები
// ==========================================
router.get(
  '/orders/:id',
  authenticateToken,
  requireBusinessType('horeca'),
  async (req: CustomRequest, res: Response) => {
    try {
      const { order, items } = await withOrgContext(req.user?.organizationId, async (client) => {
        const orderResult = await client.query<Order>('SELECT * FROM orders WHERE id = $1 AND organization_id = $2', [
          req.params.id,
          req.user?.organizationId,
        ]);

        if (orderResult.rows.length === 0) {
          throw new Error('NOT_FOUND');
        }

        const itemsResult = await client.query<OrderItem & { product_name: string }>(
          `SELECT oi.*, p.name AS product_name
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = $1
           ORDER BY oi.course_number ASC, oi.created_at ASC`,
          [req.params.id]
        );

        return { order: orderResult.rows[0], items: itemsResult.rows };
      });

      res.json({ ...order, items });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'NOT_FOUND') {
        return res.status(404).json({ error: 'შეკვეთა ვერ მოიძებნა' });
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// ➕ POST /orders/:id/items — item-ის დამატება ღია შეკვეთაზე
// ==========================================
router.post(
  '/orders/:id/items',
  authenticateToken,
  requireBusinessType('horeca'),
  async (req: CustomRequest, res: Response) => {
    const { productId, quantity, notes, seatNumber, courseNumber } = req.body as {
      productId?: unknown;
      quantity?: unknown;
      notes?: unknown;
      seatNumber?: unknown;
      courseNumber?: unknown;
    };

    const parsedProductId = Number(productId);
    if (!Number.isInteger(parsedProductId) || parsedProductId <= 0) {
      return res.status(400).json({ error: 'productId არავალიდურია' });
    }

    const parsedQuantity = Number(quantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({ error: 'quantity უნდა იყოს დადებითი მთელი რიცხვი' });
    }

    let seatNumberValue: number | null = null;
    if (seatNumber !== undefined && seatNumber !== null && seatNumber !== '') {
      const parsedSeat = Number(seatNumber);
      if (!Number.isInteger(parsedSeat) || parsedSeat <= 0) {
        return res.status(400).json({ error: 'seatNumber არავალიდურია' });
      }
      seatNumberValue = parsedSeat;
    }

    let courseNumberValue = 1;
    if (courseNumber !== undefined && courseNumber !== null && courseNumber !== '') {
      const parsedCourse = Number(courseNumber);
      if (!Number.isInteger(parsedCourse) || parsedCourse <= 0) {
        return res.status(400).json({ error: 'courseNumber არავალიდურია' });
      }
      courseNumberValue = parsedCourse;
    }

    const notesValue = typeof notes === 'string' && notes.trim().length > 0 ? notes.trim() : null;

    try {
      const item = await withOrgContext(req.user?.organizationId, async (client) => {
        const orderCheck = await client.query<{ status: OrderStatus }>(
          'SELECT status FROM orders WHERE id = $1 AND organization_id = $2',
          [req.params.id, req.user?.organizationId]
        );

        if (orderCheck.rows.length === 0) {
          throw new Error('NOT_FOUND');
        }
        if (orderCheck.rows[0].status !== 'open') {
          throw new Error('CLOSED');
        }

        const productCheck = await client.query<{ price: number }>(
          'SELECT price FROM products WHERE id = $1 AND organization_id = $2',
          [parsedProductId, req.user?.organizationId]
        );

        if (productCheck.rows.length === 0) {
          throw new Error('PRODUCT_NOT_FOUND');
        }

        const unitPrice = productCheck.rows[0].price;

        const insertResult = await client.query<OrderItem>(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price, seat_number, course_number, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [req.params.id, parsedProductId, parsedQuantity, unitPrice, seatNumberValue, courseNumberValue, notesValue]
        );

        return insertResult.rows[0];
      });

      res.status(201).json(item);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'NOT_FOUND') {
        return res.status(404).json({ error: 'შეკვეთა ვერ მოიძებნა' });
      }
      if (err instanceof Error && err.message === 'CLOSED') {
        return res.status(400).json({ error: 'შეკვეთა უკვე დახურულია' });
      }
      if (err instanceof Error && err.message === 'PRODUCT_NOT_FOUND') {
        return res.status(404).json({ error: 'პროდუქტი ვერ მოიძებნა' });
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// ✏️ PATCH /orders/items/:id — item-ის რედაქტირება ან გაუქმება (void)
// ==========================================
// ორი დამოუკიდებელი ოპერაცია ერთ ენდპოინტზე (body-ის ფორმის მიხედვით):
//   { void: true, voidReason? }              → item-ის გაუქმება
//   { quantity?, notes?, seatNumber?, courseNumber? } → რედაქტირება
// რედაქტირება დაშვებულია მხოლოდ 'pending' item-ზე (jერ სამზარეულოში არ
// გაგზავნილა — STEP 2-ის "sent" სტატუსის შემდეგ ცვლილება staleness-ს
// გამოიწვევდა KDS-ზე).
router.patch(
  '/orders/items/:id',
  authenticateToken,
  requireBusinessType('horeca'),
  async (req: CustomRequest, res: Response) => {
    const body = req.body as {
      void?: unknown;
      voidReason?: unknown;
      quantity?: unknown;
      notes?: unknown;
      seatNumber?: unknown;
      courseNumber?: unknown;
    };

    try {
      const item = await withOrgContext(req.user?.organizationId, async (client) => {
        const itemCheck = await client.query<{ id: string; kitchen_status: KitchenStatus; order_status: OrderStatus }>(
          `SELECT oi.id, oi.kitchen_status, o.status AS order_status
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           WHERE oi.id = $1 AND o.organization_id = $2`,
          [req.params.id, req.user?.organizationId]
        );

        if (itemCheck.rows.length === 0) {
          throw new Error('NOT_FOUND');
        }
        if (itemCheck.rows[0].order_status !== 'open') {
          throw new Error('CLOSED');
        }

        if (body.void === true) {
          const voidReasonValue =
            typeof body.voidReason === 'string' && body.voidReason.trim().length > 0 ? body.voidReason.trim() : null;

          const result = await client.query<OrderItem>(
            `UPDATE order_items
             SET kitchen_status = 'voided', voided_by = $1, void_reason = $2
             WHERE id = $3
             RETURNING *`,
            [req.user?.id, voidReasonValue, req.params.id]
          );
          return result.rows[0];
        }

        if (itemCheck.rows[0].kitchen_status !== 'pending') {
          throw new Error('NOT_EDITABLE');
        }

        const updates: string[] = [];
        const values: Array<string | number | null> = [];

        if (body.quantity !== undefined) {
          const parsedQuantity = Number(body.quantity);
          if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
            throw new Error('INVALID_QUANTITY');
          }
          values.push(parsedQuantity);
          updates.push(`quantity = $${values.length}`);
        }

        if (body.notes !== undefined) {
          const notesValue = typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null;
          values.push(notesValue);
          updates.push(`notes = $${values.length}`);
        }

        if (body.seatNumber !== undefined) {
          let seatNumberValue: number | null = null;
          if (body.seatNumber !== null && body.seatNumber !== '') {
            const parsedSeat = Number(body.seatNumber);
            if (!Number.isInteger(parsedSeat) || parsedSeat <= 0) {
              throw new Error('INVALID_SEAT');
            }
            seatNumberValue = parsedSeat;
          }
          values.push(seatNumberValue);
          updates.push(`seat_number = $${values.length}`);
        }

        if (body.courseNumber !== undefined) {
          const parsedCourse = Number(body.courseNumber);
          if (!Number.isInteger(parsedCourse) || parsedCourse <= 0) {
            throw new Error('INVALID_COURSE');
          }
          values.push(parsedCourse);
          updates.push(`course_number = $${values.length}`);
        }

        if (updates.length === 0) {
          throw new Error('NO_FIELDS');
        }

        values.push(req.params.id);
        const result = await client.query<OrderItem>(
          `UPDATE order_items SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
          values
        );
        return result.rows[0];
      });

      res.json(item);
    } catch (err: unknown) {
      if (err instanceof Error) {
        switch (err.message) {
          case 'NOT_FOUND':
            return res.status(404).json({ error: 'შეკვეთის სტრიქონი ვერ მოიძებნა' });
          case 'CLOSED':
            return res.status(400).json({ error: 'შეკვეთა უკვე დახურულია' });
          case 'NOT_EDITABLE':
            return res.status(400).json({ error: 'ეს item უკვე გაგზავნილია/მომზადებულია — რედაქტირება შეუძლებელია' });
          case 'NO_FIELDS':
            return res.status(400).json({ error: 'განსაახლებელი ველი არ არის მითითებული' });
          case 'INVALID_QUANTITY':
            return res.status(400).json({ error: 'quantity უნდა იყოს დადებითი მთელი რიცხვი' });
          case 'INVALID_SEAT':
            return res.status(400).json({ error: 'seatNumber არავალიდურია' });
          case 'INVALID_COURSE':
            return res.status(400).json({ error: 'courseNumber არავალიდურია' });
        }
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// 🚫 POST /orders/:id/void — მთელი შეკვეთის გაუქმება (payment-ის გარეშე)
// ==========================================
// გამოსადეგია, თუ სტუმარი წავიდა შეკვეთის დახურვამდე — manager/admin,
// რადგან ეს ფინანსურად-მიმდებარე მოქმედებაა (Retail-ის void-payment
// უფლების ანალოგიით, `can_void_receipt`).
router.post(
  '/orders/:id/void',
  authenticateToken,
  requireBusinessType('horeca'),
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    try {
      const order = await withOrgContext(req.user?.organizationId, async (client) => {
        const result = await client.query<Order>(
          `UPDATE orders SET status = 'voided', closed_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND organization_id = $2 AND status = 'open'
           RETURNING *`,
          [req.params.id, req.user?.organizationId]
        );

        if (result.rows.length === 0) {
          throw new Error('NOT_FOUND_OR_CLOSED');
        }

        const order = result.rows[0];
        // 🩹 FIX (04.09.2026) — მაგიდის სტატუსი მაგიდის ფიზიკურ (და არა
        // ფინანსურ) მდგომარეობას უნდა ასახავდეს: სტუმარი უკვე იჯდა ამ
        // მაგიდასთან (ჭიქა, სკამი გადაადგილებული და ა.შ.), მიუხედავად
        // იმისა, გადაიხადა თუ შეკვეთა გაუქმდა. ამიტომ void-იც
        // ('checkout'-ის იდენტურად, sales.ts-ში) მაგიდას პირდაპირ
        // 'free'-ს ნაცვლად 'dirty'-ზე აბრუნებს — safety-first
        // floor-management პრაქტიკა: სჯობს ერთხელ ზედმეტად შემოწმდეს
        // მაგიდა, ვიდრე უსწორო/დაუზუსტებელი მაგიდა პირდაპირ ახალ
        // სტუმარს "თავისუფლად" შერჩეს.
        if (order.table_id) {
          await client.query(`UPDATE tables SET status = 'dirty' WHERE id = $1`, [order.table_id]);
        }

        return order;
      });

      res.json(order);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'NOT_FOUND_OR_CLOSED') {
        return res.status(404).json({ error: 'ღია შეკვეთა ვერ მოიძებნა' });
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

export default router;
