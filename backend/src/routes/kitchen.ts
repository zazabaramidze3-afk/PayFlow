// backend/src/routes/kitchen.ts
//
// 🍳 HoReCa Module STEP 2 — KDS (Kitchen Display System) routing
// (Roadmap "ROADMAP - HoReCa Module - 03.09.2026.md", STEP 2). ეს
// route-ები `order_items`-ს (STEP 1, migration 019) აჩვენებს/ცვლის
// station-ის მიხედვით ("gza 2" — ბრაუზერის ეკრანი, polling-ით —
// thermal printer (გზა 1) v1-ის scope-ს სცდება, roadmap-ის "future
// step"-ია).
//
// `orders.ts`-ის (`POST /orders/:id/items`) იგივე პატერნი: authenticateToken +
// requireBusinessType('horeca') ყველა ენდპოინტზე. Register/Shift context
// (requireRegister/checkActiveShift) აქ **არ** სჭირდება — KDS ეკრანი POS
// ტრანზაქციას არ ასრულებს, მხოლოდ კითხულობს/ცვლის უკვე არსებული ღია
// შეკვეთის item-ების kitchen_status-ს.

import { Router, Response } from 'express';
import { authenticateToken } from './auth';
import { CustomRequest } from './checkShift';
import { requireBusinessType } from '../middleware/requireBusinessType';
import { withOrgContext } from '../db';
import { KitchenStatus, KitchenTicket, Station, OrderItemModifierSummary } from '../types';

const router = Router();

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'უცნობი შეცდომა');

const VALID_STATIONS: readonly Station[] = ['kitchen', 'bar'];

// 🔀 დაშვებული "წინსვლის" გადასვლები — KDS ეკრანიდან მხოლოდ წინ,
// არასდროს უკან (გაუქმება ცალკე, `PATCH /orders/items/:id` { void: true }
// ("STEP 1")-ითაა, არა აქ). `pending` თავად ტიკეტების სიაში არ ჩანს
// (იხ. GET /kitchen/tickets-ის WHERE), მაგრამ თეორიულად დაცულია.
const ALLOWED_TRANSITIONS: Partial<Record<KitchenStatus, readonly KitchenStatus[]>> = {
  pending: ['sent', 'preparing'],
  sent: ['preparing'],
  preparing: ['ready'],
  ready: ['served'],
};

const PATCHABLE_STATUSES: readonly KitchenStatus[] = ['preparing', 'ready', 'served'];

