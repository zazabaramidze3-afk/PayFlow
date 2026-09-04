// frontend/src/pages/OrderScreen.tsx
//
// 🍽️ HoReCa Module STEP 1 (Roadmap "03.09.2026") — კონკრეტული მაგიდის
// ღია შეკვეთის ეკრანი (Tables.tsx-იდან იხსნება მაგიდაზე დაჭერით).
//
// Checkout-ის ლოგიკა (ფასდაკლება + Manager PIN Override + cash/card/split
// გადახდა + ჩეკის ბეჭდვა) სრული პარიტეტით იმეორებს Sales.tsx-ის
// (Retail POS) დადასტურებულ, უკვე production-ში მომუშავე ლოგიკას — არა
// import-ით გაზიარებული (Sales.tsx მჭიდროდაა შეკრული cart/shift
// state-თან), არამედ ცალკე, თვითკმარი იმპლემენტაციით, რომ Retail-ის
// POS-ს ეს ცვლილება საერთოდ არ შეეხოს (0 რისკი არსებულ Sales.tsx-ზე).
// განსხვავებები Sales.tsx-თან შედარებით (განზრახ, ROADMAP-ის STEP 1
// scope-ის მიხედვით):
//   - "კალათა" აქ არ არსებობს ლოკალურ state-ში — თითოეული დამატებული
//     item მაშინვე APl-ზე იწერება (`order_items`), რომ STEP 2-ის KDS-მა
//     (kitchen_status) რეალურ დროში დაინახოს.
//   - Offline checkout აქ **არ არის მხარდაჭერილი** (ROADMAP-ის "Offline-ის
//     საზღვარი" — v1 non-goal). თუ POST ჩავარდება ქსელის მიზეზით,
//     უბრალო შეცდომის toast ჩანს (Sales.tsx-ის offline queue-ს ნაცვლად).

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import styles from './OrderScreen.module.scss';
import PrintableReceipt, { PrintableReceiptData } from '../components/PrintableReceipt';
import ConfirmModal from '../components/ConfirmModal';
import { RestaurantTable, OrderWithItems } from '../lib/horecaTypes';

interface Product { id: number; name: string; price: number; stock: number; }

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; }

type DiscountType = 'none' | 'percent' | 'fixed';
type PosPaymentMethod = 'cash' | 'card' | 'split';

interface OrderScreenProps {
  table: RestaurantTable;
  canManage: boolean;
  onBack: () => void;
  onOrderChanged: () => void;
}

