import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import gsap from 'gsap';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import styles from './ExecutiveDashboard.module.scss';

// ==========================================
// 📊 Executive Dashboard — Roadmap ეტაპი 6
// ==========================================
// GET /api/dashboard/stats-ის response-ის ზუსტი ასლი (backend/src/routes/dashboard.ts).
// ერთი წყარო ტიპებისთვის — თუ ბექენდის response ფორმა შეიცვლება, აქაც
// უნდა აისახოს ცვლილება.
interface TodayStats {
  revenue: number;
  receiptCount: number;
  averageReceipt: number;
}
interface TopProduct {
  id: number;
  name: string;
  totalQuantity: number;
  totalRevenue: number;
}
interface DailyTrendPoint {
  day: string; // 'YYYY-MM-DD'
  revenue: number;
  receiptCount: number;
}
// ⏰ Roadmap ეტაპი 6 — "hourly-peak" chart (30.08.2026-ის roadmap-გასწორების
// TODO). hour: 0-23, GET /dashboard/stats-ის generate_series(0,23)-ის ზუსტი ასლი.
interface HourlyPeakPoint {
  hour: number; // 0-23
  revenue: number;
  receiptCount: number;
}
// 💰 Roadmap ეტაპი 8 — დღევანდელი გადახდები, დაშლილი მეთოდის მიხედვით.
interface PaymentMethodStat {
  total: number;
  count: number;
}
interface PaymentBreakdown {
  cash: PaymentMethodStat;
  card: PaymentMethodStat;
  split: PaymentMethodStat;
}
// 🚫 Roadmap ეტაპი 8 — დღევანდელი გაუქმებული ჩეკები.
interface VoidedStat {
  total: number;
  count: number;
}
interface DashboardStats {
  today: TodayStats;
  activeShifts: number;
  topProducts: TopProduct[];
  dailyTrend: DailyTrendPoint[];
  hourlyPeak: HourlyPeakPoint[];
  paymentBreakdown: PaymentBreakdown;
  voided: VoidedStat;
}

