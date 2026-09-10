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
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import styles from './OrderScreen.module.scss';
import PrintableReceipt, { PrintableReceiptData, PrintableSplitReceipts } from '../components/PrintableReceipt';
import ConfirmModal from '../components/ConfirmModal';
import SplitBillModal, { SplitSuccessResult } from '../components/SplitBillModal';
import { RestaurantTable, OrderWithItems, ModifierGroupWithOptions } from '../lib/horecaTypes';

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
  const { t } = useTranslation();
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
  // 🍴 HoReCa STEP 4 (Roadmap "03.09.2026", migration 023) — არასავალდებულო
  // ადგილის ნომერი (seat), საჭირო მხოლოდ item-ის მიხედვით ჩეკის
  // გასაყოფად ('byItem' split-ისთვის ქვემოთ). ცარიელი დარჩენისას
  // (ძველი ქცევა) backend-ს NULL მიდის, ისევე როგორც აქამდე.
  const [itemSeatNumber, setItemSeatNumber] = useState<string>('');
  const [itemNotes, setItemNotes] = useState<string>('');
  const [addingItem, setAddingItem] = useState<boolean>(false);

  // 🧩 STEP 3.1 (მოდიფაიერები, Roadmap "03.09.2026", migration 021) —
  // არჩეული პროდუქტის მიბმული ჯგუფები (GET /modifiers/products/:id) და
  // მათგან არჩეული option-ების id-ები. `single`-ისთვის radio (+ "არცერთი"
  // ვარიანტი, თუ ჯგუფი არასავალდებულოა), `multiple`-ისთვის checkbox-ები.
  const [productModifierGroups, setProductModifierGroups] = useState<ModifierGroupWithOptions[]>([]);
  const [selectedModifierOptionIds, setSelectedModifierOptionIds] = useState<string[]>([]);
  const [loadingModifiers, setLoadingModifiers] = useState<boolean>(false);

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
  // 🍴 HoReCa STEP 4 (Roadmap "03.09.2026", migration 023) —
  // არასავალდებულო tip, ჩვეულებრივ (არა-გახლეჩილ) checkout-ზე.
  const [tipAmountInput, setTipAmountInput] = useState<string>('');
  const [checkingOut, setCheckingOut] = useState<boolean>(false);
  const [showSplitModal, setShowSplitModal] = useState<boolean>(false);

  // 🔑 Manager PIN Override — ორი დამოუკიდებელი gate იზიარებს ერთსა და
  // იმავე PIN-modal-ს: (ა) ფასდაკლება (pendingDiscountType), (ბ) item-level
  // void 'pending'-ზე მეტ kitchen_status-ზე (pendingVoidItem — ROADMAP
  // "HoReCa Open Items - 06.09.2026.md", #2). ორივესთვის ცალკე token
  // მოიპოვება (single-use, backend-ზე consumeOverrideToken-ით იჭრება),
  // ამიტომ void-token არ ინახება managerOverrideToken-ში, რომ ერთხელ
  // მოხმარებული ტოკენი შემთხვევით ხელახლა (discount/checkout-ზე) არ
  // ეცადოს გამოყენებას.
  const [managerOverrideToken, setManagerOverrideToken] = useState<string | null>(null);
  const [showPinModal, setShowPinModal] = useState<boolean>(false);
  const [pendingDiscountType, setPendingDiscountType] = useState<DiscountType>('none');
  const [pendingVoidItem, setPendingVoidItem] = useState<{ id: string; name: string } | null>(null);
  const [pinValue, setPinValue] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [pinLoading, setPinLoading] = useState<boolean>(false);

  // 🧾 ბოლო ჩეკი — checkout-ის დასრულების შემდეგ (ბეჭდვისთვის). ამ
  // ეკრანზე დარჩენა (ავტომატური "უკან" ნავიგაციის გარეშე) საშუალებას
  // აძლევს მოლარეს ხელახლა დაბეჭდოს, თუ პრინტერი მზად არ იყო — Sales.tsx-ის
  // იგივე პრინციპი.
  const [lastReceipt, setLastReceipt] = useState<PrintableReceiptData | null>(null);
  // 🍽️ HoReCa STEP 4 (06.09.2026) — ჩეკის გაყოფის (split bill) ბეჭდვადი
  // ჩეკები. `lastReceipt`-ისგან განსხვავებით მასივია (თითო ნაწილზე ერთი
  // ჩეკი), იბეჭდება ერთდროულად `PrintableSplitReceipts`-ით (page-break-ებით
  // გამოყოფილი, ერთი `.print-area`-ს შიგნით — print.css-ის
  // `position: absolute` შეზღუდვის გამო, იხ. PrintableReceipt.tsx).
  const [splitReceipts, setSplitReceipts] = useState<PrintableReceiptData[]>([]);
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
      showToast(getErrorMessage(error) || t('orderScreen.toasts.loadProductsFailed'), 'error');
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
      showToast(getErrorMessage(error) || t('orderScreen.toasts.loadOrderFailed'), 'error');
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

  // 🧩 STEP 3.1 — პროდუქტის არჩევისთანავე ვტვირთავთ მასზე მიბმულ
  // მოდიფაიერების ჯგუფებს. პროდუქტის გადართვისას წინა არჩევანი ყოველთვის
  // ცარიელდება — სხვა პროდუქტის option-ის id აქ აზრს კარგავს.
  useEffect(() => {
    setSelectedModifierOptionIds([]);
    if (!selectedProductId) {
      setProductModifierGroups([]);
      return;
    }
    let cancelled = false;
    setLoadingModifiers(true);
    axios
      .get<ModifierGroupWithOptions[]>(`/api/modifiers/products/${selectedProductId}`)
      .then(response => {
        if (!cancelled) setProductModifierGroups(response.data);
      })
      .catch(() => {
        if (!cancelled) setProductModifierGroups([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingModifiers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProductId]);

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

  useEffect(() => {
    if (splitReceipts.length > 0) {
      setTimeout(() => window.print(), 150);
    }
  }, [splitReceipts]);

  const handleOpenOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    let guestCount: number | undefined;
    if (guestCountInput.trim() !== '') {
      const parsed = Number(guestCountInput);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return showToast(t('orderScreen.toasts.invalidGuestCount'), 'error');
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
        showToast(message || t('orderScreen.toasts.openOrderFailed'), 'error');
      }
    } finally {
      setOpeningOrder(false);
    }
  };

  // 🧩 STEP 3.1 — `single` ჯგუფებში ერთდროულად მხოლოდ ერთი option ამ
  // ჯგუფიდან შეიძლება იყოს არჩეული (ახალი არჩევანი ჯგუფის დანარჩენებს
  // ცვლის); `multiple`-ში თავისუფლად ემატება/იშლება.
  const toggleModifierOption = (group: ModifierGroupWithOptions, optionId: string) => {
    setSelectedModifierOptionIds(prev => {
      if (group.selection_type === 'single') {
        const withoutGroup = prev.filter(id => !group.options.some(o => o.id === id));
        return prev.includes(optionId) ? withoutGroup : [...withoutGroup, optionId];
      }
      return prev.includes(optionId) ? prev.filter(id => id !== optionId) : [...prev, optionId];
    });
  };

  const missingRequiredModifierGroup = productModifierGroups.find(
    group => group.is_required && !group.options.some(o => selectedModifierOptionIds.includes(o.id))
  );

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    if (!selectedProductId) return showToast(t('sales.toasts.selectProductFirst'), 'error');

    const parsedQuantity = Number(itemQuantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      return showToast(t('orderScreen.toasts.invalidItemQuantity'), 'error');
    }
    if (missingRequiredModifierGroup) {
      return showToast(t('orderScreen.toasts.modifierGroupRequired', { name: missingRequiredModifierGroup.name }), 'error');
    }

    setAddingItem(true);
    try {
      await axios.post(`/api/orders/${order.id}/items`, {
        productId: Number(selectedProductId),
        quantity: parsedQuantity,
        notes: itemNotes.trim() || undefined,
        seatNumber: itemSeatNumber.trim() || undefined,
        modifierOptionIds: selectedModifierOptionIds.length > 0 ? selectedModifierOptionIds : undefined,
      });
      setSelectedProductId('');
      setItemQuantity('1');
      setItemNotes('');
      setItemSeatNumber('');
      setSelectedModifierOptionIds([]);
      await fetchOrderForTable();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || t('orderScreen.toasts.addItemFailed'), 'error');
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

  const performVoidItem = async (itemId: string, itemName: string, overrideToken?: string) => {
    try {
      await axios.patch(
        `/api/orders/items/${itemId}`,
        { void: true },
        overrideToken ? { headers: { 'X-Manager-Override': `Bearer ${overrideToken}` } } : undefined
      );
      showToast(t('orderScreen.toasts.itemVoided', { name: itemName }), 'success');
      await fetchOrderForTable();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || t('orderScreen.toasts.voidFailed'), 'error');
    }
  };

  // 🔐 ROADMAP "HoReCa Open Items - 06.09.2026.md", #2 — PIN საჭიროა
  // მხოლოდ მაშინ, თუ item უკვე 'pending'-ზე მეტშია (სამზარეულოში
  // გაგზავნილი/მომზადებული/მიტანილი) და მიმდინარე user არც admin/manager-ია
  // (`canManage`, backend-ზე იგივე შემოწმებაა `orders.ts`-ში). Pending
  // item-ის წაშლა (jერ გაგზავნილი არ არის) ჩვეულებრივი order-შესწორებაა —
  // PIN-ის გარეშე.
  const handleVoidItem = (itemId: string, itemName: string, kitchenStatus: string) => {
    const needsManagerOverride = kitchenStatus !== 'pending' && !canManage;

    if (needsManagerOverride) {
      setPendingVoidItem({ id: itemId, name: itemName });
      setPinValue('');
      setPinError('');
      setShowPinModal(true);
      return;
    }

    setConfirmModal({
      title: t('orderScreen.voidItemConfirmTitle'),
      message: t('orderScreen.voidItemConfirmMessage', { name: itemName }),
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
      showToast(t('orderScreen.toasts.orderVoided'), 'success');
      onOrderChanged();
      onBack();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || t('orderScreen.toasts.voidFailed'), 'error');
    }
  };

  const handleVoidOrder = () => {
    if (!order) return;
    setConfirmModal({
      title: t('orderScreen.voidOrderButton'),
      message: t('orderScreen.voidOrderConfirmMessage'),
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
    setPendingVoidItem(null);
  };

  const handleVerifyManagerPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(pinValue)) {
      setPinError(t('sales.toasts.pinLength'));
      return;
    }
    setPinLoading(true);
    setPinError('');
    try {
      const response = await axios.post('/api/auth/verify-manager-pin', { pin: pinValue });
      const overrideToken: string | undefined = response.data?.managerOverrideToken;
      if (response.data?.success && overrideToken) {
        if (pendingVoidItem) {
          // Void-ტოკენს შეგნებულად არ ვინახავთ managerOverrideToken-ში
          // (იხ. state-ის კომენტარი ზემოთ) — პირდაპირ ვიყენებთ ამ
          // ერთჯერად void-request-ზე.
          const { id, name } = pendingVoidItem;
          closePinModal();
          await performVoidItem(id, name, overrideToken);
        } else {
          setManagerOverrideToken(overrideToken);
          setDiscountType(pendingDiscountType);
          setDiscountValue('');
          showToast(t('sales.toasts.discountOverrideGranted'), 'success');
          closePinModal();
        }
      }
    } catch (error: unknown) {
      setPinError(getErrorMessage(error) || t('sales.toasts.pinVerifyFailed'));
      setPinValue('');
    } finally {
      setPinLoading(false);
    }
  };

  const handleCheckout = async () => {
    if (!order || activeItems.length === 0) return showToast(t('orderScreen.toasts.noItemsInOrder'), 'error');

    if (!canUseDiscountEffective && discountType !== 'none') {
      setDiscountType('none');
      setDiscountValue('');
      return showToast(t('sales.toasts.discountNotAllowed'), 'error');
    }
    if (discountType === 'percent' && (parsedDiscountValue < 0 || parsedDiscountValue > 100)) {
      return showToast(t('sales.toasts.discountPercentRange'), 'error');
    }
    if (discountType === 'fixed' && parsedDiscountValue > cartSubtotal) {
      return showToast(t('sales.toasts.discountExceedsTotal'), 'error');
    }
    if (paymentMethod === 'split' && (!splitBothFilled || parsedSplitCash <= 0 || parsedSplitCard <= 0)) {
      return showToast(t('sales.toasts.fillBothSplitFields'), 'error');
    }
    if (paymentMethod === 'split' && splitDiff !== 0) {
      return showToast(
        t('sales.toasts.splitMismatch', { sum: splitSum.toFixed(2), total: cartTotal.toFixed(2) }),
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
      tipAmount?: number;
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
    const parsedTipAmount = Number(tipAmountInput);
    if (tipAmountInput.trim() !== '' && Number.isFinite(parsedTipAmount) && parsedTipAmount > 0) {
      payload.tipAmount = parsedTipAmount;
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
        tipAmount: payload.tipAmount,
      });

      showToast(t('orderScreen.toasts.tableClosed', { name: table.name }), 'success');
      setOrderClosed(true);
      setManagerOverrideToken(null);
      setTipAmountInput('');
      onOrderChanged();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || t('orderScreen.toasts.paymentFailed'), 'error');
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
          {order && <small>{t('orderScreen.orderIdOpened', { id: order.id.slice(0, 8), time: order.opened_at })}</small>}
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {order && !orderClosed && canManage && (
            <button onClick={handleVoidOrder} className={`${styles.btn} ${styles.btnDanger}`}>
              {t('orderScreen.voidOrderButton')}
            </button>
          )}
          <button onClick={handleBackToFloorPlan} className={`${styles.btn} ${styles.btnSecondary}`}>
            {t('orderScreen.backToFloorPlan')}
          </button>
        </div>
      </div>

      {loadingOrder ? (
        <div className={styles.card}>{t('nav.loading')}</div>
      ) : orderClosed ? (
        <div className={styles.openOrderCard}>
          <h3>{t('orderScreen.orderClosedTitle')}</h3>
          <p>{t('orderScreen.orderClosedDesc', { name: table.name })}</p>
          {/* 🩹 FIX (06.09.2026) — .openOrderCard-ის max-width: 420px-ში
              (padding 40px-ის გამოკლებით ~340px სივრცე) 2 გრძელტექსტიანი
              ღილაკი (მაგ. "🖨 ჩეკების ხელახლა ბეჭდვა (2)" + "🔙 მაგიდებზე
              დაბრუნება") ერთ ხაზზე ვერ ეტეოდა — .btn-ს (mixins.scss)
              ნაგულისხმევად `white-space: nowrap` აქვს, `flex-wrap` კი აქ
              დაყენებული არ იყო, ამიტომ ღილაკები ბარათის საზღვრებს გარეთ
              გადიოდა ვიზუალურად. `flexWrap: 'wrap'` ამატებს — თუ ერთ
              ხაზზე არ ეტევა, შემდეგ ხაზზე გადადის, ბარათს არ სცილდება. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', marginTop: '10px' }}>
            {lastReceipt && (
              <button onClick={() => window.print()} className={`${styles.btn} ${styles.btnSecondary}`}>
                {t('orderScreen.reprintButton')}
              </button>
            )}
            {splitReceipts.length > 0 && (
              <button onClick={() => window.print()} className={`${styles.btn} ${styles.btnSecondary}`}>
                {t('orderScreen.reprintSplitButton', { count: splitReceipts.length })}
              </button>
            )}
            <button onClick={handleBackToFloorPlan} className={`${styles.btn} ${styles.btnPrimary}`}>
              {t('orderScreen.backToFloorPlan')}
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
          <h3>{t('orderScreen.tableFreeTitle')}</h3>
          <p>{t('orderScreen.tableFreeDesc')}</p>
        </div>
      ) : !order ? (
        <div className={styles.openOrderCard}>
          <h3>{t('orderScreen.noOpenOrderTitle')}</h3>
          <p>{t('orderScreen.noOpenOrderDesc')}</p>
          <form onSubmit={handleOpenOrder}>
            <div className={styles.formGroup}>
              <label>{t('orderScreen.guestCountLabel')}</label>
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
              {openingOrder ? t('orderScreen.openingOrderButton') : t('orderScreen.openOrderButton')}
            </button>
          </form>
        </div>
      ) : (
        <div className={styles.mainGrid}>
          <div className={styles.card}>
            <h3 style={{ marginTop: 0 }}>{t('orderScreen.addItemTitle')}</h3>
            <form onSubmit={handleAddItem}>
              <div className={styles.formGroup}>
                <label>{t('orderScreen.productLabel')}</label>
                <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)} className={styles.inputField}>
                  <option value="">{t('sales.selectFromList')}</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} · {p.price}₾</option>
                  ))}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>{t('sales.quantity')}</label>
                <input type="number" min="1" value={itemQuantity} onChange={e => setItemQuantity(e.target.value)} className={styles.inputField} />
              </div>
              <div className={styles.formGroup}>
                <label>{t('orderScreen.seatNumberLabel')}</label>
                <input
                  type="number"
                  min="1"
                  value={itemSeatNumber}
                  onChange={e => setItemSeatNumber(e.target.value)}
                  className={styles.inputField}
                  placeholder={t('orderScreen.seatNumberPlaceholder')}
                />
              </div>

              {/* 🧩 STEP 3.1 (მოდიფაიერები) — მხოლოდ მაშინ ჩანს, თუ
                  არჩეულ პროდუქტს აქვს მიბმული ჯგუფი. `single` → radio
                  (+ "არცერთი", თუ არასავალდებულოა), `multiple` → checkbox. */}
              {loadingModifiers ? (
                <p style={{ color: '#94a3b8', fontSize: '13px' }}>{t('orderScreen.loadingModifiers')}</p>
              ) : (
                productModifierGroups.map(group => (
                  <div key={group.id} className={styles.formGroup}>
                    <label>
                      {group.name}
                      {group.is_required && <span style={{ color: '#ef4444' }}> *</span>}
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {group.selection_type === 'single' && !group.is_required && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 400 }}>
                          <input
                            type="radio"
                            name={`modifier-group-${group.id}`}
                            checked={!group.options.some(o => selectedModifierOptionIds.includes(o.id))}
                            onChange={() => setSelectedModifierOptionIds(prev => prev.filter(id => !group.options.some(o => o.id === id)))}
                          />
                          {t('orderScreen.modifierNone')}
                        </label>
                      )}
                      {group.options.map(option => (
                        <label key={option.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 400 }}>
                          <input
                            type={group.selection_type === 'single' ? 'radio' : 'checkbox'}
                            name={group.selection_type === 'single' ? `modifier-group-${group.id}` : undefined}
                            checked={selectedModifierOptionIds.includes(option.id)}
                            onChange={() => toggleModifierOption(group, option.id)}
                          />
                          {option.name}
                          {option.price_delta !== 0 && (
                            <span style={{ color: '#64748b' }}>
                              ({option.price_delta > 0 ? '+' : ''}{option.price_delta.toFixed(2)} ₾)
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              )}

              <div className={styles.formGroup}>
                <label>{t('orderScreen.notesLabel')}</label>
                <input
                  type="text"
                  value={itemNotes}
                  onChange={e => setItemNotes(e.target.value)}
                  className={styles.inputField}
                  placeholder={t('orderScreen.notesPlaceholder')}
                />
              </div>
              <button type="submit" disabled={addingItem || !!missingRequiredModifierGroup} className={`${styles.btn} ${styles.btnPrimary}`} style={{ width: '100%' }}>
                {addingItem ? t('orderScreen.addingButton') : t('orderScreen.addButton')}
              </button>
            </form>
          </div>

          <div className={styles.card}>
            <h3 style={{ marginTop: 0 }}>{t('orderScreen.currentOrderTitle')}</h3>
            {order.items.length === 0 ? (
              <p style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>{t('orderScreen.noItemsYet')}</p>
            ) : (
              <>
                <div className={styles.itemsTableWrapper}>
                  <table className={styles.itemsTable}>
                    <thead>
                      <tr><th>{t('sales.tableName')}</th><th>{t('sales.tableQty')}</th><th>{t('sales.tableTotal')}</th><th>{t('orderScreen.statusHeader')}</th><th></th></tr>
                    </thead>
                    <tbody>
                      {order.items.map(item => (
                        <tr key={item.id} style={item.kitchen_status === 'voided' ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                          <td>
                            {item.product_name}
                            {item.seat_number !== null && (
                              <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 700, color: '#2563EB', background: 'rgba(37, 99, 235, 0.08)', borderRadius: '4px', padding: '1px 6px' }}>
                                🍴 {item.seat_number}
                              </span>
                            )}
                            {item.modifiers.length > 0 && (
                              <div style={{ fontSize: '12px', color: '#64748b' }}>
                                {item.modifiers.map(m => m.name).join(', ')}
                              </div>
                            )}
                            {item.notes && <div style={{ fontSize: '12px', color: '#94a3b8' }}>{item.notes}</div>}
                          </td>
                          <td className={styles.nowrapCell}>{item.quantity} {t('sales.unitPcs')}</td>
                          <td className={styles.nowrapCell}>{(item.unit_price * item.quantity).toFixed(2)} ₾</td>
                          <td className={styles.nowrapCell}><span className={kitchenStatusClass(item.kitchen_status)}>{t(`common.kitchenStatus.${item.kitchen_status}`)}</span></td>
                          <td>
                            {item.kitchen_status !== 'voided' && (
                              <button
                                onClick={() => handleVoidItem(item.id, item.product_name, item.kitchen_status)}
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                                title={t('common.cancel')}
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
                    <label>{t('sales.discountLabel')}</label>
                    <select
                      value={discountType}
                      onChange={e => handleDiscountTypeChange(e.target.value as DiscountType)}
                      className={styles.inputField}
                      title={!canUseDiscountEffective ? t('common.managerAuthRequired') : undefined}
                    >
                      <option value="none">{t('sales.discountNone')}</option>
                      <option value="percent">{t('sales.discountPercent')}</option>
                      <option value="fixed">{t('sales.discountFixed')}</option>
                    </select>
                  </div>
                  {canUseDiscountEffective && discountType !== 'none' && (
                    <div className={styles.formGroup} style={{ flex: 1, minWidth: '140px', marginBottom: 0 }}>
                      <label>{discountType === 'percent' ? t('sales.discountAmountPercent') : t('sales.discountAmountFixed')}</label>
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
                    {t('sales.discountLockedNote')}
                  </p>
                )}

                <div className={styles.totalSection} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
                  {discountAmount > 0 && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '14px' }}>
                        <span>{t('sales.subtotalBeforeDiscount')}</span>
                        <span>{cartSubtotal.toFixed(2)} ₾</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#b45309', fontSize: '14px' }}>
                        <span>{t('sales.discountRow', { percent: discountType === 'percent' ? ` (${parsedDiscountValue}%)` : '' })}</span>
                        <span>-{discountAmount.toFixed(2)} ₾</span>
                      </div>
                    </>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className={styles.totalLabel}>{t('sales.totalDue')}</span>
                    <span className={styles.totalValue}>{cartTotal.toFixed(2)} ₾</span>
                  </div>
                </div>

                <div style={{ margin: '15px 0 5px 0' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#475569' }}>{t('sales.paymentMethodLabel')}</label>
                  <div role="radiogroup" aria-label={t('sales.paymentMethodLabel')} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {(
                      [
                        { value: 'cash', label: t('sales.paymentBadge.cash') },
                        { value: 'card', label: t('sales.paymentBadge.card') },
                        { value: 'split', label: t('sales.paymentBadge.split') },
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
                    <label>{t('sales.cashReceivedLabel')}</label>
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
                        {t('sales.changeDue', { amount: changeDueNow.toFixed(2) })}
                      </p>
                    )}
                  </div>
                )}

                {paymentMethod === 'card' && (
                  <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                    {t('sales.cardFullAmountNote', { amount: cartTotal.toFixed(2) })}
                  </p>
                )}

                {paymentMethod === 'split' && (
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <div className={styles.formGroup} style={{ flex: 1, minWidth: '140px' }}>
                        <label>{t('sales.splitCashLabel')}</label>
                        <input type="number" min="0" step="0.01" value={splitCashInput} onChange={e => handleSplitCashChange(e.target.value)} className={styles.inputField} />
                      </div>
                      <div className={styles.formGroup} style={{ flex: 1, minWidth: '140px' }}>
                        <label>{t('sales.splitCardLabel')}</label>
                        <input type="number" min="0" step="0.01" value={splitCardInput} onChange={e => handleSplitCardChange(e.target.value)} className={styles.inputField} />
                      </div>
                    </div>
                    <p style={{ margin: '6px 0 0 0', fontSize: '13px', fontWeight: 'bold', color: !splitBothFilled ? '#94a3b8' : paymentMethodValid ? '#166534' : '#ef4444' }}>
                      {!splitBothFilled
                        ? t('sales.splitFillBoth')
                        : paymentMethodValid
                        ? t('sales.splitMatches')
                        : parsedSplitCash <= 0 || parsedSplitCard <= 0
                        ? t('sales.splitBothPositive')
                        : t('sales.splitDifference', { sign: splitDiff > 0 ? '+' : '', amount: splitDiff.toFixed(2) })}
                    </p>
                  </div>
                )}

                <div className={styles.formGroup} style={{ marginTop: '10px' }}>
                  <label>{t('orderScreen.tipLabel')}</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={tipAmountInput}
                    onChange={e => setTipAmountInput(e.target.value)}
                    className={styles.inputField}
                    placeholder="0.00"
                  />
                </div>

                <button
                  onClick={handleCheckout}
                  disabled={!paymentMethodValid || checkingOut}
                  className={`${styles.btn} ${styles.btnSuccess}`}
                  style={{ width: '100%', padding: '14px', fontSize: '16px', marginTop: '10px', opacity: paymentMethodValid ? 1 : 0.6, whiteSpace: 'normal' }}
                >
                  {checkingOut ? t('orderScreen.processingButton') : t('orderScreen.checkoutButton')}
                </button>

                {activeItems.length >= 2 && discountType === 'none' && (
                  <button
                    type="button"
                    onClick={() => setShowSplitModal(true)}
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    style={{ width: '100%', padding: '12px', fontSize: '14px', marginTop: '8px' }}
                  >
                    {t('orderScreen.splitBillButton')}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showPinModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBody}>
            <h3>{t('sales.managerPinModalTitle')}</h3>
            <p style={{ color: '#64748b', fontSize: '14px', marginTop: 0 }}>
              {pendingVoidItem
                ? t('orderScreen.pinReasonVoidItem', { name: pendingVoidItem.name })
                : t('sales.pinReasonDiscount')}
            </p>
            <form onSubmit={handleVerifyManagerPin}>
              <div className={styles.formGroup}>
                <label>{t('sales.pinCodeLabel')}</label>
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
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={pinLoading || pinValue.length !== 4} className={`${styles.btn} ${styles.btnPrimary}`} style={{ flex: 1, minWidth: '120px' }}>
                  {pinLoading ? t('common.verifying') : t('common.confirm')}
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
      {splitReceipts.length > 0 && <PrintableSplitReceipts receipts={splitReceipts} />}

      <ConfirmModal
        open={!!confirmModal}
        title={confirmModal?.title ?? ''}
        message={confirmModal?.message ?? ''}
        onConfirm={() => confirmModal?.onConfirm()}
        onCancel={closeConfirmModal}
      />

      {order && showSplitModal && (
        <SplitBillModal
          open={showSplitModal}
          orderId={order.id}
          activeItems={activeItems}
          totalAmount={cartTotal}
          onClose={() => setShowSplitModal(false)}
          onSuccess={(result: SplitSuccessResult) => {
            // 🍽️ HoReCa STEP 4 (06.09.2026) — split checkout-ის შედეგიდან
            // ბეჭდვადი ჩეკების აგება. 'equal' რეჟიმში products ბაზაში
            // მხოლოდ ერთ ნაწილზეა მიბმული (ორმაგი დათვლის თავიდან
            // ასაცილებლად backend-ის ანალიტიკაში — იხ. routes/sales.ts),
            // ამიტომ ბეჭდვისას ყველა ნაწილს საერთო შეკვეთის რეალურ
            // items-ს ვუჩვენებთ, sharedItemsNote-ით ცალსახად მონიშნული,
            // რომ ეს გაზიარებული სია და არა მხოლოდ ამ ნაწილის კუთვნილი
            // (Dashboard.tsx-ის "გაყიდვების ისტორიის" იგივე მიდგომა).
            const nowStr = new Date().toLocaleString('ka-GE', { hour12: false });
            const partsCount = result.parts.length;
            const sharedItems =
              result.mode === 'equal' ? result.parts.find(p => p.items.length > 0)?.items ?? [] : [];
            const receipts: PrintableReceiptData[] = result.parts.map((part, index) => ({
              paymentId: part.paymentId,
              createdAt: nowStr,
              cashierName: myUsername || undefined,
              items: result.mode === 'equal' ? sharedItems : part.items,
              subtotalAmount: part.amount,
              totalAmount: part.amount,
              paymentMethod: part.paymentMethod,
              cashReceived: part.cashReceived ?? undefined,
              changeDue: part.changeDue ?? undefined,
              tipAmount: part.tipAmount,
              partLabel:
                result.mode === 'byItem'
                  ? t('orderScreen.splitPartSeatLabel', { seat: part.seatNumber })
                  : t('orderScreen.splitPartGuestLabel', { index: index + 1, count: partsCount }),
              sharedItemsNote:
                result.mode === 'equal'
                  ? t('orderScreen.splitSharedItemsNote')
                  : undefined,
            }));
            setSplitReceipts(receipts);
            setShowSplitModal(false);
            showToast(t('orderScreen.toasts.tableSplitClosed', { name: table.name }), 'success');
            setOrderClosed(true);
            onOrderChanged();
          }}
        />
      )}
    </div>
  );
}