// ==========================================
// 🟢 GET /kitchen/tickets?station=kitchen|bar — აქტიური ტიკეტების სია
// ==========================================
router.get(
  '/kitchen/tickets',
  authenticateToken,
  requireBusinessType('horeca'),
  async (req: CustomRequest, res: Response) => {
    const stationParam = req.query.station;

    if (typeof stationParam !== 'string' || !VALID_STATIONS.includes(stationParam as Station)) {
      return res.status(400).json({ error: `station query-პარამეტრი უნდა იყოს: ${VALID_STATIONS.join(', ')}` });
    }

    try {
      const tickets = await withOrgContext(req.user?.organizationId, async (client) => {
        const ticketsResult = await client.query<Omit<KitchenTicket, 'modifiers'>>(
          `SELECT oi.id, oi.order_id, o.table_id, t.name AS table_name,
                  oi.product_id, p.name AS product_name, oi.quantity,
                  oi.seat_number, oi.course_number, oi.kitchen_status,
                  oi.station, oi.notes, oi.sent_to_kitchen_at, oi.created_at
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           JOIN products p ON p.id = oi.product_id
           LEFT JOIN tables t ON t.id = o.table_id
           WHERE o.organization_id = $1
             AND o.status = 'open'
             AND oi.station = $2
             AND oi.kitchen_status NOT IN ('served', 'voided')
           ORDER BY oi.created_at ASC`,
          [req.user?.organizationId, stationParam]
        );

        // 🧩 STEP 3.1 (მოდიფაიერები, migration 021) — სამზარეულომ/ბარმა
        // "medium rare", "+ ყველი" და ა.შ. აქაც უნდა დაინახოს, არა
        // მხოლოდ OrderScreen.tsx-ზე — routes/orders.ts-ის GET /orders/:id-ის
        // იგივე N+1-ის-თავიდან-არიდების პატერნი.
        const ticketIds = ticketsResult.rows.map((row) => row.id);
        const modifiersByTicketId = new Map<string, OrderItemModifierSummary[]>();
        if (ticketIds.length > 0) {
          const modifiersResult = await client.query<{ order_item_id: string } & OrderItemModifierSummary>(
            `SELECT oim.order_item_id, mo.id, mo.name, oim.price_delta_snapshot
             FROM order_item_modifiers oim
             JOIN modifier_options mo ON mo.id = oim.modifier_option_id
             WHERE oim.order_item_id = ANY($1)`,
            [ticketIds]
          );
          for (const row of modifiersResult.rows) {
            const list = modifiersByTicketId.get(row.order_item_id) ?? [];
            list.push({ id: row.id, name: row.name, price_delta_snapshot: row.price_delta_snapshot });
            modifiersByTicketId.set(row.order_item_id, list);
          }
        }

        const result: KitchenTicket[] = ticketsResult.rows.map((row) => ({
          ...row,
          modifiers: modifiersByTicketId.get(row.id) ?? [],
        }));
        return result;
      });

      res.json(tickets);
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

// ==========================================
// ✏️ PATCH /kitchen/tickets/:orderItemId/status — ტიკეტის სტატუსის წინსვლა
// ==========================================
router.patch(
  '/kitchen/tickets/:orderItemId/status',
  authenticateToken,
  requireBusinessType('horeca'),
  async (req: CustomRequest, res: Response) => {
    const { status } = req.body as { status?: unknown };

    if (typeof status !== 'string' || !PATCHABLE_STATUSES.includes(status as KitchenStatus)) {
      return res.status(400).json({ error: `status უნდა იყოს ერთ-ერთი: ${PATCHABLE_STATUSES.join(', ')}` });
    }
    const nextStatus = status as KitchenStatus;

    try {
      const item = await withOrgContext(req.user?.organizationId, async (client) => {
        const current = await client.query<{ kitchen_status: KitchenStatus; order_status: string }>(
          `SELECT oi.kitchen_status, o.status AS order_status
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           WHERE oi.id = $1 AND o.organization_id = $2`,
          [req.params.orderItemId, req.user?.organizationId]
        );

        if (current.rows.length === 0) {
          throw new Error('NOT_FOUND');
        }
        if (current.rows[0].order_status !== 'open') {
          throw new Error('ORDER_CLOSED');
        }

        const currentStatus = current.rows[0].kitchen_status;
        const allowedNext = ALLOWED_TRANSITIONS[currentStatus] ?? [];
        if (!allowedNext.includes(nextStatus)) {
          throw new Error('INVALID_TRANSITION');
        }

        const updateResult = await client.query<KitchenTicket>(
          `UPDATE order_items SET kitchen_status = $1 WHERE id = $2 RETURNING id, kitchen_status`,
          [nextStatus, req.params.orderItemId]
        );

        return updateResult.rows[0];
      });

      res.json(item);
    } catch (err: unknown) {
      if (err instanceof Error) {
        switch (err.message) {
          case 'NOT_FOUND':
            return res.status(404).json({ error: 'ტიკეტი ვერ მოიძებნა' });
          case 'ORDER_CLOSED':
            return res.status(400).json({ error: 'შეკვეთა უკვე დახურულია' });
          case 'INVALID_TRANSITION':
            return res.status(400).json({ error: 'ამ სტატუსზე გადასვლა ამ მომენტში დაუშვებელია' });
        }
      }
      res.status(500).json({ error: getErrorMessage(err) });
    }
  }
);

export default router;
