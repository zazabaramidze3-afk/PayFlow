import { useState, useEffect, Fragment } from 'react';
import axios from 'axios';
// 📊 Roadmap ეტაპი 6 — Executive Dashboard (ანალიტიკის ტაბი)
import ExecutiveDashboard from './ExecutiveDashboard';
import styles from './Dashboard.module.scss';
// 🧾 Migration 012 — უკვე დახურული ცვლის Z-Report-ის ხელახლა დაბეჭდვა
// (Sales.tsx-ის PrintableZReport-ის იგივე კომპონენტი/ფორმატი).
import PrintableZReport, { PrintableZReportData } from '../components/PrintableZReport';

interface PaymentItem { name: string; quantity: number; price: number; }
interface PaymentSplits { cash: number; card: number; }
interface Payment {
  // 🆔 UUID მიგრაცია (Roadmap STEP 1) — payments.id ბექენდზე ახლა UUID
  // string-ია, აღარ არის SERIAL INTEGER.
  id: string;
  cashier_name: string;
  subtotal_amount: number;
  discount_type: 'percent' | 'fixed' | null;
  discount_value: number;
  total_amount: number;
  created_at: string;
  items: PaymentItem[];
  // 🧾 Roadmap ეტაპი 4 — GET /api/payments ახლა ამასაც აბრუნებს.
  is_voided?: boolean;
  // 💰 Roadmap ეტაპი 8 — GET /api/payments ახლა ამასაც აბრუნებს. splits
  // მხოლოდ payment_method === 'split'-ზეა non-null.
  payment_method?: 'cash' | 'card' | 'split';
  splits?: PaymentSplits | null;
}

// 💰 Roadmap ეტაპი 8 — გადახდის მეთოდის ბეიჯის ტექსტი/კლასი. payment_method
// undefined-ია მხოლოდ migration 008-მდე დაზოგილი ძველი ჩანაწერებისთვის
// შეიძლება არასდროს იყოს რეალურად (backend DEFAULT 'cash'-ს აყენებს), მაგრამ
// frontend-ის მხრიდან მაინც უსაფრთხოდ ვმართავთ.
const paymentMethodBadge = (method: Payment['payment_method']): { text: string; className: string } => {
  if (method === 'card') return { text: '💳 ბარათი', className: styles.badgeCard };
  if (method === 'split') return { text: '🔀 შერეული', className: styles.badgeSplit };
  return { text: '💵 ნაღდი', className: styles.badgeCash };
};
// 🆔 UUID მიგრაცია (Roadmap STEP 1) — shifts.id ახლა UUID string-ია.
// 🧾 Migration 012 — receipt_count/card_total ახლა GET /shifts/history-ის
// (`SELECT s.*`) response-შიც შედის (აქამდე მხოლოდ PUT /shifts/close-ის
// ერთჯერად response-ში ითვლებოდა). is_amended/last_amended_at — თუ
// დაგვიანებულმა offline sync-მა ეს (უკვე დახურული) ცვლა "შეასწორა"
// (routes/sales.ts, syncSingleOfflineReceipt) — მენეჯერს ხელახლა დაბეჭდვა
// სჭირდება.
interface Shift {
  id: string;
  cashier_name: string;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  start_amount: number;
  end_amount_expected: number | null;
  end_amount_actual: number | null;
  difference: number | null;
  receipt_count: number | null;
  card_total: number | null;
  is_amended: boolean;
  last_amended_at: string | null;
}

