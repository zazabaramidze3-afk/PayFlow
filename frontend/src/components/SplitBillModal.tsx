// frontend/src/components/SplitBillModal.tsx
//
// 🍽️/💳 HoReCa STEP 4 (Roadmap "03.09.2026", migration 023) — ჩეკის
// გაყოფის მოდალი. OrderScreen.tsx-იდან იხსნება, POST /api/payments/split-ს
// უკავშირდება (backend/src/routes/sales.ts). ორი რეჟიმი:
//   - 'equal':  თანხა თანაბრად n ნაწილად (სტუმრების რაოდენობა).
//   - 'byItem': ორდერის item-ების seat_number-ის მიხედვით ჯგუფები —
//     მუშაობს მხოლოდ მაშინ, თუ ყველა აქტიურ item-ს აქვს ადგილი მინიჭებული
//     (OrderScreen.tsx-ის "პროდუქტის დამატება" ფორმის ახალი ველი).
//
// ⚠️ v1 შეზღუდვა: ფასდაკლება (discount) split checkout-ს არ ეხმარება —
// OrderScreen.tsx ღილაკს მალავს, თუ discountType !== 'none'.

import { useMemo, useState } from 'react';
import axios from 'axios';
import styles from './SplitBillModal.module.scss';

interface SplitItemLike {
  product_id: number;
  quantity: number;
  unit_price: number;
  seat_number: number | null;
}

interface SplitBillModalProps {
  open: boolean;
  orderId: string;
  activeItems: SplitItemLike[];
  totalAmount: number;
  onClose: () => void;
  onSuccess: (result: SplitSuccessResult) => void;
}

type SplitMode = 'equal' | 'byItem';

// 🍽️ HoReCa STEP 4 (06.09.2026) — POST /api/payments/split-ის success
// response-ის ტიპები, ექსპორტირებული, რომ OrderScreen.tsx-მა ბეჭდვადი
// ჩეკების (PrintableReceiptData[]) აგებისას ისარგებლოს ზუსტი,
// `any`-ს გარეშე ტიპებით (backend/routes/sales.ts-ის იგივე response shape).
export interface SplitResultItem {
  name: string;
  price: number;
  quantity: number;
}

export interface SplitResultPart {
  seatNumber: number | null;
  amount: number;
  tipAmount?: number;
  paymentMethod: PartPaymentMethod;
  cashReceived?: number | null;
  changeDue?: number | null;
  paymentId: string;
  items: SplitResultItem[];
}

export interface SplitSuccessResult {
  paymentIds: string[];
  totalAmount: number;
  mode: SplitMode;
  parts: SplitResultPart[];
}
type PartPaymentMethod = 'cash' | 'card';

interface PartFormState {
  paymentMethod: PartPaymentMethod;
  tipAmountInput: string;
  cashReceivedInput: string;
}

const emptyPart = (): PartFormState => ({ paymentMethod: 'cash', tipAmountInput: '', cashReceivedInput: '' });

