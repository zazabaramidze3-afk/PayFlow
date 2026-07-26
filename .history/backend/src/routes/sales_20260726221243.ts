import { Router, Response } from 'express';
import sqlite3 from 'sqlite3';
import path from 'path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { authenticateToken } from './auth';
import { checkActiveShift, CustomRequest } from '../checkShift';
import jwt from 'jsonwebtoken';

const router = Router();
const db = new sqlite3.Database(path.resolve(__dirname, '../../database.sqlite'));

// ⚙️ SINGLE_REGISTER_MODE
// ახლა თქვენ გაქვთ ერთი ფიზიკური სალარო (POS), ამიტომ ერთდროულად მხოლოდ ერთ
// მოლარეს უნდა შეეძლოს ცვლის გახსნა (მეორემ ვერ გახსნას ცვლა, სანამ პირველი
// არ დაიხურება) — რადგან ფაქტობრივად ორივე ერთსა და იმავე სალაროზე იჯდება.
//
// 🚀 SaaS მასშტაბირებისას (მრავალი პარალელური ტერმინალი): როცა დაამატებთ
// `registers`/`terminals` ცხრილს და შესაბამის register_id-ს shifts ცხრილში,
// ეს ალამი გამორთეთ (false) და ქვემოთ მოცემული შემოწმება ჩაანაცვლეთ
// `WHERE register_id = ? AND status = 'open'`-ით (ერთი ცვლა თითო ტერმინალზე,
// და არა გლობალურად ერთი მთელ სისტემაზე).
const SINGLE_REGISTER_MODE = true;


// --- ცვლების მოდული ---
router.get('/shifts/status', authenticateToken, (req: CustomRequest, res) => {
  db.get(`SELECT * FROM shifts WHERE cashier_id = ? AND status = 'open'`, [req.user?.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ hasActiveShift: !!row, shift: row || null });
  });
});

router.post('/shifts/open', authenticateToken, (req: CustomRequest, res) => {
  // ⚡ ცვლის გახსნა მხოლოდ მოლარეს შეუძლია. ადმინს/მენეჯერს POS-ზე წვდომა არ აქვს
  // და შესაბამისად არც ცვლის გახსნის უფლება, რომ არ გამოჩნდნენ "მოლარეების" სიაში.
  if (req.user?.role !== 'cashier') {
    return res.status(403).json({ message: "ცვლის გახსნა შეუძლია მხოლოდ მოლარეს" });
  }

  const { start_amount } = req.body;
  if (start_amount === undefined || start_amount < 0) return res.status(400).json({ message: "არავალიდური თანხა" });

  // ⚡ SINGLE_REGISTER_MODE-ის დროს ვამოწმებთ, ხომ არ არის სისტემაში საერთოდ
  // რომელიმე სხვა მოლარის მიერ უკვე გახსნილი ცვლა (ერთი ფიზიკური სალარო = ერთი
  // აქტიური ცვლა ერთდროულად). წინააღმდეგ შემთხვევაში ვამოწმებთ მხოლოდ საკუთარს.
  const activeShiftCheckQuery = SINGLE_REGISTER_MODE
    ? `SELECT id, cashier_id FROM shifts WHERE status = 'open'`
    : `SELECT id, cashier_id FROM shifts WHERE cashier_id = ? AND status = 'open'`;
  const activeShiftCheckParams = SINGLE_REGISTER_MODE ? [] : [req.user?.id];

  db.get(activeShiftCheckQuery, activeShiftCheckParams, (err, existing: any) => {
    if (err) return res.status(500).json({ error: err.message });
    if (existing) {
      const message = SINGLE_REGISTER_MODE && existing.cashier_id !== req.user?.id
        ? "სალარო უკვე დაკავებულია — სხვა მოლარეს აქვს ღია ცვლა. დაელოდეთ მის დახურვას."
        : "თქვენ უკვე გაქვთ გახსნილი ცვლა";
      return res.status(400).json({ message });
    }

    db.run(`INSERT INTO shifts (cashier_id, start_amount, status) VALUES (?, ?, 'open')`, [req.user?.id, start_amount], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ message: "ცვლა გაიხსნა", shiftId: this.lastID });
    });
  });
});

