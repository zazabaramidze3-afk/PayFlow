import Dexie, { Table } from 'dexie';

// ==========================================
// 📴 Roadmap STEP 4 — Client-Side Offline Database (Dexie.js / IndexedDB)
// ==========================================
// ორი ლოკალური store (Sales.tsx-იდან გამოიყენება):
//
//   • cached_products  — ნომენკლატურის/ფასების/მარაგის ასლი. სინქრონდება
//                         Cashier Login-ის/Shift-ის დაწყებისას (loadProducts()
//                         ონლაინ წარმატებაზე) — რომ POS-მა Offline-შიც იცოდეს,
//                         რისი გაყიდვაც შეუძლია (ბარკოდით ძებნის ჩათვლით).
//
//   • offline_receipts — Offline checkout-ის დროს ლოკალურად შენახული ჩეკები.
//                         id-ები crypto.randomUUID()-ით გენერირდება
//                         კლიენტის მხარეს — ზუსტად ბექენდის payments.id-ის
//                         ფორმატის (UUID, migration 009, Roadmap STEP 1)
//                         იდენტური, რომ Collision-ის გარეშე დარჩეს უცვლელი
//                         Background Sync-ის შემდეგაც (Roadmap STEP 5,
//                         POST /api/payments/sync-offline).

// 🛒 ზუსტად Sales.tsx-ის `Product`-ის ფორმის იდენტური — products.id
// INTEGER-ად რჩება (UUID მიგრაცია მას არ შეხებია), ამიტომ პირდაპირ
// state-იდან (`products`) შენახვა/წაკითხვა casting-ის გარეშე შესაძლებელია.
export interface CachedProduct {
  id: number;
  name: string;
  price: number;
  stock: number;
  barcode?: string;
}

export interface OfflineReceiptItem {
  productId: number;
  name: string;
  price: number;
  quantity: number;
}

export interface OfflineReceiptSplits {
  cash: number;
  card: number;
}

export type OfflineReceiptSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface OfflineReceipt {
  // 🆔 crypto.randomUUID() — client-side, POST /api/payments/sync-offline-ის
  // (Roadmap STEP 5) `id`-ად უცვლელად უნდა ჩაიწეროს ბექენდზეც.
  id: string;
  shiftId: string;
  registerId: string;
  cashierId: string;
  items: OfflineReceiptItem[];
  subtotalAmount: number;
  discountType: 'percent' | 'fixed' | null;
  discountValue: number;
  totalAmount: number;
  paymentMethod: 'cash' | 'card' | 'split';
  splits: OfflineReceiptSplits | null;
  cashReceived: number | null;
  // 🕐 Roadmap STEP 1.4 — კლიენტის საათზე დაფიქსირებული რეალური დრო
  // (ISO 8601) — იგივე ველი, რასაც POST /api/payments-ის `createdAt`
  // (client-side timestamp audit) იღებს ონლაინ checkout-ზეც.
  createdAt: string;
  syncStatus: OfflineReceiptSyncStatus;
  // 🔢 რიცხვითი (epoch ms) დუბლიკატი queue-ის დახარისხებისთვის — Dexie-ის
  // ინდექსს ISO string-ებზეც შეუძლია lexicographic დახარისხება, მაგრამ
  // number-ზე sortBy უფრო იაფი/ცალსახაა.
  createdAtLocal: number;
  // 🛠️ Background Sync-ის (Roadmap STEP 5) retry-ლოგიკისთვის — POST
  // /api/payments/sync-offline-ის 'failed' პასუხის error მესიჯი აქ ინახება,
  // Sales.tsx-ს/მომავალ UI-ს შეუძლია საჭიროების შემთხვევაში აჩვენოს.
  syncError?: string;
  // 🕐 Roadmap STEP 5 — ბოლო სინქრონიზაციის მცდელობის დრო (epoch ms).
  // Dexie-ის schema-ს ცვლილება არ სჭირდება ახალი, არაინდექსირებული
  // ველის დამატებისთვის (IndexedDB დოკუმენტებზეა, არა მკაცრ სვეტებზე) —
  // version(1).stores()-ის ცვლილება საჭირო იქნებოდა მხოლოდ ახალი
  // ინდექსის დამატებაზე.
  lastAttemptAt?: number;
}

class PayFlowOfflineDB extends Dexie {
  cached_products!: Table<CachedProduct, number>;
  offline_receipts!: Table<OfflineReceipt, string>;

  constructor() {
    super('PayFlowOfflineDB');
    // 🔑 Dexie schema სტრინგში პირველი ველი ყოველთვის Primary Key-ია;
    // დანარჩენები — დამატებითი ინდექსები, რომლებზეც .where(...) მუშაობს.
    this.version(1).stores({
      cached_products: 'id, barcode, name',
      offline_receipts: 'id, syncStatus, createdAtLocal, shiftId, registerId',
    });
  }
}

export const offlineDb = new PayFlowOfflineDB();

// ==========================================
// 📦 cached_products helper-ები
// ==========================================

// ბოლო წარმატებული GET /api/products-ის სრული ასლით ცვლის ძველ ქეშს
// (clear + bulkPut ერთ ტრანზაქციაში) — რომ წაშლილი/დამატებული პროდუქტები
// ქეშშიც სწორად აისახოს, არა მხოლოდ "დამატება".
export async function cacheProducts(products: CachedProduct[]): Promise<void> {
  await offlineDb.transaction('rw', offlineDb.cached_products, async () => {
    await offlineDb.cached_products.clear();
    await offlineDb.cached_products.bulkPut(products);
  });
}

export async function getCachedProducts(): Promise<CachedProduct[]> {
  return offlineDb.cached_products.toArray();
}