export default function SplitBillModal({ open, orderId, activeItems, totalAmount, onClose, onSuccess }: SplitBillModalProps) {
  const [mode, setMode] = useState<SplitMode>('equal');
  const [guestCountInput, setGuestCountInput] = useState<string>('2');
  const [parts, setParts] = useState<PartFormState[]>([emptyPart(), emptyPart()]);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const distinctSeatNumbers = useMemo(() => {
    const seats = new Set<number>();
    activeItems.forEach((item) => {
      if (item.seat_number !== null) seats.add(item.seat_number);
    });
    return [...seats].sort((a, b) => a - b);
  }, [activeItems]);

  const itemsWithoutSeat = activeItems.filter((item) => item.seat_number === null);
  const byItemAvailable = activeItems.length > 0 && itemsWithoutSeat.length === 0 && distinctSeatNumbers.length >= 2;

  if (!open) return null;

  const guestCount = mode === 'equal' ? Math.max(2, Math.floor(Number(guestCountInput)) || 2) : distinctSeatNumbers.length;
  const currentParts = mode === 'equal' ? parts.slice(0, guestCount) : parts.slice(0, distinctSeatNumbers.length);

  const syncPartsLength = (nextLength: number) => {
    setParts((prev) => {
      const next = [...prev];
      while (next.length < nextLength) next.push(emptyPart());
      return next.slice(0, Math.max(nextLength, 2));
    });
  };

  const handleGuestCountChange = (value: string) => {
    setGuestCountInput(value);
    const parsed = Math.max(2, Math.floor(Number(value)) || 2);
    syncPartsLength(parsed);
  };

  const updatePart = (index: number, patch: Partial<PartFormState>) => {
    setParts((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  // 💰 ინფორმაციული (frontend-ზე გამოთვლილი) თანხა თითო ნაწილზე — ზუსტი,
  // საბოლოო თანხა backend-ზეა გამოთვლილი (იგივე ლოგიკით), ეს მხოლოდ
  // მოლარეს/მიმტანს წინასწარი წარმოდგენისთვისაა.
  const previewAmounts: number[] = useMemo(() => {
    if (mode === 'byItem') {
      return distinctSeatNumbers.map((seat) =>
        Number(
          activeItems
            .filter((item) => item.seat_number === seat)
            .reduce((sum, item) => sum + item.unit_price * item.quantity, 0)
            .toFixed(2)
        )
      );
    }
    const evenShare = Math.floor((totalAmount / guestCount) * 100) / 100;
    const amounts: number[] = [];
    let running = 0;
    for (let i = 0; i < guestCount; i++) {
      const isLast = i === guestCount - 1;
      const amount = isLast ? Number((totalAmount - running).toFixed(2)) : evenShare;
      running = Number((running + amount).toFixed(2));
      amounts.push(amount);
    }
    return amounts;
  }, [mode, guestCount, totalAmount, distinctSeatNumbers, activeItems]);

  const handleSubmit = async () => {
    setErrorMessage('');

    if (mode === 'byItem' && !byItemAvailable) {
      setErrorMessage('item-ის მიხედვით გასაყოფად ყველა პროდუქტს სჭირდება მინიჭებული ადგილი (სულ მცირე 2 განსხვავებული).');
      return;
    }

    const requestParts = currentParts.map((part, index) => {
      const tipParsed = Number(part.tipAmountInput);
      const cashParsed = Number(part.cashReceivedInput);
      return {
        seatNumber: mode === 'byItem' ? distinctSeatNumbers[index] : undefined,
        paymentMethod: part.paymentMethod,
        tipAmount: part.tipAmountInput.trim() !== '' && Number.isFinite(tipParsed) && tipParsed > 0 ? tipParsed : undefined,
        cashReceived:
          part.paymentMethod === 'cash' && part.cashReceivedInput.trim() !== '' && Number.isFinite(cashParsed)
            ? cashParsed
            : undefined,
      };
    });

    for (let i = 0; i < requestParts.length; i++) {
      const part = requestParts[i];
      if (part.paymentMethod === 'cash' && (part.cashReceived === undefined || part.cashReceived < previewAmounts[i])) {
        setErrorMessage(`ნაწილი #${i + 1}-ისთვის მიღებული ნაღდი ფული ნაკლებია გადასახდელ თანხაზე (${previewAmounts[i].toFixed(2)} ₾).`);
        return;
      }
    }

    setSubmitting(true);
    // 🩹 FIX (05.09.2026) — მანამდე onSuccess(...) ამ try-ის შიგნით
    // იძახებოდა, ანუ თუ POST წარმატებული იყო, მაგრამ onSuccess-ის
    // side-effect-ებში (toast, ორდერების სიის განახლება და ა.შ.) რამე
    // გამონაკლისი ჩავარდებოდა, ეს catch-ს ხვდებოდა და მომხმარებელს
    // ცრუ "ჩეკის გაყოფა ვერ მოხერხდა" უჩვენებდა — მაშინ როცა ბაზაში
    // ჩეკი უკვე რეალურად გაყოფილი/დახურული იყო. ახლა POST-ის
    // შედეგი (paymentIds) ცალკე ინახება და onSuccess try/catch-ის
    // მიღმა, safety-ის ერთადერთ პასუხისმგებელ ადგილას გამოიძახება.
    let successResult: SplitSuccessResult | null = null;
    try {
      const response = await axios.post('/api/payments/split', {
        orderId,
        splitMode: mode,
        parts: requestParts,
      });
      successResult = {
        paymentIds: response.data.paymentIds,
        totalAmount: response.data.totalAmount,
        mode,
        parts: response.data.parts,
      };
    } catch (error: unknown) {
      // 🩹 FIX (05.09.2026) — checkActiveShift/requireRegister-ის მსგავსი
      // ლეგასი middleware-ები `{ message: "..." }` ფორმით აბრუნებენ
      // შეცდომას (ჩვენი ახალი endpoint-ების `{ error: "..." }" კონვენციის
      // ნაცვლად — იხ. OrderScreen.tsx-ის იგივე getErrorMessage-ის
      // კომენტარი). აქამდე მხოლოდ `.error` იკითხებოდა, ამიტომ, მაგ.,
      // "ცვლის გახსნა აუცილებელია" აქ საერთოდ არ ჩანდა — ზოგადი
      // fallback ჩნდებოდა მის ნაცვლად.
      const backendMessage = axios.isAxiosError<{ error?: string; message?: string }>(error)
        ? error.response?.data?.error ?? error.response?.data?.message
        : undefined;
      setErrorMessage(backendMessage ?? 'ჩეკის გაყოფა ვერ მოხერხდა');
    } finally {
      setSubmitting(false);
    }
    if (successResult) {
      onSuccess(successResult);
    }
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBody}>
        <h3>🧾 ჩეკის გაყოფა</h3>

        <div className={styles.modeSwitch}>
          <button
            type="button"
            onClick={() => setMode('equal')}
            className={`${styles.btn} ${mode === 'equal' ? styles.btnPrimary : styles.btnSecondary}`}
          >
            თანაბრად
          </button>
          <button
            type="button"
            onClick={() => byItemAvailable && setMode('byItem')}
            disabled={!byItemAvailable}
            title={!byItemAvailable ? 'ყველა პროდუქტს სჭირდება მინიჭებული ადგილი (სულ მცირე 2 განსხვავებული)' : undefined}
            className={`${styles.btn} ${mode === 'byItem' ? styles.btnPrimary : styles.btnSecondary}`}
          >
            სტუმრების მიხედვით
          </button>
        </div>

        {mode === 'byItem' && !byItemAvailable && (
          <p className={styles.hint}>
            ⚠️ ეს რეჟიმი მოითხოვს, რომ ორდერის ყველა პროდუქტს ჰქონდეს მინიჭებული ადგილი (🪑, "პროდუქტის დამატება" ფორმაში) — მინიმუმ 2 განსხვავებული ადგილით.
          </p>
        )}

        {mode === 'equal' && (
          <div className={styles.formGroup}>
            <label>სტუმრების რაოდენობა</label>
            <input
              type="number"
              min="2"
              value={guestCountInput}
              onChange={(e) => handleGuestCountChange(e.target.value)}
              className={styles.inputField}
            />
          </div>
        )}

        <div className={styles.partsList}>
          {currentParts.map((part, index) => (
            <div key={index} className={styles.partCard}>
              <div className={styles.partHeader}>
                <strong>{mode === 'byItem' ? `🪑 ადგილი ${distinctSeatNumbers[index]}` : `სტუმარი ${index + 1}`}</strong>
                <span>{previewAmounts[index]?.toFixed(2)} ₾</span>
              </div>

              <div className={styles.partRow}>
                <button
                  type="button"
                  onClick={() => updatePart(index, { paymentMethod: 'cash' })}
                  className={`${styles.btnSmall} ${part.paymentMethod === 'cash' ? styles.btnPrimary : styles.btnSecondary}`}
                >
                  💵 ნაღდი
                </button>
                <button
                  type="button"
                  onClick={() => updatePart(index, { paymentMethod: 'card' })}
                  className={`${styles.btnSmall} ${part.paymentMethod === 'card' ? styles.btnPrimary : styles.btnSecondary}`}
                >
                  💳 ბარათი
                </button>
              </div>

              {part.paymentMethod === 'cash' && (
                <>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={`მიღებული ნაღდი (მინ. ${previewAmounts[index]?.toFixed(2)} ₾)`}
                    value={part.cashReceivedInput}
                    onChange={(e) => updatePart(index, { cashReceivedInput: e.target.value })}
                    className={styles.inputField}
                  />
                  {/* 🩹 FIX (06.09.2026) — OrderScreen.tsx-ის ჩვეულებრივ
                      (non-split) checkout-ს აქვს ცოცხალი "ხურდა" გამოთვლა
                      cash input-ის ქვეშ, split-მოდალს კი არა — თუ
                      "მიღებული ნაღდი" გადასახდელზე მეტი შეყვანილიყო, ხურდა
                      არსად ჩანდა submit-მდე (მხოლოდ დაბეჭდილ ჩეკზე
                      გამოჩნდებოდა post-factum). იგივე პატერნი აქაც. */}
                  {Number(part.cashReceivedInput) > 0 && (
                    <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#166534', fontWeight: 'bold' }}>
                      ხურდა: {Math.max(0, Number((Number(part.cashReceivedInput) - (previewAmounts[index] ?? 0)).toFixed(2))).toFixed(2)} ₾
                    </p>
                  )}
                </>
              )}

              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="🪙 tip (₾) — არასავალდებულო"
                value={part.tipAmountInput}
                onChange={(e) => updatePart(index, { tipAmountInput: e.target.value })}
                className={styles.inputField}
              />
            </div>
          ))}
        </div>

        {errorMessage && <p className={styles.error}>{errorMessage}</p>}

        <div className={styles.actions}>
          <button type="button" onClick={onClose} className={`${styles.btn} ${styles.btnSecondary}`}>
            გაუქმება
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || (mode === 'byItem' && !byItemAvailable)}
            className={`${styles.btn} ${styles.btnPrimary}`}
          >
            {submitting ? 'მუშავდება...' : `დახურვა (${currentParts.length} ჩეკად)`}
          </button>
        </div>
      </div>
    </div>
  );
}
