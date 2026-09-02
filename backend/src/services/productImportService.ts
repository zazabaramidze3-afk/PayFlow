import ExcelJS from 'exceljs';

// ==========================================
// 📥 Product Excel Import — parsing & row-level ვალიდაცია
// ==========================================
// POST /products/import-ის (routes/products.ts) წმინდა, DB-სგან
// დამოუკიდებელი ნაწილი — .xlsx ბუფერს იღებს, აბრუნებს ცალკე ვალიდურ
// candidate-row-ებს (რომლებიც INSERT-ისთვის მზადაა) და უკვე ვერ-
// ვალიდირებულ/დუბლირებულ row-ებს, კონკრეტული მიზეზით. DB-level
// კონფლიქტები (existing barcode/name ბაზაში) აქ არ მოწმდება — ეს
// route-ში, SAVEPOINT-ის ფარგლებში ხდება (sales.ts-ის
// syncSingleOfflineReceipt-ის იგივე pattern), რომ race condition-ის
// გარეშე, ერთი წყაროდან (DB unique constraint) მოხდეს საბოლოო გადაწყვეტა.

// 📄 თარგის/ატვირთვის სვეტების სახელები — case-insensitive, header row-ში
// (row 1) უნდა მოიძებნოს. `barcode`/`stock` არასავალდებულოა.
const REQUIRED_COLUMNS = ['name', 'price'] as const;
export const PRODUCT_IMPORT_COLUMNS = ['barcode', 'name', 'price', 'stock'] as const;

// 🔒 ერთ ფაილში მაქსიმალური row-ების რაოდენობა — იცავს transaction-ს
// (SAVEPOINT-ი თითო row-ზე) გახანგრძლივებისგან/timeout-საგან.
export const PRODUCT_IMPORT_MAX_ROWS = 1000;

// 🗄️ products ცხრილის row-ის ფორმა (INSERT ... RETURNING *-ის ტიპი) —
// schema.sql-ს/migrations-ს უნდა ემთხვეოდეს. products.ts POST /products/import-ში
// client.query<ProductRow>(...)-ისთვის, "any"-ის ნაცვლად.
export interface ProductRow {
  id: number;
  barcode: string | null;
  name: string;
  price: number;
  stock: number;
}

export interface ProductImportCandidate {
  rowNumber: number; // Excel-ის row number (header = 1, პირველი მონაცემი = 2)
  name: string;
  price: number;
  stock: number;
  barcode: string | null;
}

export interface ProductImportSkippedRow {
  rowNumber: number;
  reason: string;
}

export interface ParsedProductImport {
  candidates: ProductImportCandidate[];
  skipped: ProductImportSkippedRow[];
}

// 🚫 სტრუქტურული შეცდომა (ცარიელი ფაილი, სავალდებულო სვეტი აკლია) —
// განსხვავდება row-level ვალიდაციისგან: მთელი ფაილი უარყოფილია,
// row-ების partial დამუშავებამდე საერთოდ არ მიდის.
export class ProductImportStructureError extends Error {}

