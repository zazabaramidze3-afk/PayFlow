import { Router, Response } from 'express';
// 🏢 Multi-Tenant SaaS STEP 2, ტიერი 5 (Roadmap "23.08.2026") — `JwtPayload`
// დაემატა named import-ად: export/excel და export/pdf ორივე ხელით
// (authenticateToken-ის გარეშე) ამოწმებს ტოკენს query param-იდან, ამიტომ
// `req.user`-ი არასდროს ივსება — ორგანიზაციის ამოსაღებად decoded payload
// თავად უნდა წაიკითხოს (იხ. ორივე route ქვემოთ).
import jwt, { JwtPayload } from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import path from 'path';
// 🔌 SAVEPOINT-ებზე დაფუძნებული per-item დამუშავებისთვის (Roadmap STEP 5,
// POST /payments/sync-offline) ცალკე, გამორჩეული PoolClient-ია საჭირო —
// pool.query() ყოველ გამოძახებაზე შემთხვევით connection-ს იღებს, SAVEPOINT
// კი ერთსა და იმავე connection-ზეა "მიბმული".
import { PoolClient } from 'pg';
// 🔒 Roadmap STEP 2.2 (RLS Pilot, "24.08.2026") — `withOrgContext` ცვლის
// ამ ფაილში ყველა წინანდელ `db.query(...)`-ს (პირდაპირ shared pool-ზე).
// RLS-ს (migration 017) სჭირდება `app.current_org_id`, კონკრეტულ
// connection-ზე/ტრანზაქციაზე დაყენებული — `withOrgContext` ამას
// უზრუნველყოფს ცხადი BEGIN/`set_config(..., true)`/COMMIT-ტრანზაქციით
// (იხ. `backend/src/db.ts`-ის დეტალური კომენტარი). ეს ამავდროულად
// აგვარებს დამოუკიდებელ, უკვე არსებულ ბაგსაც: POST /payments-სა და POST
// /payments/:id/void-ს ადრე `db.query('BEGIN')`/`COMMIT`/`ROLLBACK`
// ჰქონდათ **პირდაპირ pool-ზე** (არა dedicated client-ზე) — ტრანზაქციის
// უსაფრთხოება ტექნიკურად გარანტირებული არ იყო (pool-ს connection-ის
// გაცემა/დაბრუნება შეეძლო სტატემენტებს შორის).
import { withOrgContext } from '../db';
import { authenticateToken, writeAuditLog } from './auth';
import { checkActiveShift, CustomRequest } from './checkShift';
import {
  extractBearerToken,
  verifyManagerOverrideToken,
  consumeOverrideToken,
  ManagerOverridePayload,
} from '../middleware/managerOverride';
// 🖥️ Roadmap STEP 2.1 — "ერთი აქტიური Shift" წესი ახლა Per Register
// მუშაობს (არა გლობალურად მთელ მაღაზიაზე). requireRegister ამოწმებს
// X-Register-Id/X-Register-Token headers-ს და ავსებს req.registerId-ს.
import { requireRegister } from '../middleware/registerAuth';
// 📴 Roadmap STEP 5 — Background Sync Engine-ის request/response ტიპები
// (backend/src/types.ts-ში, frontend-ის offlineDb.ts-ის OfflineReceipt-ის
// ერთი წყაროდ). "any"-ის ნაცვლად ცალსახა ტიპები POST /payments/sync-offline-ისთვის.
import { OfflineSyncReceiptItem, OfflineSyncReceiptPayload, OfflineSyncResult } from '../types';

const router = Router();

// ==========================================
// 🔒 HttpError — Roadmap STEP 2.2 (RLS Pilot, "24.08.2026")
// ==========================================
// `withOrgContext`-ის callback-ის შიგნით validation-ტიპის შეცდომებს
// (400/403/404) ისე ისვრის, რომ გარეთა catch-ბლოკმა იცოდეს — საჭიროა
// თუ არა 500-ის ნაცვლად სხვა status-კოდი. `body`-ში ზუსტად ის JSON
// inline ინახავს, რასაც ეს route ორიგინალურად აბრუნებდა (ზოგი route
// `{ message }`-ს იყენებდა, ზოგი — `{ error }`-ს) — refactor-მა
// response-ის ფორმა არცერთ endpoint-ზე არ უნდა შეცვალოს.
class HttpError extends Error {
  public readonly statusCode: number;
  public readonly body: Record<string, unknown>;