router.put('/shifts/close', authenticateToken, (req: CustomRequest, res) => {
  const { end_amount_actual } = req.body;

  if (end_amount_actual === undefined || end_amount_actual === null || isNaN(Number(end_amount_actual))) {
    return res.status(400).json({ message: "არავალიდური ფაქტობრივი თანხა" });
  }

  db.get(`SELECT * FROM shifts WHERE cashier_id = ? AND status = 'open'`, [req.user?.id], (err, shift: any) => {
    // ⚡ აქამდე err საერთოდ არ იყო შემოწმებული — თუ SQL query ჩავარდებოდა,
    // shift იქნებოდა undefined და ფრონტს ყოველთვის ერგებოდა "აქტიური ცვლა ვერ
    // მოიძებნა", ნამდვილი მიზეზის დაფარვით.
    if (err) {
      console.error('shifts/close: SELECT active shift error:', err.message);
      return res.status(500).json({ error: err.message });
    }
    if (!shift) return res.status(400).json({ message: "აქტიური ცვლა ვერ მოიძებნა" });

    db.get(`SELECT COALESCE(SUM(total_amount), 0) as total_cash FROM payments WHERE shift_id = ?`, [shift.id], (err, row: any) => {
      if (err) {
        console.error('shifts/close: SUM(total_amount) error:', err.message);
        return res.status(500).json({ error: err.message });
      }

      const end_amount_expected = shift.start_amount + row.total_cash;
      const difference = Number(end_amount_actual) - end_amount_expected;
      const closedAt = new Date().toLocaleString('en-US', { timeZone: 'Asia/Tbilisi', hour12: false });

      db.run(`UPDATE shifts SET status = 'closed', closed_at = ?, end_amount_expected = ?, end_amount_actual = ?, difference = ? WHERE id = ?`,
        [closedAt, end_amount_expected, end_amount_actual, difference, shift.id], (err) => {
          if (err) {
            console.error('shifts/close: UPDATE error:', err.message);
            return res.status(500).json({ error: err.message });
          }
          res.json({
            message: "ცვლა დაიხურა",
            start: shift.start_amount,        // 👈 საწყისი — აკლდა
            expected: end_amount_expected,
            actual: Number(end_amount_actual),
            difference,
          });
        });
    });
  });
});


