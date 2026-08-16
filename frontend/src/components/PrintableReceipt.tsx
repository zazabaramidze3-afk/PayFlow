// ==========================================
// 🖨 POS ჩეკის ბეჭდვადი შაბლონი — Roadmap ეტაპი 7
// ==========================================
// ეკრანზე დამალულია (print.css-ის .print-area { display: none } default-ად),
// ჩნდება მხოლოდ window.print()-ის დროს (@media print წესებით). 80mm თერმული
// პრინტერის ზოლისთვის ოპტიმიზებული — იხ. print.css .receipt-80mm.
//
// მონაცემები ბექენდის POST /api/payments-ის success response-იდან მოდის
// (Sales.tsx-ის handleCheckout), არა ხელახლა გამოთვლილი frontend-ზე — რომ
// დაბეჭდილი ჩეკი ზუსტად იმას ემთხვეოდეს, რაც რეალურად შეინახა ბაზაში.

export interface PrintableReceiptItem {
  name: string;
  price: number;
  quantity: number;
}

export interface PrintableReceiptSplits {
  cash: number;
  card: number;
}

export interface PrintableReceiptData {
  // 🆔 UUID მიგრაცია (Roadmap STEP 1) — payments.id ბექენდზე ახლა UUID
  // string-ია, აღარ არის SERIAL INTEGER.
  paymentId: string;
  // 📅 უკვე დაფორმატებული, ჩვენებისთვის მზა სტრიქონი (არა Date ობიექტი) —
  // ლოკალიზაცია (ka-GE) Sales.tsx-ში ხდება, კომპონენტი მხოლოდ აჩვენებს.
  createdAt: string;
  cashierName?: string;
  items: PrintableReceiptItem[];
  subtotalAmount: number;
  discountType?: 'percent' | 'fixed' | null;
  discountValue?: number;
  discountAmount?: number;
  totalAmount: number;
  // 💰 Roadmap ეტაპი 8 — POST /api/payments-ის response-იდან, handleCheckout-ის
  // იგივე პრინციპით (არა ხელახლა გამოთვლილი frontend-ზე).
  paymentMethod?: 'cash' | 'card' | 'split';
  splits?: PrintableReceiptSplits | null;
  cashReceived?: number | null;
  changeDue?: number;
}

interface PrintableReceiptProps {
  receipt: PrintableReceiptData;
}

// 💰 Roadmap ეტაპი 8 — მოლარისთვის/მყიდველისთვის გასაგები ტექსტი, emoji
// გარეშე (80mm თერმულ პრინტერზე შესაძლოა არ დაბეჭდოს გლიფი).
const PAYMENT_METHOD_LABEL: Record<'cash' | 'card' | 'split', string> = {
  cash: 'ნაღდი',
  card: 'ბარათი',
  split: 'შერეული',
};

export default function PrintableReceipt({ receipt }: PrintableReceiptProps) {
  const hasDiscount = !!receipt.discountAmount && receipt.discountAmount > 0;
  const hasCashReceived = typeof receipt.cashReceived === 'number' && receipt.cashReceived > 0;

  return (
    <div className="print-area receipt-80mm">
      <h2>PayFlow</h2>
      <div style={{ textAlign: 'center', fontSize: '11px' }}>საკასო ჩეკი</div>
      <hr />
      <div>ჩეკი #: {receipt.paymentId}</div>
      <div>თარიღი: {receipt.createdAt}</div>
      {receipt.cashierName && <div>მოლარე: {receipt.cashierName}</div>}
      <hr />
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>დასახელება</th>
            <th style={{ textAlign: 'right' }}>რაოდ.</th>
            <th style={{ textAlign: 'right' }}>ფასი</th>
            <th style={{ textAlign: 'right' }}>ჯამი</th>
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((item, idx) => (
            <tr key={idx}>
              <td>{item.name}</td>
              <td style={{ textAlign: 'right' }}>{item.quantity}</td>
              <td style={{ textAlign: 'right' }}>{item.price.toFixed(2)}</td>
              <td style={{ textAlign: 'right' }}>{(item.price * item.quantity).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr />
      {hasDiscount && (
        <>
          <div className="receipt-row">
            <span>ჯამი ფასდაკლებამდე:</span>
            <span>{receipt.subtotalAmount.toFixed(2)} ₾</span>
          </div>
          <div className="receipt-row">
            <span>
              ფასდაკლება{receipt.discountType === 'percent' ? ` (${receipt.discountValue}%)` : ''}:
            </span>
            <span>-{(receipt.discountAmount ?? 0).toFixed(2)} ₾</span>
          </div>
          <hr />
        </>
      )}
      <div className="receipt-row" style={{ fontWeight: 'bold', fontSize: '14px' }}>
        <span>სულ გადახდილი:</span>
        <span>{receipt.totalAmount.toFixed(2)} ₾</span>
      </div>

      {/* 💰 Roadmap ეტაპი 8 — გადახდის მეთოდი + SPLIT-ის ჩაშლა + ხურდა.
          receipt.paymentMethod undefined-ია მხოლოდ იმ ძველი ჩეკებისთვის,
          რომლებიც migration 008-მდე დაიბეჭდა ამ სესიაში (ლოკალურად
          შენახული lastReceipt) — ასეთ შემთხვევაში ბლოკი საერთოდ არ ჩნდება. */}
      {receipt.paymentMethod && (
        <>
          <hr />
          <div className="receipt-row">
            <span>გადახდის მეთოდი:</span>
            <span>{PAYMENT_METHOD_LABEL[receipt.paymentMethod]}</span>
          </div>
          {receipt.paymentMethod === 'split' && receipt.splits && (
            <>
              <div className="receipt-row" style={{ fontSize: '12px' }}>
                <span>— ნაღდი:</span>
                <span>{receipt.splits.cash.toFixed(2)} ₾</span>
              </div>
              <div className="receipt-row" style={{ fontSize: '12px' }}>
                <span>— ბარათი:</span>
                <span>{receipt.splits.card.toFixed(2)} ₾</span>
              </div>
            </>
          )}
          {hasCashReceived && (
            <>
              <div className="receipt-row" style={{ fontSize: '12px' }}>
                <span>მიღებული ნაღდი:</span>
                <span>{(receipt.cashReceived ?? 0).toFixed(2)} ₾</span>
              </div>
              <div className="receipt-row" style={{ fontSize: '12px', fontWeight: 'bold' }}>
                <span>ხურდა:</span>
                <span>{(receipt.changeDue ?? 0).toFixed(2)} ₾</span>
              </div>
            </>
          )}
        </>
      )}
      <hr />
      <div style={{ textAlign: 'center', fontSize: '11px', marginTop: '4mm' }}>
        მადლობა შეძენისთვის!
      </div>
    </div>
  );
}
