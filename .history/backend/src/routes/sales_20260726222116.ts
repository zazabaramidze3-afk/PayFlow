import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import path from 'path';
// შემოგვაქვს მზა PostgreSQL პული ძირითადი ფაილიდან
import { db } from '../index'; 
import { authenticateToken } from './auth';
import { checkActiveShift, CustomRequest } from '../checkShift';

const router = Router();

const SINGLE_REGISTER_MODE = true;

// ==========================================
// 🔐 1. ცვლების მოდული (SHIFT MANAGEMENT)
// ==========================================

// ა) ცვლის სტატუსის შემოწმება (მიმდინარე მოლარისთვის)
router.get('/shifts/status', authenticateToken, async (req: CustomRequest, res: Response) => {
  try {
    const result = await db.query(
      `SELECT * FROM shifts WHERE cashier_id = $1 AND status = 'open' LIMIT 1`, 
      [req.user?.id]
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
router.post('/shifts/open', authenticateToken, async (req: CustomRequest, res: Response) => {
  if (req.user?.role !== 'cashier') {
    return res.status(403).json({ message: "ცვლის გახსნა შეუძლია მხოლოდ მოლარეს" });
  }

  const { start_amount } = req.body;
  if (start_amount === undefined || start_amount < 0) {
    return res.status(400).json({ message: "არავალიდური თანხა" });
  }

  try {
    const activeShiftCheckQuery = SINGLE_REGISTER_MODE
      ? `SELECT id, cashier_id FROM shifts WHERE status = 'open' LIMIT 1`
      : `SELECT id, cashier_id FROM shifts WHERE cashier_id = $1 AND status = 'open' LIMIT 1`;
    
    const activeShiftCheckParams = SINGLE_REGISTER_MODE ? [] : [req.user?.id];
    const existingCheck = await db.query(activeShiftCheckQuery, activeShiftCheckParams);

    if (existingCheck.rows.length > 0) {
      const existing = existingCheck.rows[0];
      const message = SINGLE_REGISTER_MODE && existing.cashier_id !== req.user?.id
        ? "სალარო უკვე დაკავებულია — სხვა მოლარეს აქვს ღია ცვლა. დაელოდეთ მის დახურვას."
        : "თქვენ უკვე გაქვთ გახსნილი ცვლა";
      return res.status(400).json({ message });
    }

    const insertQuery = `
      INSERT INTO shifts (cashier_id, start_amount, status, opened_at) 
      VALUES ($1, $2, 'open', TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')) 
      RETURNING id
    `;
    const insertResult = await db.query(insertQuery, [req.user?.id, start_amount]);

    res.status(201).json({ message: "ცვლა გაიხსნა", shiftId: insertResult.rows[0].id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
// გ) ცვლის დახურვა
router.put('/shifts/close', authenticateToken, async (req: CustomRequest, res: Response) => {
  const { end_amount_actual } = req.body;

  if (end_amount_actual === undefined || end_amount_actual === null || isNaN(Number(end_amount_actual))) {
    return res.status(400).json({ message: "არავალიდური ფაქტობრივი თანხა" });
  }

  try {
    const shiftResult = await db.query(
      `SELECT * FROM shifts WHERE cashier_id = $1 AND status = 'open' LIMIT 1`, 
      [req.user?.id]
    );

    if (shiftResult.rows.length === 0) {
      return res.status(400).json({ message: "აქტიური ცვლა ვერ მოიძებნა" });
    }

    const shift = shiftResult.rows[0];

    const salesSumResult = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0) as total_cash FROM payments WHERE shift_id = $1`, 
      [shift.id]
    );

    const total_cash = parseFloat(salesSumResult.rows[0].total_cash);
    const end_amount_expected = shift.start_amount + total_cash;
    const difference = Number(end_amount_actual) - end_amount_expected;
    
    const closedAt = new Date().toLocaleString('en-US', { timeZone: 'Asia/Tbilisi', hour12: false });

    const updateQuery = `
      UPDATE shifts 
      SET status = 'closed', 
          closed_at = $1, 
          end_amount_expected = $2, 
          end_amount_actual = $3, 
          difference = $4 
      WHERE id = $5
    `;
    await db.query(updateQuery, [closedAt, end_amount_expected, end_amount_actual, difference, shift.id]);

    res.json({
      message: "ცვლა დაიხურა",
      start: shift.start_amount,
      expected: end_amount_expected,
      actual: Number(end_amount_actual),
      difference,
    });

  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// დ) ცვლების ისტორია
router.get('/shifts/history', authenticateToken, async (req: any, res: Response) => {
  if (req.user?.role === 'cashier') return res.status(403).json({ error: 'წვდომა შეზღუდულია!' });
  
  const query = `
    SELECT s.*, u.name AS cashier_name 
    FROM shifts s 
    LEFT JOIN users u ON s.cashier_id = u.id 
    WHERE u.role IS NULL OR u.role != 'admin'
    ORDER BY s.id DESC
  `;

  try {
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// 🛒 2. გაყიდვები (POS) — მარაგების დაცვით
// ==========================================
router.post('/payments', authenticateToken, checkActiveShift, async (req: CustomRequest, res: any) => {
  const { items } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'კალათა ცარიელია!' });

  const totalAmount = items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);

  try {
    await db.query('BEGIN');

    const paymentQuery = `
      INSERT INTO payments (cashier_id, shift_id, total_amount) 
      VALUES ($1, $2, $3) 
      RETURNING id
    `;
    const paymentResult = await db.query(paymentQuery, [req.user?.id, req.activeShiftId, totalAmount]);
    const paymentId = paymentResult.rows[0].id;

    for (const item of items) {
      const pId = item.productId || item.product_id;

      await db.query(
        `INSERT INTO payment_items (payment_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)`,
        [paymentId, pId, item.quantity, item.price]
      );

      const updateStockResult = await db.query(
        `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1`,
        [item.quantity, pId]
      );

      if (updateStockResult.rowCount === 0) {
        throw new Error(`არ არის საკმარისი მარაგი პროდუქტზე ID: ${pId}`);
      }
    }

    await db.query('COMMIT');
    res.status(201).json({ success: true, paymentId, totalAmount });

  } catch (err: any) {
    await db.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  }
});
