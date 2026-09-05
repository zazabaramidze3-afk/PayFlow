// frontend/src/pages/KitchenDisplay.tsx
//
// 🍳 HoReCa Module STEP 2 — KDS ეკრანი (Roadmap "03.09.2026", STEP 2,
// "გზა 2": ბრაუზერის გვერდი + polling, thermal printer-ის (გზა 1) გარეშე
// — იხ. roadmap-ის "რეკომენდაცია v1"). ხედავს ნებისმიერი როლი, ვისაც
// HoReCa ორგანიზაციაში "🍳 სამზარეულო" ნავიგაცია აქვს (App.tsx, Tables.tsx-ის
// იგივე ხილვადობის წესი: cashier + admin/manager).
//
// Register/Shift context (RegisterGuard) აქ განზრახ **არ** არის — ეს არ
// არის POS ტრანზაქცია, მხოლოდ უკვე გახსნილი შეკვეთების item-ების
// კითხვა/სტატუსის წინსვლა (backend/src/routes/kitchen.ts).
//
// "Course-ის გაგზავნის UX" (roadmap-ის ღია საკითხი) — v1-ისთვის
// გადაწყდა ავტომატური გაგზავნით: item დამატებისთანავე (თუ station
// მინიჭებულია) მაშინვე 'sent'-ზეა და აქ ჩნდება, batch-ღილაკის გარეშე
// (routes/orders.ts-ის კომენტარი).

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import styles from './KitchenDisplay.module.scss';
import { KitchenTicket, KitchenStatus, OrderStation } from '../lib/horecaTypes';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; }

type Station = NonNullable<OrderStation>;

const POLL_INTERVAL_MS = 4000;

const STATION_TABS: { value: Station; label: string }[] = [
  { value: 'kitchen', label: '🍳 სამზარეულო' },
  { value: 'bar', label: '🍹 ბარი' },
];

// 🔀 ერთადერთი "შემდეგი ნაბიჯი" თითო სტატუსზე — backend/src/routes/
// kitchen.ts-ის ALLOWED_TRANSITIONS-ის იგივე თანმიმდევრობის frontend
// ანარეკლი (მხოლოდ ჩვენებისთვის; ვალიდაცია საბოლოოდ სერვერზეა).
const NEXT_ACTION: Partial<Record<KitchenStatus, { next: KitchenStatus; label: string; className: string }>> = {
  pending: { next: 'preparing', label: '🔥 დაწყება', className: 'actionStart' },
  sent: { next: 'preparing', label: '🔥 დაწყება', className: 'actionStart' },
  preparing: { next: 'ready', label: '✅ მზადაა', className: 'actionReady' },
  ready: { next: 'served', label: '🍽️ მიტანილია', className: 'actionServed' },
};

const STATUS_LABEL: Record<KitchenStatus, string> = {
  pending: 'მოლოდინში',
  sent: 'ახალი',
  preparing: 'მზადდება',
  ready: 'მზადაა',
  served: 'მიტანილია',
  voided: 'გაუქმებული',
};

function elapsedMinutes(iso: string | null): number {
  if (!iso) return 0;
  const diffMs = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diffMs / 60000));
}

function elapsedClass(minutes: number): string {
  if (minutes >= 12) return 'elapsedDanger';
  if (minutes >= 6) return 'elapsedWarning';
  return 'elapsedOk';
}