export default function OrderScreen({ table, canManage, onBack, onOrderChanged }: OrderScreenProps) {
  const [loadingOrder, setLoadingOrder] = useState<boolean>(true);
  const [order, setOrder] = useState<OrderWithItems | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  // 🆕 ახალი შეკვეთის გახსნის ფორმა
  const [guestCountInput, setGuestCountInput] = useState<string>('');
  const [openingOrder, setOpeningOrder] = useState<boolean>(false);

  // ➕ item-ის დამატების ფორმა
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [itemQuantity, setItemQuantity] = useState<string>('1');
  const [itemNotes, setItemNotes] = useState<string>('');
  const [addingItem, setAddingItem] = useState<boolean>(false);

  // 🔐 ფასდაკლების უფლება — იგივე GET /api/me პატერნი, რაც Sales.tsx-შია.
  const [canUseDiscount, setCanUseDiscount] = useState<boolean>(false);
  const [myUsername, setMyUsername] = useState<string>('');

  // 💰 Checkout state — Sales.tsx-ის იდენტური.
  const [discountType, setDiscountType] = useState<DiscountType>('none');
  const [discountValue, setDiscountValue] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('cash');
  const [splitCashInput, setSplitCashInput] = useState<string>('');
  const [splitCardInput, setSplitCardInput] = useState<string>('');
  const [cashReceivedInput, setCashReceivedInput] = useState<string>('');
  const [checkingOut, setCheckingOut] = useState<boolean>(false);

  // 🔑 Manager PIN Override — მხოლოდ ფასდაკლების გეითისთვის (item-ის void-ს
  // აქ PIN არ სჭირდება, orders.ts-ის PATCH /orders/items/:id ნებისმიერ
  // ავტორიზებულ HoReCa-ორგანიზაციის user-ს დაუშვებს).
  const [managerOverrideToken, setManagerOverrideToken] = useState<string | null>(null);
  const [showPinModal, setShowPinModal] = useState<boolean>(false);
  const [pendingDiscountType, setPendingDiscountType] = useState<DiscountType>('none');
  const [pinValue, setPinValue] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [pinLoading, setPinLoading] = useState<boolean>(false);

  // 🧾 ბოლო ჩეკი — checkout-ის დასრულების შემდეგ (ბეჭდვისთვის). ამ
  // ეკრანზე დარჩენა (ავტომატური "უკან" ნავიგაციის გარეშე) საშუალებას
  // აძლევს მოლარეს ხელახლა დაბეჭდოს, თუ პრინტერი მზად არ იყო — Sales.tsx-ის
  // იგივე პრინციპი.
  const [lastReceipt, setLastReceipt] = useState<PrintableReceiptData | null>(null);
  const [orderClosed, setOrderClosed] = useState<boolean>(false);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  // 🩹 FIX (04.09.2026) — ზოგიერთი გაზიარებული/ძველი middleware
  // (მაგ. checkShift.ts-ის checkActiveShift, Sales.tsx-ის Retail POS-იც
  // მას იყენებს) 400/500 შეცდომას აბრუნებს `{ message: "..." }` ფორმით,
  // ჩვენი ახალი orders.ts/tables.ts-ის `{ error: "..." }" კონვენციის
  // ნაცვლად. აქამდე getErrorMessage მხოლოდ `.error`-ს კითხულობდა,
  // ამიტომ checkActiveShift-ის სასარგებლო ტექსტი ("ცვლის გახსნა
  // აუცილებელია") toast-ში საერთოდ არ ჩანდა — მომხმარებელი მხოლოდ
  // ზოგად "შეკვეთის გახსნა ვერ მოხერხდა"-ს ხედავდა.
  const getErrorMessage = (error: unknown): string | undefined => {
    if (!axios.isAxiosError<{ error?: string; message?: string }>(error)) return undefined;
    return error.response?.data?.error ?? error.response?.data?.message;
  };

  const fetchPermissions = useCallback(async () => {
    try {
      const response = await axios.get('/api/me');
      setCanUseDiscount(response.data?.can_use_discount === true);
      setMyUsername(typeof response.data?.username === 'string' ? response.data.username : '');
    } catch {
      // 🔐 კონსერვატიული default (false) უკვე useState-შია — ჩავარდნისას
      // ფასდაკლების უფლება უბრალოდ არ ჩაირთვება.
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const response = await axios.get<Product[]>('/api/products');
      setProducts(response.data);
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'პროდუქტების ჩატვირთვა ვერ მოხერხდა', 'error');
    }
  }, [showToast]);

  const fetchOrderForTable = useCallback(async () => {
    setLoadingOrder(true);
    try {
      const openOrders = await axios.get<Array<{ id: string; table_id: string | null }>>('/api/orders', {
        params: { status: 'open' },
      });
      const match = openOrders.data.find(o => o.table_id === table.id);
      if (!match) {
        setOrder(null);
        return;
      }
      const detail = await axios.get<OrderWithItems>(`/api/orders/${match.id}`);
      setOrder(detail.data);
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'შეკვეთის ჩატვირთვა ვერ მოხერხდა', 'error');
    } finally {
      setLoadingOrder(false);
    }
  }, [table.id, showToast]);

  useEffect(() => {
    fetchPermissions();
    fetchProducts();
    fetchOrderForTable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.id]);

  useEffect(() => {
    if (!canUseDiscount) {
      setDiscountType('none');
      setDiscountValue('');
    }
  }, [canUseDiscount]);

  useEffect(() => {
    if (lastReceipt) {
      setTimeout(() => window.print(), 150);
    }
  }, [lastReceipt]);

  const handleOpenOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    let guestCount: number | undefined;
    if (guestCountInput.trim() !== '') {
      const parsed = Number(guestCountInput);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return showToast('სტუმრების რაოდენობა არავალიდურია', 'error');
      }
      guestCount = parsed;
    }

    setOpeningOrder(true);
    try {
      const response = await axios.post<OrderWithItems>('/api/orders', { tableId: table.id, guestCount });
      setOrder({ ...response.data, items: [] });
      onOrderChanged();
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      if (message?.includes('ღია შეკვეთა')) {
        // 🏁 რასის პირობა — სხვა ტერმინალმა ჩვენზე ადრე გახსნა იმავე
        // მაგიდაზე. უბრალოდ ვცდით არსებულის ჩატვირთვას.
        fetchOrderForTable();
      } else {
        showToast(message || 'შეკვეთის გახსნა ვერ მოხერხდა', 'error');
      }
    } finally {
      setOpeningOrder(false);
    }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    if (!selectedProductId) return showToast('აირჩიეთ პროდუქტი', 'error');

    const parsedQuantity = Number(itemQuantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      return showToast('რაოდენობა უნდა იყოს დადებითი მთელი რიცხვი', 'error');
    }

    setAddingItem(true);
    try {
      await axios.post(`/api/orders/${order.id}/items`, {
        productId: Number(selectedProductId),
        quantity: parsedQuantity,
        notes: itemNotes.trim() || undefined,
      });
      setSelectedProductId('');
      setItemQuantity('1');
      setItemNotes('');
      await fetchOrderForTable();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'პროდუქტის დამატება ვერ მოხერხდა', 'error');
    } finally {
      setAddingItem(false);
    }
  };

  // 🩹 FIX (04.09.2026) — Sales.tsx-ის (Retail POS) "confirmModal" პატერნის
  // ანალოგიით: ბრაუზერის ნატიური `window.confirm()`-ის ნაცვლად (დიზაინთან
  // შეუსაბამო, ბრაუზერზე დამოკიდებული UI) გამოიყენება საერთო
  // `ConfirmModal` კომპონენტი (../components/ConfirmModal.tsx, გაზიარებული
  // Tables.tsx-თან). `confirmModal` state ინახავს მიმდინარე კითხვას და
  // callback-ს, რომელიც "დიახ"-ზე დაჭერისას გაეშვება.
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(
    null
  );
  const closeConfirmModal = () => setConfirmModal(null);

  const performVoidItem = async (itemId: string, itemName: string) => {
    try {
      await axios.patch(`/api/orders/items/${itemId}`, { void: true });
      showToast(`${itemName} გაუქმდა`, 'success');
      await fetchOrderForTable();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'გაუქმება ვერ მოხერხდა', 'error');
    }
  };

  const handleVoidItem = (itemId: string, itemName: string) => {
    setConfirmModal({
      title: '🚫 პროდუქტის გაუქმება',
      message: `გავაუქმოთ "${itemName}"?`,
      onConfirm: () => {
        closeConfirmModal();
        void performVoidItem(itemId, itemName);
      },
    });
  };

  const performVoidOrder = async () => {
    if (!order) return;
    try {
      await axios.post(`/api/orders/${order.id}/void`);
      showToast('შეკვეთა გაუქმდა', 'success');
      onOrderChanged();
      onBack();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'გაუქმება ვერ მოხერხდა', 'error');
    }
  };

  const handleVoidOrder = () => {
    if (!order) return;
    setConfirmModal({
      title: '🚫 შეკვეთის გაუქმება',
      message: 'გავაუქმოთ მთელი შეკვეთა? ეს მოქმედება შეუქცევადია.',
      onConfirm: () => {
        closeConfirmModal();
        void performVoidOrder();
      },
    });
  };

  // ==========================================
  // 💰 Checkout გამოთვლები — Sales.tsx-ის იდენტური ფორმულები, მხოლოდ
  // წყარო არის order.items (ვოიდირებულის გამოკლებით) ლოკალური "cart"-ის
  // ნაცვლად.
  // ==========================================
  const activeItems = (order?.items ?? []).filter(i => i.kitchen_status !== 'voided');
  const cartSubtotal = activeItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const parsedDiscountValue = parseFloat(discountValue) || 0;
  const canUseDiscountEffective = canUseDiscount || !!managerOverrideToken;

  let discountAmount = 0;
  if (canUseDiscountEffective && discountType === 'percent') {
    discountAmount = cartSubtotal * (Math.min(Math.max(parsedDiscountValue, 0), 100) / 100);
  } else if (canUseDiscountEffective && discountType === 'fixed') {
    discountAmount = Math.min(Math.max(parsedDiscountValue, 0), cartSubtotal);
  }
  const cartTotal = Math.max(0, cartSubtotal - discountAmount);

  const parsedSplitCash = Math.round((parseFloat(splitCashInput) || 0) * 100) / 100;
  const parsedSplitCard = Math.round((parseFloat(splitCardInput) || 0) * 100) / 100;
  const splitBothFilled = splitCashInput !== '' && splitCardInput !== '';
  const splitSum = Number((parsedSplitCash + parsedSplitCard).toFixed(2));
  const splitDiff = Number((splitSum - cartTotal).toFixed(2));

  const paymentMethodValid =
    activeItems.length > 0 &&
    (paymentMethod !== 'split' || (splitBothFilled && parsedSplitCash > 0 && parsedSplitCard > 0 && splitDiff === 0));

  const totalTetri = Math.round(cartTotal * 100);
  const parsedCashReceived = parseFloat(cashReceivedInput) || 0;
  const cashDueNow = paymentMethod === 'cash' ? cartTotal : paymentMethod === 'split' ? parsedSplitCash : 0;
  const changeDueNow = paymentMethod === 'card' ? 0 : Math.max(0, Number((parsedCashReceived - cashDueNow).toFixed(2)));

  // 💰 Sales.tsx-ის იდენტური SPLIT-ის ავტომატური ბალანსი (იქაური
  // handleSplitCardChange/handleSplitCashChange-ის ანარეკლი — 🩹 FIX
  // (04.09.2026), თავდაპირველ იმპლემენტაციაში ეს ორი handler-ი გამოტოვებული
  // იყო და ველები plain setState-ს იძახებდნენ, ანუ meoreiv ველი თვითონ არ
  // ითვლებოდა). ერთი ველის შეცვლისას მეორე ავტომატურად ხდება
  // (მთლიანი − შეყვანილი), ყველა არითმეტიკა თეთრებში (Math.round(v * 100)),
  // რომ float-ის დამრგვალების ცდომილება არ გაჟონოს UI-ში.
  const clampSplitTetri = (t: number) => Math.min(Math.max(t, 0), totalTetri);

  const handleSplitCardChange = (raw: string) => {
    setSplitCardInput(raw);
    const parsed = parseFloat(raw);
    const cardTetri = Number.isFinite(parsed) ? clampSplitTetri(Math.round(parsed * 100)) : 0;
    setSplitCashInput(((totalTetri - cardTetri) / 100).toFixed(2));
  };

  const handleSplitCashChange = (raw: string) => {
    setSplitCashInput(raw);
    const parsed = parseFloat(raw);
    const cashTetri = Number.isFinite(parsed) ? clampSplitTetri(Math.round(parsed * 100)) : 0;
    setSplitCardInput(((totalTetri - cashTetri) / 100).toFixed(2));
  };

  const handleDiscountTypeChange = (nextType: DiscountType) => {
    if (nextType !== 'none' && !canUseDiscountEffective) {
      setPendingDiscountType(nextType);
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
  };

  const handleVerifyManagerPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(pinValue)) {
      setPinError('PIN-კოდი უნდა შედგებოდეს ზუსტად 4 ციფრისგან!');
      return;
    }
    setPinLoading(true);
    setPinError('');
    try {
      const response = await axios.post('/api/auth/verify-manager-pin', { pin: pinValue });
      const overrideToken: string | undefined = response.data?.managerOverrideToken;
      if (response.data?.success && overrideToken) {
        setManagerOverrideToken(overrideToken);
        setDiscountType(pendingDiscountType);
        setDiscountValue('');
        showToast('მენეჯერის ავტორიზაცია დადასტურდა — ფასდაკლება დაშვებულია ამ ჩეკზე', 'success');
        closePinModal();
      }
    } catch (error: unknown) {
      setPinError(getErrorMessage(error) || 'PIN-კოდის შემოწმება ვერ მოხერხდა!');
      setPinValue('');
    } finally {
      setPinLoading(false);
    }
  };

  const handleCheckout = async () => {
    if (!order || activeItems.length === 0) return showToast('შეკვეთაში პროდუქტი არ არის', 'error');

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
    if (paymentMethod === 'split' && (!splitBothFilled || parsedSplitCash <= 0 || parsedSplitCard <= 0)) {
      return showToast('შეავსე ორივე ველი — ნაღდი და ბარათი', 'error');
    }
    if (paymentMethod === 'split' && splitDiff !== 0) {
      return showToast(
        `გადახდების ჯამი (${splitSum.toFixed(2)} ₾) არ ემთხვევა ჩეკის თანხას (${cartTotal.toFixed(2)} ₾)`,
        'error'
      );
    }

    const payload: {
      items: Array<{ productId: number; name: string; price: number; quantity: number }>;
      paymentMethod: PosPaymentMethod;
      orderId: string;
      discount?: { type: 'percent' | 'fixed'; value: number };
      splits?: { cash: number; card: number };
      cashReceived?: number;
    } = {
      items: activeItems.map(i => ({ productId: i.product_id, name: i.product_name, price: i.unit_price, quantity: i.quantity })),
      paymentMethod,
      orderId: order.id,
    };

    if (paymentMethod === 'split') {
      payload.splits = { cash: parsedSplitCash, card: parsedSplitCard };
    }
    if (paymentMethod === 'cash' && parsedCashReceived > 0) {
      payload.cashReceived = parsedCashReceived;
    }

    let usedOverrideToken = false;
    if (canUseDiscountEffective && discountType !== 'none' && parsedDiscountValue > 0) {
      payload.discount = { type: discountType, value: parsedDiscountValue };
      usedOverrideToken = !canUseDiscount && !!managerOverrideToken;
    }

    setCheckingOut(true);
    try {
      const response = await axios.post('/api/payments', payload, {
        headers: usedOverrideToken ? { 'X-Manager-Override': `Bearer ${managerOverrideToken}` } : undefined,
      });

      setLastReceipt({
        paymentId: response.data.paymentId,
        createdAt: new Date().toLocaleString('ka-GE', { hour12: false }),
        cashierName: myUsername || undefined,
        items: activeItems.map(i => ({ name: i.product_name, price: i.unit_price, quantity: i.quantity })),
        subtotalAmount: response.data.subtotalAmount ?? cartSubtotal,
        discountType: response.data.discountType ?? null,
        discountValue: response.data.discountValue ?? 0,
        discountAmount: response.data.discountAmount ?? 0,
        totalAmount: response.data.totalAmount ?? cartTotal,
        paymentMethod: response.data.paymentMethod,
        splits: response.data.splits,
        cashReceived: response.data.cashReceived,
        changeDue: response.data.changeDue,
      });

      showToast(`მაგიდა "${table.name}" — ჩეკი დაიხურა!`, 'success');
      setOrderClosed(true);
      setManagerOverrideToken(null);
      onOrderChanged();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'გადახდა ჩავარდა!', 'error');
    } finally {
      setCheckingOut(false);
    }
  };

  const handleBackToFloorPlan = () => {
    onOrderChanged();
    onBack();
  };

  const kitchenStatusClass = (status: string): string => {
    if (status === 'voided') return styles.kitchenBadgeVoided;
    if (status === 'pending') return styles.kitchenBadgePending;
    return styles.kitchenBadgeOther;
  };

  return (
    <div className={styles.orderContainer}>
      <div className={styles.topPanel}>
        <div>
          <h2>🍽️ {table.name}</h2>
          {order && <small>შეკვეთა #{order.id.slice(0, 8)} · გახსნილია: {order.opened_at}</small>}
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {order && !orderClosed && canManage && (
            <button onClick={handleVoidOrder} className={`${styles.btn} ${styles.btnDanger}`}>
              🚫 შეკვეთის გაუქმება
            </button>
          )}
          <button onClick={handleBackToFloorPlan} className={`${styles.btn} ${styles.btnSecondary}`}>
            🔙 მაგიდებზე დაბრუნება
          </button>
        </div>
      </div>

      {loadingOrder ? (
        <div className={styles.card}>იტვირთება...</div>
      ) : orderClosed ? (
        <div className={styles.openOrderCard}>
          <h3>✅ ჩეკი დაიხურა</h3>
          <p>მაგიდა "{table.name}" მონიშნულია როგორც "დასალაგებელი" — დალაგების შემდეგ ხელით შეცვალეთ სტატუსი "თავისუფალზე" (🍽️ მაგიდები გვერდზე).</p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '10px' }}>
            {lastReceipt && (
              <button onClick={() => window.print()} className={`${styles.btn} ${styles.btnSecondary}`}>
                🖨 ხელახლა ბეჭდვა
              </button>
            )}
            <button onClick={handleBackToFloorPlan} className={`${styles.btn} ${styles.btnPrimary}`}>
              🔙 მაგიდებზე დაბრუნება
            </button>
          </div>
        </div>
      ) : !order && canManage ? (
        // 🩹 FIX (04.09.2026) — Admin/Manager-ს ფიზიკურად არასდროს ექნება
        // აქტიური ცვლა (POST /shifts/open sales.ts:129-ზე მკაცრად
        // `role === 'cashier'`-ზეა შეზღუდული, ისევე როგორც Retail POS-ში
        // მხოლოდ cashier ყიდის) — ანუ checkActiveShift POST /orders-ზე
        // მათთვის ყოველთვის 400-ს დააბრუნებდა. ამიტომ self-service
        // "შეკვეთის გახსნა" ფორმა მათთვის საერთოდ არ ჩანს, პარიტეტში
        // "🛒 Sales (POS)" ნავიგაციასთან, რომელიც ასევე მხოლოდ cashier-ს
        // უჩანს (App.tsx).
        <div className={styles.openOrderCard}>
          <h3>მაგიდა თავისუფალია</h3>
          <p>
            ახალი შეკვეთის გახსნა შესაძლებელია მხოლოდ მოლარის (cashier) მიერ,
            საკუთარი გახსნილი ცვლიდან — ისევე, როგორც Retail POS-ში მხოლოდ
            cashier ყიდის. აქედან შეგიძლიათ მხოლოდ მაგიდის რედაქტირება/წაშლა
            ("🍽️ მაგიდები" გვერდზე) და უკვე გახსნილი შეკვეთის ზედამხედველობა.
          </p>
        </div>
      ) : !order ? (
        <div className={styles.openOrderCard}>
          <h3>ღია შეკვეთა არ არსებობს</h3>
          <p>ახალი შეკვეთის გასახსნელად შეავსეთ სტუმრების რაოდენობა (არასავალდებულო) და დააჭირეთ ღილაკს.</p>
          <form onSubmit={handleOpenOrder}>
            <div className={styles.formGroup}>
              <label>სტუმრების რაოდენობა</label>
              <input
                type="number"
                min="1"
                value={guestCountInput}
                onChange={e => setGuestCountInput(e.target.value)}
                className={styles.inputField}
                placeholder="2"
              />
            </div>
            <button type="submit" disabled={openingOrder} className={`${styles.btn} ${styles.btnSuccess}`} style={{ width: '100%' }}>
              {openingOrder ? 'იხსნება...' : '🚀 შეკვეთის გახსნა'}
            </button>
          </form>
        </div>
      ) : (
        <div className={styles.mainGrid}>
          <div className={styles.card}>
            <h3 style={{ marginTop: 0 }}>➕ პროდუქტის დამატება</h3>
            <form onSubmit={handleAddItem}>
              <div className={styles.formGroup}>
                <label>პროდუქტი</label>
                <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)} className={styles.inputField}>
                  <option value="">-- აირჩიეთ სიიდან --</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} · {p.price}₾</option>
                  ))}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>რაოდენობა</label>
                <input type="number" min="1" value={itemQuantity} onChange={e => setItemQuantity(e.target.value)} className={styles.inputField} />
              </div>
              <div className={styles.formGroup}>
                <label>შენიშვნა (არასავალდებულო)</label>
                <input
                  type="text"
                  value={itemNotes}
                  onChange={e => setItemNotes(e.target.value)}
                  className={styles.inputField}
                  placeholder="medium rare, ცხარის გარეშე..."
                />
              </div>
              <button type="submit" disabled={addingItem} className={`${styles.btn} ${styles.btnPrimary}`} style={{ width: '100%' }}>
                {addingItem ? 'ემატება...' : 'დამატება'}
              </button>
            </form>
          </div>

          <div className={styles.card}>
            <h3 style={{ marginTop: 0 }}>📝 მიმდინარე შეკვეთა</h3>
            {order.items.length === 0 ? (
              <p style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>ჯერ არაფერია დამატებული</p>
            ) : (
              <>
                <div className={styles.itemsTableWrapper}>
                  <table className={styles.itemsTable}>
                    <thead>
                      <tr><th>დასახელება</th><th>რაოდ.</th><th>ჯამი</th><th>სტატუსი</th><th></th></tr>
                    </thead>
                    <tbody>
                      {order.items.map(item => (
                        <tr key={item.id} style={item.kitchen_status === 'voided' ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                          <td>{item.product_name}{item.notes && <div style={{ fontSize: '12px', color: '#94a3b8' }}>{item.notes}</div>}</td>
                          <td className={styles.nowrapCell}>{item.quantity} ც.</td>
                          <td className={styles.nowrapCell}>{(item.unit_price * item.quantity).toFixed(2)} ₾</td>
                          <td className={styles.nowrapCell}><span className={kitchenStatusClass(item.kitchen_status)}>{item.kitchen_status}</span></td>
                          <td>
                            {item.kitchen_status !== 'voided' && (
                              <button
                                onClick={() => handleVoidItem(item.id, item.product_name)}
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                                title="გაუქმება"
                              >
                                ❌
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', gap: '10px', margin: '15px 0 5px 0', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className={styles.formGroup} style={{ flex: 1, minWidth: '160px', marginBottom: 0 }}>
                    <label>🏷️ ფასდაკლება</label>
                    <select
                      value={discountType}
                      onChange={e => handleDiscountTypeChange(e.target.value as DiscountType)}
                      className={styles.inputField}
                      title={!canUseDiscountEffective ? 'საჭიროა მენეჯერის ავტორიზაცია' : undefined}
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

                <div style={{ margin: '15px 0 5px 0' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#475569' }}>💰 გადახდის მეთოდი</label>
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
                          if (value === 'split') {
                            setSplitCardInput((totalTetri / 100).toFixed(2));
                            setSplitCashInput('0.00');
                          }
                          if (value !== 'cash') setCashReceivedInput('');
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
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <div className={styles.formGroup} style={{ flex: 1, minWidth: '140px' }}>
                        <label>ნაღდი ნაწილი (₾)</label>
                        <input type="number" min="0" step="0.01" value={splitCashInput} onChange={e => handleSplitCashChange(e.target.value)} className={styles.inputField} />
                      </div>
                      <div className={styles.formGroup} style={{ flex: 1, minWidth: '140px' }}>
                        <label>ბარათის ნაწილი (₾)</label>
                        <input type="number" min="0" step="0.01" value={splitCardInput} onChange={e => handleSplitCardChange(e.target.value)} className={styles.inputField} />
                      </div>
                    </div>
                    <p style={{ margin: '6px 0 0 0', fontSize: '13px', fontWeight: 'bold', color: !splitBothFilled ? '#94a3b8' : paymentMethodValid ? '#166534' : '#ef4444' }}>
                      {!splitBothFilled
                        ? 'შეავსე ორივე ველი'
                        : paymentMethodValid
                        ? '✓ ჯამი ემთხვევა ჩეკის თანხას'
                        : parsedSplitCash <= 0 || parsedSplitCard <= 0
                        ? 'ორივე ნაწილი დადებითი უნდა იყოს (0.01 ₾-ზე მეტი)'
                        : `სხვაობა: ${splitDiff > 0 ? '+' : ''}${splitDiff.toFixed(2)} ₾`}
                    </p>
                  </div>
                )}

                <button
                  onClick={handleCheckout}
                  disabled={!paymentMethodValid || checkingOut}
                  className={`${styles.btn} ${styles.btnSuccess}`}
                  style={{ width: '100%', padding: '14px', fontSize: '16px', marginTop: '10px', opacity: paymentMethodValid ? 1 : 0.6, whiteSpace: 'normal' }}
                >
                  {checkingOut ? 'მუშავდება...' : 'ჩეკის დახურვა (ბეჭდვა)'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {showPinModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBody}>
            <h3>🔑 საჭიროა მენეჯერის ავტორიზაცია</h3>
            <p style={{ color: '#64748b', fontSize: '14px', marginTop: 0 }}>
              ფასდაკლების გამოსაყენებლად მენეჯერმა უნდა შეიყვანოს თავისი 4-ციფრიანი PIN-კოდი.
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
              {pinError && <p style={{ color: '#ef4444', fontSize: '13px', margin: '-8px 0 12px 0' }}>{pinError}</p>}
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
                <button type="button" onClick={closePinModal} className={`${styles.btn} ${styles.btnSecondary}`} style={{ flex: 1, minWidth: '120px' }}>
                  გაუქმება
                </button>
                <button type="submit" disabled={pinLoading || pinValue.length !== 4} className={`${styles.btn} ${styles.btnPrimary}`} style={{ flex: 1, minWidth: '120px' }}>
                  {pinLoading ? 'მოწმდება...' : 'დადასტურება'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {toasts.map(t => (
            <div
              key={t.id}
              style={{
                padding: '10px 18px',
                borderRadius: '10px',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 600,
                background: t.type === 'success' ? '#16a34a' : t.type === 'error' ? '#dc2626' : '#334155',
                boxShadow: '0 6px 16px rgba(0,0,0,0.15)',
              }}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}

      {lastReceipt && <PrintableReceipt receipt={lastReceipt} />}

      <ConfirmModal
        open={!!confirmModal}
        title={confirmModal?.title ?? ''}
        message={confirmModal?.message ?? ''}
        onConfirm={() => confirmModal?.onConfirm()}
        onCancel={closeConfirmModal}
      />
    </div>
  );
}