export default function Dashboard() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [shifts, setShifts] = useState<Shift[]>([]);
  // 📊 'analytics' (Executive Dashboard) — ნაგულისხმევი ტაბი, Roadmap ეტაპი 6.
  const [activeTab, setActiveTab] = useState<'analytics' | 'sales' | 'shifts'>('analytics');

  // 🧾 Migration 012 — "ხელახლა დაბეჭდვის" ერთჯერადი ბეჭდვადი ბლოკი
  // (Sales.tsx-ის triggerPrint-ის იგივე პრინციპი: state → ერთი tick
  // setTimeout → window.print(), რომ .print-area DOM-ში უკვე
  // ჩარენდერებული იყოს ბეჭდვამდე).
  const [printShift, setPrintShift] = useState<Shift | null>(null);
  const handleReprintZReport = (shift: Shift) => {
    setPrintShift(shift);
    setTimeout(() => window.print(), 150);
  };

  // ახალი ფილტრების სტეიტები
  const [cashierId, setCashierId] = useState('');
  const [productName, setProductName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // 💰 Roadmap ეტაპი 8 — გადახდის მეთოდის ფილტრი ('' = ყველა).
  const [paymentMethod, setPaymentMethod] = useState<'' | 'cash' | 'card' | 'split'>('');
  // 🚫💸 სტატუსისა (აქტიური/გაუქმებული) და ფასდაკლების ფილტრები ('' = ყველა).
  const [status, setStatus] = useState<'' | 'active' | 'voided'>('');
  const [discount, setDiscount] = useState<'' | 'yes' | 'no'>('');
  const [cashiersList, setCashiersList] = useState<any[]>([]);

  const [expandedRows, setExpandedRows] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // მოლარეების სიის წამოღება ბაზიდან dropdown-ის შესავსებად
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await axios.get('/api/shifts/history');
        const uniqueCashiers = Array.from(new Set(res.data.map((s: any) => JSON.stringify({ id: s.cashier_id, name: s.cashier_name }))))
          .map((s: any) => JSON.parse(s))
          .filter(c => c.name);
        setCashiersList(uniqueCashiers);
      } catch (err) {
        console.error("მოლარეების წამოღების შეცდომა:", err);
      }
    };
    fetchUsers();
  }, []);

  // მონაცემების ავტომატური ჩატვირთვა ტაბის ან ფილტრების შეცვლისას.
  // 'analytics' ტაბს აქ არაფერი სჭირდება — ExecutiveDashboard კომპონენტი
  // GET /api/dashboard/stats-ს დამოუკიდებლად, საკუთარი useEffect-ით იძახებს.
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    if (activeTab === 'sales') {
      loadPayments();
    } else if (activeTab === 'shifts') {
      loadShifts();
    }
  }, [activeTab, cashierId, productName, from, to, paymentMethod, status, discount]);

  // ფილტრის ან გვერდის ზომის შეცვლისას პირველ გვერდზე დაბრუნება
  useEffect(() => {
    setCurrentPage(1);
  }, [cashierId, productName, from, to, paymentMethod, status, discount, pageSize, activeTab]);

  const loadPayments = async () => {
    try {
      const res = await axios.get('/api/payments', {
        params: {
          cashierId: cashierId || undefined,
          productName: productName || undefined,
          from: from || undefined,
          to: to || undefined,
          paymentMethod: paymentMethod || undefined,
          status: status || undefined,
          discount: discount || undefined
        }
      });
      const paymentData = Array.isArray(res.data) ? res.data : [];
      setPayments(paymentData);
      // 🧾 FIX (Roadmap ეტაპი 4): "საერთო შემოსავალი" აღარ ითვლის გაუქმებულ
      // ჩეკებს — paymentData თავად მაინც შეიცავს ყველა ჩეკს (გაუქმებულებსაც),
      // რომ ისტორიის ცხრილში ჩანდეს "🚫 გაუქმებული" ბეიჯით, მაგრამ ჯამში
      // მხოლოდ აქტიური (is_voided !== true) ჩეკები ერთვება.
      const revenue = paymentData
        .filter((p: any) => p.is_voided !== true)
        .reduce((sum: number, p: any) => sum + p.total_amount, 0);
      setTotalRevenue(revenue);
    } catch (err) {
      console.error("გაყიდვების წამოღების შეცდომა:", err);
    }
  };

  const loadShifts = async () => {
    try {
      const res = await axios.get('/api/shifts/history');
      setShifts(res.data || []);
    } catch (err) {
      console.error("ცვლების წამოღების შეცდომა:", err);
    }
  };

  const formatDate = (ds: string | null) => ds ? new Date(ds).toLocaleString('ka-GE', { hour12: false }) : '—';

  // ფასდაკლების ბეჯის ტექსტი — "10%" ან "5.00 ₾"
  const formatDiscount = (type: 'percent' | 'fixed' | null, value: number) => {
    if (!type || !value) return null;
    return type === 'percent' ? `-${value}%` : `-${value.toFixed(2)} ₾`;
  };

  const handleExport = (type: 'excel' | 'pdf') => {
    const token = localStorage.getItem('token');
    const params = new URLSearchParams();
    params.set('token', token || '');
    if (cashierId) params.set('cashierId', cashierId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (paymentMethod) params.set('paymentMethod', paymentMethod);
    if (status) params.set('status', status);
    if (discount) params.set('discount', discount);
    window.open(`/api/payments/export/${type}?${params.toString()}`, '_blank');
  };

  const toggleRow = (id: string) => {
    if (expandedRows.includes(id)) {
      setExpandedRows(expandedRows.filter(rowId => rowId !== id));
    } else {
      setExpandedRows([...expandedRows, id]);
    }
  };

  const totalPages = Math.max(1, Math.ceil(payments.length / pageSize));
  const paginatedPayments = payments.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const rangeStart = payments.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, payments.length);

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>📊 გაყიდვების მართვის პანელი</h2>

      {/* ტაბები — ერთიანი Tab Bar */}
      <div className={styles.tabBar}>
        <button onClick={() => setActiveTab('analytics')} className={`${styles.tabBtn} ${activeTab === 'analytics' ? styles.tabActive : ''}`}>📈 ანალიტიკა</button>
        <button onClick={() => setActiveTab('sales')} className={`${styles.tabBtn} ${activeTab === 'sales' ? styles.tabActive : ''}`}>📝 გაყიდვების ისტორია</button>
        <button onClick={() => setActiveTab('shifts')} className={`${styles.tabBtn} ${activeTab === 'shifts' ? styles.tabActive : ''}`}>⏰ მოლარეეების ცვლები</button>
      </div>

      {/* 📊 ანალიტიკის ტაბი (Roadmap ეტაპი 6) — ცალკე კომპონენტი, საკუთარი
          GET /api/dashboard/stats ჩატვირთვით. */}
      {activeTab === 'analytics' && <ExecutiveDashboard />}

      {/* გაყიდვების ტაბი */}
      {activeTab === 'sales' && (
        <>
          <div className={styles.revenueCard}>
            <span className={styles.revenueLabel}>საერთო შემოსავალი</span>
            <h1 className={styles.revenueValue}>{(totalRevenue || 0).toFixed(2)} ₾</h1>
          </div>

          {/* ფილტრების პანელი */}
          <div className={styles.filters}>

            {/* მოლარის არჩევა Dropdown სტილში */}
            <select value={cashierId} onChange={e => setCashierId(e.target.value)} className={styles.filterSelect}>
              <option value="">-- ყველა მოლარე --</option>
              {cashiersList.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {/* პროდუქტის სახელით ძებნა */}
            <input type="text" placeholder="🔍 პროდუქტი ..." value={productName} onChange={e => setProductName(e.target.value)} className={styles.filterInput} />

            {/* თარიღის ფილტრები (დან - მდე) */}
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={styles.filterInput} title="თარიღიდან" />
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={styles.filterInput} title="თარიღამდე" />

            {/* 💰 Roadmap ეტაპი 8 — გადახდის მეთოდის ფილტრი. buildPaymentsFilterQuery-ს
                ერთი და იგივე whitelist-ს იზიარებს GET /payments-იც და ორივე
                export route-იც, ამიტომ ეს არჩევანი ცხრილსაც და Excel/PDF-საც
                ერთნაირად ფილტრავს. */}
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as '' | 'cash' | 'card' | 'split')} className={styles.filterSelect}>
              <option value="">-- ყველა გადახდა --</option>
              <option value="cash">💵 ნაღდი</option>
              <option value="card">💳 ბარათი</option>
              <option value="split">🔀 შერეული</option>
            </select>

            {/* 🚫 სტატუსის ფილტრი — აქტიური / გაუქმებული */}
            <select value={status} onChange={e => setStatus(e.target.value as '' | 'active' | 'voided')} className={styles.filterSelect}>
              <option value="">-- ყველა სტატუსი --</option>
              <option value="active">✅ აქტიური</option>
              <option value="voided">🚫 გაუქმებული</option>
            </select>

            {/* 💸 ფასდაკლების ფილტრი */}
            <select value={discount} onChange={e => setDiscount(e.target.value as '' | 'yes' | 'no')} className={styles.filterSelect}>
              <option value="">-- ფასდაკლება: ყველა --</option>
              <option value="yes">🏷️ ფასდაკლებით</option>
              <option value="no">ფასდაკლების გარეშე</option>
            </select>

            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className={styles.filterSelect} style={{ width: '160px' }}>
              <option value={20}>20 / გვერდზე</option>
              <option value={50}>50 / გვერდზე</option>
              <option value={100}>100 / გვერდზე</option>
            </select>

            <button onClick={() => handleExport('excel')} className={`${styles.exportBtn} ${styles.exportExcel}`}>Excel 📥</button>
            <button onClick={() => handleExport('pdf')} className={`${styles.exportBtn} ${styles.exportPdf}`}>PDF 📄</button>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>მოლარე</th>
                  <th>თარიღი</th>
                  <th>ჯამი ფასდაკლებამდე</th>
                  <th>ფასდაკლება</th>
                  <th>საბოლოო ფასი</th>
                  {/* 💰 Roadmap ეტაპი 8 */}
                  <th>გადახდა</th>
                  <th>დეტალები</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.emptyState}>
                      📭 გაყიდვების ისტორია ცარიელია ან მონაცემები ვერ მოიძებნა
                    </td>
                  </tr>
                ) : (
                  paginatedPayments.map(p => {
                    const isExp = expandedRows.includes(p.id);
                    const discountLabel = formatDiscount(p.discount_type, p.discount_value);
                    // 🧾 Roadmap ეტაპი 4 — ვიზუალური მონიშვნა: მთელი ხაზი ოდნავ მუქდება,
                    // თანხები ხაზგადახაზულია, "🚫 გაუქმებული" ბეიჯი კი discount-ბეიჯის
                    // ადგილას ჩნდება (ან მასთან ერთად, თუ ორივე არსებობს).
                    const isVoided = p.is_voided === true;
                    return (
                      <Fragment key={p.id}>
                        <tr className={isVoided ? styles.rowVoided : undefined}>
                          <td>#{p.id}</td>
                          <td>{p.cashier_name || 'უცნობი'}</td>
                          <td>{formatDate(p.created_at)}</td>
                          <td className={isVoided ? styles.strike : undefined} style={{ color: '#94a3b8' }}>{(p.subtotal_amount ?? p.total_amount ?? 0).toFixed(2)} ₾</td>
                          <td>
                            <div className={styles.badgeStack}>
                              {isVoided && <span className={styles.badgeVoided}>🚫 გაუქმებული</span>}
                              {discountLabel ? (
                                <span className={styles.badgeDiscount}>{discountLabel}</span>
                              ) : !isVoided ? (
                                <span style={{ color: '#cbd5e1' }}>—</span>
                              ) : null}
                            </div>
                          </td>
                          <td className={isVoided ? styles.strike : undefined} style={{ fontWeight: 700 }}>{(p.total_amount || 0).toFixed(2)} ₾</td>
                          {/* 💰 Roadmap ეტაპი 8 — გადახდის მეთოდის ბეიჯი. SPLIT-ზე დეტალები
                              (ცალ-ცალკე ნაღდი/ბარათი) მხოლოდ გაშლილ (▼) მდგომარეობაშია. */}
                          <td>
                            {(() => {
                              const badge = paymentMethodBadge(p.payment_method);
                              return <span className={badge.className}>{badge.text}</span>;
                            })()}
                          </td>
                          <td>
                            <button onClick={() => toggleRow(p.id)} className={styles.expandBtn}>
                              {isExp ? '▲' : '▼'}
                            </button>
                          </td>
                        </tr>
                        {isExp && (
                          <tr>
                            <td colSpan={8} className={styles.detailRow}>
                              <div className={styles.detailInner}>
                                {Array.isArray(p.items) && p.items.length > 0 ? (
                                  p.items.map((item, index) => (
                                    <div key={index} className={styles.detailItem}>
                                      └── 📦 <strong>{item?.name || 'პროდუქტი'}</strong> — {item?.quantity || 0} ცალი × {(item?.price || 0).toFixed(2)} ₾
                                    </div>
                                  ))
                                ) : (
                                  <div style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>
                                    ℹ ამ ქვითრის დეტალები არ არის ჩატვირთული
                                  </div>
                                )}
                                {discountLabel && (
                                  <div className={styles.detailDiscount}>
                                    🏷 ფასდაკლება: {discountLabel} ({(p.subtotal_amount ?? 0).toFixed(2)} ₾ → {(p.total_amount ?? 0).toFixed(2)} ₾)
                                  </div>
                                )}
                                {/* 💰 Roadmap ეტაპი 8 — SPLIT ჩეკის ცალ-ცალკე ნაღდი/ბარათის
                                    ჩაშლა. სხვა მეთოდებზე (cash/card) ცალკე ხაზი არ სჭირდება —
                                    ზემოთა ბეიჯი უკვე ცალსახად აჩვენებს მთელ თანხას. */}
                                {p.payment_method === 'split' && p.splits && (
                                  <div className={styles.detailSplit}>
                                    <span>🔀 შერეული:</span>
                                    <span>💵 ნაღდი — {p.splits.cash.toFixed(2)} ₾</span>
                                    <span>💳 ბარათი — {p.splits.card.toFixed(2)} ₾</span>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {/* პაგინაცია */}
          {payments.length > 0 && (
            <div className={styles.pagination}>
              <span className={styles.pageInfo}>ნაჩვენებია {rangeStart}–{rangeEnd} / სულ {payments.length}</span>
              <div className={styles.pageControls}>
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className={styles.pageBtn}>‹ წინა</button>
                <span className={styles.pageInfo}>გვერდი {currentPage} / {totalPages}</span>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className={styles.pageBtn}>შემდეგი ›</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ცვლების ტაბი */}
      {activeTab === 'shifts' && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>მოლარე</th>
                <th>სტატუსი</th>
                <th>გახსნა</th>
                <th>დახურვა</th>
                <th>საწყისი</th>
                <th>მოსალოდნელი</th>
                <th>ფაქტობრივი</th>
                <th>სხვაობა</th>
                {/* 🧾 Migration 012 */}
                <th>Z-Report</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map(s => {
                const isOpen = s.status === 'open';
                const diff = s.difference || 0;
                return (
                  <tr key={s.id}>
                    <td>#{s.id}</td>
                    <td style={{ fontWeight: 700 }}>{s.cashier_name}</td>
                    <td>
                      <span className={isOpen ? styles.badgeOpen : styles.badgeClosed}>
                        {isOpen ? 'ღიაა' : '🔒 closed'}
                      </span>
                      {/* 🧾 Migration 012 — დაგვიანებული offline sync-ის მიერ
                          "შესწორებული" ცვლა (routes/sales.ts,
                          syncSingleOfflineReceipt) — ორიგინალურად
                          დაბეჭდილი Z-Report საბოლოო აღარ არის ზუსტი. */}
                      {s.is_amended && (
                        <span className={styles.badgeAmended} title="დაგვიანებული სინქრონიზაციის გამო შესწორდა — Z-Report ხელახლა დაბეჭდეთ">
                          ⚠️ შესწორებული
                        </span>
                      )}
                    </td>
                    <td>{formatDate(s.opened_at)}</td>
                    <td>{formatDate(s.closed_at)}</td>
                    <td>{s.start_amount.toFixed(2)} ₾</td>
                    <td>{s.end_amount_expected !== null ? `${s.end_amount_expected.toFixed(2)} ₾` : '—'}</td>
                    <td>{s.end_amount_actual !== null ? `${s.end_amount_actual.toFixed(2)} ₾` : '—'}</td>
                    <td className={isOpen ? undefined : diff < 0 ? styles.diffNegative : styles.diffPositive}>
                      {isOpen ? '—' : `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} ₾`}
                    </td>
                    <td>
                      {/* 🧾 Migration 012 — ღია ცვლას Z-Report ჯერ არ აქვს
                          (PUT /shifts/close-მდე), ამიტომ ღილაკი მხოლოდ
                          დახურულ ცვლებზეა. */}
                      {!isOpen && (
                        <button
                          className={styles.reprintBtn}
                          onClick={() => handleReprintZReport(s)}
                        >
                          🖨 ხელახლა დაბეჭდვა
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 🖨 Migration 012 — ეკრანზე დამალული (print.css-ის .print-area),
          ჩნდება მხოლოდ window.print()-ის დროს (იხ. handleReprintZReport).
          ფორმატი ზუსტად იმეორებს Sales.tsx-ის ცვლის დახურვის მოდალს
          (PrintableZReport, components/PrintableZReport.tsx). */}
      {printShift && (
        <PrintableZReport
          report={{
            shiftId: printShift.id,
            openedAt: printShift.opened_at,
            closedAt: printShift.closed_at || '',
            cashierName: printShift.cashier_name,
            start: printShift.start_amount,
            expected: printShift.end_amount_expected ?? 0,
            actual: printShift.end_amount_actual ?? 0,
            difference: printShift.difference ?? 0,
            receiptCount: printShift.receipt_count ?? 0,
          } satisfies PrintableZReportData}
        />
      )}
    </div>
  );
}
