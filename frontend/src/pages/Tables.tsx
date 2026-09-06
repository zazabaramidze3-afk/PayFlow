// frontend/src/pages/Tables.tsx
//
// 🍽️ HoReCa Module STEP 1 (Roadmap "03.09.2026") — მაგიდების floor plan.
// ხედავს ნებისმიერი როლი, ვისაც HoReCa ორგანიზაციაში "🍽️ მაგიდები"
// ნავიგაცია აქვს (App.tsx). Admin/manager-ს ამატება/რედაქტირება/წაშლის
// უფლებაც აქვს (`canManage` prop, App.tsx-ის `isAdminOrManager`-ის იგივე
// მნიშვნელობა) — ბექენდზეც ეს ოპერაციები `requireAnyRole('admin',
// 'manager')`-ს უკან დგას (routes/tables.ts), ეს mask მხოლოდ UI-ის
// მოხერხებულობისთვისაა, არა უსაფრთხოების ბარიერი.
//
// მაგიდის ბარათზე დაჭერა ყოველთვის ხსნის OrderScreen-ს (მიუხედავად
// მიმდინარე სტატუსისა) — თუ ღია შეკვეთა უკვე არსებობს ამ მაგიდაზე,
// OrderScreen-ი მას თავად პოულობს (GET /orders?status=open), წინააღმდეგ
// შემთხვევაში სთავაზობს ახლის გახსნას. სტატუსის "სწრაფი" ღილაკები
// (თავისუფალი/დაჯავშნილი/დასალაგებელი) ჩანს მხოლოდ მაშინ, თუ სტატუსი
// არ არის 'occupied' — დაკავებული მაგიდის გათავისუფლება მხოლოდ
// checkout/void-ის გავლით ხდება (routes/orders.ts), არა ხელით.

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import styles from './Tables.module.scss';
import OrderScreen from './OrderScreen';
import ConfirmModal from '../components/ConfirmModal';
import { RestaurantTable, TableStatus } from '../lib/horecaTypes';

interface TablesProps {
  canManage: boolean;
}

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; }

// 🩹 FIX (05.09.2026) — მინი shift-კონტროლი (STEP 4-ის დასკვნა): მანამდე
// ცვლის გახსნა/დახურვის ერთადერთი UI Sales.tsx-ში (Retail POS) იყო,
// რომლის sidebar-ლინკიც მხოლოდ userRole === 'cashier'-ზეა გამოსახული
// (App.tsx) — waiter-ს, HoReCa-ს ახალ როლს, ცვლის გახსნის არანაირი გზა
// არ ჰქონდა, მიუხედავად იმისა, რომ POST /shifts/open და checkActiveShift
// (checkShift.ts) უკვე მხარს უჭერენ ('waiter' + 'cashier' ორივეს, STEP 4-ის
// ადრინდელი ფიქსით). ეს ვიჯეტი (ქვემოთ) cashier-ისთვისაც და waiter-ისთვისაც
// პირდაპირ Tables.tsx-ში აჩვენებს ცვლის სტატუსს + გახსნა/დახურვის ღილაკს,
// Sales.tsx-ის სრული POS ეკრანის ხილვადობის გაფართოების გარეშე.
interface ZReportData {
  start?: number;
  expected?: number;
  actual?: number;
  difference?: number;
  receiptCount?: number;
}

const POLL_INTERVAL_MS = 8000;

const STATUS_LABEL: Record<TableStatus, string> = {
  free: 'თავისუფალი',
  occupied: 'დაკავებული',
  reserved: 'დაჯავშნილი',
  dirty: 'დასალაგებელი',
};

const STATUS_BADGE_CLASS: Record<TableStatus, string> = {
  free: 'statusBadgeFree',
  occupied: 'statusBadgeOccupied',
  reserved: 'statusBadgeReserved',
  dirty: 'statusBadgeDirty',
};

const STATUS_CARD_CLASS: Record<TableStatus, string> = {
  free: 'statusFree',
  occupied: 'statusOccupied',
  reserved: 'statusReserved',
  dirty: 'statusDirty',
};