router.get('/shifts/history', authenticateToken, (req: any, res: Response) => {
  if (req.user?.role === 'cashier') return res.status(403).json({ error: 'წვდომა შეზღუდულია!' });
  
  // ⚡ ჩასწორებული SQL მოთხოვნა LEFT JOIN-ით
  // ადმინი არ არის მოლარე და არ უნდა გამოჩნდეს ცვლების სიაში
  const query = `
    SELECT s.*, u.name AS cashier_name 
    FROM shifts s 
    LEFT JOIN users u ON s.cashier_id = u.id 
    WHERE u.role IS NULL OR u.role != 'admin'
    ORDER BY s.id DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});


// --- გაყიდვები (POS) — მარაგების დაცვით და გამართული ID-ით ---
router.post('/payments', authenticateToken, checkActiveShift, (req: CustomRequest, res: any) => {
  const { items } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'კალათა ცარიელია!' });

  const totalAmount = items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);

  // 1. ვიწყებთ ტრანზაქციას
  db.run("BEGIN TRANSACTION", (err) => {
    if (err) return res.status(500).json({ error: "ტრანზაქციის დაწყება ვერ მოხერხდა" });

    // 2. ვინახავთ ძირითად ქვითარს
    db.run(
      "INSERT INTO payments (cashier_id, shift_id, total_amount) VALUES (?, ?, ?)", 
      [req.user?.id, req.activeShiftId, totalAmount], 
      function (err) {
        if (err) {
          db.run("ROLLBACK");
          return res.status(500).json({ error: err.message });
        }

        // ⚡ აი აქ გასწორდა: lastID (დიდი ასოებით)
        const paymentId = this.lastID; 
        let itemIndex = 0;

        // 3. ფუნქცია პროდუქტების სათითაოდ და უსაფრთხოდ დასამუშავებლად (ანაცვლებს ბაგებიან forEach-ს)
        function processNextItem() {
          if (itemIndex >= items.length) {
            // თუ ყველა პროდუქტმა წარმატებით გაიარა, ვასრულებთ ტრანზაქციას
            db.run("COMMIT", (err) => {
              if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: "COMMIT-ის შეცდომა" });
              }
              return res.status(201).json({ success: true, paymentId, totalAmount });
            });
            return;
          }

          const item = items[itemIndex];
          // ვადგენთ სწორ ველს: თუ ფრონტენდიდან productId მოდის თუ product_id
          const pId = item.productId || item.product_id;

          // ატომურად ვაკლებთ მარაგს და ვამოწმებთ stock >= quantity
          db.run(
            "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?", 
            [item.quantity, pId, item.quantity], 
            function (err) {
              if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
              }

              // თუ ცვლილება არ მოხდა, მარაგი არ არის!
              if (this.changes === 0) {
                db.run("ROLLBACK");
                return res.status(400).json({ error: `არ არის საკმარისი მარაგი პროდუქტზე ID: ${pId}` });
              }

              // ვამატებთ გაყიდულ ნივთს ქვითრის დეტალებში
              db.run(
                "INSERT INTO payment_items (payment_id, product_id, quantity, price) VALUES (?, ?, ?, ?)", 
                [paymentId, pId, item.quantity, item.price], 
                (err) => {
                  if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: err.message });
                  }

                  // გადავდივართ კალათის შემდეგ ნივთზე
                  itemIndex++;
                  processNextItem();
                }
              );
            }
          );
        }

        // ვიწყებთ კალათის დამუშავებას
        processNextItem();
      }
    );
  });
});

// --- გაყიდვები (POS) — მარაგების დაცვით ---
// router.post('/payments', authenticateToken, checkActiveShift, (req: CustomRequest, res) => {
//   const { items } = req.body;
//   if (!items || items.length === 0) return res.status(400).json({ error: 'კალათა ცარიელია!' });

//   const totalAmount = items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);

//   db.serialize(() => {
//     db.run("BEGIN TRANSACTION");

//     db.run("INSERT INTO payments (cashier_id, shift_id, total_amount) VALUES (?, ?, ?)", [req.user?.id, req.activeShiftId, totalAmount], function (err) {
//       if (err) {
//         db.run("ROLLBACK");
//         return res.status(500).json({ error: err.message });
//       }

//       const paymentId = this.lastId;
//       let completed = 0;
//       let hasError = false;

//       items.forEach((item: any) => {
//         if (hasError) return;

//         db.run(
//           "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?", 
//           [item.quantity, item.productId, item.quantity], 
//           function (err) {
//             if (hasError) return;
//             if (err) {
//               hasError = true;
//               db.run("ROLLBACK");
//               return res.status(500).json({ error: err.message });
//             }
//             if (this.changes === 0) {
//               hasError = true;
//               db.run("ROLLBACK");
//               return res.status(400).json({ error: `არ არის საკმარისი მარაგი!` });
//             }

//             db.run(
//               "INSERT INTO payment_items (payment_id, product_id, quantity, price) VALUES (?, ?, ?, ?)", 
//               [paymentId, item.productId, item.quantity, item.price], 
//               (err) => {
//                 if (hasError) return;
//                 if (err) {
//                   hasError = true;
//                   db.run("ROLLBACK");
//                   return res.status(500).json({ error: err.message });
//                 }
//                 completed++;
//                 if (completed === items.length) {
//                   db.run("COMMIT", () => {
//                     res.status(201).json({ success: true, paymentId, totalAmount });
//                   });
//                 }
//               }
//             );
//           }
//         );
//       });
//     });
//   });
// });

// --- გაყიდვები (POS) ---
// router.post('/payments', authenticateToken, checkActiveShift, (req: CustomRequest, res) => {
//   const { items } = req.body;
//   if (!items || items.length === 0) return res.status(400).json({ error: 'კალათა ცარიელია!' });

//   const totalAmount = items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);

//   db.serialize(() => {
//     db.run("BEGIN TRANSACTION");
//     db.run(`INSERT INTO payments (cashier_id, shift_id, total_amount) VALUES (?, ?, ?)`, [req.user?.id, req.activeShiftId, totalAmount], function (err) {
//       if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
      
//       const paymentId = this.lastID;
//       let completed = 0;

//       items.forEach((item: any) => {
//         db.run("UPDATE products SET stock = stock - ? WHERE id = ?", [item.quantity, item.productId], (err) => {
//           if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
          
//           db.run("INSERT INTO payment_items (payment_id, product_id, quantity, price) VALUES (?, ?, ?, ?)", [paymentId, item.productId, item.quantity, item.price], (err) => {
//             if (err) { db.run("ROLLBACK"); return res.status(500).json({ error: err.message }); }
//             completed++;
//             if (completed === items.length) {
//               db.run("COMMIT", () => res.status(201).json({ success: true, paymentId, totalAmount }));
//             }
//           });
//         });
//       });
//     });
//   });
// });

// --- გაყიდვების ისტორია (GET) დაშბორდისთვის ---
// router.get('/payments', authenticateToken, (req: CustomRequest, res: any) => {
//   const { minPrice, maxPrice } = req.query as any;
  
//   // ⚡ ჩასწორდა u.name-ზე, თქვენი ბაზის სქემის მიხედვით
//   let query = `
//     SELECT p.id, p.total_amount, p.created_at, u.name AS cashier_name 
//     FROM payments p
//     LEFT JOIN users u ON p.cashier_id = u.id
//     WHERE 1=1
//   `;
//   const params: any[] = [];

//   if (minPrice) { query += " AND p.total_amount >= ?"; params.push(Number(minPrice)); }
//   if (maxPrice) { query += " AND p.total_amount <= ?"; params.push(Number(maxPrice)); }
//   query += " ORDER BY p.id DESC";

//   db.all(query, params, (err, rows) => {
//     if (err) return res.status(500).json({ error: err.message });
//     res.json(rows);
//   });
// });

// --- გაყიდვების ისტორია (GET) დაშბორდისთვის (დეტალებით) ---
router.get('/payments', authenticateToken, (req: CustomRequest, res: any) => {
  const { minPrice, maxPrice, cashierName, productName } = req.query as any;
  
  // 1. ჯერ წამოვიღებთ ყველა ძირითად ქვითარს
  let query = `
    SELECT p.id, p.total_amount, p.created_at, u.name AS cashier_name 
    FROM payments p
    LEFT JOIN users u ON p.cashier_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (minPrice) { query += " AND p.total_amount >= ?"; params.push(Number(minPrice)); }
  if (maxPrice) { query += " AND p.total_amount <= ?"; params.push(Number(maxPrice)); }
  // თუ ფრონტენდიდან მოლარის სახელით ფილტრავენ
  if (cashierName) { query += " AND u.name LIKE ?"; params.push(`%${cashierName}%`); }

  query += " ORDER BY p.id DESC";

  db.all(query, params, (err, payments: any[]) => {
    if (err) return res.status(500).json({ error: err.message });
    if (payments.length === 0) return res.json([]);

    // 2. ახლა თითოეული ქვითრისთვის წამოვიღებთ მის პროდუქტებს payment_items-დან
    // ვიყენებთ SQLite-ის SQL მოთხოვნას ყველა გაყიდულ ნივთზე ერთიანად
    const paymentIds = payments.map(p => p.id);
    const placeholders = paymentIds.map(() => '?').join(',');

    const itemsQuery = `
      SELECT pi.payment_id, pi.quantity, pi.price, pr.name
      FROM payment_items pi
      LEFT JOIN products pr ON pi.product_id = pr.id
      WHERE pi.payment_id IN (${placeholders})
    `;

    db.all(itemsQuery, paymentIds, (err, items: any[]) => {
      if (err) return res.status(500).json({ error: err.message });

      // 3. შევუკრათ თითოეულ ქვითარს თავისი ნივთების მასივი
      const paymentsWithItems = payments.map(payment => {
        return {
          ...payment,
          items: items.filter(item => item.payment_id === payment.id)
        };
      });

      // ვაბრუნებთ სრულყოფილ ობიექტს
      res.json(paymentsWithItems);
    });
  });
});

// --- Excel ექსპორტი ---
router.get('/payments/export/excel', (req: any, res: any) => {
  const token = req.query.token as string;
  const secretKey = process.env.JWT_SECRET || 'super-secret-key';
  if (!token) return res.status(401).json({ error: 'ტოკენი არ არსებობს!' });
  
  jwt.verify(token, secretKey, (err: any) => {
    if (err) return res.status(403).json({ error: 'ტოკენი არავალიდურია!' });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Payments');
    
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'მოლარე', key: 'cashier_name', width: 15 },
      { header: 'ჯამური ფასი', key: 'total_amount', width: 15 },
      { header: 'თარიღი', key: 'created_at', width: 25 }
    ];

    // ⚡ ჩასწორდა u.name-ზე
    const query = `
      SELECT p.id, p.total_amount, p.created_at, u.name AS cashier_name 
      FROM payments p 
      LEFT JOIN users u ON p.cashier_id = u.id 
      ORDER BY p.id DESC
    `;

    db.all(query, [], async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      worksheet.addRows(rows);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=payments.xlsx');
      await workbook.xlsx.write(res);
      res.end();
    });
  });
});

// --- PDF ექსპორტი ---
router.get('/payments/export/pdf', (req: any, res: any) => {
  const token = req.query.token as string;
  const secretKey = process.env.JWT_SECRET || 'super-secret-key';
  if (!token) return res.status(401).json({ error: 'ტოკენი არ არსებობს!' });

  jwt.verify(token, secretKey, (err: any) => {
    if (err) return res.status(403).json({ error: 'ტოკენი არავალიდურია!' });

    const query = `
      SELECT p.id, p.total_amount, p.created_at, u.name AS cashier_name 
      FROM payments p 
      LEFT JOIN users u ON p.cashier_id = u.id
      ORDER BY p.id DESC
    `;

    db.all(query, [], (err, rows: any[]) => {
      if (err) return res.status(500).send(err.message);
      
      const doc = new PDFDocument({ margin: 50 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=payments_report.pdf');
      doc.pipe(res);

      // 🇬🇪 ქართული ფონტის რეგისტრაცია (Sylfaen), წინააღმდეგ შემთხვევაში
      // ნაგულისხმევი Helvetica ფონტი ქართულ სიმბოლოებს ("მოლარე2" და ა.შ.) აშლის.
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

      // სათაური
      doc.font(boldFont).fontSize(20).text('Sales Report', { align: 'center' });
      doc.moveDown(2);

      // ცხრილის სათაურები (Headers)
      const tableTop = 150;
      doc.fontSize(12).font(boldFont);
      doc.text('ID', 50, tableTop);
      doc.text('Cashier', 100, tableTop);
      doc.text('Total Amount', 220, tableTop);
      doc.text('Date', 350, tableTop);

      // ხაზი სათაურის ქვეშ
      doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

      // მონაცემების ციკლი
      let currentY = tableTop + 25;
      doc.font(regularFont);

      // ⚡ 1. გამოვთვალოთ ყველა გაყიდვის ჯამი
      const grandTotal = rows.reduce((sum, row) => sum + row.total_amount, 0);

      rows.forEach((row) => {
        if (currentY > 700) {
          doc.addPage();
          currentY = 50; 
        }

        doc.font(regularFont);
        doc.text(row.id.toString(), 50, currentY);
        doc.text(row.cashier_name || 'N/A', 100, currentY);
        doc.text(`${row.total_amount} GEL`, 220, currentY);
        doc.text(row.created_at, 350, currentY);

        currentY += 20;
      });

      // ⚡ 2. დავამატოთ ხაზი და ჯამური თანხა ცხრილის ბოლოში
      currentY += 10;
      if (currentY > 720) { // თუ გვერდის ბოლოში ადგილი არ არის, გადავიტანოთ ახალზე
        doc.addPage();
        currentY = 50;
      }
      
      doc.moveTo(50, currentY).lineTo(550, currentY).stroke(); // ხაზი მონაცემების ქვეშ
      currentY += 15;

      doc.fontSize(14).font(boldFont);
      doc.text('Grand Total:', 50, currentY);
      doc.text(`${grandTotal} GEL`, 220, currentY); // ჯამური თანხის გამოტანა

      doc.end();
    });
  });
});


export default router;