// ==========================================
// 🔔 Roadmap STEP 5 — Stock Deficit Notifications
// ==========================================
// GET /api/notifications/stock-deficits-ის (backend/src/routes/notifications.ts)
// response-ის ზუსტი ასლი — cashier_name/register_name JOIN-ით დამატებული
// ველებია (StockDeficitNotification-ის, backend/src/types.ts, ზედაპირი).
interface StockDeficitNotification {
  id: string;
  payment_id: string;
  product_id: number | null;
  product_name: string;
  register_id: string | null;
  cashier_id: string | null;
  cashier_name: string | null;
  register_name: string | null;
  requested_quantity: number;
  available_quantity: number;
  deficit_quantity: number;
  is_resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

// ==========================================
// 🧾 Migration 012 — Shift Amendment Notifications (Z-Report Late-Sync
// Reconciliation)
// ==========================================
// GET /api/notifications/shift-amendments-ის (backend/src/routes/notifications.ts)
// response-ის ზუსტი ასლი — cashier_name/register_name JOIN-ით დამატებული
// ველებია (ShiftAmendmentNotification-ის, backend/src/types.ts, ზედაპირი).
interface ShiftAmendmentNotification {
  id: string;
  shift_id: string;
  payment_id: string;
  cashier_id: string | null;
  register_id: string | null;
  cashier_name: string | null;
  register_name: string | null;
  previous_expected: number;
  new_expected: number;
  previous_difference: number;
  new_difference: number;
  is_resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface StatCard {
  label: string;
  icon: string;
  color: string;
  // 💰 Roadmap ეტაპი 8 — მეორე, უფრო წვრილი ხაზი ბარათზე (მაგ. ჩეკების რაოდენობა).
  subtitle?: string;
  // ✨ GSAP count-up — ნედლი რიცხვითი მნიშვნელობა (არა წინასწარ ფორმატირებული
  // სტრინგი), StatCardView 0-დან ამ მნიშვნელობამდე ანიმირებს ტექსტს mount-ზე.
  rawValue: number;
  // ათწილადის სიმბოლოების რაოდენობა ფორმატირებისას (₾ თანხებზე 2, რაოდენობაზე 0).
  decimals?: number;
  // ტექსტური სუფიქსი ფორმატირებულ მნიშვნელობას მიყოლებული (მაგ. ' ₾').
  suffix?: string;
}

// 🎨 hex → rgba(…, alpha) — აიქონის ნაზი, გამჭვირვალე ბექგრაუნდისთვის.
// ფერი მხოლოდ პატარა აიქონზეა გამოყენებული (spec-ის მოთხოვნით), არა მთელ ბარათზე.
function hexToSoftBg(hex: string, alpha = 0.12): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 🔢 rawValue → ფორმატირებული ტექსტი (decimals + suffix), საერთო ლოგიკა
// საწყისი render-ისთვისაც (0-ით) და GSAP-ის ყოველი onUpdate tick-ისთვისაც.
function formatStatValue(value: number, decimals: number, suffix: string): string {
  return `${value.toFixed(decimals)}${suffix}`;
}

function StatCardView({ card }: { card: StatCard }) {
  const valueRef = useRef<HTMLDivElement>(null);
  const decimals = card.decimals ?? 0;
  const suffix = card.suffix ?? '';

  // ✨ GSAP count-up — 0-დან card.rawValue-მდე ტვინდება number tween, ტექსტი
  // კი onUpdate-ზე პირდაპირ DOM-ში იწერება (არა React state), რომ ყოველ
  // frame-ზე ზედმეტი re-render არ გამოიწვიოს POS-ის მსგავს frequent-update
  // გარემოში. Cleanup (`tween.kill()`) StrictMode-ის double-effect-საც იცავს.
  useEffect(() => {
    const el = valueRef.current;
    if (!el) return;
    const counter = { val: 0 };
    const tween = gsap.to(counter, {
      val: card.rawValue,
      duration: 1.1,
      ease: 'power2.out',
      onUpdate: () => {
        el.textContent = formatStatValue(counter.val, decimals, suffix);
      },
    });
    return () => { tween.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.rawValue, decimals, suffix]);

  return (
    <div className={styles.statCard}>
      <div className={styles.statHeader}>
        <span className={styles.statIcon} style={{ background: hexToSoftBg(card.color), color: card.color }}>
          {card.icon}
        </span>
        {card.label}
      </div>
      <div className={styles.statValue} ref={valueRef}>{formatStatValue(0, decimals, suffix)}</div>
      {card.subtitle && <div className={styles.statSubtitle}>{card.subtitle}</div>}
    </div>
  );
}

export default function ExecutiveDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get<DashboardStats>('/api/dashboard/stats');
      setStats(response.data);
    } catch (err: unknown) {
      // "any"-ის ნაცვლად axios.isAxiosError ტიპის დამცველი — Clean Architecture წესი.
      const serverMessage = axios.isAxiosError<{ error?: string }>(err) ? err.response?.data?.error : undefined;
      setError(serverMessage || 'ანალიტიკის ჩატვირთვა ვერ მოხერხდა');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // ==========================================
  // 🔔 Roadmap STEP 5 — Stock Deficit Notifications
  // ==========================================
  const [deficits, setDeficits] = useState<StockDeficitNotification[]>([]);
  const [deficitsLoading, setDeficitsLoading] = useState<boolean>(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const loadDeficits = useCallback(async () => {
    setDeficitsLoading(true);
    try {
      const response = await axios.get<StockDeficitNotification[]>(
        '/api/notifications/stock-deficits'
      );
      setDeficits(response.data);
    } catch {
      // 🔕 ეს პანელი დამატებითი (secondary) ინფორმაციაა — ჩავარდნისას მთელ
      // Dashboard-ს არ ვბლოკავთ error-ეკრანით, უბრალოდ პანელი ცარიელი რჩება.
    } finally {
      setDeficitsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeficits();
  }, [loadDeficits]);

  const handleResolveDeficit = async (id: string) => {
    setResolvingId(id);
    try {
      await axios.put(`/api/notifications/stock-deficits/${id}/resolve`);
      setDeficits((prev) => prev.filter((d) => d.id !== id));
    } catch {
      // 🔕 წარუმატებლობისას ჩანაწერი პანელში უბრალოდ რჩება — მენეჯერს
      // შეუძლია ისევ სცადოს.
    } finally {
      setResolvingId(null);
    }
  };

  // ==========================================
  // 🧾 Migration 012 — Shift Amendment Notifications
  // ==========================================
  // Late-sync-მა უკვე დახურული ცვლის Z-Report შეცვალა (routes/sales.ts,
  // syncSingleOfflineReceipt) — მენეჯერმა უნდა იცოდეს, რომ ამ ცვლის
  // ორიგინალურად დაბეჭდილი Z-Report საბოლოო აღარ არის ზუსტი და საჭიროა
  // ხელახლა დაბეჭდვა (Dashboard.tsx-ის "მოლარეების ცვლები" ცხრილიდან,
  // "🖨 ხელახლა დაბეჭდვა" ღილაკით).
  const [amendments, setAmendments] = useState<ShiftAmendmentNotification[]>([]);
  const [amendmentsLoading, setAmendmentsLoading] = useState<boolean>(true);
  const [resolvingAmendmentId, setResolvingAmendmentId] = useState<string | null>(null);

  const loadAmendments = useCallback(async () => {
    setAmendmentsLoading(true);
    try {
      const response = await axios.get<ShiftAmendmentNotification[]>(
        '/api/notifications/shift-amendments'
      );
      setAmendments(response.data);
    } catch {
      // 🔕 ეს პანელიც დამატებითი (secondary) ინფორმაციაა — deficits-ის
      // იგივე პრინციპი.
    } finally {
      setAmendmentsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAmendments();
  }, [loadAmendments]);

  const handleResolveAmendment = async (id: string) => {
    setResolvingAmendmentId(id);
    try {
      await axios.put(`/api/notifications/shift-amendments/${id}/resolve`);
      setAmendments((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // 🔕 წარუმატებლობისას ჩანაწერი პანელში უბრალოდ რჩება.
    } finally {
      setResolvingAmendmentId(null);
    }
  };

  // ✨ GSAP stagger — "ტოპ 5 პროდუქტის" ბარები page load-ზე თანმიმდევრობით
  // "იზრდება" მარცხნიდან (scaleX 0→1). Recharts-ის built-in ანიმაცია
  // (`isAnimationActive`) ერთდროულად ამოძრავებდა ყველა ბარს — მას ვთიშავთ
  // (იხ. <Bar isAnimationActive={false}>) და GSAP-ს ვანდობთ stagger-ს.
  // rAF + მცირე setTimeout საჭიროა, რადგან ResponsiveContainer-ს სიგანის
  // measure-ისთვის (ResizeObserver) ერთი tick სჭირდება, სანამ path-ები
  // რეალურად DOM-ში გამოჩნდება.
  const barChartWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stats || stats.topProducts.length === 0) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const rafId = requestAnimationFrame(() => {
      timeoutId = setTimeout(() => {
        const el = barChartWrapRef.current;
        if (!el) return;
        const bars = el.querySelectorAll<SVGPathElement>('.recharts-rectangle');
        if (bars.length === 0) return;
        gsap.fromTo(
          bars,
          { scaleX: 0, opacity: 0, transformOrigin: 'left center' },
          { scaleX: 1, opacity: 1, duration: 0.6, ease: 'power2.out', stagger: 0.12 }
        );
      }, 30);
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [stats]);

  // 📅 'YYYY-MM-DD' → 'DD' (X ღერძის კომპაქტური ლეიბლი Line Chart-ზე)
  const formatDayTick = (day: string): string => day.slice(8, 10);
  // 📅 tooltip-ის სრული ქართული თარიღი
  const formatDayFull = (day: string): string =>
    new Date(day).toLocaleDateString('ka-GE', { day: 'numeric', month: 'long' });

  // ⏰ Roadmap ეტაპი 6 — hourly-peak chart-ის ტიკ/tooltip ფორმატერები.
  // X ღერძზე მოკლედ (მაგ. "9"), tooltip-ში სრულად ("09:00").
  const formatHourTick = (hour: number): string => String(hour);
  const formatHourFull = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

  if (loading) {
    return <div className={styles.stateBox}>იტვირთება ანალიტიკა...</div>;
  }

  if (error || !stats) {
    return (
      <div className={styles.errorBox}>
        <p>⚠ {error || 'მონაცემები ვერ ჩაიტვირთა'}</p>
        <button onClick={loadStats} className={styles.retryBtn}>
          ხელახლა ცდა
        </button>
      </div>
    );
  }

  const cards: StatCard[] = [
    { label: 'დღევანდელი შემოსავალი', rawValue: stats.today.revenue, decimals: 2, suffix: ' ₾', icon: '💰', color: '#10b981' },
    { label: 'დღევანდელი ჩეკები', rawValue: stats.today.receiptCount, icon: '🧾', color: '#3b82f6' },
    { label: 'საშუალო ჩეკი', rawValue: stats.today.averageReceipt, decimals: 2, suffix: ' ₾', icon: '📊', color: '#8b5cf6' },
    { label: 'აქტიური ცვლები', rawValue: stats.activeShifts, icon: '🟢', color: '#f59e0b' },
  ];

  // 💰 Roadmap ეტაპი 8 — დღევანდელი შემოსავლის იგივე ჯამის დაშლა
  // გადახდის მეთოდის მიხედვით (ნაღდი / ბარათი / შერეული).
  const paymentCards: StatCard[] = [
    {
      label: 'ნაღდი გადახდები',
      rawValue: stats.paymentBreakdown.cash.total,
      decimals: 2,
      suffix: ' ₾',
      subtitle: `${stats.paymentBreakdown.cash.count} ჩეკი`,
      icon: '💵',
      color: '#10b981',
    },
    {
      label: 'ბარათით გადახდები',
      rawValue: stats.paymentBreakdown.card.total,
      decimals: 2,
      suffix: ' ₾',
      subtitle: `${stats.paymentBreakdown.card.count} ჩეკი`,
      icon: '💳',
      color: '#3b82f6',
    },
    {
      label: 'შერეული გადახდები',
      rawValue: stats.paymentBreakdown.split.total,
      decimals: 2,
      suffix: ' ₾',
      subtitle: `${stats.paymentBreakdown.split.count} ჩეკი`,
      icon: '🔀',
      color: '#8b5cf6',
    },
  ];

  // 🚫 Roadmap ეტაპი 8 — დღევანდელი გაუქმებული ჩეკები, ცალკე ბარათი (წითელი
  // აქცენტი, თანხობრივად ცხადად გამოსარჩევად).
  const voidedCards: StatCard[] = [
    { label: 'გაუქმებული ჩეკები', rawValue: stats.voided.count, icon: '🚫', color: '#dc2626' },
    { label: 'გაუქმებული თანხა', rawValue: stats.voided.total, decimals: 2, suffix: ' ₾', icon: '🚫', color: '#dc2626' },
  ];

  return (
    <div>
      {/* 🃏 ანალიტიკური ბარათები */}
      <div className={styles.cardGrid}>
        {cards.map((card) => <StatCardView key={card.label} card={card} />)}
      </div>

      {/* 💰 Roadmap ეტაპი 8 — გადახდის მეთოდის მიხედვით დაშლილი ბარათები
          (იგივე "დღეს" scope, რაც ზემოთა ბარათებს). */}
      <div className={styles.cardGrid}>
        {paymentCards.map((card) => <StatCardView key={card.label} card={card} />)}
      </div>

      {/* 🚫 Roadmap ეტაპი 8 — გაუქმებული ჩეკების ბარათები */}
      <div className={styles.cardGrid}>
        {voidedCards.map((card) => <StatCardView key={card.label} card={card} />)}
      </div>

      {/* 🔔 Roadmap STEP 5 — Background Sync-ის Stock Deficit ნოტიფიკაციები.
          POST /api/payments/sync-offline-მ (backend/src/routes/sales.ts)
          ორი Register-ის დამოუკიდებელი offline oversell-ი აღმოაჩინა —
          products.stock უარყოფითზეც კი დაუშვა (migration 011), მაგრამ
          ეს ფაქტი მენეჯერს აქ უნდა დაანახოს. */}
      {!deficitsLoading && deficits.length > 0 && (
        <div className={styles.deficitPanel}>
          <div className={styles.deficitHeader}>
            <h3 className={styles.chartTitle}>⚠️ ოფლაინ სინქრონიზაციის oversell შეტყობინებები</h3>
            <span className={styles.deficitCountBadge}>{deficits.length}</span>
          </div>
          <div className={styles.deficitList}>
            {deficits.map((d) => (
              <div key={d.id} className={styles.deficitRow}>
                <div className={styles.deficitMain}>
                  <strong>{d.product_name}</strong>
                  <span className={styles.deficitQty}>
                    მოთხოვნილი {d.requested_quantity} ცალი, ხელმისაწვდომი იყო {d.available_quantity} ცალი
                    (დეფიციტი: {d.deficit_quantity} ცალი)
                  </span>
                </div>
                <div className={styles.deficitMeta}>
                  <span>{d.cashier_name || 'უცნობი მოლარე'}</span>
                  <span>{d.register_name || 'უცნობი სალარო'}</span>
                  <span>{new Date(d.created_at).toLocaleString('ka-GE', { hour12: false })}</span>
                </div>
                <button
                  className={styles.resolveBtn}
                  onClick={() => handleResolveDeficit(d.id)}
                  disabled={resolvingId === d.id}
                >
                  {resolvingId === d.id ? '...' : '✅ განხილულია'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 🧾 Migration 012 — Late-sync-ის მიერ შეცვლილი (already-closed)
          ცვლების Z-Report ნოტიფიკაციები. */}
      {!amendmentsLoading && amendments.length > 0 && (
        <div className={styles.amendmentPanel}>
          <div className={styles.deficitHeader}>
            <h3 className={styles.chartTitle}>🧾 დაგვიანებული სინქრონიზაციით შეცვლილი Z-Report-ები</h3>
            <span className={styles.amendmentCountBadge}>{amendments.length}</span>
          </div>
          <div className={styles.deficitList}>
            {amendments.map((a) => (
              <div key={a.id} className={styles.deficitRow}>
                <div className={styles.deficitMain}>
                  <strong>ცვლა #{a.shift_id.slice(0, 8)}</strong>
                  <span className={styles.deficitQty}>
                    მოსალოდნელი: {a.previous_expected.toFixed(2)} ₾ → {a.new_expected.toFixed(2)} ₾,
                    სხვაობა: {a.previous_difference.toFixed(2)} ₾ → {a.new_difference.toFixed(2)} ₾
                  </span>
                </div>
                <div className={styles.deficitMeta}>
                  <span>{a.cashier_name || 'უცნობი მოლარე'}</span>
                  <span>{a.register_name || 'უცნობი სალარო'}</span>
                  <span>{new Date(a.created_at).toLocaleString('ka-GE', { hour12: false })}</span>
                </div>
                <button
                  className={styles.resolveBtn}
                  onClick={() => handleResolveAmendment(a.id)}
                  disabled={resolvingAmendmentId === a.id}
                >
                  {resolvingAmendmentId === a.id ? '...' : '✅ ხელახლა დავბეჭდე'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 📈📊 გრაფიკები */}
      <div className={styles.chartGrid}>
        {/* ხაზოვანი გრაფიკი — გაყიდვების დინამიკა მიმდინარე თვეში */}
        <div className={styles.chartCard}>
          <h3 className={styles.chartTitle}>📈 გაყიდვების დინამიკა (მიმდინარე თვე)</h3>
          {stats.dailyTrend.length === 0 ? (
            <p className={styles.chartEmpty}>მონაცემები არ მოიძებნა</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={stats.dailyTrend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F2" vertical={false} />
                <XAxis dataKey="day" tickFormatter={formatDayTick} stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                {/* ⚠️ Recharts-ის Tooltip formatter/labelFormatter პარამეტრები ფართო
                    generic ტიპებია (ReactNode/ValueType | undefined) — ანოტაციის
                    ნაცვლად კონტექსტური ტიპის დაშვება + String()/Number() უსაფრთხო
                    კონვერტაცია, "as"/"any"-ის გარეშე. */}
                <Tooltip
                  labelFormatter={(label) => formatDayFull(String(label))}
                  formatter={(value) => [`${Number(value).toFixed(2)} ₾`, 'შემოსავალი']}
                  contentStyle={{ backgroundColor: '#FFFFFF', borderRadius: 10, border: '1px solid #E9ECEF', boxShadow: '0 10px 20px rgba(17,17,17,0.08)' }}
                  labelStyle={{ color: '#111111', fontWeight: 600, marginBottom: 4 }}
                />
                <Legend formatter={() => 'შემოსავალი (₾)'} />
                <Line type="monotone" dataKey="revenue" name="revenue" stroke="#2563EB" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* სვეტოვანი გრაფიკი — ტოპ 5 პროდუქტი */}
        <div className={styles.chartCard} ref={barChartWrapRef}>
          <h3 className={styles.chartTitle}>🏆 ტოპ 5 პროდუქტი (მიმდინარე თვე)</h3>
          {stats.topProducts.length === 0 ? (
            <p className={styles.chartEmpty}>მონაცემები არ მოიძებნა</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stats.topProducts} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F2" horizontal={false} />
                <XAxis type="number" stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={110} stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value) => [`${Number(value)} ცალი`, 'რაოდენობა']}
                  contentStyle={{ backgroundColor: '#FFFFFF', borderRadius: 10, border: '1px solid #E9ECEF', boxShadow: '0 10px 20px rgba(17,17,17,0.08)' }}
                  labelStyle={{ color: '#111111', fontWeight: 600, marginBottom: 4 }}
                  cursor={{ fill: 'rgba(37, 99, 235, 0.05)' }}
                />
                {/* isAnimationActive={false} — Recharts-ის ჩაშენებული ერთდროული
                    ანიმაცია გამორთულია, GSAP-ის stagger-ი (useEffect ზემოთ) მართავს
                    თითოეული ბარის reveal-ს ცალ-ცალკე. */}
                <Bar dataKey="totalQuantity" name="რაოდენობა" fill="#93C5FD" radius={[0, 6, 6, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ⏰ Roadmap ეტაპი 6 — hourly-peak chart (30.08.2026-ის roadmap-გასწორების
            TODO). 24-საათიანი bar chart, "peak" საათების დანახვისთვის — მოლარეების
            განრიგის დაგეგმვას (shift optimization) ემსახურება. Full-width
            (`chartCardWide`), ორივე ზემოთა ვიწრო chart-ის ქვემოთ. */}
        <div className={`${styles.chartCard} ${styles.chartCardWide}`}>
          <h3 className={styles.chartTitle}>⏰ დატვირთვა საათების მიხედვით (მიმდინარე თვე)</h3>
          {stats.hourlyPeak.length === 0 ? (
            <p className={styles.chartEmpty}>მონაცემები არ მოიძებნა</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stats.hourlyPeak} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F2" vertical={false} />
                <XAxis dataKey="hour" tickFormatter={formatHourTick} stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  labelFormatter={(label) => formatHourFull(Number(label))}
                  formatter={(value) => [`${Number(value)} ჩეკი`, 'ჩეკების რაოდენობა']}
                  contentStyle={{ backgroundColor: '#FFFFFF', borderRadius: 10, border: '1px solid #E9ECEF', boxShadow: '0 10px 20px rgba(17,17,17,0.08)' }}
                  labelStyle={{ color: '#111111', fontWeight: 600, marginBottom: 4 }}
                  cursor={{ fill: 'rgba(37, 99, 235, 0.05)' }}
                />
                <Bar dataKey="receiptCount" name="ჩეკები" fill="#FBBF24" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