export default function KitchenDisplay() {
  const [station, setStation] = useState<Station>('kitchen');
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);
  // ⏱️ ერთი წამის ტიკერი მხოლოდ "რამდენი წუთია" ბეჯების გადასათვლელად —
  // ცალკეა GET /kitchen/tickets-ის polling-ისგან (ქვემოთ), რომ ბეჯი
  // network round-trip-ის გარეშეც ცოცხლად „იდიხოს".
  const [, forceTick] = useState(0);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const fetchTickets = useCallback(async (stationValue: Station) => {
    try {
      const response = await axios.get<KitchenTicket[]>('/api/kitchen/tickets', { params: { station: stationValue } });
      setTickets(response.data);
    } catch (error: unknown) {
      const message = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      showToast(message || 'ტიკეტების ჩატვირთვა ვერ მოხერხდა', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    setLoading(true);
    fetchTickets(station);
    const interval = window.setInterval(() => fetchTickets(station), POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [fetchTickets, station]);

  useEffect(() => {
    const tickInterval = window.setInterval(() => forceTick(t => t + 1), 30000);
    return () => window.clearInterval(tickInterval);
  }, []);

  const handleAdvance = async (ticket: KitchenTicket) => {
    const action = NEXT_ACTION[ticket.kitchen_status];
    if (!action) return;

    setUpdatingId(ticket.id);
    try {
      await axios.patch(`/api/kitchen/tickets/${ticket.id}/status`, { status: action.next });
      if (action.next === 'served') {
        // 🍽️ "მიტანილია" ტიკეტს KDS-იდან საერთოდ აშორებს (GET
        // /kitchen/tickets-ის WHERE kitchen_status NOT IN ('served',...))
        // — ლოკალურადაც ასე ვაფილტრავთ, შემდეგი poll-ის ლოდინის გარეშე.
        setTickets(prev => prev.filter(t => t.id !== ticket.id));
      } else {
        setTickets(prev => prev.map(t => (t.id === ticket.id ? { ...t, kitchen_status: action.next } : t)));
      }
    } catch (error: unknown) {
      const message = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      showToast(message || 'სტატუსის განახლება ვერ მოხერხდა', 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  // 🍽️ მაგიდის მიხედვით დაჯგუფება — ერთ მაგიდაზე რამდენიმე კერძი
  // ერთ ბარათთა ჯგუფად ჩანდეს, ცალკეული ტიკეტების ქაოსის ნაცვლად.
  const grouped = tickets.reduce<Map<string, KitchenTicket[]>>((acc, ticket) => {
    const key = ticket.order_id;
    const list = acc.get(key) ?? [];
    list.push(ticket);
    acc.set(key, list);
    return acc;
  }, new Map());

  return (
    <div className={styles.kdsContainer}>
      <div className={styles.topPanel}>
        <div>
          <h2>🍳 სამზარეულო/ბარის ეკრანი</h2>
          <small>ავტომატურად განახლდება — ახალი ტიკეტები დამატებისთანავე ჩნდება</small>
        </div>
        <div className={styles.stationTabs}>
          {STATION_TABS.map(tab => (
            <button
              key={tab.value}
              className={`${styles.stationTab} ${station === tab.value ? styles.active : ''}`}
              onClick={() => setStation(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className={styles.emptyState}>იტვირთება...</div>
      ) : grouped.size === 0 ? (
        <div className={styles.emptyState}>ამ სადგურზე აქტიური ტიკეტები არ არის.</div>
      ) : (
        <div className={styles.grid}>
          {Array.from(grouped.entries()).map(([orderId, items]) => (
            <div key={orderId} className={styles.orderGroup}>
              <div className={styles.orderGroupHeader}>
                {items[0].table_name ? `🍽️ ${items[0].table_name}` : '🥡 Takeaway/ბარი'}
              </div>
              {items.map(ticket => {
                const minutes = elapsedMinutes(ticket.sent_to_kitchen_at ?? ticket.created_at);
                const action = NEXT_ACTION[ticket.kitchen_status];
                return (
                  <div key={ticket.id} className={styles.ticketCard}>
                    <div className={styles.ticketMain}>
                      <span className={styles.ticketProduct}>
                        {ticket.quantity} × {ticket.product_name}
                      </span>
                      {ticket.seat_number !== null && (
                        <span className={styles.ticketMeta}>💺 ადგილი {ticket.seat_number}</span>
                      )}
                      {ticket.notes && <span className={styles.ticketNotes}>📝 {ticket.notes}</span>}
                    </div>
                    <div className={styles.ticketFooter}>
                      <span className={`${styles.elapsedBadge} ${styles[elapsedClass(minutes)]}`}>
                        ⏱ {minutes} წთ · {STATUS_LABEL[ticket.kitchen_status]}
                      </span>
                      {action && (
                        <button
                          className={`${styles.actionBtn} ${styles[action.className]}`}
                          disabled={updatingId === ticket.id}
                          onClick={() => handleAdvance(ticket)}
                        >
                          {updatingId === ticket.id ? '...' : action.label}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
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
    </div>
  );
}
