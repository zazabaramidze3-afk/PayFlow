import { Router, Response, NextFunction } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import path from 'path';
import multer from 'multer';
import { authenticateToken, CustomRequest } from './auth';
import { requireAnyRole } from '../middleware/requireRole';
// შემოგვაქვს მზა PostgreSQL პული ძირითადი ფაილიდან (ერთადერთი, საერთო pool)
import { db } from '../index';
// 🔒 Roadmap STEP 2.2 (RLS Full Rollout, "28.08.2026") — products.ts, ბლოკი 2.
// იგივე `withOrgContext` pattern, რაც auth.ts-ს (ბლოკი 1) და sales.ts-ს
// (pilot) დაერთო — `products` ცხრილზე migration 017-ის RLS policy-ს
// უერთდება, route-level `WHERE/AND organization_id` scoping-ის დამატებით
// შრედ.
import { withOrgContext } from '../db';
// 📥 Product Excel Import (PLAN - Product Excel Import & Dark Mode -
// 02.09.2026.md) — parsing/ვალიდაციის წმინდა ფენა, DB-სგან
// დამოუკიდებელი.
import {
  parseProductImportWorkbook,
  buildProductImportTemplate,
  ProductImportStructureError,
  ProductImportSkippedRow,
  ProductRow,
  PRODUCT_IMPORT_MAX_ROWS,
} from '../services/productImportService';

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
// 📥 EXCEL IMPORT (პროდუქტების მასობრივი დამატება)
// ==========================================
// PLAN - Product Excel Import & Dark Mode (მომავალი ფიჩერები) -
// 02.09.2026.md-ის გადაწყვეტილებები: max 1000 row ერთ ფაილში,
// row-level partial import (ვალიდური row-ები აიტვირთება, დანარჩენები
// report-ში ბრუნდება), duplicate barcode/name — skip + report
// (არასდროს არ იქმნება ორი პროდუქტი ერთი ბარკოდით/დასახელებით — DB-level
// uq_products_org_barcode/uq_products_org_name constraint-ია საბოლოო
// გადამწყვეტი, SAVEPOINT-ის ფარგლებში დაჭერილი, sales.ts-ის
// syncSingleOfflineReceipt-ის იგივე pattern-ით), წვდომა — მხოლოდ
// manager/admin (requireAnyRole).
// ==========================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const isXlsx =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.originalname.toLowerCase().endsWith('.xlsx');
    if (!isXlsx) {
      cb(new Error('მხოლოდ .xlsx ფაილებია დაშვებული'));
      return;
    }
    cb(null, true);
  },
});

// 🔌 multer-ის ხელით გამოძახება (router.post-ის middleware-ჯაჭვის
// ნაწილად), რომ multer-ის შეცდომებიც (მაგ. LIMIT_FILE_SIZE) სუფთა
// JSON პასუხით დაბრუნდეს, Express-ის დეფოლტ HTML error page-ის
// ნაცვლად (index.ts-ში გლობალური error-handling middleware არ
// არსებობს).
function handleXlsxUpload(req: CustomRequest, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    const isSizeError =
      typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'LIMIT_FILE_SIZE';
    const message = err instanceof Error ? err.message : 'ფაილის ატვირთვა ვერ მოხერხდა';
    res.status(400).json({
      error: isSizeError ? 'ფაილის ზომა აღემატება 5MB-ს (მაქსიმალური ზღვარი)' : message,
    });
  });
}

// 📄 ნიმუშის (template) ჩამოტვირთვა — ოთხი სვეტი (barcode/name/price/stock),
// რომ იმპორტის ფორმატი მომხმარებლისთვის ცხადი იყოს.
router.get(
  '/products/import/template',
  authenticateToken,
  requireAnyRole('admin', 'manager'),
  (_req: CustomRequest, res: Response) => {
    const workbook = buildProductImportTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=product_import_template.xlsx');
    workbook.xlsx.write(res).then(() => res.end());
  }
);

// 📥 Excel-იდან პროდუქტების მასობრივი დამატება — partial import
// (ვალიდური და უნიკალური row-ები იტვირთება, დანარჩენები აისახება
// report-ში, ერთი ცუდი row მთელ batch-ს არ აჩერებს).
router.post(
  '/products/import',
  authenticateToken,
  requireAnyRole('admin', 'manager'),
  handleXlsxUpload,
  async (req: CustomRequest, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: '.xlsx ფაილი სავალდებულოა' });
    }

    let parsed;
    try {
      parsed = await parseProductImportWorkbook(req.file.buffer);
    } catch (err) {
      if (err instanceof ProductImportStructureError) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: 'ფაილის დამუშავება ვერ მოხერხდა' });
    }

    if (parsed.candidates.length === 0 && parsed.skipped.length === 0) {
      return res.status(400).json({ error: 'ფაილი ცარიელია — პროდუქტები ვერ მოიძებნა' });
    }

    const totalRows = parsed.candidates.length + parsed.skipped.length;
    if (totalRows > PRODUCT_IMPORT_MAX_ROWS) {
      return res.status(400).json({
        error: `ერთ ფაილში მაქსიმუმ ${PRODUCT_IMPORT_MAX_ROWS} პროდუქტის ატვირთვაა დაშვებული (ეს ფაილი შეიცავს ${totalRows}-ს)`,
      });
    }

    const skipped: ProductImportSkippedRow[] = [...parsed.skipped];
    const imported: ProductRow[] = [];

    try {
      await withOrgContext(req.user?.organizationId, async (client) => {
        for (const candidate of parsed.candidates) {
          const savepoint = `sp_import_row_${candidate.rowNumber}`;
          try {
            await client.query(`SAVEPOINT ${savepoint}`);
            const result = await client.query<ProductRow>(
              `INSERT INTO products (name, price, stock, barcode, organization_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
              [candidate.name, candidate.price, candidate.stock, candidate.barcode, req.user?.organizationId]
            );
            await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            imported.push(result.rows[0]);
          } catch (rowErr) {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            await client.query(`RELEASE SAVEPOINT ${savepoint}`);
            const isDuplicate =
              typeof rowErr === 'object' && rowErr !== null && 'code' in rowErr && (rowErr as { code?: string }).code === '23505';
            skipped.push({
              rowNumber: candidate.rowNumber,
              reason: isDuplicate
                ? 'ეს სახელი ან ბარკოდი უკვე დაკავებულია ბაზაში'
                : rowErr instanceof Error
                ? rowErr.message
                : 'უცნობი შეცდომა ჩასმის დროს',
            });
          }
        }
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'უცნობი სერვერის შეცდომა';
      return res.status(500).json({ error: message });
    }

    skipped.sort((a, b) => a.rowNumber - b.rowNumber);

    res.status(201).json({
      importedCount: imported.length,
      skippedCount: skipped.length,
      imported,
      skipped,
    });
  }
);

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
      `გენერირების თარიღი: ${new Date().toLocaleString('ka-GE', { timeZone: 'Asia/Tbilisi' })}`,
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