  constructor(statusCode: number, body: Record<string, unknown>) {
    const message =
      typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : 'შეცდომა';
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

// ==========================================
// 🕐 Client-Side Timestamp Audit — Roadmap STEP 1.4
// ==========================================
// Offline-ში გატარებული გაყიდვის რეალური დრო არის ის მომენტი, როცა
// მოლარემ ჩეკი შეასრულა (შესაძლოა ინტერნეტის გარეშე), არა ის მომენტი,
// როცა Background Sync-მა საბოლოოდ მოახერხა სერვერთან დაკავშირება
// (STEP 5). ამიტომ POST /payments ახლა იღებს არასავალდებულო `createdAt`-ს
// (ISO 8601 string, კლიენტის საათის მიხედვით) და თავად წერს მას
// created_at-ში — DB-ის DEFAULT NOW()/TO_CHAR(CURRENT_TIMESTAMP...)-ის
// მაგივრად. თუ არ გამოიგზავნა (ჯერჯერობით ონლაინ checkout ასეა), სერვერის
// მიმდინარე დრო გამოიყენება ზუსტად იმავე ფორმატით — ქცევა უცვლელია.
function formatDbTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tbilisi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

// ==========================================
// 🔐 1. ცვლების მოდული (SHIFT MANAGEMENT)
// ==========================================

// ა) ცვლის სტატუსის შემოწმება (მიმდინარე მოლარისთვის)
// 🔒 STEP 2.2 (RLS Pilot) — `withOrgContext`-ში გადატანილია, `shifts`-ზე
// RLS ჩართულია (migration 017).
router.get('/shifts/status', authenticateToken, async (req: CustomRequest, res: Response) => {
  try {
    const result = await withOrgContext(req.user?.organizationId, (client) =>
      client.query(`SELECT * FROM shifts WHERE cashier_id = $1 AND status = 'open' LIMIT 1`, [req.user?.id])
    );

    if (result.rows.length === 0) {
      return res.json({ hasActiveShift: false, shift: null });
    }

    res.json({ hasActiveShift: true, shift: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ბ) ახალი ცვლის გახსნა
// 🖥️ Roadmap STEP 2.1 — requireRegister აუცილებელია: ცვლის "Per Register"
// იზოლაცია ვერ იმუშავებს, თუ არ ვიცით, რომელ ფიზიკურ სალაროზეა მოთხოვნა.
// 🔒 STEP 2.2 (RLS Pilot) — ორივე შემოწმება + INSERT ერთ `withOrgContext`
// ტრანზაქციაშია გაერთიანებული (ადრე სამი ცალკე, ავტოკომიტ query იყო).
router.post('/shifts/open', authenticateToken, requireRegister, async (req: CustomRequest, res: Response) => {
  if (req.user?.role !== 'cashier') {
    return res.status(403).json({ message: "ცვლის გახსნა შეუძლია მხოლოდ მოლარეს" });
  }

  const { start_amount } = req.body;
  if (start_amount === undefined || start_amount < 0) {
    return res.status(400).json({ message: "არავალიდური თანხა" });
  }

  try {
    const shiftId = await withOrgContext(req.user?.organizationId, async (client) => {
      // 🖥️ STEP 2.1 — "მხოლოდ ერთი აქტიური Shift" წესი ორ დონეზე მოწმდება:
      //   (ა) ამ კონკრეტულ Register-ზე უკვე არავის აქვს ღია ცვლა (სხვადასხვა
      //       ფიზიკურ Register-ზე კი პარალელურად რამდენიმე მოლარეს შეუძლია);
      //   (ბ) ამ მოლარეს (ადამიანს) არ აქვს სხვა Register-ზეც ღია ცვლა —
      //       ერთ ადამიანს ერთდროულად ორ სალაროზე ყოფნა ლოგიკურად არ შეიძლება.
      const registerCheck = await client.query(
        `SELECT id, cashier_id FROM shifts WHERE register_id = $1 AND status = 'open' LIMIT 1`,
        [req.registerId]
      );

      if (registerCheck.rows.length > 0) {
        const existing = registerCheck.rows[0];
        const message = existing.cashier_id !== req.user?.id
          ? "ეს სალარო უკვე დაკავებულია — სხვა მოლარეს აქვს ღია ცვლა. დაელოდეთ მის დახურვას."
          : "თქვენ უკვე გაქვთ გახსნილი ცვლა ამ სალაროზე";
        throw new HttpError(400, { message });
      }

      const cashierCheck = await client.query(
        `SELECT id FROM shifts WHERE cashier_id = $1 AND status = 'open' LIMIT 1`,
        [req.user?.id]
      );

      if (cashierCheck.rows.length > 0) {
        throw new HttpError(400, { message: "თქვენ უკვე გაქვთ გახსნილი ცვლა სხვა სალაროზე" });
      }

      // 🩹 FIX (16.08) — ადრე TO_CHAR(CURRENT_TIMESTAMP, ...) იყენებდა Postgres
      // სერვერის default timezone-ს (Neon-ზე UTC), ხოლო PUT /shifts/close ქვემოთ
      // ცხადად Asia/Tbilisi-ზე კონვერტირებულ დროს ინახავს (`new Date().toLocaleString(...,
      // { timeZone: 'Asia/Tbilisi' })`). შედეგად Manager Dashboard-ის "მოლარეების
      // ცვლები" ცხრილში opened_at ~4 საათით ჩამორჩებოდა closed_at-ს (UTC vs
      // UTC+4). `AT TIME ZONE 'Asia/Tbilisi'` აქაც იმავე კონვენციაზე გადმოჰყავს.
      // 🏢 Multi-Tenant SaaS STEP 2, ტიერი 5 (Roadmap "23.08.2026") —
      // **write-blocker fix**: migration 013-ის შემდეგ `shifts.organization_id`
      // NOT NULL-ია — ამის გარეშე ეს INSERT 500-ით ჩავარდებოდა, ანუ "ცვლის
      // გახსნა" (POS-ის სამუშაო ციკლის პირველი ნაბიჯი) საერთოდ არ იმუშავებდა
      // STEP 1-ის production-ზე merge-ის შემდეგ. `requireRegister`-მა უკვე
      // დაადასტურა (ზემოთ, registerAuth.ts), რომ req.registerId ამ user-ის
      // საკუთარ org-ს ეკუთვნის.
      const insertQuery = `
        INSERT INTO shifts (cashier_id, register_id, start_amount, status, opened_at, organization_id)
        VALUES ($1, $2, $3, 'open', TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tbilisi', 'YYYY-MM-DD HH24:MI:SS'), $4)
        RETURNING id
      `;
      const insertResult = await client.query(insertQuery, [req.user?.id, req.registerId, start_amount, req.user?.organizationId]);
      return insertResult.rows[0].id;
    });

    res.status(201).json({ message: "ცვლა გაიხსნა", shiftId });
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.statusCode).json(err.body);
    res.status(500).json({ error: err.message });
  }
});

// 💰 ერთი ცვლის ნაღდი/ბარათის ჯამების + ჩეკების რაოდენობის გამოთვლა —
// ერთი წყარო PUT /shifts/close-სთვისაც და Migration 012-ის late-sync
// reconciliation-ისთვისაც (syncSingleOfflineReceipt, ქვემოთ).
// 🔒 STEP 2.2 (RLS Pilot) — ხელმოწერა გამარტივდა `Pool | PoolClient` →
// მხოლოდ `PoolClient`: ორივე caller ახლა `withOrgContext`-ის მიერ
// მოწოდებულ dedicated client-ს იყენებს (ადრე PUT /shifts/close პირდაპირ
// shared pool-ს (`db`) გადასცემდა).
async function computeShiftTotals(
  client: PoolClient,
  shiftId: string
): Promise<{ total_cash: number; total_card: number; receipt_count: number }> {
  const salesSumResult = await client.query(
    `SELECT
       COALESCE(SUM(CASE WHEN p.payment_method = 'cash' THEN p.total_amount ELSE 0 END), 0)
         + COALESCE((
             SELECT SUM(ps.amount)
             FROM payment_splits ps
             JOIN payments p2 ON p2.id = ps.payment_id
             WHERE p2.shift_id = $1 AND p2.is_voided = false AND ps.method = 'cash'
           ), 0) AS total_cash,
       COALESCE(SUM(CASE WHEN p.payment_method = 'card' THEN p.total_amount ELSE 0 END), 0)
         + COALESCE((
             SELECT SUM(ps.amount)
             FROM payment_splits ps
             JOIN payments p2 ON p2.id = ps.payment_id
             WHERE p2.shift_id = $1 AND p2.is_voided = false AND ps.method = 'card'
           ), 0) AS total_card,
       COUNT(*) as receipt_count
     FROM payments p
     WHERE p.shift_id = $1 AND p.is_voided = false`,
    [shiftId]
  );

  return {
    total_cash: parseFloat(salesSumResult.rows[0].total_cash),
    total_card: parseFloat(salesSumResult.rows[0].total_card),
    receipt_count: Number(salesSumResult.rows[0].receipt_count),
  };
}

// გ) ცვლის დახურვა
// 🔒 STEP 2.2 (RLS Pilot) — `withOrgContext`-ში გადატანილია.
router.put('/shifts/close', authenticateToken, async (req: CustomRequest, res: Response) => {
  const { end_amount_actual } = req.body;

  if (end_amount_actual === undefined || end_amount_actual === null || isNaN(Number(end_amount_actual))) {
    return res.status(400).json({ message: "არავალიდური ფაქტობრივი თანხა" });
  }

  try {
    const responseData = await withOrgContext(req.user?.organizationId, async (client) => {
      const shiftResult = await client.query(
        `SELECT * FROM shifts WHERE cashier_id = $1 AND status = 'open' LIMIT 1`,
        [req.user?.id]
      );

      if (shiftResult.rows.length === 0) {
        throw new HttpError(400, { message: "აქტიური ცვლა ვერ მოიძებნა" });
      }

      const shift = shiftResult.rows[0];

      // 🧾 FIX (Roadmap ეტაპი 4): გაუქმებული ჩეკები (is_voided = true) აღარ უნდა
      // ერთვებოდეს მოსალოდნელ ნაღდ ფულში — მარაგიც უკან დაბრუნდა POST /:id/void-ზე,
      // ფულადი შემოსავალიც ფაქტობრივად აღარ არსებობს. წინააღმდეგ შემთხვევაში Z-Report-ის
      // "მოსალოდნელი" თანხა გაუქმებული ჩეკის ღირებულებასაც ითვლიდა რეალურად მიღებულად.
      // 🖨 receipt_count დაემატა Roadmap ეტაპი 7-ისთვის — Z-Report ბეჭდვას (PrintableZReport)
      // სჭირდება "გაყიდული ჩეკების რაოდენობა", იმავე is_voided-ფილტრით.
      //
      // 💰 FIX (Roadmap ეტაპი 8): total_cash აქამდე SUM(total_amount)-ს იღებდა
      // ყოველგვარი payment_method-ის დიფერენციაციის გარეშე — ანუ ბარათით
      // გადახდილი ჩეკიც ისე ითვლებოდა, თითქოს ფიზიკურად სალაროში ნაღდი ფული
      // შესულიყო. ახლა "მოსალოდნელი" ნაღდი ფული ითვლის მხოლოდ:
      //   • payment_method = 'cash' ჩეკების სრულ თანხას, პლუს
      //   • payment_method = 'split' ჩეკებიდან მხოლოდ payment_splits.method = 'cash' ნაწილს.
      // payment_method = 'card' საერთოდ არ ერთვება — ეს ფული სალაროში არასდროს
      // შედის, ბანკის ანგარიშზე მიდის. total_card ცალკე ემატება response-ს
      // (არსებულს არაფერს არ ცვლის) — მომავალში Z-Report ეკრანზეც გამოსაჩენად.
      //
      // 🧾 FIX (Migration 012): აქამდე receipt_count/total_card მხოლოდ ამ
      // response-ში ითვლებოდა და არსად ინახებოდა — თუ მოგვიანებით late-sync
      // reconciliation-მა (syncSingleOfflineReceipt) ეს ცვლა შეცვალა,
      // Manager Dashboard-ს (Dashboard.tsx-ის "მოლარეების ცვლები" ცხრილს)
      // Z-Report-ის ხელახლა დასაბეჭდად receipt_count/card_total-იც სჭირდება,
      // არა მხოლოდ end_amount_expected/difference — ამიტომ ახლა shifts
      // row-შიც ვინახავთ, ცალკე computeShiftTotals()-ის საშუალებით.
      const { total_cash, total_card, receipt_count } = await computeShiftTotals(client, shift.id);
      const end_amount_expected = shift.start_amount + total_cash;
      const difference = Number(end_amount_actual) - end_amount_expected;

      const closedAt = new Date().toLocaleString('en-US', { timeZone: 'Asia/Tbilisi', hour12: false });

      const updateQuery = `
        UPDATE shifts
        SET status = 'closed',
            closed_at = $1,
            end_amount_expected = $2,
            end_amount_actual = $3,
            difference = $4,
            receipt_count = $5,
            card_total = $6
        WHERE id = $7
      `;
      await client.query(updateQuery, [closedAt, end_amount_expected, end_amount_actual, difference, receipt_count, total_card, shift.id]);

      return {
        message: "ცვლა დაიხურა",
        start: shift.start_amount,
        expected: end_amount_expected,
        actual: Number(end_amount_actual),
        difference,
        receiptCount: receipt_count,
        // 💰 Roadmap ეტაპი 8 — დამატებითი ველი, არსებულს არაფერს არ ცვლის.
        cardTotal: total_card,
      };
    });

    res.json(responseData);
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.statusCode).json(err.body);
    res.status(500).json({ error: err.message });
  }
});

// დ) ცვლების ისტორია
// 🩹 FIX (12.08, STEP 5-ის ტესტირებისას აღმოჩენილი): `ORDER BY s.id DESC`
// SERIAL/INTEGER PK-ის დროინდელი კონვენცია იყო — Roadmap STEP 1-ის (migration
// 009) UUID მიგრაციის შემდეგ id აღარაფერს ამბობს შექმნის თანმიმდევრობაზე
// (UUID-ები ლექსიკოგრაფიულად თარიღივით არ ლაგდება), ამიტომ ღია ცვლა
// შემთხვევით ჩნდებოდა სიის შუაში, არა თავში. `opened_at` (TEXT,
// 'YYYY-MM-DD HH24:MI:SS' ფორმატით — dashboard.ts-ის იგივე ლექსიკოგრაფიული
// სორტირების კონვენცია) კი ნამდვილად ასახავს რეალურ დროს.
// 🏢 Multi-Tenant SaaS STEP 2, ტიერი 4 (Roadmap "23.08.2026") —
// `AND s.organization_id = $1` დაემატა. `req: any` → `req: CustomRequest`
// (org-ის წვდომისთვის საჭირო).
// 🔒 STEP 2.2 (RLS Pilot) — `withOrgContext`-ში გადატანილია.
router.get('/shifts/history', authenticateToken, async (req: CustomRequest, res: Response) => {
  if (req.user?.role === 'cashier') return res.status(403).json({ error: 'წვდომა შეზღუდულია!' });

  const query = `
    SELECT s.*, u.name AS cashier_name
    FROM shifts s
    LEFT JOIN users u ON s.cashier_id = u.id
    WHERE (u.role IS NULL OR u.role != 'admin') AND s.organization_id = $1
    ORDER BY s.opened_at DESC
  `;

  try {
    const result = await withOrgContext(req.user?.organizationId, (client) =>
      client.query(query, [req.user?.organizationId])
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// 🛒 2. გაყიდვები (POS) — მარაგების დაცვით + ფასდაკლების სისტემა
// ==========================================
// checkout body: { items: [...], discount?: { type: 'percent' | 'fixed', value: number } }
// - discount.type === 'percent' → 0-100 შუალედში
// - discount.type === 'fixed'   → არ უნდა აჭარბებდეს კალათის subtotal-ს
// - discount არ არის სავალდებულო; თუ არ გაიგზავნა, ძველებურად მუშაობს
// 🖥️ Roadmap STEP 2.1 — requireRegister დაემატა checkActiveShift-ის წინ,
// რომ register_id-იც ხელმისაწვდომი იყოს ჩეკის შესანახად (STEP 1.3).
router.post('/payments', authenticateToken, requireRegister, checkActiveShift, async (req: CustomRequest, res: any) => {
  // 🍽️ HoReCa Module STEP 1 (Roadmap "03.09.2026") — არასავალდებულო `orderId`.
  // Retail checkout-ს (frontend არასდროს გზავნის ამ ველს) ეს დამატება
  // ნულოვან გავლენას ახდენს — ქვემოთ, ტრანზაქციის ბოლოს, მხოლოდ მაშინ
  // მოქმედებს, თუ ცხადადაა გადმოცემული.
  const { items, discount, paymentMethod: paymentMethodInput, splits, cashReceived, createdAt, orderId } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'კალათა ცარიელია!' });

  if (orderId !== undefined && orderId !== null && typeof orderId !== 'string') {
    return res.status(400).json({ error: 'orderId არავალიდურია' });
  }

  // ==========================================
  // 🕐 Roadmap STEP 1.4 — Client-Side Timestamp Audit
  // ==========================================
  // Offline checkout-ისას (STEP 4/5) ბრაუზერი ჩეკს ინტერნეტის გარეშე ქმნის —
  // created_at სერვერის სინქრონიზაციის დროს კი არა, ტრანზაქციის რეალურ,
  // კლიენტის საათზე დაფიქსირებულ დროს უნდა ასახავდეს. createdAt არასავალდებულოა
  // (ჯერჯერობით ონლაინ POS checkout საერთოდ არ აგზავნის) — თუ არ მოვიდა,
  // სერვერის მიმდინარე დრო გამოიყენება, ზუსტად იმავე ფორმატით.
  let createdAtToStore: string;
  if (createdAt !== undefined && createdAt !== null && createdAt !== '') {
    const parsedCreatedAt = new Date(createdAt);
    if (isNaN(parsedCreatedAt.getTime())) {
      return res.status(400).json({ error: 'createdAt არავალიდურია (მოსალოდნელია ISO 8601 თარიღი)' });
    }
    createdAtToStore = formatDbTimestamp(parsedCreatedAt);
  } else {
    createdAtToStore = formatDbTimestamp(new Date());
  }

  // ==========================================
  // 💰 Roadmap ეტაპი 8 — გადახდის მეთოდის ვალიდაცია (cash / card / split)
  // ==========================================
  // paymentMethod არ არის მკაცრად სავალდებულო ველი — თუ არ მოვიდა (ან
  // ცნობილი არ არის), 'cash'-ად ითვლება. ეს ზუსტად ის ქცევა იყო, რაც
  // migration 008-მდე ერთადერთი რეალობა იყო (payment_method-ის გარეშე
  // ყველა გაყიდვა de facto ნაღდად ითვლებოდა), ამიტომ ძველი frontend
  // build-ებიც (თუ ოდესმე დარჩება) კვლავ იმუშავებდა.
  const paymentMethod: 'cash' | 'card' | 'split' =
    paymentMethodInput === 'card' || paymentMethodInput === 'split' ? paymentMethodInput : 'cash';

  let splitCash = 0;
  let splitCard = 0;

  if (paymentMethod === 'split') {
    const rawCash = Number(splits?.cash);
    const rawCard = Number(splits?.card);

    if (!Number.isFinite(rawCash) || !Number.isFinite(rawCard) || rawCash <= 0 || rawCard <= 0) {
      return res.status(400).json({ error: 'შერეული გადახდისთვის საჭიროა ორივე დადებითი თანხა (ნაღდი და ბარათი)' });
    }

    splitCash = Number(rawCash.toFixed(2));
    splitCard = Number(rawCard.toFixed(2));
  } else if (splits !== undefined && splits !== null) {
    return res.status(400).json({ error: 'splits დასაშვებია მხოლოდ "split" გადახდის მეთოდისთვის' });
  }

  // ==========================================
  // ფასდაკლების ვალიდაცია და გამოთვლა (receipt-level)
  // ==========================================
  let discountType: 'percent' | 'fixed' | null = null;
  let discountValue = 0;

  if (discount !== undefined && discount !== null) {
    if (discount.type !== 'percent' && discount.type !== 'fixed') {
      return res.status(400).json({ error: 'discount.type უნდა იყოს "percent" ან "fixed"' });
    }

    const rawValue = Number(discount.value);
    if (isNaN(rawValue) || rawValue < 0) {
      return res.status(400).json({ error: 'ფასდაკლების მნიშვნელობა არავალიდურია' });
    }

    if (discount.type === 'percent' && rawValue > 100) {
      return res.status(400).json({ error: 'პროცენტული ფასდაკლება არ შეიძლება 100%-ზე მეტი იყოს' });
    }

    if (rawValue > 0) {
      discountType = discount.type;
      discountValue = rawValue;
    }
  }

  // ==========================================
  // 🔐 ფასდაკლების უფლების სერვერული შემოწმება (can_use_discount)
  // ეს არის frontend-ის disabled-input-ის ბოლო ბარიერი: მოთხოვნა შეიძლება
  // მოვიდეს პირდაპირ API-დან (Postman/curl) და UI-ის ბლოკს გვერდი აუაროს.
  // ვამოწმებთ ბაზიდან სვეჟ მნიშვნელობას (არა JWT-ს), რომ ადმინის/მენეჯერის
  // მიერ უფლების მომენტალურად გამორთვა დაუყოვნებლივ ეფექტური იყოს.
  //
  // 🔑 Manager PIN Override (Roadmap ეტაპი 2): თუ მოლარეს can_use_discount
  // არა აქვს, მაგრამ POST /api/auth/verify-manager-pin-იდან მიღებული
  // X-Manager-Override: Bearer <token> ჰედერი ვალიდურია (ხელმოწერა+ვადა+
  // cashierId ემთხვევა+jti ჯერ არ მოხმარებულა) — ტრანზაქცია მაინც დაიშვება.
  //
  // 🔒 STEP 2.2 (RLS Pilot) — `users`-ის ეს SELECT-იც `withOrgContext`-ში
  // გადავიდა (ცალკე, პატარა ტრანზაქციაში — checkout-ის მთავარ INSERT-ებთან
  // ატომურობა აქ საჭირო არაა, უფლების pre-check-ია).
  // ==========================================
  let managerOverrideUsed: ManagerOverridePayload | null = null;

  if (discountType !== null && discountValue > 0) {
    try {
      const hasOwnPermission = await withOrgContext(req.user?.organizationId, async (client) => {
        const permCheck = await client.query('SELECT can_use_discount FROM users WHERE id = $1', [req.user?.id]);
        return permCheck.rows.length > 0 && permCheck.rows[0].can_use_discount === true;
      });

      if (!hasOwnPermission) {
        const overrideToken = extractBearerToken(req.headers['x-manager-override']);
        const overridePayload = overrideToken ? verifyManagerOverrideToken(overrideToken) : null;

        // 🔒 ტოკენი მკაცრად იმ მოლარის სესიას უნდა ეკუთვნოდეს, ვინც PIN
        // გამოითხოვა — სხვა ტერმინალიდან "მოპარული" header ვერ იმუშავებს.
        managerOverrideUsed = overridePayload && overridePayload.cashierId === req.user?.id ? overridePayload : null;
      }

      if (!hasOwnPermission && !managerOverrideUsed) {
        return res.status(403).json({ error: 'თქვენ არ გაქვთ ფასდაკლების გამოყენების უფლება' });
      }
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  const subtotalAmount = items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);

  let discountAmount = 0;
  if (discountType === 'percent') {
    discountAmount = subtotalAmount * (discountValue / 100);
  } else if (discountType === 'fixed') {
    discountAmount = discountValue;
  }

  if (discountAmount > subtotalAmount) {
    return res.status(400).json({ error: 'ფასდაკლება არ შეიძლება აჭარბებდეს ჯამურ თანხას' });
  }

  const totalAmount = Number((subtotalAmount - discountAmount).toFixed(2));

  // 💰 Roadmap ეტაპი 8 — SPLIT-ის ორი ნაწილი ზუსტად ჯამურ თანხას უნდა
  // ემთხვეოდეს. ჯამის დათვლა/შედარება მხოლოდ ახლა ხდება, რადგან totalAmount
  // (ფასდაკლების გათვალისწინებით) ზემოთ ახლახან გამოითვალა. epsilon 0.01 —
  // `real` (float) სვეტია, ისევე როგორც totalAmount-ის დათვლის toFixed(2)
  // კონვენცია ზემოთ.
  if (paymentMethod === 'split') {
    const splitSum = Number((splitCash + splitCard).toFixed(2));
    if (Math.abs(splitSum - totalAmount) > 0.01) {
      return res.status(400).json({
        error: `გადახდების ჯამი (${splitSum.toFixed(2)} ₾) არ ემთხვევა ჩეკის თანხას (${totalAmount.toFixed(2)} ₾)`,
      });
    }
  }

  // 💵 ხურდის დათვლა — cashReceived არასავალდებულოა (მოლარემ შეიძლება
  // საერთოდ არ შეავსოს). cashDue არის ის თანხა, რაც რეალურად ნაღდით
  // იფარება: 'cash'-ზე მთლიანი totalAmount, 'split'-ზე მხოლოდ splitCash,
  // 'card'-ზე 0 (cashReceived card-ზე უბრალოდ იგნორირდება).
  let changeDue = 0;
  let cashReceivedToStore: number | null = null;

  if (cashReceived !== undefined && cashReceived !== null && cashReceived !== '') {
    const received = Number(cashReceived);
    if (!Number.isFinite(received) || received < 0) {
      return res.status(400).json({ error: 'cashReceived არავალიდურია' });
    }

    const cashDue = paymentMethod === 'cash' ? totalAmount : paymentMethod === 'split' ? splitCash : 0;

    if (cashDue > 0 && received < cashDue) {
      return res.status(400).json({ error: 'მიღებული ნაღდი ფული ნაკლებია გადასახდელ თანხაზე' });
    }

    cashReceivedToStore = Number(received.toFixed(2));
    changeDue = Number((received - cashDue).toFixed(2));
  }

  // 🔒 STEP 2.2 (RLS Pilot) — მთელი checkout-ტრანზაქცია (payment INSERT +
  // splits + items + stock decrement) ერთ `withOrgContext`-შია. ორიგინალი
  // ქცევა შენარჩუნებულია: ნებისმიერი შეცდომა (მარაგის დეფიციტის ჩათვლით)
  // 400-ს აბრუნებდა, არა მხოლოდ "ნამდვილი" validation-შეცდომები — ეს
  // refactor მხოლოდ ტრანზაქცია-მართვას (BEGIN/COMMIT/ROLLBACK) ცვლის
  // `withOrgContext`-ის სასარგებლოდ, response-კონტრაქტს არა.
  try {
    const paymentId = await withOrgContext(req.user?.organizationId, async (client) => {
      // 🖥️ register_id (STEP 1.3) და created_at (STEP 1.4, DB DEFAULT-ის
      // ნაცვლად ცალსახად გადაცემული) დაემატა INSERT-ს.
      // 🏢 Multi-Tenant SaaS STEP 2, ტიერი 5 (Roadmap "23.08.2026") —
      // **write-blocker fix**: `organization_id` NOT NULL-ია (migration 013)
      // — ამის გარეშე ყოველი checkout 500-ით ჩავარდებოდა.
      const paymentQuery = `
        INSERT INTO payments (cashier_id, shift_id, register_id, subtotal_amount, discount_type, discount_value, total_amount, payment_method, cash_received, created_at, organization_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `;
      const paymentResult = await client.query(paymentQuery, [
        req.user?.id,
        req.activeShiftId,
        req.registerId,
        subtotalAmount,
        discountType,
        discountValue,
        totalAmount,
        paymentMethod,
        cashReceivedToStore,
        createdAtToStore,
        req.user?.organizationId
      ]);
      const newPaymentId = paymentResult.rows[0].id;

      // 🔀 SPLIT-ის ორი ტენდერ-ხაზი — PUT /shifts/close-ის Z-Report ამათგან
      // ითვლის, რა ნაწილი ევალება ფაქტობრივად სალაროში ნაღდ ფულში.
      if (paymentMethod === 'split') {
        await client.query(
          `INSERT INTO payment_splits (payment_id, method, amount) VALUES ($1, 'cash', $2), ($1, 'card', $3)`,
          [newPaymentId, splitCash, splitCard]
        );
      }

      for (const item of items) {
        const pId = item.productId || item.product_id;

        await client.query(
          `INSERT INTO payment_items (payment_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)`,
          [newPaymentId, pId, item.quantity, item.price]
        );

        const updateStockResult = await client.query(
          `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1`,
          [item.quantity, pId]
        );

        if (updateStockResult.rowCount === 0) {
          throw new Error(`არ არის საკმარისი მარაგი პროდუქტზე ID: ${pId}`);
        }
      }

      // 🍽️ HoReCa Module STEP 1 (Roadmap "03.09.2026") — თუ checkout მაგიდის
      // ღია შეკვეთიდან მოდის (orderId გადმოცემულია), აქვე ვხურავთ შეკვეთას
      // (status='closed', closed_payment_id) იმავე ატომურ ტრანზაქციაში,
      // რაც payment-ის შექმნა/stock-decrement. Retail checkout-ზე (orderId
      // არასდროს იგზავნება) ეს ბლოკი საერთოდ არ სრულდება — ნულოვანი
      // გავლენა. თუ orderId მითითებულია, მაგრამ აღარ არსებობს/უკვე
      // დახურულია, მთელი ტრანზაქცია (payment-ის ჩათვლით) უკან ბრუნდება
      // (ROLLBACK) და მოლარეს 400 უბრუნდება.
      //
      // 🩹 FIX (04.09.2026) — მაგიდას ანგარიშწორების შემდეგ პირდაპირ
      // 'free'-ზე კი არა, 'dirty'-ზე ("დასალაგებელი") ვაბრუნებთ: სტუმრები
      // წავიდნენ, მაგრამ მაგიდა ჯერ ლაგდება (ჭურჭელი/სუფრა) — მხოლოდ
      // ხელით (POS/tables.ts-ის PATCH /tables/:id/status) დალაგების
      // დადასტურების შემდეგ უნდა გახდეს ისევ 'free' შემდეგი სტუმრებისთვის.
      if (orderId) {
        const orderCloseResult = await client.query(
          `UPDATE orders SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_payment_id = $1
           WHERE id = $2 AND organization_id = $3 AND status = 'open'
           RETURNING table_id`,
          [newPaymentId, orderId, req.user?.organizationId]
        );

        if (orderCloseResult.rowCount === 0) {
          throw new Error('მითითებული შეკვეთა ვერ მოიძებნა ან უკვე დახურილია');
        }

        const closedTableId = orderCloseResult.rows[0].table_id;
        if (closedTableId) {
          await client.query(`UPDATE tables SET status = 'dirty' WHERE id = $1`, [closedTableId]);
        }
      }

      return newPaymentId;
    });

    // 🔑 Manager PIN Override გამოყენებული იყო ამ გადახდაზე — ტოკენი
    // ვნიშნავთ "მოხმარებულად" (single-use, ვეღარ გამოიყენება ხელახლა
    // ამავე ჩეკზე/სხვა checkout-ზე) და ვწერთ აუდიტ-ლოგს, კონკრეტულ
    // payment ID-ზე მიბმულს. COMMIT-ის შემდეგ ვწერთ განზრახ — თუ
    // ტრანზაქცია ROLLBACK-ზე წავიდა (მაგ. მარაგის კონფლიქტი), მენეჯერის
    // დადასტურება არ იწვის ტყუილად და მოლარეს ხელახლა შეუძლია იგივე
    // override-ით სცადოს.
    if (managerOverrideUsed) {
      consumeOverrideToken(managerOverrideUsed.jti);
      await writeAuditLog(
        managerOverrideUsed.managerId,
        req.user?.id ?? managerOverrideUsed.managerId,
        'manager-pin-override-used',
        `payment:${paymentId}`,
        req.user?.organizationId
      );
    }

    res.status(201).json({
      success: true,
      paymentId,
      subtotalAmount,
      discountType,
      discountValue,
      discountAmount,
      totalAmount,
      // 💰 Roadmap ეტაპი 8 — დამატებითი ველები, არსებულს არაფერს არ ცვლის.
      paymentMethod,
      splits: paymentMethod === 'split' ? { cash: splitCash, card: splitCard } : null,
      cashReceived: cashReceivedToStore,
      changeDue,
      // 🕐 Roadmap STEP 1.4 — ის ზუსტი created_at, რაც რეალურად ჩაიწერა
      // (კლიენტისეული ან სერვერის fallback), Offline sync-ის დროს
      // ჩეკის quittance-ის ასაღებად.
      createdAt: createdAtToStore,
      registerId: req.registerId
    });

  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ==========================================
// 🚫 2.5 ჩეკის გაუქმება (Void Receipt) — Roadmap ეტაპი 4
// ==========================================
// POST /api/payments/:id/void
// - შლის (ითვლის გაუქმებულად) უკვე გატარებულ ჩეკს და აბრუნებს
//   მასში შემავალი ყველა product-ის stock-ს უკან ბაზაში.
// - უფლების ლოგიკა ზუსტად ფასდაკლების (can_use_discount) პატერნის
//   ანალოგიურია: ჯერ სუფთა DB-იდან (არა JWT) ვამოწმებთ
//   can_void_receipt-ს, თუ ის false-ია — ვთხოვთ ვალიდურ
//   X-Manager-Override: Bearer <token> ჰედერს (იხ. auth.ts-ის
//   POST /auth/verify-manager-pin და middleware/managerOverride.ts).
// 🆔 UUID v4 ვალიდაციის ცალსახა Regex — "any"-ის/ზედაპირული truthy-შემოწმების
// ნაცვლად. payments.id ახლა UUID string-ია, აღარ არის SERIAL INTEGER.
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 🔒 STEP 2.2 (RLS Pilot) — მთელი ნაკადი (paymentCheck → permission-check →
// items → stock-restore → UPDATE) ერთ `withOrgContext`-შია გაერთიანებული.
// 404/400/403-ის ორიგინალური სტატუს-კოდები `HttpError`-ით ინარჩუნებს ზუსტ
// response-ფორმას.
router.post('/payments/:id/void', authenticateToken, async (req: CustomRequest, res: Response) => {
  const paymentId = req.params.id;
  if (!UUID_V4_REGEX.test(paymentId)) {
    return res.status(400).json({ error: 'ჩეკის ID არავალიდურია' });
  }

  try {
    const { managerOverrideUsed, voidPayment } = await withOrgContext(req.user?.organizationId, async (client) => {
      // 🏢 Multi-Tenant SaaS STEP 2, ტიერი 5 (Roadmap "23.08.2026", IDOR fix)
      // — `AND organization_id = $2` დაემატა. ამის გარეშე ეს ერთ-ერთი
      // ყველაზე სერიოზული IDOR იყო მთელ STEP 2-ში: ნებისმიერ ავტორიზებულ
      // (can_void_receipt უფლების ან manager override-ის მქონე) user-ს,
      // payment id-ის (UUID) გამოცნობით/გაუჟონვით, შეეძლო **სხვა org-ის
      // რეალური ფინანსური ჩეკის გაუქმება** — მარაგის დაბრუნებით და
      // ფინანსური ისტორიის შეცვლით ერთად.
      const paymentCheck = await client.query(
        'SELECT id, is_voided FROM payments WHERE id = $1 AND organization_id = $2',
        [paymentId, req.user?.organizationId]
      );

      if (paymentCheck.rows.length === 0) {
        throw new HttpError(404, { error: 'ჩეკი ვერ მოიძებნა' });
      }

      if (paymentCheck.rows[0].is_voided === true) {
        throw new HttpError(400, { error: 'ეს ჩეკი უკვე გაუქმებულია' });
      }

      // 🔐 can_void_receipt-ის სერვერული შემოწმება + Manager PIN Override —
      // POST /payments-ის დისკაუნთის შემოწმების ზუსტი ანალოგი.
      let managerOverrideUsed: ManagerOverridePayload | null = null;

      const permCheck = await client.query('SELECT can_void_receipt FROM users WHERE id = $1', [req.user?.id]);
      const hasOwnPermission = permCheck.rows.length > 0 && permCheck.rows[0].can_void_receipt === true;

      if (!hasOwnPermission) {
        const overrideToken = extractBearerToken(req.headers['x-manager-override']);
        const overridePayload = overrideToken ? verifyManagerOverrideToken(overrideToken) : null;

        // 🔒 იგივე დაცვა, რაც checkout-ზე: override ტოკენი მკაცრად იმ
        // მოლარეს უნდა ეკუთვნოდეს, ვინც PIN დაადასტურა.
        managerOverrideUsed = overridePayload && overridePayload.cashierId === req.user?.id ? overridePayload : null;
      }

      if (!hasOwnPermission && !managerOverrideUsed) {
        throw new HttpError(403, { error: 'თქვენ არ გაქვთ ჩეკის გაუქმების უფლება' });
      }

      const itemsResult = await client.query(
        'SELECT product_id, quantity FROM payment_items WHERE payment_id = $1',
        [paymentId]
      );

      for (const item of itemsResult.rows) {
        // best-effort restock — თუ პროდუქტი მას შემდეგ წაშლილა, rowCount 0-ია
        // და მარაგის დაბრუნებაზე აზრი აღარ აქვს, მაგრამ ჩეკის გაუქმებას მაინც
        // არ უნდა ვუშალოთ (payment_items.product_id-ს FK-შეზღუდვა არც აქვს).
        await client.query(
          'UPDATE products SET stock = stock + $1 WHERE id = $2',
          [item.quantity, item.product_id]
        );
      }

      // 🩹 FIX (16.08) — იგივე UTC-vs-Tbilisi ბაგი, რაც shifts.opened_at-ს
      // ჰქონდა: raw CURRENT_TIMESTAMP Postgres-ის server timezone-ს (UTC)
      // იყენებდა, payments.created_at კი formatDbTimestamp()-ით სამუშაოდ
      // ცხადად Asia/Tbilisi-ზეა კონვერტირებული. AT TIME ZONE იმავე
      // კონვენციაზე გადმოჰყავს voided_at-იც.
      // 🏢 STEP 2, ტიერი 5 — `AND organization_id = $3` აქაც, თანმიმდევრობის
      // გულისთვის (paymentCheck-ით უკვე დავრწმუნდით ორგ-საკუთრებაში, მაგრამ
      // defense-in-depth — dupCheck+UPDATE-ის იგივე ორმაგი შემოწმების
      // პატერნი, რასაც products.ts-ის PUT იყენებს).
      const voidResult = await client.query(
        `UPDATE payments
         SET is_voided = true,
             voided_at = TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tbilisi', 'YYYY-MM-DD HH24:MI:SS'),
             voided_by = $1
         WHERE id = $2 AND organization_id = $3
         RETURNING id, is_voided, voided_at, voided_by`,
        [req.user?.id, paymentId, req.user?.organizationId]
      );

      return { managerOverrideUsed, voidPayment: voidResult.rows[0] };
    });

    // 🔑 Manager PIN Override იყო გამოყენებული ამ გაუქმებაზე — ტოკენს
    // ვნიშნავთ მოხმარებულად (single-use) და ვწერთ აუდიტ-ლოგს, ისევე
    // როგორც checkout-ის 'manager-pin-override-used'-ს. COMMIT-ის
    // შემდეგ განზრახ, რომ ROLLBACK-ის შემთხვევაში მოლარემ იგივე
    // override-ით ხელახლა სცადოს.
    if (managerOverrideUsed) {
      consumeOverrideToken(managerOverrideUsed.jti);
      await writeAuditLog(
        managerOverrideUsed.managerId,
        req.user?.id ?? managerOverrideUsed.managerId,
        'void-receipt-override',
        `payment:${paymentId}`,
        req.user?.organizationId
      );
    }

    res.json({
      success: true,
      message: 'ჩეკი წარმატებით გაუქმდა',
      payment: voidPayment,
    });
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.statusCode).json(err.body);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 🔄 2.6 Background Sync Engine — Offline Receipts (Roadmap STEP 5)
// ==========================================
// ერთი offline ჩეკის სრული დამუშავება: ვალიდაცია → payments/payment_items/
// payment_splits INSERT → stock decrement (უარყოფითის დაშვებით, migration
// 011) → deficit-ის შემთხვევაში stock_deficit_notifications. საკუთარი
// SAVEPOINT-ის ფარგლებში გამოიძახება (იხ. POST /payments/sync-offline) —
// ნებისმიერ ეტაპზე throw-ი უსაფრთხოდ აბრუნებს მხოლოდ ამ ერთი ჩეკის
// ცვლილებებს, დანარჩენი batch-ი ხელუხლებელი რჩება.
//
// ⚠️ FIX (Migration 012, PROGRESS - 12.08.2026.md-ის "ცნობილი, დაუხურავი
// საკითხი"): თუ მოლარემ ცვლა უკვე დახურა (online-ზე დაბრუნების შემდეგ,
// სინქრონიზაციამდე), ეს ჩეკი მაინც ჩაიწერება ამ (უკვე დახურულ) shift_id-ზე —
// ფინანსური სიზუსტისთვის (ფული რეალურად ამ ცვლაზე იქნა აღებული) ისტორიული
// სისწორე პრიორიტეტულია. აქამდე ეს ნიშნავდა, რომ ცვლის უკვე დაბეჭდილი
// Z-Report საბოლოოდ არაზუსტი რჩებოდა (STEP 5-ის ცნობილი, დაუხურავი
// საკითხი). ახლა ფუნქციის ბოლოში (იხ. `if (shift.status === 'closed')`)
// ეს ავტომატურად "amend"-დება — shifts.end_amount_expected/difference
// ხელახლა გამოითვლება და მენეჯერს ნოტიფიკაცია უჩნდება (shift_amendments,
// notifications.ts-ის GET/PUT /notifications/shift-amendments).
// 🏢 Multi-Tenant SaaS STEP 2, ტიერი 5 (Roadmap "23.08.2026") — `organizationId`
// დაემატა პარამეტრად (call site-ი, POST /payments/sync-offline, req.user?.organizationId-ს
// გადასცემს) — ქვემოთ shift-ის org-საკუთრების შესამოწმებლად და ყველა
// ახალი row-ის (payments/stock_deficit_notifications/shift_amendments)
// organization_id-ით ჩასაწერად.
async function syncSingleOfflineReceipt(
  client: PoolClient,
  receipt: OfflineSyncReceiptPayload,
  registerId: string,
  organizationId: string | undefined,
  requestingUserId: string | undefined,
  requestingUserRole: string | undefined
): Promise<OfflineSyncResult> {
  // 🖥️ receipt.registerId — Dexie-ში (Roadmap STEP 4.1) იმ ფიზიკური
  // Register-ის UUID-ია, რომელმაც ეს ჩეკი შექმნა. requireRegister
  // middleware-ის registerId-ს (X-Register-Id header, ცხადი JWT-ხელმოწერით
  // დადასტურებული) უნდა ემთხვეოდეს — Background Sync Worker ყოველთვის
  // იმავე ფიზიკურ მოწყობილობაზე მუშაობს, სადაც ჩეკი შეიქმნა.
  if (receipt.registerId !== registerId) {
    throw new Error('ჩეკის registerId არ ემთხვევა სინქრონიზაციის მომთხოვნელ სალაროს');
  }

  // 🔒 Cashier-impersonation დაცვა (Roadmap "23.08.2026", ადრე დისციპლინის
  // დარღვევის გაცნობიერებული უარით გადადებული პუნქტი) — მოლარეს (role
  // 'cashier') არ უნდა შეეძლოს offline sync-ის დროს receipt.cashierId-ად
  // სხვისი id-ის მითითება, ავტორიზებული session-ისგან განსხვავებით.
  // Admin/manager-ისთვის განზრახ გამონაკლისი დარჩა — ხანგრძლივი offline
  // პერიოდის შემდეგ shift handover-ისას (მოლარე A-ს რიგგარეშე ჩეკი
  // ჯერ არ სინქრონდა, სანამ B არ შესულა იმავე Register-ზე), stuck ჩეკის
  // ხელით სინქრონიზაცია მენეჯერს/ადმინს უნდა შეეძლოს — წინააღმდეგ
  // შემთხვევაში ეს ლეგიტიმური გაყიდვა სამუდამოდ დაიკარგებოდა.
  if (requestingUserRole === 'cashier' && receipt.cashierId !== requestingUserId) {
    throw new Error('ჩეკის cashierId არ ემთხვევა ავტორიზებულ მომხმარებელს');
  }

  if (!Array.isArray(receipt.items) || receipt.items.length === 0) {
    throw new Error('ჩეკის კალათა ცარიელია');
  }

  const items: OfflineSyncReceiptItem[] = receipt.items;
  for (const item of items) {
    if (
      typeof item.productId !== 'number' ||
      typeof item.price !== 'number' || item.price < 0 ||
      typeof item.quantity !== 'number' || item.quantity <= 0 || !Number.isFinite(item.quantity)
    ) {
      throw new Error('ჩეკის ერთ-ერთი ერთეული არავალიდურია');
    }
  }

  if (receipt.paymentMethod !== 'cash' && receipt.paymentMethod !== 'card' && receipt.paymentMethod !== 'split') {
    throw new Error('paymentMethod არავალიდურია');
  }

  // 🔐 shift/register/cashier წყვილის სისწორე ბაზიდან (არა client-ის
  // pასწორი) — POST /payments-ის requireRegister-ის ანალოგიური "ნდობა
  // ცხადად, არა ბრმად" პრინციპი.
  // 🧾 Migration 012 — status/start_amount/end_amount_actual/
  // end_amount_expected/difference დამატებით ვკითხულობთ, რომ ქვემოთ
  // (item-ების ჩაწერის შემდეგ) ცხადად ვიცოდეთ, ეს ცვლა უკვე დახურული
  // დაგვხვდა თუ არა — late-sync reconciliation-ისთვის.
  // 🏢 STEP 2, ტიერი 5 — `organization_id`-იც ვკითხულობთ და ცალსახად
  // ვამოწმებთ. registerId (requireRegister-ის მიერ) და shift.register_id
  // (ზემოთ) უკვე ირიბად ზღუდავს org-ს, მაგრამ ცხადი შემოწმება defense-in-depth-ია
  // — იმ შემთხვევისთვისაც, თუ ძველი (STEP 1-მდე შექმნილი) shift-ი
  // organization_id-ის გარეშე/არასწორი მნიშვნელობით აღმოჩნდება.
  const shiftCheck = await client.query(
    `SELECT id, cashier_id, register_id, status, start_amount, end_amount_actual, end_amount_expected, difference, organization_id
     FROM shifts WHERE id = $1`,
    [receipt.shiftId]
  );
  if (shiftCheck.rows.length === 0) {
    throw new Error('ჩეკის ცვლა ვერ მოიძებნა');
  }
  const shift = shiftCheck.rows[0];
  if (shift.cashier_id !== receipt.cashierId || shift.register_id !== registerId) {
    throw new Error('ჩეკის ცვლა/სალარო/მოლარე კომბინაცია არასწორია');
  }
  if (organizationId !== undefined && shift.organization_id !== organizationId) {
    throw new Error('ჩეკის ცვლა თქვენს ორგანიზაციას არ ეკუთვნის');
  }

  // 🕐 client-side timestamp audit (Roadmap STEP 1.4/4.1-ის იგივე ფორმატი)
  const parsedCreatedAt = new Date(receipt.createdAt);
  if (isNaN(parsedCreatedAt.getTime())) {
    throw new Error('createdAt არავალიდურია');
  }
  const createdAtToStore = formatDbTimestamp(parsedCreatedAt);

  // 💰 თანხების ხელახლა გამოთვლა items-იდან (client-ის მიერ წინასწარ
  // გამოთვლილი subtotalAmount/totalAmount არ ენდობა პირდაპირ — POST
  // /payments-ის იგივე პრინციპი) — არითმეტიკული სისწორის დაცვა.
  const subtotalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  let discountType: 'percent' | 'fixed' | null = null;
  let discountValue = 0;
  if (receipt.discountType === 'percent' || receipt.discountType === 'fixed') {
    const rawValue = Number(receipt.discountValue);
    if (!Number.isFinite(rawValue) || rawValue < 0) {
      throw new Error('ფასდაკლების მნიშვნელობა არავალიდურია');
    }
    if (receipt.discountType === 'percent' && rawValue > 100) {
      throw new Error('პროცენტული ფასდაკლება არ შეიძლება 100%-ზე მეტი იყოს');
    }
    if (rawValue > 0) {
      discountType = receipt.discountType;
      discountValue = rawValue;
    }
  }

  let discountAmount = 0;
  if (discountType === 'percent') {
    discountAmount = subtotalAmount * (discountValue / 100);
  } else if (discountType === 'fixed') {
    discountAmount = discountValue;
  }
  if (discountAmount > subtotalAmount) {
    throw new Error('ფასდაკლება არ შეიძლება აჭარბებდეს ჯამურ თანხას');
  }

  const totalAmount = Number((subtotalAmount - discountAmount).toFixed(2));

  let splitCash = 0;
  let splitCard = 0;
  if (receipt.paymentMethod === 'split') {
    const rawCash = Number(receipt.splits?.cash);
    const rawCard = Number(receipt.splits?.card);
    if (!Number.isFinite(rawCash) || !Number.isFinite(rawCard) || rawCash <= 0 || rawCard <= 0) {
      throw new Error('შერეული გადახდისთვის საჭიროა ორივე დადებითი თანხა');
    }
    splitCash = Number(rawCash.toFixed(2));
    splitCard = Number(rawCard.toFixed(2));
    const splitSum = Number((splitCash + splitCard).toFixed(2));
    if (Math.abs(splitSum - totalAmount) > 0.01) {
      throw new Error('გადახდების ჯამი არ ემთხვევა ჩეკის თანხას');
    }
  }

  let cashReceivedToStore: number | null = null;
  if (receipt.cashReceived !== undefined && receipt.cashReceived !== null) {
    const received = Number(receipt.cashReceived);
    if (!Number.isFinite(received) || received < 0) {
      throw new Error('cashReceived არავალიდურია');
    }
    cashReceivedToStore = Number(received.toFixed(2));
  }

  // 🆔 id — client-ის crypto.randomUUID() (Roadmap STEP 4.1), უცვლელად
  // payments.id-ად. ON CONFLICT DO NOTHING + RETURNING id — თუ ეს ჩეკი
  // უკვე სინქრონდა ადრე (retry/ორმაგი Worker-გაშვება), აქ 0 row ბრუნდება
  // და ვიცით, რომ 'duplicate'-ია, არა შეცდომა.
  // 🏢 STEP 2, ტიერი 5 — **write-blocker fix**: `organization_id` NOT
  // NULL-ია (migration 013), ამის გარეშე ყოველი offline sync 'failed'
  // status-ს დააბრუნებდა (throw ხდება, SAVEPOINT-ის catch-ში ეჭერა) —
  // ანუ ONLINE checkout-ის იგივე write-blocker, უბრალოდ Background Sync-ის
  // batch-ში "ჩუმად" (თითოეული ჩეკის შედეგი results[]-შია, არა top-level
  // 500).
  const insertResult = await client.query(
    `INSERT INTO payments
       (id, cashier_id, shift_id, register_id, subtotal_amount, discount_type, discount_value, total_amount, payment_method, cash_received, created_at, is_offline_sync, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      receipt.id,
      receipt.cashierId,
      receipt.shiftId,
      registerId,
      subtotalAmount,
      discountType,
      discountValue,
      totalAmount,
      receipt.paymentMethod,
      cashReceivedToStore,
      createdAtToStore,
      organizationId,
    ]
  );

  if (insertResult.rowCount === 0) {
    return { id: receipt.id, status: 'duplicate' };
  }

  if (receipt.paymentMethod === 'split') {
    await client.query(
      `INSERT INTO payment_splits (payment_id, method, amount) VALUES ($1, 'cash', $2), ($1, 'card', $3)`,
      [receipt.id, splitCash, splitCard]
    );
  }

  let hadStockDeficit = false;

  for (const item of items) {
    await client.query(
      `INSERT INTO payment_items (payment_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)`,
      [receipt.id, item.productId, item.quantity, item.price]
    );

    // 🔒 FOR UPDATE — ორი paralelurad სინქრონიზებული ჩეკი (ორი Register)
    // ერთსა და იმავე პროდუქტზე row-level lock-ით ერიდება ერთმანეთს,
    // რომ deficit-ის გამოთვლა (availableBefore) race condition-ის გარეშე
    // იყოს ზუსტი.
    const stockRow = await client.query<{ stock: number }>(
      'SELECT stock FROM products WHERE id = $1 FOR UPDATE',
      [item.productId]
    );

    // 🗑️ პროდუქტი შესაძლოა შემდგომ წაშლილიყო — best-effort, ჩეკის
    // სინქრონიზაციას მაინც არ ვაჩერებთ (payment_items.product_id-ს FK არ
    // აქვს, migration 009-ის კომენტარი).
    if (stockRow.rows.length === 0) continue;

    const availableBefore = stockRow.rows[0].stock;
    const newStock = availableBefore - item.quantity;

    // 📉 Roadmap STEP 5 (migration 011) — უპირობო decrement, oversell-იც
    // დაშვებულია (chk_stock_positive მოხსნილია). ონლაინ checkout-ის
    // `WHERE stock >= $1` გუარდი აქ განზრახ არ გვაქვს.
    await client.query('UPDATE products SET stock = $1 WHERE id = $2', [newStock, item.productId]);

    if (availableBefore < item.quantity) {
      hadStockDeficit = true;
      const deficitQuantity = item.quantity - availableBefore;
      // 🏢 STEP 2, ტიერი 5 — write-blocker fix (organization_id NOT NULL,
      // migration 013), payments-ის ზემოთა INSERT-ის იგივე მიზეზით.
      await client.query(
        `INSERT INTO stock_deficit_notifications
           (payment_id, product_id, product_name, register_id, cashier_id, requested_quantity, available_quantity, deficit_quantity, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [receipt.id, item.productId, item.name, registerId, receipt.cashierId, item.quantity, availableBefore, deficitQuantity, organizationId]
      );
    }
  }

  let causedShiftAmendment = false;

  // 🧾 Migration 012 — Late-close race condition reconciliation
  // (PROGRESS - 12.08.2026.md-ის "ცნობილი, დაუხურავი საკითხი"): ეს ჩეკი
  // უკვე დახურულ ცვლაზე ჩაიწერა (ფინანსური სიზუსტისთვის — ფული რეალურად
  // ამ ცვლაზე იქნა აღებული, იხ. ფაილის თავში ფუნქციის კომენტარი).
  // Server-side ბლოკირება პრინციპულადაც შეუძლებელია (ბექენდს არ სწვდება
  // კლიენტის IndexedDB queue-ს — Sales.tsx-ის Late-close guard მხოლოდ
  // frontend-ის დონეზეა), ამიტომ ბლოკვის ნაცვლად — post-hoc reconciliation:
  // shifts.end_amount_expected/difference ხელახლა გამოითვლება
  // (end_amount_actual — მოლარის ფიზიკურად დათვლილი თანხა — უცვლელი
  // რჩება), ორიგინალური (პირველად დაბეჭდილი) მნიშვნელობები ინახება
  // (COALESCE — მხოლოდ პირველ ცვლილებაზე იწერება), და მენეჯერისთვის
  // ჩნდება ნოტიფიკაცია (shift_amendments — stock_deficit_notifications-ის,
  // migration 011-ის, იგივე პატერნი), რომ იცოდეს ამ ცვლის Z-Report
  // ხელახლა უნდა დაიბეჭდოს.
  if (shift.status === 'closed') {
    const { total_cash, receipt_count, total_card } = await computeShiftTotals(client, shift.id);
    const newExpected = Number(shift.start_amount) + total_cash;
    const previousActual = shift.end_amount_actual !== null ? Number(shift.end_amount_actual) : 0;
    const newDifference = previousActual - newExpected;
    const previousExpected = shift.end_amount_expected !== null ? Number(shift.end_amount_expected) : newExpected;
    const previousDifference = shift.difference !== null ? Number(shift.difference) : newDifference;

    await client.query(
      `UPDATE shifts
       SET end_amount_expected = $1,
           difference = $2,
           receipt_count = $3,
           card_total = $4,
           is_amended = true,
           last_amended_at = $5,
           original_end_amount_expected = COALESCE(original_end_amount_expected, $6),
           original_difference = COALESCE(original_difference, $7)
       WHERE id = $8`,
      [
        newExpected,
        newDifference,
        receipt_count,
        total_card,
        formatDbTimestamp(new Date()),
        previousExpected,
        previousDifference,
        shift.id,
      ]
    );

    // 🏢 STEP 2, ტიერი 5 — write-blocker fix (organization_id NOT NULL,
    // migration 013), იგივე მიზეზით, რაც ზემოთა ორ INSERT-ს.
    await client.query(
      `INSERT INTO shift_amendments
         (shift_id, payment_id, cashier_id, register_id, previous_expected, new_expected, previous_difference, new_difference, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [shift.id, receipt.id, receipt.cashierId, registerId, previousExpected, newExpected, previousDifference, newDifference, organizationId]
    );

    causedShiftAmendment = true;
  }

  return { id: receipt.id, status: 'synced', hadStockDeficit, causedShiftAmendment };
}

// POST /api/payments/sync-offline
// body: { receipts: OfflineSyncReceiptPayload[] }
//
// Background Sync Worker (frontend/src/sync/backgroundSync.ts) ინტერნეტის
// დაბრუნებისთანავე Dexie-ის offline_receipts queue-ს (Roadmap STEP 4.1)
// ერთბაშად, ამ ერთი მოთხოვნით აგზავნის. თითოეული ჩეკი დამოუკიდებელ
// SAVEPOINT-ში მუშავდება (იხ. syncSingleOfflineReceipt) — ერთი "ცუდი"
// ჩეკი (მაგ. წაშლილი shift) დანარჩენების commit-ს არ აჩერებს.
// 🔒 STEP 2.2 (RLS Pilot) — ადრე ეს route ხელით (`db.connect()`) იღებდა
// dedicated client-ს (ერთადერთი ადგილი ფაილში, SAVEPOINT-ების გამო, სადაც
// ეს უკვე სწორად იყო გაკეთებული) — ახლა იმავე client-ს `withOrgContext`
// გვაძლევს, ორგ-კონტექსტიც ავტომატურად ერთვის.
router.post(
  '/payments/sync-offline',
  authenticateToken,
  requireRegister,
  async (req: CustomRequest, res: Response) => {
    const receiptsInput: unknown = req.body?.receipts;

    if (!Array.isArray(receiptsInput) || receiptsInput.length === 0) {
      return res.status(400).json({ error: 'receipts მასივი სავალდებულოა და არ უნდა იყოს ცარიელი' });
    }

    // 🔒 ზედაპირული shape-ვალიდაცია batch-ის დამუშავებამდე — "any"-ის
    // ნაცვლად ცალსახა ტიპის დამცველი. დეტალური, ველ-ველზე ვალიდაცია
    // syncSingleOfflineReceipt-შია, თითოეული ჩეკისთვის ცალკე.
    const isValidShape = receiptsInput.every((r) => {
      if (typeof r !== 'object' || r === null) return false;
      const candidate = r as Record<string, unknown>;
      return (
        typeof candidate.id === 'string' &&
        UUID_V4_REGEX.test(candidate.id) &&
        typeof candidate.shiftId === 'string' &&
        typeof candidate.registerId === 'string' &&
        typeof candidate.cashierId === 'string' &&
        typeof candidate.createdAt === 'string' &&
        Array.isArray(candidate.items)
      );
    });

    if (!isValidShape) {
      return res.status(400).json({ error: 'receipts მასივში არავალიდური ჩანაწერია' });
    }

    const payloads = receiptsInput as OfflineSyncReceiptPayload[];

    try {
      const results = await withOrgContext(req.user?.organizationId, async (client) => {
        const batchResults: OfflineSyncResult[] = [];

        for (const receipt of payloads) {
          // 🔖 SAVEPOINT სახელი — hyphen-ების გარეშე (PostgreSQL იდენტიფიკატორი),
          // UUID-ის საკმარისად უნიკალურია batch-ის ფარგლებში.
          const savepoint = `sp_${receipt.id.replace(/-/g, '')}`;
          try {
            await client.query(`SAVEPOINT ${savepoint}`);
            const result = await syncSingleOfflineReceipt(
              client,
              receipt,
              req.registerId as string,
              req.user?.organizationId,
              req.user?.id,
              req.user?.role
            );
            await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            batchResults.push(result);
          } catch (itemErr: any) {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            batchResults.push({ id: receipt.id, status: 'failed', error: itemErr.message || 'უცნობი შეცდომა' });
          }
        }

        return batchResults;
      });

      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ==========================================
// 🧺 2.7 კალათის მართვის Manager Override აუდიტ-ლოგი — Roadmap ეტაპი 5
// ==========================================
// POST /api/cart/confirm-override
// კალათა (და მასში ცალკეული პროდუქტები) მთლიანად frontend-ის React state-შია —
// checkout-მდე (POST /payments) საერთოდ არაფერი არ იწერება ბაზაში, ამიტომ
// "კალათის გასუფთავება"/"პროდუქტის წაშლა" თავისთავად არანაირ backend
// resource-ს არ ეხება. ამ endpoint-ის ერთადერთი დანიშნულებაა — გადაამოწმოს,
// რომ X-Manager-Override ტოკენი ნამდვილად ვალიდურია (ხელმოწერა+ვადა+
// cashierId+single-use, იგივე verifyManagerOverrideToken რაც checkout-სა და
// void-ზეა), და მხოლოდ ამის დადასტურების შემდეგ ჩაწეროს აუდიტ-ლოგი.
// frontend-ს დამოუკიდებლად არ შეუძლია "მოიგონოს" ეს ლოგი — ტოკენის გარეშე
// 403-ს დააბრუნებს.
// 🔒 STEP 2.2 (RLS Pilot) — ეს route არცერთ RLS-ჩართულ ცხრილს პირდაპირ არ
// ეხება (მხოლოდ `writeAuditLog()`-ს იძახებს, რომელიც `audit_logs`-ში წერს —
// ეს ცხრილი განზრახ გამორიცხულია migration 017-ის scope-იდან), ამიტომ
// უცვლელად რჩება.
const CART_OVERRIDE_ACTIONS = ['clear-cart-override', 'remove-item-override'] as const;
type CartOverrideAction = (typeof CART_OVERRIDE_ACTIONS)[number];

// 🔒 whitelist-ის საფუძველზე ტიპის დამცველი — "any"-ის ნაცვლად. frontend-ს
// არ ეძლევა თავისუფალი სტრიქონის გაგზავნის საშუალება (მაგ. თითქოს ეს იყოს
// 'discount-access'-ის ტოლფასი ლოგი).
function isCartOverrideAction(value: unknown): value is CartOverrideAction {
  return typeof value === 'string' && (CART_OVERRIDE_ACTIONS as readonly string[]).includes(value);
}

router.post('/cart/confirm-override', authenticateToken, async (req: CustomRequest, res: Response) => {
  const { action, detail } = req.body;

  if (!isCartOverrideAction(action)) {
    return res.status(400).json({ error: 'action უნდა იყოს clear-cart-override ან remove-item-override' });
  }

  const overrideToken = extractBearerToken(req.headers['x-manager-override']);
  const overridePayload = overrideToken ? verifyManagerOverrideToken(overrideToken) : null;
  const managerOverrideUsed = overridePayload && overridePayload.cashierId === req.user?.id ? overridePayload : null;

  if (!managerOverrideUsed) {
    return res.status(403).json({ error: 'მენეჯერის ვალიდური ავტორიზაცია ვერ მოიძებნა' });
  }

  consumeOverrideToken(managerOverrideUsed.jti);

  // 🕵️ new_value: 'remove-item-override'-ისთვის წაშლილი პროდუქტის სახელი/ID
  // (detail), 'clear-cart-override'-ისთვის კონკრეტული დეტალი არ არსებობს.
  const newValue = typeof detail === 'string' && detail.trim().length > 0 ? detail.trim() : 'confirmed';

  await writeAuditLog(
    managerOverrideUsed.managerId,
    req.user?.id ?? managerOverrideUsed.managerId,
    action,
    newValue,
    req.user?.organizationId
  );

  res.json({ success: true });
});

// ==========================================
// 🧩 ფილტრაციის საერთო helper — /payments-ისა და ორივე export
// ენდპოინტის მიერ გამოყენებული, რომ ფრონტისა და ექსპორტის
// მონაცემები ყოველთვის ერთმანეთს ემთხვეოდეს.
// ==========================================
// 💰 Roadmap ეტაპი 8 — დასაშვები მნიშვნელობების whitelist. ეს ორმაგად იცავს:
// (1) chk_payment_method-ის ანალოგიური "cash"|"card"|"split" შემოწმება
//     query-პარამეტრზეც, თორემ არავალიდური მნიშვნელობა უბრალოდ ცარიელ
//     შედეგს დააბრუნებდა (WHERE p.payment_method = 'რაღაცას' არასდროს
//     ემთხვევა), რაც მოლარეს/ადმინს "მონაცემები არ არისს" დაანახებდა
//     ცხადი მიზეზის გარეშე;
// (2) SQL-ინექციისგან — თუმცა პარამეტრიზებული query-თი ისედაც დაცულია,
//     whitelist-ი დამატებითი ბარიერია.
const PAYMENT_METHOD_FILTER_VALUES = ['cash', 'card', 'split'] as const;
// 🚫💸 გაუქმებულობისა და ფასდაკლების ფილტრები — იგივე whitelist-პრინციპი,
// რაც paymentMethod-ს ზემოთ: არავალიდური მნიშვნელობა იგნორირდება (ანუ
// "ყველა" შედეგს აბრუნებს), ცარიელ სიას კი არ აჩვენებს გაუგებრად.
const STATUS_FILTER_VALUES = ['active', 'voided'] as const;
const DISCOUNT_FILTER_VALUES = ['yes', 'no'] as const;

// 🏢 Multi-Tenant SaaS STEP 2, ტიერი 5 (Roadmap "23.08.2026") — `organizationId`
// დაემატა სავალდებულო (არა optional filter-ების მსგავსად) პარამეტრად —
// ყოველთვის, ცალსახად გამოიყენება (არა `if`-ით პირობითი, სხვა ფილტრების
// მსგავსად), რომ ვერცერთმა caller-მა (GET /payments და ორივე export)
// შემთხვევით ვერ "დაავიწყოს". ამის გარეშე ეს ერთი helper (ფაილის
// თავშივე მითითებული, "ეკრანი და ექსპორტი ერთმანეთს ემთხვევა" პრინციპით)
// სამივე endpoint-ს ერთდროულად ტოვებდა cross-tenant გახსნილს — ერთი org-ის
// admin/manager-ს ყველა org-ის ფინანსური ისტორიის ნახვა/ექსპორტი შეეძლო.
function buildPaymentsFilterQuery(baseSelect: string, query: any, organizationId: string | undefined) {
  const { from, to, cashierId, productName, paymentMethod, status, discount } = query;

  let sql = baseSelect + ' WHERE p.organization_id = $1';
  const params: any[] = [organizationId];
  let index = 2;

  if (from) {
    sql += ` AND p.created_at >= $${index}`;
    params.push(from);
    index++;
  }

  if (to) {
    sql += ` AND p.created_at <= $${index}`;
    params.push(to);
    index++;
  }

  if (cashierId) {
    // 🆔 UUID მიგრაცია — cashier_id ახლა UUID string-ია, Number()-ი
    // ყოველთვის NaN-ს გამოიღებდა და ფილტრს ჩუმად "გატეხდა".
    sql += ` AND p.cashier_id = $${index}`;
    params.push(String(cashierId));
    index++;
  }

  if (productName) {
    sql += ` AND EXISTS (
      SELECT 1 FROM payment_items pi
      JOIN products pr ON pi.product_id = pr.id
      WHERE pi.payment_id = p.id AND pr.name ILIKE $${index}
    )`;
    params.push(`%${productName}%`);
    index++;
  }

  // 💰 Roadmap ეტაპი 8 — გადახდის მეთოდის ფილტრი. ეს helper GET /payments-სა
  // და ორივე export routes-შიც გამოიყენება (იხ. ფაილის თავში კომენტარი),
  // ამიტომ ეს ერთი ცვლილება ავტომატურად ფილტრავს Excel/PDF ექსპორტსაც —
  // ეკრანზე გაფილტრული "მხოლოდ ბარათი" აჩვენებს ზუსტად იმას, რასაც Excel-იც
  // გადმოწერს.
  if (PAYMENT_METHOD_FILTER_VALUES.includes(paymentMethod)) {
    sql += ` AND p.payment_method = $${index}`;
    params.push(paymentMethod);
    index++;
  }

  // 🚫 სტატუსის ფილტრი (აქტიური / გაუქმებული). ნაგულისხმევად (სტატუსის
  // მითითების გარეშე) ორივე ტიპი ერთად ჩანს — ეს არ ცვლის აქამდე არსებულ
  // ქცევას, უბრალოდ ემატება ცხადი choice, როცა ადმინს მხოლოდ ერთი აინტერესებს.
  if (STATUS_FILTER_VALUES.includes(status)) {
    sql += ` AND p.is_voided = $${index}`;
    params.push(status === 'voided');
    index++;
  }

  // 💸 ფასდაკლების ფილტრი — "ფასდაკლებით" ნიშნავს რეალურად გამოყენებულ
  // ფასდაკლებას (discount_type დაყენებული და მნიშვნელობა > 0), არა უბრალოდ
  // NULL-ისგან განსხვავებულ ველს.
  if (DISCOUNT_FILTER_VALUES.includes(discount)) {
    if (discount === 'yes') {
      sql += ' AND p.discount_type IS NOT NULL AND p.discount_value > 0';
    } else {
      sql += ' AND (p.discount_type IS NULL OR p.discount_value = 0)';
    }
  }

  // 🩹 FIX (12.08, STEP 5-ის ტესტირებისას აღმოჩენილი) — იგივე UUID-ორდერინგის
  // ბაგი, რაც GET /shifts/history-ს ჰქონდა: `ORDER BY p.id DESC` migration
  // 009-მდე (SERIAL PK-ის დროს) სწორად აჩვენებდა უახლესს თავში, UUID PK-ზე
  // გადასვლის შემდეგ კი აღარაფერს ნიშნავს. `created_at` (TEXT,
  // ლექსიკოგრაფიულად სორტირებადი) ნამდვილ ქრონოლოგიას აბრუნებს.
  sql += ' ORDER BY p.created_at DESC';
  return { sql, params };
}

// ==========================================
// 📈 3. გაყიდვების ისტორია (GET) დაშბორდისთვის
// ==========================================
// 🔒 Role-restriction (Roadmap "23.08.2026", ადრე დისციპლინის დარღვევის
// გაცნობიერებული უარით გადადებული პუნქტი) — `GET /shifts/history`-ის
// ზუსტად იგივე პატერნი: მოლარეს არ უნდა შეეძლოს მთელი ორგანიზაციის
// სრული გაყიდვების ისტორიის ნახვა (მისი "საკუთარი ცვლის" scope-ია
// `GET /payments/my-history`, ქვემოთ) — მხოლოდ admin/manager.
// 🔒 STEP 2.2 (RLS Pilot) — სამივე query (payments/items/splits) ერთ
// `withOrgContext`-შია, ისე რომ ერთი, კონსისტენტური snapshot-ი დაბრუნდეს.
router.get('/payments', authenticateToken, async (req: CustomRequest, res: any) => {
  if (req.user?.role === 'cashier') return res.status(403).json({ error: 'წვდომა შეზღუდულია!' });

  // 🧾 p.is_voided დამატებულია (Roadmap ეტაპი 4 fix) — Dashboard.tsx-ს სჭირდება
  // ვიცოდეთ, რომელი ჩეკია გაუქმებული, რომ (ა) ისტორიის ცხრილში ვიზუალურად მონიშნოს
  // და (ბ) "საერთო შემოსავლის" ჯამში აღარ ჩართოს. გაუქმებული ჩეკები განზრახ
  // მაინც ბრუნდება სიაში (არა WHERE-ით გაფილტრული) — ჩანაწერი უნდა ჩანდეს,
  // უბრალოდ ფინანსურ ჯამში არ უნდა შედიოდეს.
  //
  // 💰 p.payment_method დამატებულია (Roadmap ეტაპი 8) — POST /api/payments
  // migration 008-იდან ინახავს მას, მაგრამ GET /payments აქამდე არ აბრუნებდა,
  // ამიტომ Dashboard.tsx-ის "გაყიდვების ისტორია" ცხრილს არ ჰქონდა საიდან
  // ეჩვენებინა, ნაღდი იყო თუ ბარათი.
  const baseSelect = `
    SELECT p.id, p.subtotal_amount, p.discount_type, p.discount_value, p.total_amount, p.created_at, p.is_voided, p.payment_method, u.name AS cashier_name
    FROM payments p
    LEFT JOIN users u ON p.cashier_id = u.id
  `;
  const { sql, params } = buildPaymentsFilterQuery(baseSelect, req.query, req.user?.organizationId);

  try {
    const paymentsWithItems = await withOrgContext(req.user?.organizationId, async (client) => {
      const paymentsResult = await client.query(sql, params);
      const payments = paymentsResult.rows;

      if (payments.length === 0) return [];

      const paymentIds = payments.map((p) => p.id);
      const itemsQuery = `
        SELECT pi.payment_id, pi.quantity, pi.price, pr.name
        FROM payment_items pi
        LEFT JOIN products pr ON pi.product_id = pr.id
        WHERE pi.payment_id = ANY($1)
      `;
      const itemsResult = await client.query(itemsQuery, [paymentIds]);
      const items = itemsResult.rows;

      // 💰 Roadmap ეტაპი 8 — SPLIT ჩეკების ტენდერ-ხაზები, items-ის ზუსტი
      // ანალოგიით ცალკე query-თი წამოღებული და payment_id-ით მიბმული.
      // Map<paymentId, {cash, card}> — ერთ round-trip-ში ყველა ჩეკისთვის ერთად.
      const splitsQuery = `
        SELECT payment_id, method, amount
        FROM payment_splits
        WHERE payment_id = ANY($1)
      `;
      const splitsResult = await client.query(splitsQuery, [paymentIds]);
      // 🆔 UUID მიგრაცია — payment_id ახლა UUID string-ია.
      const splitsByPayment = new Map<string, { cash: number; card: number }>();
      for (const row of splitsResult.rows) {
        const entry = splitsByPayment.get(row.payment_id) ?? { cash: 0, card: 0 };
        if (row.method === 'cash') entry.cash = Number(row.amount);
        else if (row.method === 'card') entry.card = Number(row.amount);
        splitsByPayment.set(row.payment_id, entry);
      }

      return payments.map((payment) => ({
        ...payment,
        items: items.filter((item) => item.payment_id === payment.id),
        splits: splitsByPayment.get(payment.id) ?? null,
      }));
    });

    res.json(paymentsWithItems);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 🧾 3.5 მოლარის პირადი გაყიდვების ისტორია (მიმდინარე ცვლის ჩეკები)
// ==========================================
// ⚠️ მნიშვნელოვანი: ეს ენდპოინტი განზრახ არ აბრუნებს მოლარის მთელ
// ისტორიას (ყველა ცვლიდან, ოდესმე), არამედ მხოლოდ მიმდინარე, ღია
// ცვლის ჩეკებს — ისევე, როგორც POST /payments და /shifts/close
// ითვლიან ჯამებს shift_id-ის მიხედვით. checkActiveShift middleware
// ავსებს req.activeShiftId-ს (და თუ ცვლა არ არის გახსნილი, თავად
// აბრუნებს შესაბამის შეცდომას POST /payments-ის ანალოგიურად).
// 🔒 STEP 2.2 (RLS Pilot) — `withOrgContext`-ში გადატანილია (permission-check
// ჩათვლით), GET /payments-ის იგივე ერთი-ტრანზაქცია-სამი-query პატერნით.
router.get(
  '/payments/my-history',
  authenticateToken,
  checkActiveShift,
  async (req: CustomRequest, res: Response) => {
    const cashierId = req.user?.id;
    const shiftId = req.activeShiftId;

    if (!cashierId || !shiftId) {
      return res.status(401).json({ error: 'ავტორიზაცია ან აქტიური ცვლა ვერ მოიძებნა!' });
    }

    try {
      const responseData = await withOrgContext(req.user?.organizationId, async (client) => {
        // 🔐 can_view_history ფრეშად ვამოწმებთ ბაზაში (არა JWT-დან), რომ ადმინის
        // მიერ გამორთვა მომენტალურად ამოქმედდეს, მოლარეს ტოკენის განახლების გარეშეც.
        const permissionCheck = await client.query('SELECT can_view_history FROM users WHERE id = $1', [cashierId]);
        if (permissionCheck.rows.length === 0 || permissionCheck.rows[0].can_view_history === false) {
          throw new HttpError(403, { error: 'ისტორიის ნახვის უფლება გამორთულია!' });
        }

        // 🧾 p.is_voided დამატებულია Roadmap ეტაპი 4-ისთვის — POS ეკრანის "ჩემი
        // ისტორია" პანელს სჭირდება ვიცოდეთ, რომელი ჩეკია უკვე გაუქმებული, რომ
        // არც ხელახლა შესთავაზოს გაუქმება და არც დამალოს ჩეკი სიიდან. ჯამებზე
        // (totalSum) ჯერ არ მოქმედებს — ეს ცალკე გასასწორებელია (იხ. sales.ts-ის
        // POST /payments/:id/void-ის კომენტარი GET /shifts/close-ის შესახებ).
        //
        // 💰 p.payment_method დამატებულია (Roadmap ეტაპი 8) — იგივე მიზეზით,
        // რაც GET /payments-ში.
        // 🩹 FIX (12.08) — იგივე UUID-ორდერინგის ბაგი, `created_at`-ზე
        // (იხ. buildPaymentsFilterQuery-ის კომენტარი ზემოთ).
        const query = `
          SELECT p.id, p.subtotal_amount, p.discount_type, p.discount_value, p.total_amount, p.created_at, p.is_voided, p.payment_method, u.name AS cashier_name
          FROM payments p
          LEFT JOIN users u ON p.cashier_id = u.id
          WHERE p.cashier_id = $1 AND p.shift_id = $2
          ORDER BY p.created_at DESC
        `;

        const paymentsResult = await client.query(query, [cashierId, shiftId]);
        const payments = paymentsResult.rows;

        if (payments.length === 0) {
          return { receipts: [], summary: { totalReceipts: 0, totalSum: 0 } };
        }

        const paymentIds = payments.map((p) => p.id);
        const itemsQuery = `
          SELECT pi.payment_id, pi.quantity, pi.price, pr.name
          FROM payment_items pi
          LEFT JOIN products pr ON pi.product_id = pr.id
          WHERE pi.payment_id = ANY($1)
        `;
        const itemsResult = await client.query(itemsQuery, [paymentIds]);
        const items = itemsResult.rows;

        // 💰 Roadmap ეტაპი 8 — SPLIT ჩეკების cash/card ხაზები, GET /payments-ის
        // ზუსტი ანალოგიით.
        const splitsQuery = `
          SELECT payment_id, method, amount
          FROM payment_splits
          WHERE payment_id = ANY($1)
        `;
        const splitsResult = await client.query(splitsQuery, [paymentIds]);
        // 🆔 UUID მიგრაცია — payment_id ახლა UUID string-ია.
        const splitsByPayment = new Map<string, { cash: number; card: number }>();
        for (const row of splitsResult.rows) {
          const entry = splitsByPayment.get(row.payment_id) ?? { cash: 0, card: 0 };
          if (row.method === 'cash') entry.cash = Number(row.amount);
          else if (row.method === 'card') entry.card = Number(row.amount);
          splitsByPayment.set(row.payment_id, entry);
        }

        const receipts = payments.map((payment) => ({
          ...payment,
          items: items.filter((item) => item.payment_id === payment.id),
          splits: splitsByPayment.get(payment.id) ?? null,
        }));

        // 🧾 FIX (Roadmap ეტაპი 4): receipts სია განზრახ აბრუნებს ყველა ჩეკს (გაუქმებულებსაც,
        // is_voided ბეიჯისთვის Sales.tsx-ში), მაგრამ "ჯამური თანხა" მხოლოდ აქტიურ, არაგაუქმებულ
        // ჩეკებზე უნდა ითვლებოდეს — წინააღმდეგ შემთხვევაში მოლარეს ცვლის ჯამში გაუქმებული
        // გაყიდვის თანხაც ეჩვენებოდა, თითქოს რეალურად მიღებული ჰქონდეს.
        const totalSum = payments
          .filter((p) => p.is_voided !== true)
          .reduce((sum, p) => sum + Number(p.total_amount), 0);

        return {
          receipts,
          summary: { totalReceipts: payments.length, totalSum },
        };
      });

      res.json(responseData);
    } catch (err: any) {
      if (err instanceof HttpError) return res.status(err.statusCode).json(err.body);
      res.status(500).json({ error: err.message });
    }
  }
);


// ==========================================
// 📊 4. EXCEL ექსპორტი — from/to/cashierId ფილტრებით + ფასდაკლების სვეტები
// ==========================================
// 🔒 STEP 2.2 (RLS Pilot) — ეს route `authenticateToken`-ს არ იყენებს
// (token query param-იდან მოდის), ამიტომ `req.user` არასდროს არსებობს —
// `organizationId` decoded JWT payload-იდან მოდის (უცვლელად), `withOrgContext`-საც
// იმავე მნიშვნელობას ვაწვდით.
router.get('/payments/export/excel', async (req: any, res: any) => {
  const token = req.query.token as string;
  const secretKey = process.env.JWT_SECRET || 'super-secret-key';

  if (!token) return res.status(401).json({ error: 'ტოკენი არ არსებობს!' });

  try {
    // 🏢 STEP 2, ტიერი 5 — decoded payload-იც ვიღებთ (არა მხოლოდ
    // ვალიდურობის დადასტურებას), რომ organizationId ამოვიღოთ. ეს route
    // authenticateToken-ს არ იყენებს (token query param-იდან მოდის,
    // header-ის ნაცვლად — excel/PDF ბმულები პირდაპირ ბრაუზერში იხსნება),
    // ამიტომ req.user აქ არასდროს არსებობს.
    const decoded = await new Promise<JwtPayload>((resolve, reject) => {
      jwt.verify(token, secretKey, (err, payload) => {
        if (err || !payload || typeof payload === 'string') {
          reject(new Error('ტოკენი არავალიდურია!'));
          return;
        }
        resolve(payload);
      });
    });
    const organizationId = typeof decoded.organizationId === 'string' ? decoded.organizationId : undefined;

    // 🔒 Role-restriction (Roadmap "23.08.2026") — `GET /payments`-ის იგივე
    // შეზღუდვა: `authenticateToken` აქ არ გამოიყენება (token query param-იდან
    // მოდის), ამიტომ role-იც decoded payload-იდან ცალსახად ვკითხულობთ.
    if (decoded.role === 'cashier') {
      return res.status(403).json({ error: 'წვდომა შეზღუდულია!' });
    }

    // 🧾 p.is_voided დამატებულია (Roadmap ეტაპი 4 fix) — ბუღალტერმა Excel-შიც
    // ცალსახად უნდა დაინახოს, რომელი ჩეკია გაუქმებული (იხ. 'სტატუსი' სვეტი ქვემოთ).
    const baseSelect = `
      SELECT p.id, p.subtotal_amount, p.discount_type, p.discount_value, p.total_amount, p.created_at, p.is_voided, u.name AS cashier_name
      FROM payments p
      LEFT JOIN users u ON p.cashier_id = u.id
    `;
    const { sql, params } = buildPaymentsFilterQuery(baseSelect, req.query, organizationId);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payments');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'მოლარე', key: 'cashier_name', width: 15 },
      { header: 'ჯამი ფასდაკლებამდე', key: 'subtotal_amount', width: 20 },
      { header: 'ფასდაკლების ტიპი', key: 'discount_type', width: 15 },
      { header: 'ფასდაკლების მნიშვნელობა', key: 'discount_value', width: 20 },
      { header: 'საბოლოო ფასი', key: 'total_amount', width: 15 },
      { header: 'თარიღი', key: 'created_at', width: 25 },
      { header: 'სტატუსი', key: 'status_label', width: 15 }
    ];

    worksheet.getRow(1).font = { bold: true };

    const result = await withOrgContext(organizationId, (client) => client.query(sql, params));
    // 🧾 is_voided (boolean) → ადამიანისთვის წასაკითხი ტექსტი ცალკე სვეტში;
    // ნედლი is_voided მნიშვნელობა worksheet.columns-ში არ არის განსაზღვრული
    // (key არ ემთხვევა), ამიტომ ExcelJS მას უბრალოდ იგნორირებას გაუკეთებს.
    const rowsWithStatus = result.rows.map((row: any) => ({
      ...row,
      status_label: row.is_voided ? '🚫 გაუქმებული' : '✅ აქტიური',
    }));
    worksheet.addRows(rowsWithStatus);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=payments.xlsx');

    await workbook.xlsx.write(res);
    res.end();

  } catch (err: any) {
    const status = err.message === 'ტოკენი არავალიდურია!' ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});


// ==========================================
// 🟥 5. PDF ექსპორტი — from/to/cashierId ფილტრებით + ფასდაკლების სვეტი
// ==========================================
// 🔒 STEP 2.2 (RLS Pilot) — export/excel-ის იგივე მიზეზი.
router.get('/payments/export/pdf', async (req: any, res: any) => {
  const token = req.query.token as string;
  const secretKey = process.env.JWT_SECRET || 'super-secret-key';

  if (!token) return res.status(401).json({ error: 'ტოკენი არ არსებობს!' });

  try {
    // 🏢 STEP 2, ტიერი 5 — იგივე, რაც export/excel-ს (იხ. მისი კომენტარი).
    const decoded = await new Promise<JwtPayload>((resolve, reject) => {
      jwt.verify(token, secretKey, (err, payload) => {
        if (err || !payload || typeof payload === 'string') {
          reject(new Error('ტოკენი არავალიდურია!'));
          return;
        }
        resolve(payload);
      });
    });
    const organizationId = typeof decoded.organizationId === 'string' ? decoded.organizationId : undefined;

    // 🔒 Role-restriction (Roadmap "23.08.2026") — export/excel-ის იგივე
    // შეზღუდვა/მიზეზი.
    if (decoded.role === 'cashier') {
      return res.status(403).json({ error: 'წვდომა შეზღუდულია!' });
    }

    // 🧾 p.is_voided დამატებულია (Roadmap ეტაპი 4 fix) — Grand Total-ს ქვემოთ
    // გაუქმებული ჩეკები აღარ უნდა ერთვებოდეს (იხ. grandTotal-ის გამოთვლა).
    const baseSelect = `
      SELECT p.id, p.subtotal_amount, p.discount_type, p.discount_value, p.total_amount, p.created_at, p.is_voided, u.name AS cashier_name
      FROM payments p
      LEFT JOIN users u ON p.cashier_id = u.id
    `;
    const { sql, params } = buildPaymentsFilterQuery(baseSelect, req.query, organizationId);

    const result = await withOrgContext(organizationId, (client) => client.query(sql, params));
    const rows = result.rows;

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=payments_report.pdf');
    doc.pipe(res);

    const fontPath = path.resolve(__dirname, '../fonts/Sylfaen.ttf');
    let georgianFontAvailable = false;
    try {
      doc.registerFont('Georgian', fontPath);
      georgianFontAvailable = true;
    } catch (fontError: any) {
      console.error("ფონტის რეგისტრაცია ჩავარდა:", fontError);
    }
    const regularFont = georgianFontAvailable ? 'Georgian' : 'Helvetica';
    const boldFont = georgianFontAvailable ? 'Georgian' : 'Helvetica-Bold';

    doc.font(boldFont).fontSize(20).text('Sales Report', { align: 'center' });
    doc.font(regularFont).fontSize(10).text(`გენერირების თარიღი: ${new Date().toLocaleString('ka-GE', { timeZone: 'Asia/Tbilisi' })}`, { align: 'center' });
    doc.moveDown(2);

    const tableTop = 150;
    doc.fontSize(11).font(boldFont);
    doc.text('ID', 40, tableTop);
    doc.text('Cashier', 80, tableTop);
    doc.text('Subtotal', 170, tableTop);
    doc.text('Discount', 250, tableTop);
    doc.text('Total', 340, tableTop);
    doc.text('Date', 420, tableTop);

    doc.moveTo(40, tableTop + 15).lineTo(555, tableTop + 15).stroke();

    let currentY = tableTop + 25;
    // 🧾 FIX (Roadmap ეტაპი 4): Grand Total აღარ ითვლის გაუქმებულ ჩეკებს — მხოლოდ
    // აქტიურ (is_voided !== true) ჩეკებზეა დაანგარიშებული, Dashboard.tsx-ის
    // "საერთო შემოსავლის" ანალოგიური ლოგიკით.
    const grandTotal = rows
      .filter((row) => row.is_voided !== true)
      .reduce((sum, row) => sum + row.total_amount, 0);

    rows.forEach((row) => {
      if (currentY > 700) {
        doc.addPage();
        currentY = 50;
      }

      const discountLabel = row.discount_type
        ? row.discount_type === 'percent'
          ? `${row.discount_value}%`
          : `${row.discount_value} GEL`
        : '—';

      // 🧾 გაუქმებული ჩეკის მთელი ხაზი ვიზუალურად მოვნაცრისფროთ (ID-დან თარიღამდე) —
      // Dashboard.tsx-ის ცხრილში ჩვენებული "🚫 გაუქმებული" ბეიჯის PDF-ის ანალოგი.
      doc.font(regularFont).fontSize(9);
      doc.fillColor(row.is_voided ? '#94a3b8' : '#000000');
      // 🩹 FIX (16.08) — row.id არის სრული UUID (36 სიმბოლო, მაგ.
      // "712b0795-c382-49f7-9545-34e98fe50e1"), რომელიც ID სვეტის 40px
      // სიგანეს (Cashier-მდე) 5x-ით აღემატებოდა და ვიზუალურად ედებოდა
      // შემდეგ სვეტებს (Cashier/Subtotal/Total ტექსტს). სხვა ეკრანებზეც
      // (POS, Users Control) მოკლე UUID-პრეფიქსი გამოიყენება საკმარისი
      // იდენტიფიკაციისთვის — აქაც იგივე კონვენციას ვიცავთ. width+ellipsis
      // დანარჩენ სვეტებზეც უსაფრთხოების ბადედაა (გრძელი Cashier სახელი და ა.შ.).
      doc.text(row.id.toString().slice(0, 8), 40, currentY, { width: 35, ellipsis: true });
      doc.text(row.cashier_name || 'N/A', 80, currentY, { width: 85, ellipsis: true });
      doc.text(`${row.subtotal_amount} GEL`, 170, currentY, { width: 75, ellipsis: true });
      doc.text(discountLabel, 250, currentY, { width: 85, ellipsis: true });
      // ⚠️ ემოჯი განზრახ არ გამოგვიყენებია — Helvetica/Sylfaen ფონტებს არ აქვთ
      // ემოჯი-გლიფები, PDF-ში ცარიელ ველად/broken glyph-ად აისახებოდა.
      doc.text(`${row.total_amount} GEL${row.is_voided ? ' (VOID)' : ''}`, 340, currentY, { width: 75, ellipsis: true });
      doc.text(row.created_at || '-', 420, currentY, { width: 130, ellipsis: true });
      doc.fillColor('#000000');

      currentY += 20;
    });

    currentY += 10;
    if (currentY > 720) {
      doc.addPage();
      currentY = 50;
    }

    doc.moveTo(40, currentY).lineTo(555, currentY).stroke();
    currentY += 15;

    doc.fontSize(14).font(boldFont);
    doc.text('Grand Total:', 40, currentY);
    doc.text(`${grandTotal} GEL`, 250, currentY);

    doc.end();

  } catch (err: any) {
    const status = err.message === 'ტოკენი არავალიდურია!' ? 403 : 500;
    if (!res.headersSent) {
      res.status(status).json({ error: err.message });
    }
  }
});

export default router;
