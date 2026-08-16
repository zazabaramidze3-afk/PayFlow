import styles from './Sales.module.scss';
import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
// 🖨 Roadmap ეტაპი 7 — ბეჭდვადი შაბლონები (@media print).
import PrintableReceipt, { PrintableReceiptData } from '../components/PrintableReceipt';
import PrintableZReport, { PrintableZReportData } from '../components/PrintableZReport';
// 📴 Roadmap STEP 4 — Client-Side Offline Database (Dexie.js).
import { cacheProducts, getCachedProducts, queueOfflineReceipt, OfflineReceipt, countUnsyncedOfflineReceipts } from '../db/offlineDb';
// 🖥️ Roadmap STEP 4.2 — Offline checkout-ს ამ ფიზიკური Register-ის UUID
// სჭირდება (RegisterGuard.tsx-ის localStorage-გასაღების იგივე წყარო).
import { getStoredRegisterId } from '../components/RegisterGuard';
// 🚧 Roadmap-ის მიღმა (12.08) — Late-close race condition-ის დაცვა
// (PROGRESS - 12.08.2026.md-ის "შემდეგი ნაბიჯი"): ცვლის დახურვამდე ვცდით
// pending queue-ს სწრაფად დაცლას.
import { syncOfflineReceipts } from '../sync/backgroundSync';

interface Product { id: number; name: string; price: number; stock: number; barcode?: string; }
interface CartItem { productId: number; name: string; price: number; quantity: number; maxStock: number; }
type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; }

// 🏷️ ფასდაკლების ტიპი — receipt-level, checkout-ში აირჩევა
type DiscountType = 'none' | 'percent' | 'fixed';

// 💰 Roadmap ეტაპი 8 — გადახდის მეთოდი. ბექენდი (POST /api/payments)
// 'cash'-ად ითვლის, თუ საერთოდ არ მოვა — ეს მხოლოდ frontend-ის default state-ია.
type PosPaymentMethod = 'cash' | 'card' | 'split';

// 📜 ტიპები "ჩემი ისტორიის" მოდულისთვის
interface ReceiptItem { name: string; quantity: number; price: number; }
interface ReceiptSplits { cash: number; card: number; }
interface Receipt {
  // 🆔 UUID მიგრაცია (Roadmap STEP 1) — payments.id ბექენდზე ახლა UUID
  // string-ია, აღარ არის SERIAL INTEGER.
  id: string;
  subtotal_amount?: number;
  discount_type?: 'percent' | 'fixed' | null;
  discount_value?: number;
  total_amount: number;
  created_at: string;
  items: ReceiptItem[];
  // 💰 Roadmap ეტაპი 8 — GET /api/payments/my-history ახლა ამასაც აბრუნებს.
  payment_method?: PosPaymentMethod;
  splits?: ReceiptSplits | null;
  // 🧾 Roadmap ეტაპი 4 — GET /api/payments/my-history ახლა ამასაც აბრუნებს.
  is_voided?: boolean;
}
interface HistorySummary { totalReceipts: number; totalSum: number; }

// 🧾 POST /api/payments-ის request body — ერთი ცალსახა ტიპი, რომელსაც
// ორივე handleCheckout (ონლაინ) და handleOfflineCheckout (Roadmap STEP 4.2)
// იზიარებს, რომ ორივე გზა ზუსტად იმავე payload-ს აწყობდეს.
interface CheckoutPayload {
  items: CartItem[];
  discount?: { type: 'percent' | 'fixed'; value: number };
  paymentMethod: PosPaymentMethod;
  splits?: { cash: number; card: number };
  cashReceived?: number;
}

// 🖨 Roadmap ეტაპი 7 — PUT /api/shifts/close-ის response ფორმა. ადრე ეს
// state "any"-ად იყო ტიპირებული ("Clean Architecture" წესის დარღვევა);
// ახლა ცალსახად გვჭირდება receiptCount ველიც Z-Report-ის ბეჭდვისთვის.
interface ZReportResponse {
  message: string;
  start: number;
  expected: number;
  actual: number;
  difference: number;
  receiptCount: number;
}

// ==========================================
// 📴 Roadmap STEP 3/4 — ბოლო ცნობილი ცვლის მდგომარეობის ლოკალური ასლი.
// ==========================================
// PWA-ს "სრულად Offline ჩატვირთვის" დაპირება (STEP 3, Precaching) უსარგებლო
// იქნებოდა, თუ გვერდის reload-ისას (ინტერნეტის გარეშე) GET /api/shifts/status
// ჩავარდნისთანავე მოლარეს ცარიელი "ცვლის გახსნის" ფორმა ეჩვენებოდა POS
// ეკრანის ნაცვლად — თავად ეს ფორმაც ხომ ქსელს საჭიროებს. ამიტომ ყოველ
// წარმატებულ checkShiftStatus()-ზე ვინახავთ "ბოლო ცნობილ" მდგომარეობას და,
// ქსელური შეცდომისას, სწორედ ამით ვაგრძელებთ POS-ის მუშაობას.
const ACTIVE_SHIFT_CACHE_KEY = 'payflow_active_shift_cache';

function cacheActiveShift(hasActiveShift: boolean, shift: unknown): void {
  try {
    localStorage.setItem(ACTIVE_SHIFT_CACHE_KEY, JSON.stringify({ hasActiveShift, shift }));
  } catch {
    // 🔕 localStorage quota-ს გადავსება აქ კრიტიკული არ არის — უბრალოდ
    // შემდეგი offline reload-ისას fallback აღარ იქნება ხელმისაწვდომი.
  }
}

function readCachedActiveShift(): { hasActiveShift: boolean; shift: unknown } | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SHIFT_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ==========================================
// 🔔 Toast შეტყობინებების პატარა, დამოუკიდებელი კომპონენტი
// ცვლის window.alert()-ს ლამაზი, არადაბლოკავი overlay-ით.
// ==========================================
const TOAST_ICON: Record<ToastType, string> = { success: '✅', error: '⚠️', info: 'ℹ️' };

// 💰 Roadmap ეტაპი 8 — გადახდის მეთოდის ბეიჯი "ჩემი ისტორია" პანელისთვის,
// Dashboard.tsx-ის paymentMethodBadge-ის ზუსტი ანალოგი (ცალკე ფაილშია,
// გვერდის სტილის დუბლირების გარეშე გაზიარება ამ ორ page-ს შორის ამ ეტაპზე
// ზედმეტი აბსტრაქციაა).
const paymentMethodBadge = (method: PosPaymentMethod | undefined): { text: string; bg: string; color: string } => {
  if (method === 'card') return { text: '💳 ბარათი', bg: '#dbeafe', color: '#1d4ed8' };
  if (method === 'split') return { text: '🔀 შერეული', bg: '#ede9fe', color: '#6d28d9' };
  return { text: '💵 ნაღდი', bg: '#dcfce7', color: '#15803d' };
};

function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className={styles.toastContainer}>
      {toasts.map(t => (
        <div key={t.id} className={`${styles.toast} ${styles[`toast${t.type[0].toUpperCase()}${t.type.slice(1)}`]}`}>
          <span className={styles.toastIcon}>{TOAST_ICON[t.type]}</span>
          <span className={styles.toastMessage}>{t.message}</span>
          <button className={styles.toastClose} onClick={() => onDismiss(t.id)} aria-label="დახურვა">×</button>
        </div>
      ))}
    </div>
  );
}