export async function parseProductImportWorkbook(buffer: Buffer): Promise<ParsedProductImport> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ⚠️ FIX: exceljs-ის ერთ-ერთი დამოკიდებულება (fast-csv) საკუთარ,
    // ძველ @types/node-ს ეყრდნობა — TypeScript ამის გამო `Buffer`-ის
    // ორ სხვადასხვა ნომინალურ ტიპად ხედავს (@types/node-ის ახალი
    // generic Buffer<ArrayBufferLike> vs exceljs-ის .d.ts-ში
    // ნაგულისხმევი ძველი, არა-generic Buffer). Runtime-ზე ეს
    // იგივე Buffer ობიექტია — მხოლოდ ტიპების იდენტობის კონფლიქტია,
    // ამიტომ ერთადერთ ამ საზღვარზე (exceljs-ის გამოძახებისას)
    // `unknown`-ის გავლით ვწერთ ტიპს.
    type ExceljsLoadBuffer = Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(buffer as unknown as ExceljsLoadBuffer);
  } catch {
    throw new ProductImportStructureError('ფაილის წაკითხვა ვერ მოხერხდა — დარწმუნდით, რომ ეს ვალიდური .xlsx ფაილია');
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new ProductImportStructureError('ფაილში worksheet ვერ მოიძებნა');
  }

  const columnIndexByName = new Map<string, number>();
  worksheet.getRow(1).eachCell((cell, colNumber) => {
    const normalized = cellToString(cell.value)?.trim().toLowerCase();
    if (normalized) columnIndexByName.set(normalized, colNumber);
  });

  const missingColumns = REQUIRED_COLUMNS.filter((col) => !columnIndexByName.has(col));
  if (missingColumns.length > 0) {
    throw new ProductImportStructureError(
      `სავალდებულო სვეტ(ებ)ი ვერ მოიძებნა ფაილში: ${missingColumns.join(', ')}. გამოიყენეთ "ნიმუშის ჩამოტვირთვა" სწორი ფორმატისთვის.`
    );
  }

  const barcodeCol = columnIndexByName.get('barcode') ?? null;
  const nameCol = columnIndexByName.get('name') as number;
  const priceCol = columnIndexByName.get('price') as number;
  const stockCol = columnIndexByName.get('stock') ?? null;

  const candidates: ProductImportCandidate[] = [];
  const skipped: ProductImportSkippedRow[] = [];
  const seenNames = new Set<string>();
  const seenBarcodes = new Set<string>();

  const lastRow = worksheet.rowCount;
  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    const row = worksheet.getRow(rowNumber);

    const nameValue = cellToString(row.getCell(nameCol).value)?.trim() ?? '';
    const priceValue = row.getCell(priceCol).value;
    const barcodeValue = barcodeCol ? row.getCell(barcodeCol).value : null;
    const stockValue = stockCol ? row.getCell(stockCol).value : null;

    // 🕳️ სრულად ცარიელი row (ხშირია ფაილის ბოლოში, formatting-ის
    // "კუდის" გამო) — არც შეცდომად ითვლება, უბრალოდ გამოტოვდება.
    const isRowEmpty =
      !nameValue &&
      cellToString(priceValue) === null &&
      cellToString(barcodeValue) === null &&
      cellToString(stockValue) === null;
    if (isRowEmpty) continue;

    if (!nameValue) {
      skipped.push({ rowNumber, reason: 'დასახელება (name) არ არის მითითებული' });
      continue;
    }

    const price = cellToNumber(priceValue);
    if (price === null || price <= 0) {
      skipped.push({ rowNumber, reason: 'ფასი (price) არავალიდურია — უნდა იყოს დადებითი რიცხვი' });
      continue;
    }

    let stock = 0;
    const stockStr = cellToString(stockValue)?.trim();
    if (stockStr) {
      const parsedStock = cellToNumber(stockValue);
      if (parsedStock === null || !Number.isInteger(parsedStock) || parsedStock < 0) {
        skipped.push({ rowNumber, reason: 'მარაგი (stock) არავალიდურია — უნდა იყოს არაუარყოფითი მთელი რიცხვი' });
        continue;
      }
      stock = parsedStock;
    }

    let barcode: string | null = null;
    const barcodeStr = cellToString(barcodeValue)?.trim();
    if (barcodeStr) {
      // ⚠️ products.chk_barcode_positive_v2 DB-constraint-ის სარკე
      // (migration-ში: CHECK (barcode !~ '-')) — ადრეული უარყოფა
      // row-level report-ში, DB-constraint-ის ხაფანგში ჩავარდნის
      // ნაცვლად.
      if (barcodeStr.includes('-')) {
        skipped.push({ rowNumber, reason: 'ბარკოდი არ უნდა შეიცავდეს დეფისს (-)' });
        continue;
      }
      barcode = barcodeStr;
    }

    const nameKey = nameValue.toLowerCase();
    if (seenNames.has(nameKey)) {
      skipped.push({ rowNumber, reason: `დუბლირებული დასახელება ამავე ფაილში: "${nameValue}"` });
      continue;
    }
    if (barcode && seenBarcodes.has(barcode)) {
      skipped.push({ rowNumber, reason: `დუბლირებული ბარკოდი ამავე ფაილში: ${barcode}` });
      continue;
    }

    seenNames.add(nameKey);
    if (barcode) seenBarcodes.add(barcode);

    candidates.push({ rowNumber, name: nameValue, price, stock, barcode });
  }

  return { candidates, skipped };
}

// 📄 ცარიელი .xlsx template-ის გენერაცია — GET /products/import/template.
// ცალკეა products.ts-ის export/excel ლოგიკისგან (განსხვავებული columns/
// დანიშნულება), მაგრამ იმავე ExcelJS pattern-ს იყენებს.
export function buildProductImportTemplate(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Products');

  worksheet.columns = [
    { header: 'barcode', key: 'barcode', width: 18 },
    { header: 'name', key: 'name', width: 30 },
    { header: 'price', key: 'price', width: 12 },
    { header: 'stock', key: 'stock', width: 12 },
  ];
  worksheet.getRow(1).font = { bold: true };
  // 🧾 ერთი მაგალითი-row, ფორმატის საილუსტრაციოდ (მომხმარებელმა უნდა
  // წაშალოს/გადაწეროს ატვირთვამდე).
  worksheet.addRow({ barcode: '4860000000000', name: 'მაგალითი პროდუქტი', price: 9.99, stock: 10 });

  return workbook;
}

// ==========================================
// Cell-ის უსაფრთხო კონვერტაცია — "any" გარეშე
// ==========================================
// ExcelJS.CellValue union-ია (string | number | boolean | Date |
// CellErrorValue | CellRichTextValue | CellHyperlinkValue |
// CellFormulaValue | CellSharedFormulaValue) — თითოეული ვარიანტი
// ცალკე მოწმდება, დაუმტკიცებელ cast-ების გარეშე.
function cellToString(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText.map((part) => part.text).join('');
  }
  if (typeof value === 'object' && 'text' in value) {
    return value.text;
  }
  if (typeof value === 'object' && 'result' in value) {
    const { result } = value;
    if (result === undefined || result === null) return null;
    if (typeof result === 'object') return null; // CellErrorValue — ვცდილობთ, არა ფატალურად
    return cellToString(result);
  }
  return null;
}

function cellToNumber(value: ExcelJS.CellValue): number | null {
  if (typeof value === 'number') return value;
  const str = cellToString(value);
  if (!str || !str.trim()) return null;
  const normalized = str.trim().replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}