// ==========================================
// 🧾 offline_receipts helper-ები
// ==========================================
export async function queueOfflineReceipt(receipt: OfflineReceipt): Promise<void> {
  await offlineDb.offline_receipts.add(receipt);
}

export async function getPendingOfflineReceipts(): Promise<OfflineReceipt[]> {
  return offlineDb.offline_receipts.where('syncStatus').equals('pending').sortBy('createdAtLocal');
}

export async function countPendingOfflineReceipts(): Promise<number> {
  return offlineDb.offline_receipts.where('syncStatus').equals('pending').count();
}

// ==========================================
// 🔄 Background Sync helper-ები — Roadmap STEP 5
// ==========================================
// frontend/src/sync/backgroundSync.ts-ის ერთადერთი Dexie-წვდომის წყარო
// (Sales.tsx-ის queueOfflineReceipt-ის ანალოგიური პრინციპი — page
// კომპონენტები Dexie-ს პირდაპირ არ ეხებიან, ყველა ოპერაცია ამ ფაილშია).

// 🔁 'pending' + 'failed' — ორივე ხელახლა საცდელია. 'syncing'-ს (უკვე
// მიმდინარე request-ის ნაწილია) და 'synced'-ს (ტერმინალური, აღარ
// გვჭირდება) ეს query განზრახ არ შეეხება.
export async function getSyncableOfflineReceipts(): Promise<OfflineReceipt[]> {
  return offlineDb.offline_receipts
    .where('syncStatus')
    .anyOf('pending', 'failed')
    .sortBy('createdAtLocal');
}

// 🩹 FIX: თუ გვერდი reload/დაიხურა ზუსტად POST /payments/sync-offline-ის
// მიმდინარეობისას (JS-ის მთელი execution ჩერდება ერთბაშად — არც axios-ის
// catch, არც markReceiptFailed ვერ ასწრებს გაშვებას), ჩანაწერი Dexie-ში
// სამუდამოდ 'syncing'-ად "ჩერდება" — getSyncableOfflineReceipts (მხოლოდ
// 'pending'/'failed') მას აღარასდროს დაინახავს, ანუ ეს კონკრეტული ჩეკი
// უსასრულოდ "იკარგება" queue-დან, თუმცა ფიზიკურად Dexie-ში ჯერ კიდევ დევს.
//
// ახალი page load-ის მომენტში (React-ის JS runtime ახლახან დაიწყო) ნებისმიერი
// 'syncing'-ად მონიშნული ჩანაწერი გარანტირებულად ორფანულია — წინა request
// ამ ახალ runtime-ში ვერასდროს "დასრულდება" (Promise-ები reload-ზე ქრება),
// ამიტომ უსაფრთხოა ყველა ასეთის უპირობოდ 'pending'-ზე დაბრუნება.
export async function resetStuckSyncingReceipts(): Promise<void> {
  await offlineDb.offline_receipts
    .where('syncStatus')
    .equals('syncing')
    .modify({ syncStatus: 'pending' });
}

// 🚦 batch request-ის გაგზავნამდე — ყველა მონაწილე ჩანაწერი 'syncing'-ად
// აღინიშნება ერთ ტრანზაქციაში, რომ Worker-ის ორმაგმა (ერთდროულმა)
// გაშვებამ იგივე ჩეკები ხელახლა არ "მოიტაცოს".
export async function markReceiptsSyncing(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = Date.now();
  await offlineDb.offline_receipts
    .where('id')
    .anyOf(ids)
    .modify({ syncStatus: 'syncing', lastAttemptAt: now });
}

// ✅ სერვერმა დაადასტურა ('synced' ან 'duplicate' — ორივე ტერმინალურად
// წარმატებულია, იხ. backend/src/routes/sales.ts-ის sync-offline
// კომენტარი) — ჩანაწერი Dexie-დან საბოლოოდ იშლება. სერვერი (payments
// ცხრილი) ახლა ერთადერთი წყაროა ამ ჩეკისთვის (Sales.tsx-ის "ჩემი
// ისტორია" უკვე GET /payments/my-history-დან კითხულობს).
export async function markReceiptSynced(id: string): Promise<void> {
  await offlineDb.offline_receipts.delete(id);
}

// ❌ ეს კონკრეტული ჩეკი ვერ დასინქრონდა (მაგ. ცვლა/სალარო კომბინაცია
// არასწორი აღმოჩნდა) — 'failed'-ად ინიშნება, queue-ში რჩება შემდეგი
// Worker-ციკლისთვის ხელახალი მცდელობით.
export async function markReceiptFailed(id: string, errorMessage: string): Promise<void> {
  await offlineDb.offline_receipts.update(id, {
    syncStatus: 'failed',
    syncError: errorMessage,
    lastAttemptAt: Date.now(),
  });
}

export async function countFailedOfflineReceipts(): Promise<number> {
  return offlineDb.offline_receipts.where('syncStatus').equals('failed').count();
}

// 🚧 Roadmap-ის მიღმა (12.08) — Late-close race condition-ის დაცვისთვის
// (PROGRESS - 12.08.2026.md-ის "შემდეგი ნაბიჯი"): `offline_receipts` table
// ფაქტობრივად მხოლოდ დაუსინქრონებელ ჩანაწერებს ინახავს — 'synced'/'duplicate'
// სტატუსზე markReceiptSynced() row-ს პირდაპირ შლის (არა update-ავს
// status-ს), ამიტომ table-ის მთლიანი row-count ზუსტად ის რიცხვია, რაც
// Sales.tsx-ს სჭირდება: "რამდენი ჩეკია ჯერ კიდევ სერვერზე არ მისული"
// (syncStatus-ის მიუხედავად — pending, syncing თუ failed).
export async function countUnsyncedOfflineReceipts(): Promise<number> {
  return offlineDb.offline_receipts.count();
}
