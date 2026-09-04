const { Client } = require('pg');
require('dotenv').config();

const BASE = 'http://localhost:5000/api';
const rand = Math.random().toString(36).slice(2, 8);

let failed = false;
function check(label, cond, extra) {
  if (cond) {
    console.log(`✅ ${label}`);
  } else {
    failed = true;
    console.log(`❌ ${label}` + (extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''));
  }
}

async function req(method, path, token, body, extraHeaders) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extraHeaders || {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

async function main() {
  // 1) ახალი test org + admin
  const slug = `horeca-test-${rand}`;
  const reg = await req('POST', '/organizations/register', null, {
    companyName: 'HoReCa Test Restaurant',
    slug,
    adminName: 'Test Admin',
    email: `admin-${rand}@example.com`,
    password: 'testpassword123',
  });
  check('POST /organizations/register -> 201', reg.status === 201, reg);
  const adminToken = reg.body?.token;
  const orgId = reg.body?.organization?.id;

  // 2) business_type -> 'horeca' (პირდაპირ DB-დან, ჯერ frontend/API flow ამას არ აკეთებს)
  const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });
  await pg.connect();
  await pg.query(`UPDATE organizations SET business_type = 'horeca' WHERE id = $1`, [orgId]);
  await pg.end();
  console.log(`ℹ️  org ${orgId} -> business_type = 'horeca'`);

  // 3) cashier user შექმნა (admin-ით)
  const cashierUsername = `cashier${rand}`;
  const createCashier = await req('POST', '/users', adminToken, {
    username: cashierUsername,
    password: 'cashierpass123',
    role: 'cashier',
  });
  check('POST /users (cashier) -> 201', createCashier.status === 201, createCashier);

  // 4) cashier login
  const cashierLogin = await req('POST', '/login', null, { slug, username: cashierUsername, password: 'cashierpass123' });
  check('POST /login (cashier) -> 200', cashierLogin.status === 200, cashierLogin);
  const cashierToken = cashierLogin.body?.token;

  // 5) requireBusinessType გუარდის ტესტი retail-ის სცენარისთვის ჯერ არ გვჭირდება
  //    (ეს org უკვე horeca-ზეა გადართული) — პირდაპირ /tables-ზე გადავდივართ.
  const tablesBeforeHoreca = await req('GET', '/tables', adminToken);
  check('GET /tables (horeca org) -> 200', tablesBeforeHoreca.status === 200, tablesBeforeHoreca);

  // 6) ახალი მაგიდის შექმნა (admin)
  const createTable = await req('POST', '/tables', adminToken, { name: 'მაგიდა 1', section: 'დარბაზი', capacity: 4 });
  check('POST /tables -> 201', createTable.status === 201, createTable);
  const tableId = createTable.body?.id;

  // 7) პროდუქტის შექმნა (admin)
  const createProduct = await req('POST', '/products', adminToken, { name: `ცეზარის სალათი ${rand}`, price: 25, stock: 100 });
  check('POST /products -> 201', createProduct.status === 201, createProduct);
  const productId = createProduct.body?.id;

  // 8) register pairing flow
  const genCode = await req('POST', '/registers/generate-code', null);
  check('POST /registers/generate-code -> 201', genCode.status === 201, genCode);
  const code = genCode.body?.code;

  const pair = await req('POST', '/registers/pair', adminToken, { code, newRegisterName: 'ტესტ სალარო' });
  check('POST /registers/pair -> 200', pair.status === 200, pair);

  const pairingStatus = await req('GET', `/registers/pairing-status/${code}`, null);
  check('GET /registers/pairing-status -> confirmed', pairingStatus.body?.status === 'confirmed', pairingStatus);
  const registerId = pairingStatus.body?.registerId;
  const registerToken = pairingStatus.body?.registerToken;
  const registerHeaders = { 'X-Register-Id': registerId, 'X-Register-Token': registerToken };

  // 9) cashier-მა გახსნას ცვლა ამ Register-ზე
  const openShift = await req('POST', '/shifts/open', cashierToken, { start_amount: 0 }, registerHeaders);
  check('POST /shifts/open -> 201', openShift.status === 201, openShift);

  // 10) cashier-მა გახსნას ღია შეკვეთა ამ მაგიდაზე
  const openOrder = await req('POST', '/orders', cashierToken, { tableId, guestCount: 2 }, registerHeaders);
  check('POST /orders -> 201', openOrder.status === 201, openOrder);
  const orderId = openOrder.body?.id;

  // 11) მაგიდა ახლა 'occupied' უნდა იყოს
  const tableAfterOpen = await req('GET', '/tables', cashierToken);
  const openedTable = tableAfterOpen.body?.find((t) => t.id === tableId);
  check("table status === 'occupied' შეკვეთის გახსნის შემდეგ", openedTable?.status === 'occupied', openedTable);

  // 12) item დამატება
  const addItem = await req('POST', `/orders/${orderId}/items`, cashierToken, { productId, quantity: 2, seatNumber: 1 });
  check('POST /orders/:id/items -> 201', addItem.status === 201, addItem);
  const itemId = addItem.body?.id;

  // 13) მეორე item, void-ის შესამოწმებლად
  const addItem2 = await req('POST', `/orders/${orderId}/items`, cashierToken, { productId, quantity: 1 });
  check('POST /orders/:id/items (მე-2) -> 201', addItem2.status === 201, addItem2);
  const itemId2 = addItem2.body?.id;

  const voidItem = await req('PATCH', `/orders/items/${itemId2}`, cashierToken, { void: true, voidReason: 'ტესტ-გაუქმება' });
  check('PATCH /orders/items/:id (void) -> 200', voidItem.status === 200 && voidItem.body?.kitchen_status === 'voided', voidItem);

  // 14) GET /orders/:id — item-ები ჩანს
  const getOrder = await req('GET', `/orders/${orderId}`, cashierToken);
  check('GET /orders/:id -> 200, items.length === 2', getOrder.status === 200 && getOrder.body?.items?.length === 2, getOrder.body);

  // 15) checkout — POST /payments orderId-ით
  const checkout = await req('POST', '/payments', cashierToken, {
    items: [{ productId, quantity: 2, price: 25 }],
    paymentMethod: 'cash',
    cashReceived: 50,
    orderId,
  }, registerHeaders);
  check('POST /payments (orderId-ით) -> 201', checkout.status === 201, checkout);

  // 16) დახურვის შემდეგ: order status='closed', table status='free'
  const getOrderAfterClose = await req('GET', `/orders/${orderId}`, cashierToken);
  check("order.status === 'closed' checkout-ის შემდეგ", getOrderAfterClose.body?.status === 'closed', getOrderAfterClose.body);

  const tableAfterClose = await req('GET', '/tables', cashierToken);
  const freedTable = tableAfterClose.body?.find((t) => t.id === tableId);
  check("table status === 'free' checkout-ის შემდეგ", freedTable?.status === 'free', freedTable);

  // 17) requireBusinessType-ის რეალური ტესტი: retail org-ს ეს endpoint-ები დაეხუროს
  const retailReg = await req('POST', '/organizations/register', null, {
    companyName: 'Retail Test Shop',
    slug: `retail-test-${rand}`,
    adminName: 'Retail Admin',
    email: `retail-admin-${rand}@example.com`,
    password: 'testpassword123',
  });
  const retailToken = retailReg.body?.token;
  const retailTablesAttempt = await req('GET', '/tables', retailToken);
  check('GET /tables Retail org-ზე -> 403 (requireBusinessType)', retailTablesAttempt.status === 403, retailTablesAttempt);

  console.log('\n' + (failed ? '❌ ზოგიერთი შემოწმება ჩავარდა' : '✅ ყველა შემოწმება წარმატებულია'));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('SCRIPT ERROR:', err);
  process.exit(1);
});
