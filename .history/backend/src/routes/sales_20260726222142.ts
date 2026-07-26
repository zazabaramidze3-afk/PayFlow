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
// ==========================================
// 📈 3. გაყიდვების ისტორია (GET) დაშბორდისთვის
// ==========================================
router.get('/payments', authenticateToken, async (req: CustomRequest, res: any) => {
  const { minPrice, maxPrice, cashierName } = req.query as any;
  
  let query = `
    SELECT p.id, p.total_amount, p.created_at, u.name AS cashier_name 
    FROM payments p
    LEFT JOIN users u ON p.cashier_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];
  let index = 1;

  if (minPrice) { query += ` AND p.total_amount >= $${index}`; params.push(Number(minPrice)); index++; }
  if (maxPrice) { query += ` AND p.total_amount <= $${index}`; params.push(Number(maxPrice)); index++; }
  if (cashierName) { query += ` AND u.name LIKE $${index}`; params.push(`%${cashierName}%`); index++; }

  query += " ORDER BY p.id DESC";

  try {
    const paymentsResult = await db.query(query, params);
    const payments = paymentsResult.rows;

    if (payments.length === 0) return res.json([]);

    const paymentIds = payments.map(p => p.id);
    const itemsQuery = `
      SELECT pi.payment_id, pi.quantity, pi.price, pr.name
      FROM payment_items pi
      LEFT JOIN products pr ON pi.product_id = pr.id
      WHERE pi.payment_id = ANY($1)
    `;

    const itemsResult = await db.query(itemsQuery, [paymentIds]);
    const items = itemsResult.rows;

    const paymentsWithItems = payments.map(payment => {
      return {
        ...payment,
        items: items.filter(item => item.payment_id === payment.id)
      };
    });

    res.json(paymentsWithItems);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// 📊 4. EXCEL ექსპორტი
// ==========================================
router.get('/payments/export/excel', async (req: any, res: any) => {
  const token = req.query.token as string;
  const secretKey = process.env.JWT_SECRET || 'super-secret-key';
  
  if (!token) return res.status(401).json({ error: 'ტოკენი არ არსებობს!' });
  
  try {
    await new Promise((resolve, reject) => {
      jwt.verify(token, secretKey, (err) => {
        if (err) reject(new Error('ტოკენი არავალიდურია!'));
        resolve(true);
      });
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payments');
    
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'მოლარე', key: 'cashier_name', width: 15 },
      { header: 'ჯამური ფასი', key: 'total_amount', width: 15 },
      { header: 'თარიღი', key: 'created_at', width: 25 }
    ];

    worksheet.getRow(1).font = { bold: true };

    const query = `
      SELECT p.id, p.total_amount, p.created_at, u.name AS cashier_name 
      FROM payments p 
      LEFT JOIN users u ON p.cashier_id = u.id 
      ORDER BY p.id DESC
    `;

    const result = await db.query(query);
    worksheet.addRows(result.rows);

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
// 🟥 5. PDF ექსპორტი
// ==========================================
router.get('/payments/export/pdf', async (req: any, res: any) => {
  const token = req.query.token as string;
  const secretKey = process.env.JWT_SECRET || 'super-secret-key';
  
  if (!token) return res.status(401).json({ error: 'ტოკენი არ არსებობს!' });

  try {
    await new Promise((resolve, reject) => {
      jwt.verify(token, secretKey, (err) => {
        if (err) reject(new Error('ტოკენი არავალიდურია!'));
        resolve(true);
      });
    });

    const query = `
      SELECT p.id, p.total_amount, p.created_at, u.name AS cashier_name 
      FROM payments p 
      LEFT JOIN users u ON p.cashier_id = u.id
      ORDER BY p.id DESC
    `;

    const result = await db.query(query);
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
    doc.font(regularFont).fontSize(10).text(`გენერირების თარიღი: ${new Date().toLocaleString('ka-GE')}`, { align: 'center' });
    doc.moveDown(2);

    const tableTop = 150;
    doc.fontSize(12).font(boldFont);
    doc.text('ID', 50, tableTop);
    doc.text('Cashier', 100, tableTop);
    doc.text('Total Amount', 220, tableTop);
    doc.text('Date', 350, tableTop);

    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    let currentY = tableTop + 25;
    const grandTotal = rows.reduce((sum, row) => sum + row.total_amount, 0);

    rows.forEach((row) => {
      if (currentY > 700) {
        doc.addPage();
        currentY = 50; 
      }

      doc.font(regularFont).fontSize(10);
      doc.text(row.id.toString(), 50, currentY);
      doc.text(row.cashier_name || 'N/A', 100, currentY);
      doc.text(`${row.total_amount} GEL`, 220, currentY);
      doc.text(row.created_at || '-', 350, currentY);

      currentY += 20;
    });

    currentY += 10;
    if (currentY > 720) {
      doc.addPage();
      currentY = 50;
    }
    
    doc.moveTo(50, currentY).lineTo(550, currentY).stroke();
    currentY += 15;

    doc.fontSize(14).font(boldFont);
    doc.text('Grand Total:', 50, currentY);
    doc.text(`${grandTotal} GEL`, 220, currentY);

    doc.end();

  } catch (err: any) {
    const status = err.message === 'ტოკენი არავალიდურია!' ? 403 : 500;
    if (!res.headersSent) {
      res.status(status).json({ error: err.message });
    }
  }
});

export default router;