export default function Sales() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [hasActiveShift, setHasActiveShift] = useState<boolean>(false);
  const [activeShift, setActiveShift] = useState<any>(null);
  const [startAmount, setStartAmount] = useState<string>('0');
  const [endAmountActual, setEndAmountActual] = useState<string>('0');
  const [showCloseModal, setShowCloseModal] = useState<boolean>(false);
  // 🚧 Roadmap-ის მიღმა (12.08) — Late-close race condition-ის დაცვა:
  // ცვლის დახურვის ღილაკზე დაწკაპუნებასა და PUT /shifts/close-ის
  // რეალურ გამოძახებას შორის ჯერ pending offline queue-ის სინქრონიზაციას
  // ვცდით (იხ. handleCloseShift) — ეს ხანმოკლე loading state ბლოკავს
  // ღილაკის განმეორებით დაჭერას იმ პერიოდში.
  const [closingShift, setClosingShift] = useState<boolean>(false);
  const [zReport, setZReport] = useState<ZReportResponse | null>(null);
  // 🖨 Roadmap ეტაპი 7 — ცვლის დახურვის ზუსტი მომენტის ტექსტური ბეჭდვა
  // (Z-Report-ის ბეჭდვისას იმეორებს ამ დროს, არა print-ის მომენტს).
  const [shiftClosedAtDisplay, setShiftClosedAtDisplay] = useState<string>('');

  // 🏷️ ფასდაკლების state — receipt-level, checkout-ის წინ
  const [discountType, setDiscountType] = useState<DiscountType>('none');
  const [discountValue, setDiscountValue] = useState<string>('');

  // 💰 Roadmap ეტაპი 8 — გადახდის მეთოდის state. 'split'-ის ორივე ველი
  // ხელით ივსება (არცერთი არ არის მეორისგან ავტომატურად გამოთვლილი) —
  // ვალიდაცია (splitDiff === 0) დარწმუნდება, რომ ჯამი ზუსტად ემთხვევა
  // ჩეკის თანხას checkout-ის დაჭერამდე.
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('cash');
  const [splitCashInput, setSplitCashInput] = useState<string>('');
  const [splitCardInput, setSplitCardInput] = useState<string>('');
  const [cashReceivedInput, setCashReceivedInput] = useState<string>('');

  // 🔐 can_view_history — ბექენდიდან (GET /api/me) ფრეშად ვამოწმებთ ყოველ ჩატვირთვაზე,
  // რომ ადმინის მიერ გამორთვა მომენტალურად აისახოს "ჩემი ისტორია" ღილაკის ჩვენებაზე.
  const [canViewHistory, setCanViewHistory] = useState<boolean>(true);

  // 🔐 can_use_discount — იგივე პრინციპით, GET /api/me-დან ყოველ ჩატვირთვაზე ფრეშად.
  // სანამ ეს არ ჩამოიტვირთება, კონსერვატიულად ვთვლით false-ად, რომ მოლარემ ვერცერთ
  // წამს ვერ დაინახოს/გამოიყენოს ფასდაკლების კონტროლი ავტორიზაციის დადასტურებამდე.
  const [canUseDiscount, setCanUseDiscount] = useState<boolean>(false);

  // 🧾 can_void_receipt (Roadmap ეტაპი 4) — იგივე პრინციპით, GET /api/me-დან
  // ყოველ ჩატვირთვაზე ფრეშად. კონსერვატიულად false, სანამ არ ჩამოიტვირთება.
  const [canVoidReceipt, setCanVoidReceipt] = useState<boolean>(false);

  // 🧺 can_clear_cart (Roadmap ეტაპი 5) — იგივე პრინციპით.
  const [canClearCart, setCanClearCart] = useState<boolean>(false);

  // 🖨 Roadmap ეტაპი 7 — მიმდინარე მოლარის სახელი (GET /api/me-დან), ჩეკის
  // ბეჭდვისას "მოლარე: X" ველისთვის.
  const [myUsername, setMyUsername] = useState<string>('');

  // 🆔 Roadmap STEP 4.2 — მიმდინარე მოლარის UUID (GET /api/me-დან). საჭიროა
  // Offline Checkout-ისას offline_receipts (Dexie) ჩანაწერის cashierId
  // ველისთვის — POST /api/payments-ის ონლაინ ვერსიისგან განსხვავებით,
  // ოფლაინში ბექენდს ვერ ვთხოვთ, თავად req.user?.id-ს გამოიყენოს.
  const [myUserId, setMyUserId] = useState<string>('');

  // 🖨 ბოლოს წარმატებით გატარებული გადახდის მონაცემები — ბეჭდვისთვის
  // (PrintableReceipt). null არის მანამ, სანამ პირველი checkout არ მოხდება
  // ამ სესიაში; დაყენებისთანავე ქვემოთა useEffect ავტომატურად ხსნის
  // ბრაუზერის ბეჭდვის ფანჯარას.
  const [lastReceipt, setLastReceipt] = useState<PrintableReceiptData | null>(null);

  // 🔑 Manager PIN Override (Roadmap ეტაპი 2, 4, 5) — ერთი და იგივე მოდალი ოთხ
  // დანიშნულებას ემსახურება: 'discount' (ფასდაკლების ტიპის არჩევა), 'void-receipt'
  // (ჩეკის გაუქმება), 'clear-cart' (მთელი კალათის გასუფთავება) და 'remove-item'
  // (ცალკეული პროდუქტის წაშლა). pinAction განსაზღვრავს, წარმატებული PIN-ის
  // შემდეგ რომელი branch-ი გაეშვება handleVerifyManagerPin-ში.
  //
  // discount-ის შემთხვევაში ტოკენი ინახება state-ში და გამოიყენება მოგვიანებით,
  // checkout-ის დროს (X-Manager-Override ჰედერით) — რადგან ფასდაკლება ჯერ კიდევ
  // "მიმდინარე ჩეკის" ნაწილია, არა დამოუკიდებელი მოქმედება.
  // void-receipt/clear-cart/remove-item-ის შემთხვევაში კი ტოკენი დაუყოვნებლივ
  // გამოიყენება (performVoidReceipt/performClearCart/performRemoveItem) — არ
  // ინახება state-ში.
  //
  // ტოკენი არასდროს ინახება localStorage-ში — მხოლოდ React state-ია, ერთჯერადი
  // (single-use) და backend-ი (არა frontend) არის ერთადერთი წყარო, ვინც
  // რეალურად წყვეტს, დაშვებულია თუ არა მოქმედება.
  const [managerOverrideToken, setManagerOverrideToken] = useState<string | null>(null);
  const [showPinModal, setShowPinModal] = useState<boolean>(false);
  const [pinAction, setPinAction] = useState<'discount' | 'void-receipt' | 'clear-cart' | 'remove-item' | null>(null);
  const [pendingDiscountType, setPendingDiscountType] = useState<DiscountType>('none');
  const [pendingVoidPaymentId, setPendingVoidPaymentId] = useState<string | null>(null);
  // 🧺 'remove-item' pinAction-ისთვის — რომელი კონკრეტული კალათის ერთეული უნდა
  // წაიშალოს წარმატებული PIN-ის შემდეგ (productId + name, toast/ლოგისთვის).
  const [pendingRemoveItem, setPendingRemoveItem] = useState<{ productId: number; name: string } | null>(null);
  const [pinValue, setPinValue] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [pinLoading, setPinLoading] = useState<boolean>(false);

  // 🧾 ჩეკის გაუქმების დადასტურების მოდალი — Products.tsx-ის confirmModal
  // პატერნის ანალოგიით (window.confirm()-ის ნაცვლად).
  const [voidConfirm, setVoidConfirm] = useState<{ show: boolean; paymentId: string | null }>({
    show: false,
    paymentId: null,
  });

  // ტოკენის არსებობა UI-სთვის საკმარისია — ცალკე ბულეანი state არ გვჭირდება
  // (ორმაგი state-ის დესინქრონიზაციის რისკის ასაცილებლად).
  const managerOverrideActive = !!managerOverrideToken;

  // ფასდაკლების ეფექტური უფლება ამ ჩეკზე — ან საკუთარი can_use_discount,
  // ან მენეჯერის მიერ დადასტურებული ერთჯერადი override.
  const canUseDiscountEffective = canUseDiscount || managerOverrideActive;

  // 📜 "ჩემი ისტორიის" მოდულის state
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [historyReceipts, setHistoryReceipts] = useState<Receipt[]>([]);
  const [historySummary, setHistorySummary] = useState<HistorySummary>({ totalReceipts: 0, totalSum: 0 });
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState<number>(1);
  const HISTORY_PAGE_SIZE = 5;

  // 🔔 Toast state
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // 🩹 FIX: products/cart-ის ცვლილება აღარ იწვევს ამ ეფექტის თავიდან გაშვებას.
  // ადრე დამოკიდებულების მასივში [products, cart] ჰქონდა, ხოლო შიგნით checkShiftStatus()
  // იძახებდა loadProducts()-ს, რომელიც ცვლიდა products-ს — ეს კი ისევ ეშვებდა ამ ეფექტს
  // და ქმნიდა უსასრულო ციკლს (/api/shifts/status და /api/products მუდმივად იბომბებოდა).
  // ახლა products/cart ინახება ref-ებში, რომ keydown listener-მა ყოველთვის
  // აქტუალურ მონაცემებზე იმუშაოს ეფექტის ხელახლა გაშვების გარეშე.
  const productsRef = useRef(products);
  const cartRef = useRef(cart);
  useEffect(() => { productsRef.current = products; }, [products]);
  useEffect(() => { cartRef.current = cart; }, [cart]);

  const fetchMyPermissions = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/me');
      setCanViewHistory(response.data?.can_view_history !== false);
      setCanUseDiscount(response.data?.can_use_discount === true);
      setCanVoidReceipt(response.data?.can_void_receipt === true);
      setCanClearCart(response.data?.can_clear_cart === true);
      setMyUsername(typeof response.data?.username === 'string' ? response.data.username : '');
      // 🆔 Roadmap STEP 4.2 — Offline Checkout-ს (offline_receipts.cashierId)
      // ეს UUID სჭირდება; ონლაინ POST /api/payments-ისგან განსხვავებით
      // ბექენდს ვერ ვანდობთ req.user?.id-ის ავტომატურ ჩასმას.
      setMyUserId(typeof response.data?.id === 'string' ? response.data.id : '');
    } catch (error) {
      console.error('მომხმარებლის უფლებების ჩატვირთვა ვერ მოხერხდა:', error);
      // 📴 Roadmap STEP 3/4 — თუ ეს GET /api/me ქსელის გარეშე ჩავარდა
      // (გვერდის reload ოფლაინში), can_* უფლებები კონსერვატიულად
      // (false/true საწყისი მნიშვნელობებით) რჩება — მაგრამ myUserId მაინც
      // საჭიროა Offline checkout-ისთვის, ამიტომ ლოკალურად შენახული JWT-დან
      // ვცდილობთ ამოვიღოთ (ისევე, როგორც App.tsx-ის getUserFromStoredToken).
      try {
        const token = localStorage.getItem('token');
        const payloadBase64 = token?.split('.')[1];
        if (payloadBase64) {
          const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));
          if (typeof payload.id === 'string') setMyUserId(payload.id);
          if (typeof payload.username === 'string') setMyUsername(payload.username);
        }
      } catch (decodeError) {
        console.error('ტოკენიდან მომხმარებლის ID-ის ამოღება ჩავარდა:', decodeError);
      }
    }
  };

  // 🔐 თუ უფლება გამორთულია (მათ შორის თუ ის ცოცხალ სესიაზე გამოირთო),
  // ვასუფთავებთ discount state-ს, რომ UI-ც და checkout-ის payload-იც კონსისტენტური დარჩეს.
  useEffect(() => {
    if (!canUseDiscount) {
      setDiscountType('none');
      setDiscountValue('');
    }
  }, [canUseDiscount]);

  // 🖨 Roadmap ეტაპი 7 — რომელი ბეჭდვადი ბლოკია ამჟამად "აქტიური". თუ ორივე
  // (ბოლო ჩეკი და Z-Report) ერთდროულად ჰქონდეს .print-area კლასი DOM-ში
  // (მაგ. ცვლის განმავლობაში ჩეკიც დაიბეჭდა და მოგვიანებით Z-Report-იც
  // იბეჭდება იმავე სესიაში), ბეჭდვისას ორივე ერთდროულად დაიბეჭდებოდა/
  // ერთმანეთს გადაფარავდა — printTarget უზრუნველყოფს, რომ ერთდროულად
  // მხოლოდ ერთი კონკრეტული ბლოკი იყოს დარენდერებული.
  const [printTarget, setPrintTarget] = useState<'receipt' | 'zreport' | null>(null);

  // setTimeout-ი ერთი tick-ით აჩერებს, რომ სასურველი print-area DOM-ში
  // უკვე ჩარენდერებული იყოს window.print()-ის გამოძახებამდე — წინააღმდეგ
  // შემთხვევაში ბრაუზერი ან ცარიელ ფურცელს დაბეჭდავს, ან ძველ ბლოკს.
  // ცალკე ფუნქციაა (არა მხოლოდ useEffect), რომ განმეორებითმა ღილაკზე
  // დაჭერამაც იმუშაოს, თუნდაც printTarget-ის მნიშვნელობა არ შეიცვალოს.
  const triggerPrint = (target: 'receipt' | 'zreport') => {
    setPrintTarget(target);
    setTimeout(() => window.print(), 150);
  };

  // ახალი ჩეკის დადასტურებისთანავე ავტომატური ბეჭდვა (handleCheckout-ის
  // setLastReceipt-ის შემდეგ).
  useEffect(() => {
    if (lastReceipt) triggerPrint('receipt');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastReceipt]);

  // 🔑 ფასდაკლების ტიპის select-ზე ცვლილების მცდელობა. თუ მოლარეს
  // (და ჯერ არც override აქვს დადასტურებული) უფლება არ აქვს, დისქაუნთი
  // არ ირთვება — ამის ნაცვლად ვხსნით PIN მოდალს და ვიმახსოვრებთ, რომელი
  // ტიპი სურდა არჩეული, რომ წარმატებული PIN-ის შემდეგ ავტომატურად ჩაერთოს.
  const handleDiscountTypeChange = (nextType: DiscountType) => {
    if (nextType !== 'none' && !canUseDiscountEffective) {
      setPendingDiscountType(nextType);
      setPinAction('discount');
      setPinValue('');
      setPinError('');
      setShowPinModal(true);
      return;
    }
    setDiscountType(nextType);
    setDiscountValue('');
  };

  const closePinModal = () => {
    setShowPinModal(false);
    setPinValue('');
    setPinError('');
    setPendingDiscountType('none');
    setPendingVoidPaymentId(null);
    setPendingRemoveItem(null);
    setPinAction(null);
  };

  // 🧾 ჩეკის ფაქტობრივი გაუქმება — POST /api/payments/:id/void (Roadmap ეტაპი 4).
  // overrideToken გადაეცემა მხოლოდ მაშინ, როცა can_void_receipt არ გვყოფნის და
  // მენეჯერის PIN-ით ახლახან დადასტურებული ერთჯერადი override გვაქვს — იგივე
  // X-Manager-Override პატერნი, რაც checkout-ის ფასდაკლებაზეა (handleCheckout).
  const performVoidReceipt = async (paymentId: string, overrideToken?: string) => {
    try {
      await axios.post(
        `http://localhost:5000/api/payments/${paymentId}/void`,
        {},
        { headers: overrideToken ? { 'X-Manager-Override': `Bearer ${overrideToken}` } : undefined }
      );
      showToast('ჩეკი გაუქმდა და მარაგი ავტომატურად დაბრუნდა', 'success');
      fetchMyHistory(); // სია განახლდეს — გაუქმებული ჩეკი ახლა is_voided: true-ით უნდა ჩანდეს
    } catch (error: unknown) {
      const serverMessage = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      showToast(serverMessage || 'ჩეკის გაუქმება ვერ მოხერხდა', 'error');
    }
  };

  // 🕵️ POST /api/cart/confirm-override — Roadmap ეტაპი 5. კალათა (და მასში
  // ცალკეული პროდუქტები) checkout-მდე მხოლოდ ამ React state-შია, ბექენდზე
  // არაფერს ეხება — ამიტომ ეს არის მხოლოდ აუდიტ-ლოგის ჩაწერის მოთხოვნა, არა
  // ბიზნეს-ოპერაცია. ბექენდი დამოუკიდებლად ხელახლა ამოწმებს overrideToken-ს
  // (ხელმოწერა+ვადა+cashierId+single-use), ისე რომ frontend-მა ვერ "მოიგონოს"
  // მენეჯერის დადასტურება ლოგისთვის. ლოგირების წარუმატებლობამ განზრახ არ
  // უნდა "დააბრუნოს" უკვე ლოკალურად შესრულებული clear/remove — toast-ით
  // ვაფრთხილებთ და ვჩერდებით.
  const logCartOverride = async (action: 'clear-cart-override' | 'remove-item-override', overrideToken: string, detail?: string) => {
    try {
      await axios.post(
        'http://localhost:5000/api/cart/confirm-override',
        { action, detail },
        { headers: { 'X-Manager-Override': `Bearer ${overrideToken}` } }
      );
    } catch (error: unknown) {
      console.error('აუდიტ-ლოგის ჩაწერა ჩავარდა:', error);
      showToast('მოქმედება შესრულდა, მაგრამ აუდიტ-ლოგის ჩაწერა ჩავარდა', 'error');
    }
  };

  // 🧺 კალათის ფაქტობრივი გასუფთავება (Roadmap ეტაპი 5). overrideToken
  // გადაეცემა მხოლოდ მაშინ, როცა can_clear_cart არ გვყოფნის და მენეჯერის
  // PIN-ით დადასტურდა — მაშინ ცალკე ვწერთ 'clear-cart-override' აუდიტ-ლოგს.
  const performClearCart = async (overrideToken?: string) => {
    setCart([]);
    showToast('კალათა გასუფთავდა', 'success');
    if (overrideToken) {
      await logCartOverride('clear-cart-override', overrideToken);
    }
  };

  // 🧺 კონკრეტული პროდუქტის ფაქტობრივი წაშლა კალათიდან (Roadmap ეტაპი 5).
  // overrideToken-ის შემთხვევაში detail-ში პროდუქტის სახელი გადაეცემა
  // 'remove-item-override' აუდიტ-ლოგის new_value-სთვის.
  const performRemoveItem = async (productId: number, itemName: string, overrideToken?: string) => {
    setCart(prev => prev.filter(i => i.productId !== productId));
    showToast(`${itemName} წაიშალა კალათიდან`, 'success');
    if (overrideToken) {
      await logCartOverride('remove-item-override', overrideToken, itemName);
    }
  };

  // 🔑 POST /api/auth/verify-manager-pin — bcrypt-ით შემოწმებული PIN.
  // pinAction განსაზღვრავს, წარმატებული PIN-ის შემდეგ რომელი მოქმედება გაგრძელდეს:
  // 'discount' — override ტოკენი ინახება state-ში checkout-ისთვის (ძველი ქცევა);
  // 'void-receipt' — performVoidReceipt; 'clear-cart' — performClearCart;
  // 'remove-item' — performRemoveItem.
  const handleVerifyManagerPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(pinValue)) {
      setPinError('PIN-კოდი უნდა შედგებოდეს ზუსტად 4 ციფრისგან!');
      return;
    }

    setPinLoading(true);
    setPinError('');
    try {
      const response = await axios.post('http://localhost:5000/api/auth/verify-manager-pin', { pin: pinValue });
      const overrideToken: string | undefined = response.data?.managerOverrideToken;

      if (response.data?.success && overrideToken) {
        if (pinAction === 'void-receipt' && pendingVoidPaymentId !== null) {
          await performVoidReceipt(pendingVoidPaymentId, overrideToken);
        } else if (pinAction === 'clear-cart') {
          await performClearCart(overrideToken);
        } else if (pinAction === 'remove-item' && pendingRemoveItem !== null) {
          await performRemoveItem(pendingRemoveItem.productId, pendingRemoveItem.name, overrideToken);
        } else {
          setManagerOverrideToken(overrideToken);
          setDiscountType(pendingDiscountType);
          setDiscountValue('');
          showToast('მენეჯერის ავტორიზაცია დადასტურდა — ფასდაკლება დაშვებულია ამ ჩეკზე', 'success');
        }
        closePinModal();
      }
    } catch (error: unknown) {
      // "any"-ის ნაცვლად axios.isAxiosError ტიპის დამცველი — Clean Architecture წესი.
      const serverMessage = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      setPinError(serverMessage || 'PIN-კოდის შემოწმება ვერ მოხერხდა!');
      setPinValue('');
    } finally {
      setPinLoading(false);
    }
  };

  // 🧺 "კალათის გასუფთავება" წითელ ღილაკზე დაჭერა (Roadmap ეტაპი 5).
  // can_clear_cart === true → პირდაპირ გასუფთავდეს (spec-ის მოთხოვნით, confirm
  // მოდალის გარეშე); false → მენეჯერის PIN მოდალი.
  const handleClearCartClick = () => {
    if (cart.length === 0) return;
    if (canClearCart) {
      performClearCart();
    } else {
      setPendingRemoveItem(null);
      setPinAction('clear-cart');
      setPinValue('');
      setPinError('');
      setShowPinModal(true);
    }
  };

  // 🧺 კალათიდან ცალკეული პროდუქტის წაშლის ღილაკზე ("❌") დაჭერა.
  const handleRemoveItemClick = (productId: number, itemName: string) => {
    if (canClearCart) {
      performRemoveItem(productId, itemName);
    } else {
      setPendingRemoveItem({ productId, name: itemName });
      setPinAction('remove-item');
      setPinValue('');
      setPinError('');
      setShowPinModal(true);
    }
  };

  // 🧾 "ჩეკის გაუქმება" ღილაკზე დაჭერა — ჯერ Products.tsx-ის სტილის confirm
  // მოდალი (window.confirm()-ის ნაცვლად), დადასტურების შემდეგ კი branch:
  // საკუთარი უფლებით პირდაპირ, უფლების გარეშე კი მენეჯერის PIN მოდალით.
  const handleVoidReceiptClick = (paymentId: string) => {
    setVoidConfirm({ show: true, paymentId });
  };

  const closeVoidConfirm = () => setVoidConfirm({ show: false, paymentId: null });

  const confirmVoidReceipt = () => {
    const paymentId = voidConfirm.paymentId;
    closeVoidConfirm();
    if (paymentId === null) return;

    if (canVoidReceipt) {
      performVoidReceipt(paymentId);
    } else {
      setPendingVoidPaymentId(paymentId);
      setPinAction('void-receipt');
      setPinValue('');
      setPinError('');
      setShowPinModal(true);
    }
  };

  useEffect(() => {
    checkShiftStatus();
    fetchMyPermissions();
    let barcodeBuffer = '';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' && (document.activeElement as HTMLInputElement).type === 'number') return;
      if (e.key === 'Enter') {
        if (barcodeBuffer.trim().length > 0) {
          handleBarcodeScanned(barcodeBuffer.trim());
          barcodeBuffer = '';
        }
      } else if (e.key !== 'Shift') {
        barcodeBuffer += e.key;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // ⬅️ ცარიელი მასივი — ერთხელ გაეშვება mount-ზე, აღარ ციკლავს

  const checkShiftStatus = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/shifts/status');
      setHasActiveShift(response.data.hasActiveShift);
      setActiveShift(response.data.shift);
      cacheActiveShift(response.data.hasActiveShift, response.data.shift);
      if (response.data.hasActiveShift) loadProducts();
    } catch (error) {
      console.error(error);
      // 📴 Roadmap STEP 3/4 — ქსელის გარეშე (ან ბექენდთან დროებითი
      // კავშირის გაწყვეტისას) ბოლო ცნობილი ცვლის მდგომარეობით ვაგრძელებთ,
      // ცარიელი/დაბლოკილი ეკრანის ნაცვლად.
      const cached = readCachedActiveShift();
      if (cached) {
        setHasActiveShift(cached.hasActiveShift);
        setActiveShift(cached.shift);
        if (cached.hasActiveShift) loadProducts();
      }
    }
  };

  const loadProducts = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/products');
      setProducts(response.data);
      // 📦 Roadmap STEP 4.1 — cached_products (Dexie) სინქრონიზდება ყოველ
      // წარმატებულ ჩატვირთვაზე (Cashier Login-ის/Shift-ის დაწყების დროს),
      // რომ Offline checkout-საც ჰქონდეს რისი გაყიდვაც შეუძლია.
      cacheProducts(response.data).catch((err) => console.error('პროდუქტების ქეშირება ჩავარდა:', err));
    } catch (error) {
      console.error(error);
      // 📴 Offline (ან ბექენდთან დროებითი გაწყვეტისას) ლოკალურად ქეშირებული
      // ნომენკლატურით ვაგრძელებთ, ცარიელი POS ეკრანის ნაცვლად.
      try {
        const cached = await getCachedProducts();
        if (cached.length > 0) setProducts(cached);
      } catch (dexieErr) {
        console.error('ქეშირებული პროდუქტების წაკითხვა ჩავარდა:', dexieErr);
      }
    }
  };

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await axios.post('http://localhost:5000/api/shifts/open', { start_amount: parseFloat(startAmount) });
      checkShiftStatus();
    } catch (error: any) {
      showToast(error.response?.data?.message || 'შეცდომა', 'error');
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();

    // ==========================================
    // 🚧 Late-close race condition guard (roadmap-ის მიღმა, 12.08)
    // ==========================================
    // PROGRESS - 12.08.2026.md-ის "ცნობილი, დაუხურავი საკითხი": თუ ცვლა
    // დაიხურა Dexie-ში ჯერ კიდევ დარჩენილი offline ჩეკებით, ეს ჩეკები
    // მოგვიანებით მაინც დასინქრონდება (ფული ხომ უკვე რეალურად აღებულია),
    // მაგრამ უკვე ნანახი/დაბეჭდილი Z-Report-ს ვეღარასდროს ასახავს — ცვლის
    // "ფაქტობრივი" თანხა მოძველებული დარჩება სამუდამოდ.
    //
    // აქ ჯერ ვცდილობთ სწრაფ, ერთჯერად სინქრონიზაციას (თუ online ვართ, ეს
    // ჩვეულებრივ საკმარისია და მოლარეს საერთოდ არაფერს ვუშლით), და
    // მხოლოდ იმ შემთხვევაში ვბლოკავთ ცვლის დახურვას, თუ ამის შემდეგაც
    // queue-ში რაღაც რჩება (რეალურად offline ვართ, ან სინქრონიზაცია
    // ჩავარდა). ეს მხოლოდ frontend-ის დონის დაცვაა — ბექენდს ფიზიკურად
    // არ შეუძლია იცოდეს, რა დევს ამ კონკრეტული ბრაუზერის IndexedDB-ში,
    // ამიტომ სერვერული enforcement აქ შეუძლებელია.
    setClosingShift(true);
    try {
      const unsyncedBeforeSync = await countUnsyncedOfflineReceipts();
      if (unsyncedBeforeSync > 0) {
        showToast(`⏳ ${unsyncedBeforeSync} ოფლაინ ჩეკი სინქრონიზდება, სანამ ცვლა დაიხურება...`, 'info');
        await syncOfflineReceipts();

        const stillUnsynced = await countUnsyncedOfflineReceipts();
        if (stillUnsynced > 0) {
          showToast(
            `🚫 ცვლის დახურვა ვერ მოხერხდება — ${stillUnsynced} ოფლაინ ჩეკი ჯერ არ დასინქრონებულა. დაელოდეთ ინტერნეტის დაბრუნებას და სცადეთ ხელახლა.`,
            'error'
          );
          return;
        }
        showToast('✅ ყველა ოფლაინ ჩეკი დასინქრონდა', 'success');
      }

      const response = await axios.put('http://localhost:5000/api/shifts/close', { end_amount_actual: parseFloat(endAmountActual) });
      setZReport(response.data);
      // 🖨 Roadmap ეტაპი 7 — დახურვის ზუსტი მომენტი, Z-Report-ის ბეჭდვისთვის.
      setShiftClosedAtDisplay(new Date().toLocaleString('ka-GE', { hour12: false }));
      // მნიშვნელოვანია: არ ვცვლით hasActiveShift-ს ხელით აქ, რათა ეკრანი არ დაიბლოკოს მოდალის გამოჩენამდე
    } catch (error: any) {
      console.error('ცვლის დახურვის შეცდომა:', error.response?.data || error.message);
      showToast(error.response?.data?.message || error.response?.data?.error || 'შეცდომა ცვლის დახურვისას', 'error');
    } finally {
      setClosingShift(false);
    }
  };

  const handleBarcodeScanned = (scannedCode: string) => {
    // ⬇️ products/cart-ის ნაცვლად ref-ებს ვიყენებთ, რადგან ეს ფუნქცია
    // გამოძახებულია mount-ზე ერთხელ დარეგისტრირებული keydown listener-იდან
    // (იხ. ზემოთ useEffect-ის კომენტარი) და closure-ში ძველი state-ი არ უნდა დარჩეს.
    const prod = productsRef.current.find(p => p.barcode === scannedCode);
    if (!prod) return showToast(`პროდუქტი კოდით [${scannedCode}] ვერ მოიძებნა!`, 'error');
    if (prod.stock <= 0) return showToast('მარაგში აღარ არის!', 'error');
    const currentCart = cartRef.current;
    const existing = currentCart.find(item => item.productId === prod.id);
    const currentQty = existing ? existing.quantity : 0;
    if (prod.stock < currentQty + 1) return showToast('მარაგი არ არის საკმარისი!', 'error');

    if (existing) {
      setCart(currentCart.map(item => item.productId === prod.id ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      setCart([...currentCart, { productId: prod.id, name: prod.name, price: prod.price, quantity: 1, maxStock: prod.stock }]);
    }
    showToast(`${prod.name} დაემატა კალათაში`, 'success');
  };

  const handleAddToCart = (e: React.FormEvent) => {
    e.preventDefault();
    const prod = products.find(p => p.id === Number(selectedProductId));
    if (!prod) return showToast('აირჩიეთ პროდუქტი', 'error');
    const qty = parseInt(quantity);
    if (qty <= 0 || isNaN(qty)) return showToast('არავალიდური რაოდენობა', 'error');
    const currentQty = cart.find(item => item.productId === prod.id)?.quantity || 0;
    if (prod.stock < currentQty + qty) return showToast('მარაგი არ არის საკმარისი', 'error');

    if (currentQty > 0) {
      setCart(cart.map(item => item.productId === prod.id ? { ...item, quantity: item.quantity + qty } : item));
    } else {
      setCart([...cart, { productId: prod.id, name: prod.name, price: prod.price, quantity: qty, maxStock: prod.stock }]);
    }
    setQuantity('1');
  };

  // 📜 მიმდინარე ცვლის საკუთარი ჩეკების ჩატვირთვა
  // (ბექენდი თავად შემოსაზღვრავს shift_id-ით — თარიღის ფილტრი აღარ სჭირდება)
  const fetchMyHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await axios.get('http://localhost:5000/api/payments/my-history');
      setHistoryReceipts(response.data.receipts || []);
      setHistorySummary(response.data.summary || { totalReceipts: 0, totalSum: 0 });
      setHistoryPage(1); // ახალი ჩატვირთვის შემდეგ ყოველთვის პირველ გვერდზე ვბრუნდებით
    } catch (error: any) {
      if (error?.response?.status === 403) {
        setCanViewHistory(false); // ღილაკიც დაუყოვნებლივ დაიმალოს, თუ უფლება იმ წამს გამორთეს
        setShowHistoryModal(false);
        showToast('ისტორიის ნახვის უფლება გამორთულია', 'error');
      } else {
        showToast('ისტორიის ჩატვირთვა ვერ მოხერხდა', 'error');
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [showToast]);

  const handleOpenHistory = () => {
    setShowHistoryModal(true);
    fetchMyHistory();
  };

  const toggleReceipt = (id: string) => {
    setExpandedReceiptId(prev => (prev === id ? null : id));
  };

  // 📄 კლიენტური პაგინაცია — იგივე პრინციპი, რაც Products.tsx-ში
  const totalHistoryPages = Math.max(1, Math.ceil(historyReceipts.length / HISTORY_PAGE_SIZE));
  const paginatedReceipts = historyReceipts.slice(
    (historyPage - 1) * HISTORY_PAGE_SIZE,
    historyPage * HISTORY_PAGE_SIZE
  );

  // 🏷️ ფასდაკლების გამოთვლა — ბექენდის buildPaymentsFilterQuery/POST-ის
  // ვალიდაციის ანალოგიურად: percent 0-100, fixed არ აჭარბებს subtotal-ს.
  const cartSubtotal = cart.reduce((s, i) => s + (i.price * i.quantity), 0);
  const parsedDiscountValue = parseFloat(discountValue) || 0;
  let discountAmount = 0;
  if (discountType === 'percent') {
    discountAmount = cartSubtotal * (Math.min(Math.max(parsedDiscountValue, 0), 100) / 100);
  } else if (discountType === 'fixed') {
    discountAmount = Math.min(Math.max(parsedDiscountValue, 0), cartSubtotal);
  }
  const cartTotal = Math.max(0, cartSubtotal - discountAmount);

  // 💰 Roadmap ეტაპი 8 — SPLIT-ის ორი ხელით შევსებული ველიდან წარმოებული
  // მნიშვნელობები. splitDiff !== 0 ნიშნავს, რომ ჯამი ჩეკის თანხას არ
  // ემთხვევა — ამ დროს checkout-ის ღილაკი დაბლოკილია (იხ. paymentMethodValid).
  // ⚠️ FIX: მანამდე აქ პირდაპირ parseFloat(splitCashInput)-ს ვიღებდი, დამრგვალების
  // გარეშე — spinner-ით ან ხელით "0.001"-ის ტიპის sub-cent მნიშვნელობის აკრეფისას
  // splitSum.toFixed(2) ამას "ფარავდა" (5.601 → "5.60"), checkout ღილაკი ცრუდ
  // enable-დებოდა, payload კი 0.001-იან splits.cash-ს გაუშვებდა backend-ში, სადაც
  // payment_splits.amount-ს CHECK (amount > 0) აქვს — მრგვალდება 0.00-მდე
  // (Number(x.toFixed(2))) და INSERT DB-კონსტრეინტის დარღვევით ჩავარდებოდა. ახლა
  // თეთრებში ვამრგვალებ აქვე, რომ "0.001" ნამდვილად 0.00-დ იქცეს და > 0 შემოწმებამ
  // სწორად დაბლოკოს, ნაცვლად იმისა, რომ UI-მ ცრუ "✓"-ი აჩვენოს.
  const parsedSplitCash = Math.round((parseFloat(splitCashInput) || 0) * 100) / 100;
  const parsedSplitCard = Math.round((parseFloat(splitCardInput) || 0) * 100) / 100;
  const splitBothFilled = splitCashInput !== '' && splitCardInput !== '';
  const splitSum = Number((parsedSplitCash + parsedSplitCard).toFixed(2));
  const splitDiff = Number((splitSum - cartTotal).toFixed(2));

  const paymentMethodValid =
    paymentMethod !== 'split' ||
    (splitBothFilled && parsedSplitCash > 0 && parsedSplitCard > 0 && splitDiff === 0);

  // 💰 Roadmap ეტაპი 8 (fix) — SPLIT-ის ავტომატური ბალანსი. ხელით ორივე ველის
  // შევსების (და სხვაობის ხელით გამოთვლის) ნაცვლად: ერთი ველის შეცვლისას
  // მეორე თვითონ ითვლება როგორც (მთლიანი − შეყვანილი). ყველა თანხობრივი
  // არითმეტიკა თეთრებში (Math.round(v * 100)) ხდება, რომ float-ის დამრგვალების
  // ცდომილება (0.1 + 0.2 !== 0.3 ტიპის ბაგი) არასდროს გაჟონოს UI-ში.
  const totalTetri = Math.round(cartTotal * 100);
  const clampTetri = (t: number) => Math.min(Math.max(t, 0), totalTetri);

  const handleSplitCardChange = (raw: string) => {
    setSplitCardInput(raw);
    const parsed = parseFloat(raw);
    const cardTetri = Number.isFinite(parsed) ? clampTetri(Math.round(parsed * 100)) : 0;
    setSplitCashInput(((totalTetri - cardTetri) / 100).toFixed(2));
  };

  const handleSplitCashChange = (raw: string) => {
    setSplitCashInput(raw);
    const parsed = parseFloat(raw);
    const cashTetri = Number.isFinite(parsed) ? clampTetri(Math.round(parsed * 100)) : 0;
    setSplitCardInput(((totalTetri - cashTetri) / 100).toFixed(2));
  };

  // 💵 ხურდის ცოცხალი გამოთვლა ეკრანზე — cashDueNow არის ის ნაწილი, რაც
  // რეალურად ნაღდით იფარება ('cash'-ზე მთელი ჯამი, 'split'-ზე მხოლოდ
  // ნაღდი ნაწილი, 'card'-ზე 0).
  const parsedCashReceived = parseFloat(cashReceivedInput) || 0;
  const cashDueNow = paymentMethod === 'cash' ? cartTotal : paymentMethod === 'split' ? parsedSplitCash : 0;
  const changeDueNow = paymentMethod === 'card' ? 0 : Math.max(0, Number((parsedCashReceived - cashDueNow).toFixed(2)));

  // ==========================================
  // 📴 Roadmap STEP 4.2 — Offline Checkout Handler
  // ==========================================
  // handleCheckout-ის მიერ უკვე ვალიდირებული payload-ით გამოიძახება, თუ
  // navigator.onLine === false (ან POST /api/payments ქსელური მიზეზით
  // ჩავარდა — იხ. handleCheckout-ის catch ბლოკი). ბექენდზე request-ის
  // გაგზავნის ნაცვლად: (1) crypto.randomUUID()-ით კლიენტის მხარეს
  // გენერირებული ID (ზუსტად ბექენდის payments.id-ის, UUID migration
  // 009-ის, ფორმატის) მიბმულია მიმდინარე shift_id/register_id-ზე, (2)
  // ჩეკი ინახება Dexie-ის offline_receipts store-ში (Roadmap STEP 4.1),
  // (3) მოლარეს უჩვენდება ზუსტად ისეთივე "წარმატებული გაყიდვის" UI
  // მდგომარეობა, როგორც ონლაინ checkout-ზე — ჩეკის ბეჭდვის ჩათვლით.
  const handleOfflineCheckout = async (payload: CheckoutPayload) => {
    const shiftId = typeof activeShift?.id === 'string' ? activeShift.id : null;
    const registerId = getStoredRegisterId();

    if (!shiftId || !registerId || !myUserId) {
      showToast('ოფლაინ გაყიდვისთვის საჭიროა აქტიური ცვლა, დაწყვილებული სალარო და ავტორიზაცია', 'error');
      return;
    }

    const receiptId = crypto.randomUUID();
    const createdAtIso = new Date().toISOString();
    const discountAmount = Number((cartSubtotal - cartTotal).toFixed(2));

    const offlineReceipt: OfflineReceipt = {
      id: receiptId,
      shiftId,
      registerId,
      cashierId: myUserId,
      items: payload.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      })),
      subtotalAmount: cartSubtotal,
      discountType: payload.discount?.type ?? null,
      discountValue: payload.discount?.value ?? 0,
      totalAmount: cartTotal,
      paymentMethod: payload.paymentMethod,
      splits: payload.splits ?? null,
      cashReceived: payload.cashReceived ?? null,
      createdAt: createdAtIso,
      syncStatus: 'pending',
      createdAtLocal: Date.now(),
    };

    try {
      await queueOfflineReceipt(offlineReceipt);
    } catch (err) {
      console.error('ოფლაინ ჩეკის ლოკალურად შენახვა ჩავარდა:', err);
      showToast('ოფლაინ ჩეკის შენახვა ვერ მოხერხდა', 'error');
      return;
    }

    // ⬇️ "ოპტიმისტური" stock-ის დაკლება ლოკალურ state-ში — ნამდვილი stock
    // ბაზაში მხოლოდ Background Sync-ის დროს დაკლდება (Roadmap STEP 5),
    // მაგრამ ამის გარეშე UI-ს stock ველი მოძველებული დარჩებოდა და მოლარეს
    // იმავე ცვლაზე იმავე პროდუქტის ზედმეტად გაყიდვის საშუალებას მისცემდა.
    setProducts((prev) =>
      prev.map((p) => {
        const cartItem = payload.items.find((item) => item.productId === p.id);
        return cartItem ? { ...p, stock: p.stock - cartItem.quantity } : p;
      })
    );

    showToast('📴 ინტერნეტი არ არის — ჩეკი შენახულია ლოკალურად და დასინქრონდება კავშირის აღდგენისას', 'info');

    setLastReceipt({
      paymentId: receiptId,
      createdAt: new Date(createdAtIso).toLocaleString('ka-GE', { hour12: false }),
      cashierName: myUsername || undefined,
      items: payload.items.map((item) => ({ name: item.name, price: item.price, quantity: item.quantity })),
      subtotalAmount: cartSubtotal,
      discountType: payload.discount?.type ?? null,
      discountValue: payload.discount?.value ?? 0,
      discountAmount,
      totalAmount: cartTotal,
      paymentMethod: payload.paymentMethod,
      splits: payload.splits ?? null,
      cashReceived: payload.cashReceived ?? null,
      changeDue:
        payload.paymentMethod === 'cash' && parsedCashReceived > 0
          ? Number((parsedCashReceived - cartTotal).toFixed(2))
          : undefined,
    });

    setCart([]);
    setDiscountType('none');
    setDiscountValue('');
    setPaymentMethod('cash');
    setSplitCashInput('');
    setSplitCardInput('');
    setCashReceivedInput('');
    setManagerOverrideToken(null);
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return showToast('კალათა ცარიელია!', 'error');

    // 🔐 თუ მოლარეს (და არც მენეჯერის დადასტურებული override-ს) ფასდაკლების
    // უფლება არ აქვს, checkout-ი უნდა ჩაიშალოს მაშინაც კი, თუ UI state
    // ხელით/DevTools-ით იქნა შეცვლილი — ეს არის frontend-ის ბოლო ბარიერი
    // backend-ის ვალიდაციამდე.
    if (!canUseDiscountEffective && discountType !== 'none') {
      setDiscountType('none');
      setDiscountValue('');
      return showToast('ფასდაკლების გამოყენების უფლება არ გაქვთ', 'error');
    }

    if (discountType === 'percent' && (parsedDiscountValue < 0 || parsedDiscountValue > 100)) {
      return showToast('პროცენტული ფასდაკლება უნდა იყოს 0-100 შორის', 'error');
    }
    if (discountType === 'fixed' && parsedDiscountValue > cartSubtotal) {
      return showToast('ფასდაკლება არ შეიძლება აჭარბებდეს ჯამურ თანხას', 'error');
    }

    // 💰 Roadmap ეტაპი 8 — SPLIT-ის ვალიდაცია checkout-ის დაჭერისას. ღილაკი
    // ისედაც დაბლოკილია (paymentMethodValid), მაგრამ ეს არის frontend-ის
    // ბოლო ბარიერი, ისევე როგორც ფასდაკლების შემოწმება ზემოთ.
    if (paymentMethod === 'split' && (!splitBothFilled || parsedSplitCash <= 0 || parsedSplitCard <= 0)) {
      return showToast('შეავსე ორივე ველი — ნაღდი და ბარათი', 'error');
    }
    if (paymentMethod === 'split' && splitDiff !== 0) {
      return showToast(
        `გადახდების ჯამი (${splitSum.toFixed(2)} ₾) არ ემთხვევა ჩეკის თანხას (${cartTotal.toFixed(2)} ₾)`,
        'error'
      );
    }

    const payload: CheckoutPayload = { items: cart, paymentMethod };

    if (paymentMethod === 'split') {
      payload.splits = { cash: parsedSplitCash, card: parsedSplitCard };
    }
    // 💰 Roadmap ეტაპი 8 (fix) — cashReceived მხოლოდ სუფთა 'cash' გადახდაზე
    // ვრცელდება. SPLIT-ს UI-ში ეს ველი აღარ აქვს (იხ. ზემოთ), მაგრამ
    // cashReceivedInput state მაინც არ ინულდება paymentMethod-ის შეცვლისას —
    // ადრინდელი `!== 'card'` პირობა ამიტომ 'cash' რეჟიმიდან დარჩენილ
    // მნიშვნელობას შერეულ გადახდაშიც "გაჟონავდა". ახლა მკაცრად === 'cash'.
    if (paymentMethod === 'cash' && parsedCashReceived > 0) {
      payload.cashReceived = parsedCashReceived;
    }

    let usedOverrideToken = false;
    if (canUseDiscountEffective && discountType !== 'none' && parsedDiscountValue > 0) {
      payload.discount = { type: discountType, value: parsedDiscountValue };
      usedOverrideToken = !canUseDiscount && !!managerOverrideToken;
    }

    // 📴 Roadmap STEP 4.2 — Checkout Submit Handler-ის რეფაქტორინგი: თუ
    // ბრაუზერი Offline სტატუსშია, POST /api/payments-ის გამოძახებაც კი არ
    // ხდება (ისედაც ჩავარდებოდა) — პირდაპირ Dexie-ის offline_receipts-ში
    // ვინახავთ (STEP 4.1) და მოლარეს ვუჩვენებთ წარმატებული გაყიდვის UI-ს.
    // Manager PIN Override ფასდაკლებაზე ოფლაინში ვერ დადასტურდება
    // (POST /auth/verify-manager-pin-იც ქსელს საჭიროებს), ამიტომ ეს
    // კონკრეტული checkout მაინც ბექენდზე იგზავნება, თუ override-ს იყენებს —
    // Offline რეჟიმში ფასდაკლების override უბრალოდ მიუწვდომელია.
    if (!navigator.onLine && !usedOverrideToken) {
      await handleOfflineCheckout(payload);
      return;
    }

    try {
      // 🔑 X-Manager-Override: Bearer <token> — მხოლოდ მაშინ, როცა საკუთარი
      // can_use_discount არ გვყოფნის და ეს კონკრეტული checkout ფასდაკლებიან
      // override-ს ეყრდნობა. ტოკენს backend (sales.ts) ვერიფიცირებს ხელახლა —
      // ეს header უბრალოდ გადასცემს მას, არაფერს არ "ანდობს" frontend-ს.
      const response = await axios.post('http://localhost:5000/api/payments', payload, {
        headers: usedOverrideToken ? { 'X-Manager-Override': `Bearer ${managerOverrideToken}` } : undefined,
      });
      showToast('გაყიდვა დასრულდა!', 'success');

      // 🖨 Roadmap ეტაპი 7 — ჩეკის ბეჭდვა. ვიღებთ response.data-დან (არა
      // ხელახლა ვთვლით cart-იდან), რომ დაბეჭდილი ჩეკი ზუსტად ემთხვეოდეს
      // ბაზაში რეალურად შენახულ subtotal/discount/total მნიშვნელობებს.
      // items მაინც cart-იდან მოდის — POST /payments-ის response items-ს
      // არ აბრუნებს, მხოლოდ ჯამებს (იხ. sales.ts).
      setLastReceipt({
        paymentId: response.data.paymentId,
        createdAt: new Date().toLocaleString('ka-GE', { hour12: false }),
        cashierName: myUsername || undefined,
        items: cart.map(item => ({ name: item.name, price: item.price, quantity: item.quantity })),
        subtotalAmount: response.data.subtotalAmount ?? cartSubtotal,
        discountType: response.data.discountType ?? null,
        discountValue: response.data.discountValue ?? 0,
        discountAmount: response.data.discountAmount ?? 0,
        totalAmount: response.data.totalAmount ?? cartTotal,
        // 💰 Roadmap ეტაპი 8 — POST /api/payments-ის response-იდან პირდაპირ
        // (იგივე პრინციპი, რაც totalAmount-ზეა ზემოთ) — დაბეჭდილი ჩეკი ზუსტად
        // იმას აჩვენებს, რაც ბაზაში რეალურად შენახულა.
        paymentMethod: response.data.paymentMethod,
        splits: response.data.splits,
        cashReceived: response.data.cashReceived,
        changeDue: response.data.changeDue,
      });

      setCart([]);
      setDiscountType('none');
      setDiscountValue('');
      // 💰 Roadmap ეტაპი 8 — შემდეგი ჩეკისთვის ყოველთვის 'cash'-ზე ვბრუნდებით,
      // ისევე როგორც ფასდაკლების state ზემოთ ყოველ checkout-ის შემდეგ იშლება.
      setPaymentMethod('cash');
      setSplitCashInput('');
      setSplitCardInput('');
      setCashReceivedInput('');
      // 🔒 ჩეკი დაიხურა — თუ ეს override-ით ჩატარებული გაყიდვა იყო,
      // ტოკენი იშლება state-იდან და უფლება ისევ ბლოკირდება შემდეგი ჩეკისთვის
      // (Roadmap ეტაპი 2 მოთხოვნა). ტოკენი backend-ზეც უკვე "მოხმარებულადაა"
      // მონიშნული (single-use), ამიტომ ხელახლა ვერც სცადებდა, თუნდაც დარჩენილიყო.
      setManagerOverrideToken(null);
      loadProducts();
    } catch (error: any) {
      // 📴 Roadmap STEP 4.2 — `error.response`-ის არარსებობა ნიშნავს, რომ
      // მოთხოვნამ სერვერამდე საერთოდ ვერ მიაღწია (კავშირი წყდა, DNS/wifi
      // ჩავარდა და ა.შ.) — navigator.onLine ამ შემთხვევებში ხშირად მაინც
      // `true`-ს აჩვენებს (captive portal-ები, wifi-ს "ჩხირკედელი" კავშირი),
      // ამიტომ ეს ფაქტობრივადაც Offline-ის ტოლფასია და იმავე queue-ში
      // ვინახავთ, ვიდრე მოლარეს "შეცდომის" ტოსტი ვაჩვენოთ ტყუილად. Manager
      // Override-იანი checkout კვლავ სუფთა შეცდომად ითვლება (იხ. ზემოთ
      // კომენტარი — override ისედაც ონლაინს საჭიროებს).
      if (!error.response && !usedOverrideToken) {
        await handleOfflineCheckout(payload);
        return;
      }
      showToast(error.response?.data?.error || 'გაყიდვა ჩავარდა!', 'error');
    }
  };

  // ბლოკირებული ეკრანი გამოჩნდება მხოლოდ მაშინ, თუ ცვლა დახურულია და თან Z-Report-ს არ ვუყურებთ
  if (!hasActiveShift && !zReport) {
    return (
      <div className={styles.salesContainer}>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        <div className={styles.blockedScreen}>
          <div className={styles.blockedCard}>
            <h2>🔒 სალარო ბლოკირებულია</h2>
            <p>მუშაობის დასაწყებად აუცილებელია მიმდინარე დღის ცვლის გახსნა.</p>
            <form onSubmit={handleOpenShift}>
              <div className={styles.formGroup}>
                <label>საწყისი ნაღდი ფული სალაროში (₾)</label>
                <input type="number" min="0" step="0.01" value={startAmount} onChange={e => setStartAmount(e.target.value)} className={styles.inputField} />
              </div>
              <button type="submit" className={`${styles.btn} ${styles.btnSuccess}`} style={{ width: '100%', marginTop: '10px' }}>🚀 ცვლის გახსნა</button>
            </form>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.salesContainer}>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      {/* მთავარი სამუშაო პანელი ჩანს მხოლოდ მაშინ, როცა ცვლა რეალურად აქტიურია */}
      {hasActiveShift && (
        <>
          <div className={styles.topPanel}>
            <div><h2>🛒 გაყიდვების პანელი (POS)</h2><small>ცვლა #{activeShift?.id} | გახსნილია: {activeShift?.opened_at}</small></div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {canViewHistory && (
                <button onClick={handleOpenHistory} className={`${styles.btn} ${styles.btnSecondary}`}>📜 ჩემი ისტორია</button>
              )}
              {/* 🖨 Roadmap ეტაპი 7 — ბოლო ჩეკის ხელახლა დაბეჭდვა (მაგ. პრინტერი
                  checkout-ის მომენტში მზად არ იყო). ჩანს მხოლოდ მას შემდეგ, რაც
                  ამ სესიაში სულ მცირე ერთი გაყიდვა შედგა. */}
              {lastReceipt && (
                <button onClick={() => triggerPrint('receipt')} className={`${styles.btn} ${styles.btnSecondary}`}>🖨 ბოლო ჩეკის ბეჭდვა</button>
              )}
              <button onClick={() => setShowCloseModal(true)} className={`${styles.btn} ${styles.btnDanger}`}>🛑 ცვლის დახურვა (Z-Report)</button>
            </div>
          </div>

          <div className={styles.mainGrid}>
            <div className={styles.leftSide}>
              <h3 style={{ marginTop: 0, color: '#475569' }}>პროდუქტის დამატება ჩეკში</h3>
              <form onSubmit={handleAddToCart}>
                <div className={styles.formGroup}><label>აირჩიეთ პროდუქტი</label>
                  <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)} className={styles.inputField}>
                    <option value="">-- აირჩიეთ სიიდან --</option>
                    {/* 📱 შემოკლებული ფორმატი (name · price · stock) — გრძელი ტექსტი
                        native <select>-ის dropdown popup-ს ეკრანზე გადმოსცემდა
                        ვიწრო/მობილურ ეკრანებზე. */}
                    {products.map(p => <option key={p.id} value={p.id} disabled={p.stock <= 0}>{p.name} · {p.price}₾ · {p.stock} ც.</option>)}
                  </select>
                </div>
                <div className={styles.formGroup}><label>რაოდენობა</label>
                  <input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className={styles.inputField} />
                </div>
                <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} style={{ width: '100%' }}>კალათაში დამატება</button>
              </form>
            </div>

            <div className={styles.rightSide}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <h3 style={{ marginTop: 0, color: '#475569' }}>📝 მიმდინარე ჩეკი</h3>
                {/* 🧺 "კალათის გასუფთავება" წითელი ღილაკი (Roadmap ეტაპი 5) — ჩანს
                    მხოლოდ თუ კალათა ცარიელი არ არის. can_clear_cart === false-ის
                    შემთხვევაში ღილაკი მაინც აქტიურია (void-ღილაკის ანალოგიით) —
                    დაჭერაზე მენეჯერის PIN მოდალი გაიხსნება. */}
                {cart.length > 0 && (
                  <button
                    onClick={handleClearCartClick}
                    className={`${styles.btn} ${styles.btnDanger}`}
                    style={{ fontSize: '13px', padding: '6px 12px', whiteSpace: 'normal', textAlign: 'center' }}
                    title={!canClearCart ? 'საჭიროა მენეჯერის ავტორიზაცია' : undefined}
                  >
                    🧹 კალათის გასუფთავება{!canClearCart ? ' (მენეჯერის PIN)' : ''}
                  </button>
                )}
              </div>
              {cart.length === 0 ? <p style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>კალათა ცარიელია</p> : (
                <>
                  <div className={styles.cartTableWrapper}>
                    <table className={styles.cartTable}>
                      <thead><tr><th>დასახელება</th><th>ფასი</th><th>რაოდ.</th><th>ჯამი</th><th></th></tr></thead>
                      <tbody>
                        {cart.map(item => (
                          <tr key={item.productId}><td>{item.name}</td><td className={styles.nowrapCell}>{item.price} ₾</td><td className={styles.nowrapCell}>{item.quantity} ც.</td><td className={styles.nowrapCell} style={{ fontWeight: 'bold' }}>{(item.price * item.quantity).toFixed(2)} ₾</td>
                            {/* 🧺 ცალკეული პროდუქტის წაშლა (Roadmap ეტაპი 5) — can_clear_cart-ის
                                მიხედვით პირდაპირ ან მენეჯერის PIN-ის მეშვეობით (handleRemoveItemClick). */}
                            <td><button onClick={() => handleRemoveItemClick(item.productId, item.name)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }} title={!canClearCart ? 'საჭიროა მენეჯერის ავტორიზაცია' : undefined}>❌</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 🏷️ ფასდაკლების კალკულატორი — receipt-level, checkout-ის წინ.
                      can_use_discount === false-ის შემთხვევაში select-ი განზრახ არ არის disabled —
                      არჩევის მცდელობაზე (handleDiscountTypeChange) იხსნება მენეჯერის PIN მოდალი
                      (Roadmap ეტაპი 2), managerOverrideActive-ის დადასტურებამდე კი ხელით შეყვანის
                      ველი საერთოდ არ ჩნდება. */}
                  <div style={{ display: 'flex', gap: '10px', margin: '15px 0 5px 0', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className={styles.formGroup} style={{ flex: 1, minWidth: '160px', marginBottom: 0 }}>
                      <label>🏷️ ფასდაკლება</label>
                      <select
                        value={discountType}
                        onChange={e => handleDiscountTypeChange(e.target.value as DiscountType)}
                        className={styles.inputField}
                        title={!canUseDiscountEffective ? 'საჭიროა მენეჯერის ავტორიზაცია' : undefined}
                        style={!canUseDiscountEffective ? { opacity: 0.85 } : undefined}
                      >
                        <option value="none">არ არის</option>
                        <option value="percent">პროცენტული %</option>
                        <option value="fixed">ფიქსირებული ₾</option>
                      </select>
                    </div>
                    {canUseDiscountEffective && discountType !== 'none' && (
                      <div className={styles.formGroup} style={{ flex: 1, minWidth: '140px', marginBottom: 0 }}>
                        <label>{discountType === 'percent' ? 'ოდენობა (%)' : 'ოდენობა (₾)'}</label>
                        <input
                          type="number"
                          min="0"
                          max={discountType === 'percent' ? 100 : undefined}
                          step="0.01"
                          value={discountValue}
                          onChange={e => setDiscountValue(e.target.value)}
                          className={styles.inputField}
                          placeholder="0"
                        />
                      </div>
                    )}
                  </div>
                  {!canUseDiscountEffective && (
                    <p style={{ color: '#94a3b8', fontSize: '12px', margin: '0 0 10px 0' }}>
                      🔒 ფასდაკლების გამოყენების უფლება არ გაქვთ — ტიპის არჩევისას მოგეთხოვებათ მენეჯერის PIN-ავტორიზაცია.
                    </p>
                  )}
                  {managerOverrideActive && (
                    <p style={{ color: '#166534', fontSize: '12px', margin: '0 0 10px 0', fontWeight: 'bold' }}>
                      🔓 მენეჯერის ავტორიზაციით ფასდაკლება დაშვებულია ამ ჩეკზე.
                    </p>
                  )}

                  <div className={styles.totalSection} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
                    {discountAmount > 0 && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '14px' }}>
                          <span>ჯამი ფასდაკლებამდე:</span>
                          <span>{cartSubtotal.toFixed(2)} ₾</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b45309', fontSize: '14px' }}>
                          <span>ფასდაკლება{discountType === 'percent' ? ` (${parsedDiscountValue}%)` : ''}:</span>
                          <span>-{discountAmount.toFixed(2)} ₾</span>
                        </div>
                      </>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className={styles.totalLabel}>სულ გადასახდელი:</span>
                      <span className={styles.totalValue}>{cartTotal.toFixed(2)} ₾</span>
                    </div>
                  </div>

                  {/* 💰 Roadmap ეტაპი 8 — გადახდის მეთოდის არჩევა (ნაღდი/ბარათი/შერეული).
                      ბექენდი (POST /api/payments) ინახავს payment_method-ს და, 'split'-ის
                      შემთხვევაში, payment_splits-ს ორ ხაზად — რომ PUT /shifts/close-ის
                      Z-Report-ის "მოსალოდნელი" ნაღდი ფული აღარ ითვლიდეს ბარათით
                      გადახდილ თანხასაც (იხ. sales.ts-ის FIX-ის კომენტარი). */}
                  <div style={{ margin: '15px 0 5px 0' }}>
                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#475569' }}>
                      💰 გადახდის მეთოდი
                    </label>
                    <div role="radiogroup" aria-label="გადახდის მეთოდი" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {(
                        [
                          { value: 'cash', label: '💵 ნაღდი' },
                          { value: 'card', label: '💳 ბარათი' },
                          { value: 'split', label: '🔀 შერეული' },
                        ] as const
                      ).map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={paymentMethod === value}
                          onClick={() => {
                            setPaymentMethod(value);
                            // 💰 Roadmap ეტაპი 8 (fix) — "შერეულზე" გადართვისას საწყისი
                            // მდგომარეობა ავტომატურად: მთელი თანხა ბარათზე, 0 ნაღდზე
                            // (კასირი შემდეგ ერთი ველის შეცვლით არეგულირებს ბალანსს).
                            if (value === 'split') {
                              setSplitCardInput((totalTetri / 100).toFixed(2));
                              setSplitCashInput('0.00');
                            }
                            // 'cash'-იდან წასვლისას ძველი "მიღებული ნაღდი" აღარ უნდა
                            // დარჩეს state-ში — თორემ 'cash'-ზე ხელახლა დაბრუნებისას
                            // ან სხვა რეჟიმში გამოუყენებელი მნიშვნელობა "გაჟონავს".
                            if (value !== 'cash') {
                              setCashReceivedInput('');
                            }
                          }}
                          className={`${styles.btn} ${paymentMethod === value ? styles.btnPrimary : styles.btnSecondary}`}
                          style={{ flex: 1, padding: '10px', fontSize: '14px' }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {paymentMethod === 'cash' && (
                    <div className={styles.formGroup} style={{ marginTop: '10px' }}>
                      <label>მიღებული ნაღდი ფული (₾) — არასავალდებულო</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={cashReceivedInput}
                        onChange={e => setCashReceivedInput(e.target.value)}
                        className={styles.inputField}
                        placeholder={cartTotal.toFixed(2)}
                      />
                      {parsedCashReceived > 0 && (
                        <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#166534', fontWeight: 'bold' }}>
                          ხურდა: {changeDueNow.toFixed(2)} ₾
                        </p>
                      )}
                    </div>
                  )}

                  {paymentMethod === 'card' && (
                    <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                      მთლიანი თანხა {cartTotal.toFixed(2)} ₾ ჩამოიჭრება ბარათიდან.
                    </p>
                  )}

                  {paymentMethod === 'split' && (
                    <div style={{ marginTop: '10px' }}>
                      {/* 💰 Roadmap ეტაპი 8 (fix) — ავტომატური ბალანსი: ერთი ველის
                          შეცვლა მეორეს თვითონ ითვლის (მთლიანი − შეყვანილი), ამიტომ
                          კასირს სხვაობის ხელით ძებნა აღარ სჭირდება. "მიღებული ნაღდი
                          ფული" ველი აქ განზრახ არ ჩანს — ხურდის ლოგიკა SPLIT-ის
                          დროს არ გამოიყენება. */}
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <div className={styles.formGroup} style={{ flex: 1, minWidth: '140px' }}>
                          <label>ნაღდი ნაწილი (₾)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={splitCashInput}
                            onChange={e => handleSplitCashChange(e.target.value)}
                            className={styles.inputField}
                          />
                        </div>
                        <div className={styles.formGroup} style={{ flex: 1, minWidth: '140px' }}>
                          <label>ბარათის ნაწილი (₾)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={splitCardInput}
                            onChange={e => handleSplitCardChange(e.target.value)}
                            className={styles.inputField}
                          />
                        </div>
                      </div>
                      <p
                        style={{
                          margin: '6px 0 0 0',
                          fontSize: '13px',
                          fontWeight: 'bold',
                          color: !splitBothFilled ? '#94a3b8' : paymentMethodValid ? '#166534' : '#ef4444',
                        }}
                      >
                        {!splitBothFilled
                          ? 'შეავსე ორივე ველი'
                          : paymentMethodValid
                          ? '✓ ჯამი ემთხვევა ჩეკის თანხას'
                          : parsedSplitCash <= 0 || parsedSplitCard <= 0
                          // ⚠️ FIX: sub-cent შეყვანა (მაგ. "0.001") ცენტებამდე მრგვალდება
                          // 0.00-მდე — splitDiff ამ დროს 0-ს გვიჩვენებს, მაგრამ ეს არ
                          // ნიშნავს ვალიდურ split-ს (ერთი მხარე ფაქტობრივად ცარიელია),
                          // ამიტომ სხვა, ცხადი შეტყობინება სჭირდება "✓"-ის ნაცვლად.
                          ? 'ორივე ნაწილი დადებითი უნდა იყოს (0.01 ₾-ზე მეტი)'
                          : `სხვაობა: ${splitDiff > 0 ? '+' : ''}${splitDiff.toFixed(2)} ₾`}
                      </p>
                    </div>
                  )}

                  <button
                    onClick={handleCheckout}
                    disabled={!paymentMethodValid}
                    className={`${styles.btn} ${styles.btnSuccess}`}
                    style={{ width: '100%', padding: '14px', fontSize: '16px', marginTop: '10px', opacity: paymentMethodValid ? 1 : 0.6, whiteSpace: 'normal' }}
                    title={!paymentMethodValid ? 'შერეული გადახდის ორივე ნაწილი დადებითი უნდა იყოს და ჯამში ჩეკის თანხას უნდა ემთხვეოდეს' : undefined}
                  >
                    გაყიდვის დასრულება (ჩეკის ბეჭდვა)
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* კომბინირებული მოდალი: სადაც ჯერ შეგვყავს ფაქტობრივი თანხა, ხოლო დახურვის შემდეგ იქვე ვხედავთ Z-Report-ს */}
      {showCloseModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBody}>
            {!zReport ? (
              <>
                <h3>ცვლის დახურვა და ინკასაცია</h3>
                <p>შეიყვანეთ სალაროში არსებული ფაქტობრივი ნაღდი ფული.</p>
                <form onSubmit={handleCloseShift}>
                  <div className={styles.formGroup}><label>💵 ფაქტობრივი ნაღდი ფული (₾)</label>
                    <input type="number" min="0" step="0.01" value={endAmountActual} onChange={e => setEndAmountActual(e.target.value)} className={styles.inputField} />
                  </div>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => setShowCloseModal(false)} disabled={closingShift} className={`${styles.btn} ${styles.btnSecondary}`} style={{ flex: 1, minWidth: '120px' }}>გაუქმება</button>
                    <button type="submit" disabled={closingShift} className={`${styles.btn} ${styles.btnDanger}`} style={{ flex: 1, minWidth: '120px' }}>
                      {closingShift ? '⏳ მოწმდება...' : 'დახურვა'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <h3 style={{ color: '#10b981' }}>📊 ცვლა დაიხურა (Z-Report)</h3>
                <div style={{ background: '#f8fafc', padding: '15px', borderRadius: '8px', margin: '20px 0', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>საწყისი:</span> <strong>{Number(zReport.start ?? 0).toFixed(2)} ₾</strong></div>
                  {/* 🖨 Roadmap ეტაპი 7 — "გაყიდული ჩეკების რაოდენობა", ადრე მოდალშიც კი არ ჩანდა */}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>გაყიდული ჩეკები:</span> <strong>{zReport.receiptCount ?? 0}</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>მოსალოდნელი:</span> <strong>{Number(zReport.expected ?? 0).toFixed(2)} ₾</strong></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>ფაქტობრივი:</span> <strong>{Number(zReport.actual ?? 0).toFixed(2)} ₾</strong></div>
                  <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: (zReport.difference ?? 0) < 0 ? '#ef4444' : '#10b981' }}><span>სხვაობა:</span> <strong>{Number(zReport.difference ?? 0).toFixed(2)} ₾</strong></div>
                </div>
                {/* 🖨 Z-Report ბეჭდვის ღილაკი (Roadmap ეტაპი 7) — ზუსტად ის ციფრები
                    იბეჭდება, რაც ზემოთ მოდალშია ნაჩვენები (PrintableZReport). */}
                <button onClick={() => triggerPrint('zreport')} className={`${styles.btn} ${styles.btnSecondary}`} style={{ width: '100%', marginBottom: '10px' }}>🖨 Z-რეპორტის ბეჭდვა</button>
                <button onClick={() => { localStorage.removeItem('token'); window.location.reload(); }} className={`${styles.btn} ${styles.btnPrimary}`} style={{ width: '100%' }}>დასრულება და გასვლა</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 🔑 მენეჯერის PIN-ავტორიზაციის მოდალი (Roadmap ეტაპი 2 + 4) — ჩნდება, როცა
          უფლების არმქონე მოლარე ცდილობს ფასდაკლების ტიპის არჩევას ან ჩეკის გაუქმებას.
          🩹 FIX (z-index): ეს მოდალი ხშირად იხსნება "ჩემი ისტორია"-ს მოდალის *შიგნიდან*
          (void-receipt flow). ორივე იზიარებს .modalOverlay-ს იგივე base z-index-ით (9999),
          ამიტომ თანაბარი z-index-ის დროს მოგვიანებით DOM-ში ჩამონტაჟებული (historyModal)
          ყოველთვის ეხურებოდა ამას თავზე. ინლაინ zIndex-ი მკაცრად მაღლა სვამს ამ მოდალს
          ნებისმიერ სხვა .modalOverlay-ზე, მიუხედავად DOM-ში თანმიმდევრობისა. */}
      {showPinModal && (
        <div className={styles.modalOverlay} style={{ zIndex: 10050 }}>
          <div className={styles.modalBody}>
            <h3>🔑 საჭიროა მენეჯერის ავტორიზაცია</h3>
            <p style={{ color: '#64748b', fontSize: '14px', marginTop: 0 }}>
              {pinAction === 'void-receipt'
                ? 'ჩეკის გასაუქმებლად მენეჯერმა უნდა შეიყვანოს თავისი 4-ციფრიანი PIN-კოდი.'
                : pinAction === 'clear-cart'
                ? 'კალათის გასასუფთავებლად მენეჯერმა უნდა შეიყვანოს თავისი 4-ციფრიანი PIN-კოდი.'
                : pinAction === 'remove-item'
                ? 'პროდუქტის კალათიდან წასაშლელად მენეჯერმა უნდა შეიყვანოს თავისი 4-ციფრიანი PIN-კოდი.'
                : 'ფასდაკლების გამოსაყენებლად მენეჯერმა უნდა შეიყვანოს თავისი 4-ციფრიანი PIN-კოდი.'}
            </p>
            <form onSubmit={handleVerifyManagerPin}>
              <div className={styles.formGroup}>
                <label>PIN-კოდი</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoFocus
                  value={pinValue}
                  onChange={e => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className={styles.inputField}
                  placeholder="••••"
                  style={{ textAlign: 'center', fontSize: '22px', letterSpacing: '10px' }}
                />
              </div>
              {pinError && (
                <p style={{ color: '#ef4444', fontSize: '13px', margin: '-8px 0 12px 0' }}>{pinError}</p>
              )}
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
                <button type="button" onClick={closePinModal} className={`${styles.btn} ${styles.btnSecondary}`} style={{ flex: 1, minWidth: '120px' }}>
                  გაუქმება
                </button>
                <button
                  type="submit"
                  disabled={pinLoading || pinValue.length !== 4}
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  style={{ flex: 1, minWidth: '120px', opacity: pinLoading || pinValue.length !== 4 ? 0.6 : 1 }}
                >
                  {pinLoading ? 'მოწმდება...' : 'დადასტურება'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 📜 "ჩემი ისტორია" — მოლარის საკუთარი ჩეკების სია */}
      {showHistoryModal && (
        <div className={styles.modalOverlay}>
          <div className={`${styles.modalBody} ${styles.historyModalBody}`}>
            <div className={styles.historyHeader}>
              <h3>📜 მიმდინარე ცვლის ჩეკები</h3>
              <button
                onClick={() => { setShowHistoryModal(false); setExpandedReceiptId(null); }}
                className={styles.historyCloseBtn}
                aria-label="დახურვა"
              >×</button>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '13px', marginTop: '-8px', marginBottom: '15px' }}>
              ცვლა #{activeShift?.id} | გახსნილია: {activeShift?.opened_at}
            </p>

            <div className={styles.historySummaryBar}>
              <span>ჩეკები: <strong>{historySummary.totalReceipts}</strong></span>
              <span>ჯამური თანხა: <strong>{Number(historySummary.totalSum).toFixed(2)} ₾</strong></span>
            </div>

            <div className={styles.historyList}>
              {historyLoading ? (
                <p style={{ textAlign: 'center', color: '#94a3b8', padding: '20px' }}>იტვირთება...</p>
              ) : historyReceipts.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#94a3b8', padding: '20px' }}>ჩეკები ვერ მოიძებნა</p>
              ) : (
                paginatedReceipts.map(receipt => (
                  <div key={receipt.id} className={styles.receiptCard}>
                    <button className={styles.receiptHeader} onClick={() => toggleReceipt(receipt.id)}>
                      <div>
                        <strong>ჩეკი #{receipt.id}</strong>
                        <small>{receipt.created_at}</small>
                      </div>
                      <div className={styles.receiptHeaderRight}>
                        {/* 🧾 Roadmap ეტაპი 4 — გაუქმებული ჩეკის ბეიჯი, ჩანს კოლაფსშიც, გაშლის გარეშეც */}
                        {receipt.is_voided && (
                          <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: '50px', fontSize: '12px', fontWeight: 'bold' }}>
                            🚫 გაუქმებული
                          </span>
                        )}
                        {receipt.discount_type && receipt.discount_value ? (
                          <span style={{ background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '50px', fontSize: '12px', fontWeight: 'bold' }}>
                            {receipt.discount_type === 'percent' ? `-${receipt.discount_value}%` : `-${Number(receipt.discount_value).toFixed(2)} ₾`}
                          </span>
                        ) : null}
                        {/* 💰 Roadmap ეტაპი 8 — გადახდის მეთოდის ბეიჯი კოლაფსშიც ჩანს */}
                        {(() => {
                          const badge = paymentMethodBadge(receipt.payment_method);
                          return (
                            <span style={{ background: badge.bg, color: badge.color, padding: '2px 8px', borderRadius: '50px', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                              {badge.text}
                            </span>
                          );
                        })()}
                        <span className={styles.receiptTotal}>{Number(receipt.total_amount).toFixed(2)} ₾</span>
                        <span>{expandedReceiptId === receipt.id ? '▲' : '▼'}</span>
                      </div>
                    </button>

                    {expandedReceiptId === receipt.id && (
                      <>
                        <table className={styles.receiptItemsTable}>
                          <thead><tr><th>დასახელება</th><th>ფასი</th><th>რაოდ.</th><th>ჯამი</th></tr></thead>
                          <tbody>
                            {receipt.items.map((item, idx) => (
                              <tr key={idx}>
                                <td>{item.name}</td>
                                <td>{item.price} ₾</td>
                                <td>{item.quantity}</td>
                                <td className={styles.receiptItemTotal}>{(item.price * item.quantity).toFixed(2)} ₾</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {receipt.discount_type && receipt.discount_value ? (
                          <div style={{ fontSize: '13px', color: '#b45309', fontWeight: 'bold', padding: '8px 4px 0 4px' }}>
                            🏷 ფასდაკლება: {receipt.discount_type === 'percent' ? `${receipt.discount_value}%` : `${Number(receipt.discount_value).toFixed(2)} ₾`}
                            {' '}({Number(receipt.subtotal_amount ?? 0).toFixed(2)} ₾ → {Number(receipt.total_amount).toFixed(2)} ₾)
                          </div>
                        ) : null}
                        {/* 💰 Roadmap ეტაპი 8 — SPLIT ჩეკის ცალ-ცალკე ნაღდი/ბარათის ჩაშლა */}
                        {receipt.payment_method === 'split' && receipt.splits && (
                          <div style={{ fontSize: '13px', color: '#6d28d9', fontWeight: 'bold', padding: '8px 4px 0 4px', display: 'flex', gap: '16px' }}>
                            <span>🔀 შერეული:</span>
                            <span>💵 ნაღდი — {receipt.splits.cash.toFixed(2)} ₾</span>
                            <span>💳 ბარათი — {receipt.splits.card.toFixed(2)} ₾</span>
                          </div>
                        )}

                        {/* 🧾 ჩეკის გაუქმების ღილაკი (Roadmap ეტაპი 4) — უკვე გაუქმებულზე აღარ ჩანს.
                            canVoidReceipt === false-ის შემთხვევაში ღილაკი მაინც აქტიურია (დისკაუნთის
                            select-ის ანალოგიით) — დაჭერაზე მენეჯერის PIN მოდალი გაიხსნება. */}
                        {!receipt.is_voided && (
                          <button
                            type="button"
                            onClick={() => handleVoidReceiptClick(receipt.id)}
                            className={`${styles.btn} ${styles.btnDanger}`}
                            style={{ width: '100%', marginTop: '10px', fontSize: '13px' }}
                            title={!canVoidReceipt ? 'საჭიროა მენეჯერის ავტორიზაცია' : undefined}
                          >
                            🚫 ჩეკის გაუქმება{!canVoidReceipt ? ' (მენეჯერის PIN)' : ''}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* 📄 გვერდები — ჩანს მხოლოდ თუ ერთ გვერდზე მეტია */}
            {!historyLoading && historyReceipts.length > HISTORY_PAGE_SIZE && (
              <div className={styles.historyPagination}>
                <button
                  onClick={() => { setHistoryPage(p => Math.max(1, p - 1)); setExpandedReceiptId(null); }}
                  disabled={historyPage === 1}
                  className={styles.pageBtn}
                >‹ წინა</button>
                <span className={styles.pageInfo}>გვერდი {historyPage} / {totalHistoryPages}</span>
                <button
                  onClick={() => { setHistoryPage(p => Math.min(totalHistoryPages, p + 1)); setExpandedReceiptId(null); }}
                  disabled={historyPage === totalHistoryPages}
                  className={styles.pageBtn}
                >შემდეგი ›</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 🧾 ჩეკის გაუქმების დადასტურების მოდალი (Roadmap ეტაპი 4) — Products.tsx-ის
          confirmModal პატერნის ანალოგიით, window.confirm()-ის ნაცვლად.
          🩹 იგივე z-index FIX, რაც PIN მოდალშია — ესეც "ჩემი ისტორია"-ს მოდალის
          შიგნიდან იხსნება, ამიტომ იმ overlay-ს ყოველთვის თავზე უნდა ეხუროს. */}
      {voidConfirm.show && (
        <div className={styles.modalOverlay} style={{ zIndex: 10050 }}>
          <div className={styles.modalBody}>
            <h3>🚫 ჩეკის გაუქმება</h3>
            <p style={{ margin: '0 0 24px 0', color: '#1e293b', fontSize: '15px', lineHeight: 1.5 }}>
              ნამდვილად გსურთ ჩეკი #{voidConfirm.paymentId}-ის გაუქმება? პროდუქტების მარაგი
              ავტომატურად დაბრუნდება, მოქმედება კი ვერ გაუქმდება.
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button type="button" onClick={closeVoidConfirm} className={`${styles.btn} ${styles.btnSecondary}`} style={{ flex: 1, minWidth: '120px' }}>
                გაუქმება
              </button>
              <button type="button" onClick={confirmVoidReceipt} className={`${styles.btn} ${styles.btnDanger}`} style={{ flex: 1, minWidth: '120px' }}>
                დიახ, გავაუქმო
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🖨 Roadmap ეტაპი 7 — ეკრანზე დამალული (print.css-ის .print-area),
          ჩნდება მხოლოდ window.print()-ის დროს. printTarget განსაზღვრავს,
          რომელი ერთ-ერთი (არა ორივე ერთდროულად) უნდა დარენდერდეს. */}
      {printTarget === 'receipt' && lastReceipt && <PrintableReceipt receipt={lastReceipt} />}
      {printTarget === 'zreport' && zReport && (
        <PrintableZReport
          report={{
            shiftId: activeShift?.id,
            openedAt: activeShift?.opened_at,
            closedAt: shiftClosedAtDisplay,
            cashierName: myUsername || undefined,
            start: zReport.start,
            expected: zReport.expected,
            actual: zReport.actual,
            difference: zReport.difference,
            receiptCount: zReport.receiptCount,
          } satisfies PrintableZReportData}
        />
      )}
    </div>
  );
}
