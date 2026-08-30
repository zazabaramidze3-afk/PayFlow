import { Router, Response } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import path from 'path';
import { authenticateToken, CustomRequest } from './auth';
// შემოგვაქვს მზა PostgreSQL პული ძირითადი ფაილიდან (ერთადერთი, საერთო pool)
import { db } from '../index';
// 🔒 Roadmap STEP 2.2 (RLS Full Rollout, "28.08.2026") — products.ts, ბლოკი 2.
// იგივე `withOrgContext` pattern, რაც auth.ts-ს (ბლოკი 1) და sales.ts-ს
// (pilot) დაერთო — `products` ცხრილზე migration 017-ის RLS policy-ს
// უერთდება, route-level `WHERE/AND organization_id` scoping-ის დამატებით
// შრედ.
import { withOrgContext } from '../db';

const router = Router();

const LOW_STOCK_THRESHOLD = 5;

// ==========================================
// 📦 პროდუქტების CRUD
// ==========================================

// 🟢 ყველა პროდუქტის წამოღება (+ სურვილისამებრ low-stock ფილტრი)
// 🏢 Multi-Tenant SaaS STEP 2 (Roadmap "23.08.2026") — `WHERE organization_id
// = $1` დაემატა (ყოველთვის, არა მხოლოდ lowStockOnly-ის დროს). `tests/isolation/
// tenant-isolation.test.ts`-ის "GET /api/products" ამ ცვლილებას ამოწმებს.
router.get('/products', authenticateToken, async (req: CustomRequest, res: Response) => {
  const { lowStockOnly } = req.query;

  try {
    let query = 'SELECT * FROM products WHERE organization_id = $1';
    const params: any[] = [req.user?.organizationId];

    if (lowStockOnly === 'true') {
      query += ' AND stock <= $2';
      params.push(LOW_STOCK_THRESHOLD);
    }

    query += ' ORDER BY name ASC';

    const result = await withOrgContext(req.user?.organizationId, (client) => client.query(query, params));
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🔍 პროდუქტის ძებნა ბარკოდით (Restock/Registration მოდალისთვის)
// ⚠️ FIX: Products.tsx ელოდება ზუსტად { exists, product } ფორმატს
// (response.data.exists შემოწმებით), წინა ვერსია product-ს პირდაპირ აბრუნებდა.
// 🏢 Multi-Tenant SaaS STEP 2 (Roadmap "23.08.2026") — `AND organization_id
// = $2` დაემატა. Migration 013-ის შემდეგ ბარკოდი აღარაა გლობალურად
// უნიკალური (მხოლოდ per-org, `uq_products_org_barcode`) — ამის გარეშე
// org A-ს მოლარეს org B-ს იმავე ბარკოდიანი პროდუქტიც შეეძლო აღმოეჩინა.
router.get('/products/barcode/:barcode', authenticateToken, async (req: CustomRequest, res: Response) => {
  if (req.user?.role === 'cashier') {
    return res.status(403).json({ error: 'წვდომა შეზღუდულია!' });
  }

  try {
    const result = await withOrgContext(req.user?.organizationId, (client) =>
      client.query(
        'SELECT * FROM products WHERE barcode = $1 AND organization_id = $2 LIMIT 1',
        [req.params.barcode, req.user?.organizationId]
      )
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ exists: false, error: 'პროდუქტი ამ ბარკოდით ვერ მოიძებნა' });
    }

    res.json({ exists: true, product: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ➕ ახალი პროდუქტის დამატება
router.post('/products', authenticateToken, async (req: CustomRequest, res: Response) => {
  if (req.user?.role === 'cashier') {
    return res.status(403).json({ error: 'წვდომა შეზღუდულია!' });
  }

  const { name, price, stock, barcode } = req.body;

  if (!name || price === undefined || price < 0) {
    return res.status(400).json({ error: 'სახელი და ვალიდური ფასი სავალდებულოა' });
  }

  // 📴 Roadmap STEP 5 (migration 011) — chk_stock_positive DB-constraint
  // მოიხსნა, რომ Background Sync-ს (POST /payments/sync-offline)
  // დაშვებოდა products.stock-ის უარყოფით მნიშვნელობაზე ჩასმა (Offline
  // oversell-ის რეალური ასახვისთვის). ხელით პროდუქტის დამატებას კი ეს
  // "დაცვის ხვრელი" არ უნდა ეხებოდეს — აქ ცალსახად ვამოწმებთ.
  if (stock !== undefined && stock !== null && Number(stock) < 0) {
    return res.status(400).json({ error: 'მარაგი უარყოფითი ვერ იქნება' });
  }

  try {
    // 🏢 Multi-Tenant SaaS STEP 2, ტიერი 2 (Roadmap "23.08.2026", write-blocker
    // fix) — dupCheck-საც და INSERT-საც დაემატა organization_id.
    // migration 013-ის შემდეგ products.name per-org უნიკალურია
    // (uq_products_org_name), აღარ არის გლობალურად უნიკალური — ორგ-ის
    // ფილტრის გარეშე dupCheck არასწორად უარყოფდა Org A-ს მოთხოვნას,
    // თუ Org B-ს უკვე ჰქონდა იგივე სახელით პროდუქტი. INSERT-ის
    // organization_id-ის გარეშე კი (NOT NULL constraint) 500 იქნებოდა.
    const dupCheck = await withOrgContext(req.user?.organizationId, (client) =>
      client.query(
        'SELECT id FROM products WHERE LOWER(name) = LOWER($1) AND organization_id = $2',
        [name.trim(), req.user?.organizationId]
      )
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({ error: 'ამ სახელით პროდუქტი უკვე არსებობს!' });
    }

    const result = await withOrgContext(req.user?.organizationId, (client) =>
      client.query(
        `INSERT INTO products (name, price, stock, barcode, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [name.trim(), price, stock ?? 0, barcode || null, req.user?.organizationId]
      )
    );

    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'ეს სახელი ან ბარკოდი უკვე დაკავებულია!' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ✏️ პროდუქტის რედაქტირება
router.put('/products/:id', authenticateToken, async (req: CustomRequest, res: Response) => {
  if (req.user?.role === 'cashier') {
    return res.status(403).json({ error: 'წვდომა შეზღუდულია!' });
  }

  const { name, price, stock, barcode } = req.body;

  // 📴 Roadmap STEP 5 (migration 011) — იხ. POST /products-ის იგივე
  // კომენტარი: ხელით რედაქტირებას (Products.tsx) მარაგის უარყოფით
  // მნიშვნელობაზე ჩასმა კვლავ არ უნდა შეეძლოს, მხოლოდ Background
  // Sync-ის ავტომატურ oversell-სცენარს.
  if (stock !== undefined && stock !== null && Number(stock) < 0) {
    return res.status(400).json({ error: 'მარაგი უარყოფითი ვერ იქნება' });
  }

  try {
    // 🏢 Multi-Tenant SaaS STEP 2, ტიერი 3 (Roadmap "23.08.2026", IDOR fix)
    // — `AND organization_id = $3` დაემატა dupCheck-ს და `AND organization_id
    // = $6` UPDATE-ს. ამის გარეშე ეს IDOR-ტიპის ხარვეზი იყო: ნებისმიერ
    // ავტორიზებულ (non-cashier) მომხმარებელს, თუ სხვა org-ის პროდუქტის
    // id-ს გამოიცნობდა/მოიპოვებდა, შეეძლო მისი რედაქტირება — org-ის
    // საკუთრების შემოწმების გარეშე `WHERE id = $N` ნებისმიერ id-ს იღებდა.
    if (name) {
      const dupCheck = await withOrgContext(req.user?.organizationId, (client) =>
        client.query(
          'SELECT id FROM products WHERE LOWER(name) = LOWER($1) AND id != $2 AND organization_id = $3',
          [name.trim(), req.params.id, req.user?.organizationId]
        )
      );
      if (dupCheck.rows.length > 0) {
        return res.status(409).json({ error: 'ამ სახელით სხვა პროდუქტი უკვე არსებობს!' });
      }
    }

    const result = await withOrgContext(req.user?.organizationId, (client) =>
      client.query(
        `UPDATE products SET
          name = COALESCE($1, name),
          price = COALESCE($2, price),
          stock = COALESCE($3, stock),
          barcode = COALESCE($4, barcode)
         WHERE id = $5 AND organization_id = $6 RETURNING *`,
        [name?.trim(), price, stock, barcode, req.params.id, req.user?.organizationId]
      )
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'პროდუქტი ვერ მოიძებნა' });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'ეს სახელი ან ბარკოდი უკვე დაკავებულია!' });
    }
    res.status(500).json({ error: err.message });
  }
});

// 📥 მარაგის შევსება (Restock) — ატომურად ემატება არსებულს
// ⚠️ FIX: Products.tsx აგზავნის { quantityToAdd }, არა { quantity }.
router.patch('/products/:id/restock', authenticateToken, async (req: CustomRequest, res: Response) => {
  if (req.user?.role === 'cashier') {
    return res.status(403).json({ error: 'წვდომა შეზღუდულია!' });
  }

  const { quantityToAdd } = req.body;
  const qty = Number(quantityToAdd);

  if (!qty || qty <= 0) {
    return res.status(400).json({ error: 'რაოდენობა უნდა იყოს დადებითი რიცხვი' });
  }

  try {
    // 🏢 Multi-Tenant SaaS STEP 2, ტიერი 3 (Roadmap "23.08.2026", IDOR fix)
    // — `AND organization_id = $3` დაემატა. ორგანიზაციის საკუთრების
    // შემოწმების გარეშე სხვა org-ის პროდუქტის მარაგის ცვლილება იყო შესაძლებელი.
    const result = await withOrgContext(req.user?.organizationId, (client) =>
      client.query(
        'UPDATE products SET stock = stock + $1 WHERE id = $2 AND organization_id = $3 RETURNING *',
        [qty, req.params.id, req.user?.organizationId]
      )
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'პროდუქტი ვერ მოიძებნა' });
    }

    res.json({ success: true, product: result.rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🗑️ პროდუქტის წაშლა
router.delete('/products/:id', authenticateToken, async (req: CustomRequest, res: Response) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'მხოლოდ ადმინისტრატორს შეუძლია პროდუქტის წაშლა!' });
  }

  try {
    // 🏢 Multi-Tenant SaaS STEP 2, ტიერი 3 (Roadmap "23.08.2026", IDOR fix)
    // — `AND organization_id = $2` დაემატა. ორგანიზაციის შემოწმების გარეშე
    // ადმინს სხვა org-ის პროდუქტის წაშლა შეეძლო, id-ს გამოცნობით/მოპოვებით.
    const result = await withOrgContext(req.user?.organizationId, (client) =>
      client.query(
        'DELETE FROM products WHERE id = $1 AND organization_id = $2 RETURNING id',
        [req.params.id, req.user?.organizationId]
      )
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'პროდუქტი ვერ მოიძებნა' });
    }

    res.json({ success: true, message: 'პროდუქტი წაშლილია' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 📊 EXCEL ექსპორტი (პროდუქტები)
// ⚠️ FIX: ეს endpoint საერთოდ არ არსებობდა — Products.tsx-ის
// "Excel ექსპორტი" ღილაკი 404-ს იძლეოდა (იხ. screenshot).
// ==========================================
// 🏢 Multi-Tenant SaaS STEP 2 (Roadmap "23.08.2026") — `WHERE organization_id
// = $1` დაემატა, ამის გარეშე ექსპორტი ყველა org-ის პროდუქტს გადმოწერდა.
router.get('/products/export/excel', authenticateToken, async (req: CustomRequest, res: Response) => {
  try {
    const isLowStockOnly = req.query.type === 'low';

    let query = 'SELECT id, barcode, name, price, stock FROM products WHERE organization_id = $1';
    const params: any[] = [req.user?.organizationId];
    if (isLowStockOnly) {
      query += ' AND stock <= $2';
      params.push(LOW_STOCK_THRESHOLD);
    }
    query += ' ORDER BY name ASC';

    const result = await withOrgContext(req.user?.organizationId, (client) => client.query(query, params));

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Products');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'შტრიხკოდი', key: 'barcode', width: 18 },
      { header: 'დასახელება', key: 'name', width: 30 },
      { header: 'ფასი (₾)', key: 'price', width: 12 },
      { header: 'მარაგი', key: 'stock', width: 12 },
    ];
    worksheet.getRow(1).font = { bold: true };
    worksheet.addRows(result.rows);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=products_report_${isLowStockOnly ? 'low_stock' : 'all'}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 🟥 PDF ექსპორტი (პროდუქტები)
// ⚠️ FIX: ეს endpoint-იც არ არსებობდა — "PDF ექსპორტი" ღილაკი 404-ს იძლეოდა.
// ==========================================
// 🏢 Multi-Tenant SaaS STEP 2 (Roadmap "23.08.2026") — `WHERE organization_id
// = $1` დაემატა, იგივე მიზეზით, რაც Excel ექსპორტს ზემოთ.
router.get('/products/export/pdf', authenticateToken, async (req: CustomRequest, res: Response) => {
  try {
    const isLowStockOnly = req.query.type === 'low';

    let query = 'SELECT id, barcode, name, price, stock FROM products WHERE organization_id = $1';
    const params: any[] = [req.user?.organizationId];
    if (isLowStockOnly) {
      query += ' AND stock <= $2';
      params.push(LOW_STOCK_THRESHOLD);
    }
    query += ' ORDER BY name ASC';

    const result = await withOrgContext(req.user?.organizationId, (client) => client.query(query, params));
    const rows = result.rows;

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=products_report_${isLowStockOnly ? 'low_stock' : 'all'}.pdf`
    );
    doc.pipe(res);

    const fontPath = path.resolve(__dirname, '../fonts/Sylfaen.ttf');
    let georgianFontAvailable = false;
    try {
      doc.registerFont('Georgian', fontPath);
      georgianFontAvailable = true;
    } catch (fontError: any) {
      console.error('ფონტის რეგისტრაცია ჩავარდა:', fontError);
    }
    const regularFont = georgianFontAvailable ? 'Georgian' : 'Helvetica';
    const boldFont = georgianFontAvailable ? 'Georgian' : 'Helvetica-Bold';

    doc.font(boldFont).fontSize(20).text(
      isLowStockOnly ? 'Low Stock Report' : 'Products Report',
      { align: 'center' }
    );
    doc.font(regularFont).fontSize(10).text(
      `გენერირების თარიღი: ${new Date().toLocaleString('ka-GE')}`,
      { align: 'center' }
    );
    doc.moveDown(2);

    const tableTop = 150;
    doc.fontSize(12).font(boldFont);
    doc.text('ID', 50, tableTop);
    doc.text('შტრიხკოდი', 100, tableTop);
    doc.text('დასახელება', 220, tableTop);
    doc.text('ფასი', 380, tableTop);
    doc.text('მარაგი', 460, tableTop);

    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    let currentY = tableTop + 25;

    rows.forEach((row) => {
      if (currentY > 700) {
        doc.addPage();
        currentY = 50;
      }

      doc.font(regularFont).fontSize(10);
      doc.text(row.id.toString(), 50, currentY);
      doc.text(row.barcode || '-', 100, currentY);
      doc.text(row.name, 220, currentY);
      doc.text(`${row.price} ₾`, 380, currentY);
      doc.text(row.stock.toString(), 460, currentY);

      currentY += 20;
    });

    doc.end();
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

export default router;