const QUICK_STATUSES: TableStatus[] = ['free', 'reserved', 'dirty'];
const QUICK_STATUS_LABEL: Record<TableStatus, string> = {
  free: '🟢 თავისუფალი',
  occupied: '🔴 დაკავებული',
  reserved: '🟡 დაჯავშნილი',
  dirty: '⚪ დასალაგებელი',
};

export default function Tables({ canManage }: TablesProps) {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  // ✏️ დამატება/რედაქტირების მოდალის state (admin/manager)
  const [showFormModal, setShowFormModal] = useState<boolean>(false);
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [formName, setFormName] = useState<string>('');
  const [formSection, setFormSection] = useState<string>('');
  const [formCapacity, setFormCapacity] = useState<string>('');
  const [formSaving, setFormSaving] = useState<boolean>(false);

  // 🩹 მინი shift-კონტროლის state (იხ. ZReportData-ის კომენტარი ზემოთ).
  // hasActiveShift === null → სტატუსი ჯერ არ ჩატვირთულა (ან canManage===true,
  // ანუ admin/manager-ს ცვლა საერთოდ არ ეხება).
  const [hasActiveShift, setHasActiveShift] = useState<boolean | null>(null);
  const [activeShift, setActiveShift] = useState<{ id: string; opened_at: string } | null>(null);
  const [showOpenShiftModal, setShowOpenShiftModal] = useState<boolean>(false);
  const [startAmount, setStartAmount] = useState<string>('0');
  const [openingShift, setOpeningShift] = useState<boolean>(false);
  const [showCloseShiftModal, setShowCloseShiftModal] = useState<boolean>(false);
  const [endAmountActual, setEndAmountActual] = useState<string>('');
  const [closingShift, setClosingShift] = useState<boolean>(false);
  const [zReport, setZReport] = useState<ZReportData | null>(null);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const fetchTables = useCallback(async () => {
    try {
      const response = await axios.get<RestaurantTable[]>('/api/tables');
      setTables(response.data);
    } catch (error: unknown) {
      const message = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      showToast(message || 'მაგიდების ჩატვირთვა ვერ მოხერხდა', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchTables();
    // 🔁 Floor plan-ი პოლინგით განახლდება (8წმ) — რამდენიმე ტერმინალი
    // შეიძლება ერთდროულად მუშაობდეს იმავე მაგიდებზე. OrderScreen-ში
    // ყოფნისას (selectedTable !== null) პოლინგი ჩერდება, რომ ორმა
    // ერთდროულმა request-მა ერთმანეთს ხელი არ შეუშალოს.
    if (selectedTable) return;
    const interval = window.setInterval(fetchTables, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [fetchTables, selectedTable]);

  // 🕐 ცვლის სტატუსი — მხოლოდ cashier/waiter-ისთვის (canManage === false);
  // admin/manager-ს register/shift-კონტექსტი საერთოდ არ სჭირდება.
  const fetchShiftStatus = useCallback(async () => {
    if (canManage) return;
    try {
      const response = await axios.get('/api/shifts/status');
      setHasActiveShift(Boolean(response.data?.hasActiveShift));
      setActiveShift(response.data?.shift ?? null);
    } catch {
      // 🔇 არაკრიტიკული ვიჯეტია — ჩავარდნისას წინა ცნობილ მდგომარეობას
      // ვინარჩუნებთ, splitBill/checkout-ის საკუთარი შეცდომები საკმარისია.
    }
  }, [canManage]);

  useEffect(() => {
    fetchShiftStatus();
  }, [fetchShiftStatus]);

  const handleQuickStatus = async (table: RestaurantTable, status: TableStatus, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await axios.patch(`/api/tables/${table.id}/status`, { status });
      setTables(prev => prev.map(t => (t.id === table.id ? { ...t, status } : t)));
    } catch (error: unknown) {
      const message = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      showToast(message || 'სტატუსის შეცვლა ვერ მოხერხდა', 'error');
    }
  };

  const openCreateModal = () => {
    setEditingTable(null);
    setFormName('');
    setFormSection('');
    setFormCapacity('');
    setShowFormModal(true);
  };

  const openEditModal = (table: RestaurantTable, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTable(table);
    setFormName(table.name);
    setFormSection(table.section ?? '');
    setFormCapacity(table.capacity !== null ? String(table.capacity) : '');
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingTable(null);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      showToast('მაგიდის სახელი სავალდებულოა', 'error');
      return;
    }

    setFormSaving(true);
    const payload = {
      name: formName.trim(),
      section: formSection.trim() || undefined,
      capacity: formCapacity.trim() || undefined,
    };

    try {
      if (editingTable) {
        await axios.put(`/api/tables/${editingTable.id}`, payload);
        showToast('მაგიდა განახლდა', 'success');
      } else {
        await axios.post('/api/tables', payload);
        showToast('მაგიდა დაემატა', 'success');
      }
      closeFormModal();
      fetchTables();
    } catch (error: unknown) {
      const message = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      showToast(message || 'შენახვა ვერ მოხერხდა', 'error');
    } finally {
      setFormSaving(false);
    }
  };

  // 🩹 FIX (04.09.2026) — Sales.tsx-ის "confirmModal" პატერნის ანალოგიით
  // (../components/ConfirmModal.tsx, OrderScreen.tsx-თან გაზიარებული):
  // ბრაუზერის ნატიური `window.confirm()`-ის ნაცვლად სტილიზებული მოდალი.
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(
    null
  );
  const closeConfirmModal = () => setConfirmModal(null);

  const performDelete = async (table: RestaurantTable) => {
    try {
      await axios.delete(`/api/tables/${table.id}`);
      showToast('მაგიდა წაიშალა', 'success');
      fetchTables();
    } catch (error: unknown) {
      const message = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      showToast(message || 'წაშლა ვერ მოხერხდა', 'error');
    }
  };

  const handleDelete = (table: RestaurantTable, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmModal({
      title: '🗑️ მაგიდის წაშლა',
      message: `წავშალოთ მაგიდა "${table.name}"?`,
      onConfirm: () => {
        closeConfirmModal();
        void performDelete(table);
      },
    });
  };

  // 🔙 OrderScreen-იდან დაბრუნებისას (checkout/void/უკან) — მაგიდების
  // სია თავიდან იტვირთება, რომ სტატუსის ცვლილება დაუყოვნებლივ აისახოს.
  const handleOrderChanged = useCallback(() => {
    fetchTables();
  }, [fetchTables]);

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setOpeningShift(true);
    try {
      const parsedStart = parseFloat(startAmount) || 0;
      await axios.post('/api/shifts/open', { start_amount: parsedStart });
      showToast('ცვლა გაიხსნა', 'success');
      setShowOpenShiftModal(false);
      setStartAmount('0');
      fetchShiftStatus();
    } catch (error: unknown) {
      const message = axios.isAxiosError<{ error?: string; message?: string }>(error)
        ? error.response?.data?.error ?? error.response?.data?.message
        : undefined;
      showToast(message || 'ცვლის გახსნა ვერ მოხერხდა', 'error');
    } finally {
      setOpeningShift(false);
    }
  };

  // 🩹 FIX (05.09.2026) — იგივე ვალიდაცია, რაც Sales.tsx-ის endAmountActual-ს
  // დაემატა: ცარიელი/არავალიდური მნიშვნელობა ცალსახად იბლოკება submit-ზე,
  // ჩუმად 0-დ აღარ ითვლება (რაც ცრუ დიდ "სხვაობას" აჩვენებდა Z-Report-ში).
  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedEndAmount = parseFloat(endAmountActual);
    if (endAmountActual.trim() === '' || !Number.isFinite(parsedEndAmount) || parsedEndAmount < 0) {
      showToast('შეიყვანეთ სალაროში დათვლილი ფაქტობრივი ნაღდი ფულის ოდენობა', 'error');
      return;
    }
    setClosingShift(true);
    try {
      const response = await axios.put<ZReportData>('/api/shifts/close', { end_amount_actual: parsedEndAmount });
      setZReport(response.data);
    } catch (error: unknown) {
      const message = axios.isAxiosError<{ error?: string; message?: string }>(error)
        ? error.response?.data?.error ?? error.response?.data?.message
        : undefined;
      showToast(message || 'ცვლის დახურვა ვერ მოხერხდა', 'error');
    } finally {
      setClosingShift(false);
    }
  };

  const closeCloseShiftModal = () => {
    setShowCloseShiftModal(false);
    setZReport(null);
    setEndAmountActual('');
    fetchShiftStatus();
  };

  if (selectedTable) {
    return (
      <OrderScreen
        table={selectedTable}
        canManage={canManage}
        onBack={() => setSelectedTable(null)}
        onOrderChanged={handleOrderChanged}
      />
    );
  }

  return (
    <div className={styles.tablesContainer}>
      <div className={styles.topPanel}>
        <div>
          <h2>🍽️ მაგიდები</h2>
          <small>დააჭირეთ მაგიდას შეკვეთის სანახავად/გასახსნელად</small>
        </div>
        {canManage && (
          <button onClick={openCreateModal} className={`${styles.btn} ${styles.btnPrimary}`}>
            ➕ ახალი მაგიდა
          </button>
        )}
      </div>

      {!canManage && (
        <div className={styles.shiftBar}>
          {hasActiveShift === null ? (
            <span className={styles.shiftLoading}>ცვლის სტატუსი იტვირთება...</span>
          ) : hasActiveShift ? (
            <>
              <span className={`${styles.shiftBadge} ${styles.shiftBadgeOpen}`}>
                🟢 ცვლა აქტიურია{activeShift?.opened_at ? ` — გახსნილია: ${activeShift.opened_at}` : ''}
              </span>
              <button type="button" onClick={() => setShowCloseShiftModal(true)} className={`${styles.btn} ${styles.btnDanger}`}>
                🛑 ცვლის დახურვა
              </button>
            </>
          ) : (
            <>
              <span className={`${styles.shiftBadge} ${styles.shiftBadgeClosed}`}>🔒 ცვლა დახურულია</span>
              <button type="button" onClick={() => setShowOpenShiftModal(true)} className={`${styles.btn} ${styles.btnPrimary}`}>
                🚀 ცვლის გახსნა
              </button>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className={styles.emptyState}>იტვირთება...</div>
      ) : tables.length === 0 ? (
        <div className={styles.emptyState}>
          მაგიდები ჯერ არ არის დამატებული.
          {canManage && ' დააჭირეთ "➕ ახალი მაგიდა"-ს ზემოთ.'}
        </div>
      ) : (
        <div className={styles.grid}>
          {tables.map(table => (
            <div
              key={table.id}
              className={`${styles.tableCard} ${styles[STATUS_CARD_CLASS[table.status]]}`}
            >
              {canManage && (
                <div className={styles.cardActions}>
                  <button className={styles.iconBtn} onClick={e => openEditModal(table, e)} aria-label="რედაქტირება">✏️</button>
                  <button className={styles.iconBtn} onClick={e => handleDelete(table, e)} aria-label="წაშლა">🗑️</button>
                </div>
              )}
              <div className={styles.cardMain} onClick={() => setSelectedTable(table)}>
                <span className={styles.tableName}>{table.name}</span>
                {table.section && <span className={styles.tableMeta}>{table.section}</span>}
                {table.capacity !== null && <span className={styles.tableMeta}>👥 {table.capacity} ადგილი</span>}
                <span className={styles[STATUS_BADGE_CLASS[table.status]]}>{STATUS_LABEL[table.status]}</span>
              </div>
              {table.status !== 'occupied' && (
                <div className={styles.quickStatusRow}>
                  {QUICK_STATUSES.map(status => (
                    <button
                      key={status}
                      className={`${styles.quickStatusBtn} ${table.status === status ? styles.active : ''}`}
                      onClick={e => handleQuickStatus(table, status, e)}
                    >
                      {QUICK_STATUS_LABEL[status]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showFormModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBody}>
            <h3>{editingTable ? '✏️ მაგიდის რედაქტირება' : '➕ ახალი მაგიდა'}</h3>
            <form onSubmit={handleFormSubmit}>
              <div className={styles.formGroup}>
                <label>სახელი</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className={styles.inputField}
                  placeholder="მაგიდა 5"
                  autoFocus
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label>სექცია (არასავალდებულო)</label>
                <input
                  type="text"
                  value={formSection}
                  onChange={e => setFormSection(e.target.value)}
                  className={styles.inputField}
                  placeholder="დარბაზი / ტერასა / ბარი"
                />
              </div>
              <div className={styles.formGroup}>
                <label>ტევადობა (არასავალდებულო)</label>
                <input
                  type="number"
                  min="1"
                  value={formCapacity}
                  onChange={e => setFormCapacity(e.target.value)}
                  className={styles.inputField}
                  placeholder="4"
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={closeFormModal} className={`${styles.btn} ${styles.btnSecondary}`} style={{ flex: 1 }}>
                  გაუქმება
                </button>
                <button type="submit" disabled={formSaving} className={`${styles.btn} ${styles.btnPrimary}`} style={{ flex: 1 }}>
                  {formSaving ? 'ინახება...' : 'შენახვა'}
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

      {showOpenShiftModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBody}>
            <h3>🚀 ცვლის გახსნა</h3>
            <form onSubmit={handleOpenShift}>
              <div className={styles.formGroup}>
                <label>საწყისი ნაღდი ფული სალაროში (₾)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={startAmount}
                  onChange={e => setStartAmount(e.target.value)}
                  className={styles.inputField}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={() => setShowOpenShiftModal(false)} disabled={openingShift} className={`${styles.btn} ${styles.btnSecondary}`} style={{ flex: 1 }}>
                  გაუქმება
                </button>
                <button type="submit" disabled={openingShift} className={`${styles.btn} ${styles.btnPrimary}`} style={{ flex: 1 }}>
                  {openingShift ? 'იხსნება...' : 'გახსნა'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCloseShiftModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBody}>
            {!zReport ? (
              <>
                <h3>🛑 ცვლის დახურვა</h3>
                <p>შეიყვანეთ სალაროში არსებული ფაქტობრივი ნაღდი ფული.</p>
                <form onSubmit={handleCloseShift}>
                  <div className={styles.formGroup}>
                    <label>💵 ფაქტობრივი ნაღდი ფული (₾)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={endAmountActual}
                      onChange={e => setEndAmountActual(e.target.value)}
                      className={styles.inputField}
                      autoFocus
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                    <button type="button" onClick={() => setShowCloseShiftModal(false)} disabled={closingShift} className={`${styles.btn} ${styles.btnSecondary}`} style={{ flex: 1 }}>
                      გაუქმება
                    </button>
                    <button
                      type="submit"
                      disabled={
                        closingShift ||
                        endAmountActual.trim() === '' ||
                        !Number.isFinite(parseFloat(endAmountActual)) ||
                        parseFloat(endAmountActual) < 0
                      }
                      className={`${styles.btn} ${styles.btnDanger}`}
                      style={{ flex: 1 }}
                    >
                      {closingShift ? 'მოწმდება...' : 'დახურვა'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <h3 className={styles.zReportTitle}>📊 ცვლა დაიხურა (Z-Report)</h3>
                <div className={styles.zReportBox}>
                  <div className={styles.zReportRow}>
                    <span>საწყისი:</span>
                    <strong>{Number(zReport.start ?? 0).toFixed(2)} ₾</strong>
                  </div>
                  <div className={styles.zReportRow}>
                    <span>გაყიდული ჩეკები:</span>
                    <strong>{zReport.receiptCount ?? 0}</strong>
                  </div>
                  <div className={styles.zReportRow}>
                    <span>მოსალოდნელი:</span>
                    <strong>{Number(zReport.expected ?? 0).toFixed(2)} ₾</strong>
                  </div>
                  <div className={styles.zReportRow}>
                    <span>ფაქტობრივი:</span>
                    <strong>{Number(zReport.actual ?? 0).toFixed(2)} ₾</strong>
                  </div>
                  <hr className={styles.zReportDivider} />
                  <div
                    className={`${styles.zReportRow} ${Number(zReport.difference ?? 0) < 0 ? styles.zReportNegative : styles.zReportPositive}`}
                  >
                    <span>სხვაობა:</span>
                    <strong>{Number(zReport.difference ?? 0).toFixed(2)} ₾</strong>
                  </div>
                </div>
                <button type="button" onClick={closeCloseShiftModal} className={`${styles.btn} ${styles.btnPrimary}`} style={{ width: '100%' }}>
                  დახურვა
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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
