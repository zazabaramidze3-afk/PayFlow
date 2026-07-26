import { Router, Request, Response } from 'express';
import sqlite3 from 'sqlite3';
import path from 'path';
import { authenticateToken } from './auth';
import { CustomRequest } from './auth'; // 👈 თუ კავშირი ასე გაქვთ
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import fs from 'fs';

const router = Router();
const db = new sqlite3.Database(path.resolve(__dirname, '../../database.sqlite'));

// 1. პროდუქტების სრული სიის წაკითხვა
router.get('/products', authenticateToken, (req: CustomRequest, res: Response) => {
  db.all(`SELECT id, barcode, name, price, stock FROM products`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// [ახალი] 1.5. პროდუქტის ძებნა შტრიხკოდით (საჭიროა Restock და მართვის პანელისთვის)
// [ახალი] 1.5. პროდუქტის ძებნა შტრიხკოდით (საჭიროა Restock და მართვის პანელისთვის)
router.get('/products/barcode/:barcode', authenticateToken, (req: CustomRequest, res: Response) => {
  const { barcode } = req.params;

  if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
    return res.status(403).json({ error: 'წვდომა უარყოფილია. საჭიროა მენეჯერის უფლებები.' });
  }

  db.get(`SELECT id, barcode, name, price, stock FROM products WHERE barcode = ?`, [barcode.trim()], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (!row) {
      return res.status(404).json({ exists: false, message: 'პროდუქტი ამ შტრიხკოდით არ მოიძებნა.' });
    }

    res.json({ exists: true, product: row });
  });
});

// [ახალი] 1.2. კრიტიკული ნაშთების მქონე პროდუქტების წაკითხვა (Low Stock Alert)
router.get('/products/low-stock', authenticateToken, (req: CustomRequest, res: Response) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
    return res.status(403).json({ error: 'წვდომა უარყოფილია. საჭიროა მენეჯერის უფლებები.' });
  }

  db.all(`SELECT id, barcode, name, price, stock FROM products WHERE stock <= 5 ORDER BY stock ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});


// 2. ახალი პროდუქტის დამატება (განახლებული შტრიხკოდით)
router.post('/products', authenticateToken, (req: CustomRequest, res: Response) => {
  const { barcode, name, price, stock } = req.body;

  
  db.get(`SELECT * FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`, [name], (err, row) => {
    if (row) return res.status(409).json({ error: 'პროდუქტი ამ დასახელებით უკვე არსებობს!' });

    if (barcode && barcode.trim() !== '') {
      db.get(`SELECT * FROM products WHERE barcode = ?`, [barcode.trim()], (err, barcodeRow) => {
        if (barcodeRow) return res.status(409).json({ error: 'ეს შტრიხკოდი უკვე მინიჭებული აქვს სხვა პროდუქტს!' });
        
        insertProduct();
      });
    } else {
      insertProduct();
    }
  });

  function insertProduct() {
    const bCode = barcode && barcode.trim() !== '' ? barcode.trim() : null;
    db.run(
      `INSERT INTO products (barcode, name, price, stock) VALUES (?, ?, ?, ?)`,
      [bCode, name.trim(), price, stock],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, barcode: bCode, name: name.trim(), price, stock });
      }
    );
  }
});

// [ახალი] 2.5. არსებული პროდუქტის მარაგის შევსება (Restock ოპერაცია)
router.patch('/products/:id/restock', authenticateToken, (req: CustomRequest, res: Response) => {
  const { id } = req.params;
  const { quantityToAdd } = req.body;

  // უსაფრთხოება: მოლარეს არ აქვს მარაგების გაზრდის უფლება
  if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
    return res.status(403).json({ error: 'წვდომა უარყოფილია.' });
  }

  // ვალიდაცია
  if (!quantityToAdd || quantityToAdd <= 0) {
    return res.status(400).json({ error: 'გთხოვთ მიუთითოთ ვალიდური რაოდენობა.' });
  }

  db.run(
    `UPDATE products SET stock = stock + ? WHERE id = ?`,
    [quantityToAdd, id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'პროდუქტი ვერ მოიძებნა.' });

      res.json({ message: 'მარაგი წარმატებით განახლდა', added: quantityToAdd });
    }
  );
});

// 3. პროდუქტის რედაქტირება (განახლებული შტრიხკოდით)
router.put('/products/:id', authenticateToken, (req: CustomRequest, res: Response) => {
  const { id } = req.params;
  const { barcode, name, price, stock } = req.body;
  const bCode = barcode && barcode.trim() !== '' ? barcode.trim() : null;

  db.run(
    `UPDATE products SET barcode = ?, name = ?, price = ?, stock = ? WHERE id = ?`,
    [bCode, name.trim(), price, stock, id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: Number(id), barcode: bCode, name: name.trim(), price, stock });
    }
  );
});

// 4. პროდუქტის წაშლა
router.delete('/products/:id', authenticateToken, (req: CustomRequest, res: Response) => {
  db.run(`DELETE FROM products WHERE id = ?`, [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'წარმატებით წაიშალა' });
  });
});


// 🟩 1. Excel ექსპორტის ენდპოინტი
router.get('/products/export/excel', authenticateToken, (req: Request, res: Response) => {
  const isLowStockOnly = req.query.type === 'low';
  
  // თუ ჩართულია ფილტრი, წამოიღებს მხოლოდ stock <= 5, თუ არა - ყველას
  const query = isLowStockOnly 
    ? `SELECT id, barcode, name, price, stock FROM products WHERE stock <= 5 ORDER BY stock ASC`
    : `SELECT id, barcode, name, price, stock FROM products ORDER BY id ASC`;

  db.all(query, [], async (err, rows: any[]) => {
    if (err) return res.status(500).json({ error: err.message });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('მარაგების ნაშთები');

    // სვეტების სტრუქტურა
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'შტრიხკოდი', key: 'barcode', width: 20 },
      { header: 'დასახელება', key: 'name', width: 30 },
      { header: 'ფასი (GEL)', key: 'price', width: 15 },
      { header: 'ნაშთი', key: 'stock', width: 15 }
    ];

    // ჰედერის სტილი
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };

    // მონაცემების შევსება
    rows.forEach(row => {
      worksheet.addRow({
        id: row.id,
        barcode: row.barcode || '-',
        name: row.name,
        price: `${row.price} GEL`,
        stock: `${row.stock} ცალი`
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=products_report.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  });
});

// 🟥 2. PDF ექსპორტის ენდპოინტი
router.get('/products/export/pdf', authenticateToken, (req: Request, res: Response) => {
  const isLowStockOnly = req.query.type === 'low';
  
  const query = isLowStockOnly 
    ? `SELECT id, barcode, name, price, stock FROM products WHERE stock <= 5 ORDER BY stock ASC`
    : `SELECT id, barcode, name, price, stock FROM products ORDER BY id ASC`;

  db.all(query, [], (err, rows: any[]) => {
    if (err) return res.status(500).json({ error: err.message });

    // ფონტის ზუსტი მისამართის განსაზღვრა (ვიყენებთ იმას, რაც ტერმინალმა წეღან წარმატებით იპოვა)
    // const fontPath = path.join(process.cwd(), 'backend', 'src', 'fonts', 'Sylfaen.ttf');
    const doc = new PDFDocument({ margin: 30 });

    // 🚀 უნივერსალური გზა: ფარდობითი მისამართი მიმდინარე ფაილიდან (routes-დან fonts-მდე)
    const fontPath = path.resolve(__dirname, '../fonts/Sylfaen.ttf');

    try {
      doc.registerFont('Georgian', fontPath);
      doc.font('Georgian');
    } catch (fontError: any) {
      console.error("ფონტის რეგისტრაცია ჩავარდა:", fontError);
    }


    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=products_report.pdf');
    doc.pipe(res);

    // PDF დიზაინი
    doc.fontSize(18).text(' მარაგების ნაშთების რეპორტი', { align: 'center' });
    doc.fontSize(10).text(`გენერირების თარიღი: ${new Date().toLocaleString('ka-GE')}`, { align: 'center' });
    if (isLowStockOnly) {
      doc.fillColor('red').fontSize(11).text(' ფილტრი: ნაჩვენებია მხოლოდ ამოწურვადი პროდუქტები', { align: 'center' }).fillColor('black');
    }
    doc.moveDown(2);

    // ცხრილის ჰედერი
    doc.fontSize(11).text('ID       შტრიხკოდი          დასახელება                    ფასი          ნაშთი');
    doc.text('-------------------------------------------------------------------------------------------------------');
    doc.moveDown(0.5);

    // პროდუქტების ჩაწერა
    rows.forEach(row => {
      const barcodeStr = (row.barcode || '-').padEnd(18);
      const nameStr = row.name.padEnd(25);
      const priceStr = `${row.price} ლ.`.padEnd(12);
      
      // ⚠️ ყურადღება მიაქციეთ ბექტიკებს (Backticks) მთლიანი ტექსტის გარშემო
      doc.fontSize(10).text(
        `${row.id.toString().padEnd(6)} ${barcodeStr} ${nameStr} ${priceStr} ${row.stock} ცალი`
      );
      doc.moveDown(0.3);
    });



    doc.end();
  });
});

export default router;
