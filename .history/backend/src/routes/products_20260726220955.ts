import { Router, Request, Response } from 'express';
import { authenticateToken, CustomRequest } from './auth';
// შემოგვაქვს მზა PostgreSQL პული ძირითადი ფაილიდან
import { db } from '../index'; 

const router = Router();

// ==========================================
// 🔐 1. ცვლების მართვა (SHIFT MANAGEMENT)
// ==========================================

// 🟢 ა) მიმდინარე აქტიური ცვლის სტატუსის შემოწმება
router.get('/shifts/active', authenticateToken, async (req: CustomRequest, res: Response) => {
  try {
    const result = await db.query(
      `SELECT s.*, u.name as cashier_name 
       FROM shifts s 
       JOIN users u ON s.cashier_id = u.id 
       WHERE s.status = 'open' LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.json({ active: false, message: "აქტიური ცვლა არ არის გახსნილი" });
    }

    res.json({ active: true, shift: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🚀 ბ) ახალი ცვლის გახსნა (Single-Shift შეზღუდვით)
router.post('/shifts/open', authenticateToken, async (req: CustomRequest, res: Response) => {
  const { startAmount } = req.body;
  const cashierId = req.user?.id;

  if (!cashierId) return res.status(401).json({ error: 'მომხმარებელი ვერ იდენტიფიცირდა' });
  if (startAmount === undefined || startAmount < 0) {
    return res.status(400).json({ error: 'გთხოვთ მიუთითოთ ვალიდური საწყისი თანხა' });
  }

  try {
    // უსაფრთხოების მთავარი შემოწმება: არის თუ არა უკვე სისტემაში სხვა გახსნილი ცვლა?
    const activeCheck = await db.query("SELECT id FROM shifts WHERE status = 'open' LIMIT 1");
    if (activeCheck.rows.length > 0) {
      return res.status(400).json({ error: "სისტემაში უკვე გახსნილია აქტიური ცვლა სხვა მოლარის მიერ!" });
    }

    // ახალი ცვლის ჩაწერა
    const query = `
      INSERT INTO shifts (cashier_id, start_amount, status, opened_at) 
      VALUES ($1, $2, 'open', TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')) 
      RETURNING id, opened_at
    `;
    const insertResult = await db.query(query, [cashierId, startAmount]);

    res.status(201).json({
      success: true,
      message: 'ცვლა წარმატებით გაიხსნა',
      shiftId: insertResult.rows[0].id,
      openedAt: insertResult.rows[0].opened_at
    });

  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🛑 გ) ცვლის დახურვა და ნაშთების შეჯამება
router.post('/shifts/close', authenticateToken, async (req: CustomRequest, res: Response) => {
  const { shiftId, endAmountActual } = req.body;
  const cashierId = req.user?.id;

  if (!shiftId || endAmountActual === undefined) {
    return res.status(400).json({ error: 'ყველა პარამეტრი სავალდებულოა' });
  }

  try {
    // მიმდინარე ცვლის წამოსაღებად
    const shiftResult = await db.query("SELECT * FROM shifts WHERE id = $1 AND status = 'open'", [shiftId]);
    if (shiftResult.rows.length === 0) {
      return res.status(404).json({ error: 'აქტიური ცვლა ამ ID-ით ვერ მოიძებნა' });
    }

    const shift = shiftResult.rows[0];

    // უსაფრთხოება: მხოლოდ იმ მოლარეს შეუძლია დახურვა, ვინც გახსნა (ან ადმინს)
    if (shift.cashier_id !== cashierId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'თქვენ არ გაქვთ ამ ცვლის დახურვის უფლება!' });
    }

    // გამოვთვალოთ ამ ცვლაში ჩატარებული გაყიდვების ჯამი
    const salesSumResult = await db.query(
      "SELECT COALESCE(SUM(total_amount), 0) as total FROM payments WHERE shift_id = $1", 
      [shiftId]
    );
    const totalSales = parseFloat(salesSumResult.rows[0].total);
    const endAmountExpected = shift.start_amount + totalSales;
    const difference = endAmountActual - endAmountExpected;

    // ცვლის სტატუსის განახლება
    const updateQuery = `
      UPDATE shifts 
      SET status = 'closed', 
          closed_at = TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'), 
          end_amount_expected = $1, 
          end_amount_actual = $2, 
          difference = $3 
      WHERE id = $4
    `;
    await db.query(updateQuery, [endAmountExpected, endAmountActual, difference, shiftId]);

    res.json({
      success: true,
      message: 'ცვლა წარმატებით დაიხურა',
      summary: {
        startAmount: shift.start_amount,
        totalSales,
        endAmountExpected,
        endAmountActual,
        difference
      }
    });

  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// 🛒 2. გაყიდვების გატარება (POS OPERATIONS)
// ==========================================

// 🧾 ა) ახალი ჩეკის/გაყიდვის რეგისტრაცია
router.post('/sales', authenticateToken, async (req: CustomRequest, res: Response) => {
  const { items, totalAmount, shiftId } = req.body;
  const cashierId = req.user?.id;

  if (!items || items.length === 0 || !totalAmount || !shiftId) {
    return res.status(400).json({ error: 'ჩეკის მონაცემები არასრულია' });
  }

  try {
    // 1. გადავამოწმოთ ცვლა ნამდვილად აქტიურია თუ არა
    const shiftCheck = await db.query("SELECT status FROM shifts WHERE id = $1", [shiftId]);
    if (shiftCheck.rows.length === 0 || shiftCheck.rows[0].status !== 'open') {
      return res.status(400).json({ error: 'გაყიდვის დასაფიქსირებლად საჭიროა აქტიური ცვლა!' });
    }

    // 2. მარაგების ვალიდაცია (Race Condition-ის პრევენცია)
    for (const item of items) {
      const prodCheck = await db.query("SELECT stock, name FROM products WHERE id = $1", [item.productId]);
      if (prodCheck.rows.length === 0) {
        return res.status(404).json({ error: `პროდუქტი ID-ით ${item.productId} ვერ მოიძებნა` });
      }
      if (prodCheck.rows[0].stock < item.quantity) {
        return res.status(400).json({ error: `პროდუქტზე "${prodCheck.rows[0].name}" ნაშთი არასაკმარისია! ხელმისაწვდომია: ${prodCheck.rows[0].stock}` });
      }
    }

    // 3. ტრანზაქციის დაწყება მონაცემთა ბაზაში
    await db.query('BEGIN');

    // მთავარი გადახდის ჩაწერა (payments)
    const paymentQuery = `
      INSERT INTO payments (cashier_id, shift_id, total_amount, created_at) 
      VALUES ($1, $2, $3, TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')) 
      RETURNING id, created_at
    `;
    const paymentResult = await db.query(paymentQuery, [cashierId, shiftId, totalAmount]);
    const paymentId = paymentResult.rows[0].id;

    // ჩეკის დეტალების ჩაწერა და მარაგების შემცირება
    for (const item of items) {
      // ჩაწერა დეტალებში (payment_items)
      await db.query(
        `INSERT INTO payment_items (payment_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)`,
        [paymentId, item.productId, item.quantity, item.price]
      );

      // მარაგის შემცირება (მხოლოდ იმ შემთხვევაში, თუ მარაგი მეტია ან ტოლი მოთხოვნილზე)
      const updateStockResult = await db.query(
        `UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1`,
        [item.quantity, item.productId]
      );

      if (updateStockResult.rowCount === 0) {
        throw new Error('მარაგის განახლება ჩავარდა. შესაძლოა ნაშთი პარალელურად შეიცვალა.');
      }
    }

    // თუ ყველაფერმა წარმატებით გაიარა, ვინახავთ ცვლილებებს
    await db.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'გაყიდვა წარმატებით დაფიქსირდა',
      paymentId,
      createdAt: paymentResult.rows[0].created_at
    });

  } catch (err: any) {
    // შეცდომის შემთხვევაში ვაუქმებთ ბაზაში ყველაფერს
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// 📋 ბ) ჩეკების ისტორიის წაკითხვა მიმდინარე ცვლისთვის (მოლარის კონტროლის ფიჩერი)
router.get('/receipts', authenticateToken, async (req: CustomRequest, res: Response) => {
  const { shiftId } = req.query;

  if (!shiftId) {
    return res.status(400).json({ error: 'shiftId პარამეტრი სავალდებულოა' });
  }

  try {
    const result = await db.query(
      `SELECT p.id as payment_id, p.total_amount, p.created_at, u.name as cashier_name
       FROM payments p
       JOIN users u ON p.cashier_id = u.id
       WHERE p.shift_id = $1 
       ORDER BY p.id DESC`,
      [shiftId]
    );

    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
