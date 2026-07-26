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
