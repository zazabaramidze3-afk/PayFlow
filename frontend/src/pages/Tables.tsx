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
import { EditIcon, TrashIcon, UsersIcon, DashboardIcon, LockIcon, CashIcon } from '../components/Icons';
import OrderScreen from './OrderScreen';
import ConfirmModal from '../components/ConfirmModal';
import { RestaurantTable, TableStatus } from '../lib/horecaTypes';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

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
  // 🩹 FIX (06.09.2026) — HoReCa STEP 4, PUT /shifts/close-ის ახალი ველი
  // (migration 024) — ჯამური tip ცვლაზე, reconciliation-ისთვის.
  tipTotal?: number;
}

const POLL_INTERVAL_MS = 8000;

const getStatusLabel = (status: TableStatus): string => i18n.t(`tables.status.${status}`);

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

// 🎨 მინიმალისტური სტატუს-წერტილი (badge/quick-status ღილაკებში) — emoji-ის
// ნაცვლად, რომ OS-ის მიხედვით რენდერი არ იცვლებოდეს და თემასთან
// (light/dark) თანმიმდევრული დარჩეს.
const STATUS_DOT_CLASS: Record<TableStatus, string> = {
  free: 'dotFree',
  occupied: 'dotOccupied',
  reserved: 'dotReserved',
  dirty: 'dotDirty',
};

const QUICK_STATUSES: TableStatus[] = ['free', 'reserved', 'dirty'];

export default function Tables({ canManage }: TablesProps) {
  const { t } = useTranslation();
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
      showToast(message || t('tables.toasts.loadFailed'), 'error');
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
      showToast(message || t('tables.toasts.statusChangeFailed'), 'error');
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
      showToast(t('tables.toasts.nameRequired'), 'error');
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
        showToast(t('tables.toasts.updated'), 'success');
      } else {
        await axios.post('/api/tables', payload);
        showToast(t('tables.toasts.created'), 'success');
      }
      closeFormModal();
      fetchTables();
    } catch (error: unknown) {
      const message = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      showToast(message || t('tables.toasts.saveFailed'), 'error');
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
      showToast(t('tables.toasts.deleted'), 'success');
      fetchTables();
    } catch (error: unknown) {
      const message = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      showToast(message || t('tables.toasts.deleteFailed'), 'error');
    }
  };

  const handleDelete = (table: RestaurantTable, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmModal({
      title: t('tables.deleteConfirmTitle'),
      message: t('tables.deleteConfirmMessage', { name: table.name }),
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
      showToast(t('tables.toasts.shiftOpened'), 'success');
      setShowOpenShiftModal(false);
      setStartAmount('0');
      fetchShiftStatus();
    } catch (error: unknown) {
      const message = axios.isAxiosError<{ error?: string; message?: string }>(error)
        ? error.response?.data?.error ?? error.response?.data?.message
        : undefined;
      showToast(message || t('tables.toasts.openShiftFailed'), 'error');
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
      showToast(t('sales.toasts.enterActualCash'), 'error');
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
      showToast(message || t('tables.toasts.closeShiftFailed'), 'error');
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
          <h2>{t('tables.pageTitle')}</h2>
          <small>{t('tables.pageSubtitle')}</small>
        </div>
        {canManage && (
          <button onClick={openCreateModal} className={`${styles.btn} ${styles.btnPrimary}`}>
            {t('tables.addTable')}
          </button>
        )}
      </div>

      {!canManage && (
        <div className={styles.shiftBar}>
          {hasActiveShift === null ? (
            <span className={styles.shiftLoading}>{t('tables.shiftStatusLoading')}</span>
          ) : hasActiveShift ? (
            <>
              <span className={`${styles.shiftBadge} ${styles.shiftBadgeOpen}`}>
                {t('tables.shiftActiveBadge')}{activeShift?.opened_at ? t('tables.shiftOpenedSuffix', { time: activeShift.opened_at }) : ''}
              </span>
              <button type="button" onClick={() => setShowCloseShiftModal(true)} className={`${styles.btn} ${styles.btnDanger}`}>
                {t('tables.closeShiftBtn')}
              </button>
            </>
          ) : (
            <>
              <span className={`${styles.shiftBadge} ${styles.shiftBadgeClosed}`}>{t('tables.shiftClosedBadge')}</span>
              <button type="button" onClick={() => setShowOpenShiftModal(true)} className={`${styles.btn} ${styles.btnPrimary}`}>
                {t('tables.openShiftBtn')}
              </button>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className={styles.emptyState}>{t('nav.loading')}</div>
      ) : tables.length === 0 ? (
        <div className={styles.emptyState}>
          {t('tables.emptyState')}
          {canManage && t('tables.emptyStateHint', { addTable: t('tables.addTable') })}
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
                  <button className={styles.iconBtn} onClick={e => openEditModal(table, e)} aria-label={t('tables.editAria')}><EditIcon /></button>
                  <button className={styles.iconBtn} onClick={e => handleDelete(table, e)} aria-label={t('tables.deleteAria')}><TrashIcon /></button>
                </div>
              )}
              <div className={styles.cardMain} onClick={() => setSelectedTable(table)}>
                <span className={styles.tableName}>{table.name}</span>
                {table.section && <span className={styles.tableMeta}>{table.section}</span>}
                {table.capacity !== null && (
                  <span className={styles.tableMeta}>
                    <UsersIcon /> {t('tables.capacityLabel', { count: table.capacity })}
                  </span>
                )}
                <span className={styles[STATUS_BADGE_CLASS[table.status]]}>
                  <span className={`${styles.dot} ${styles[STATUS_DOT_CLASS[table.status]]}`} />
                  {getStatusLabel(table.status)}
                </span>
              </div>
              {table.status !== 'occupied' && (
                <div className={styles.quickStatusRow}>
                  {QUICK_STATUSES.map(status => (
                    <button
                      key={status}
                      className={`${styles.quickStatusBtn} ${table.status === status ? styles.active : ''}`}
                      onClick={e => handleQuickStatus(table, status, e)}
                    >
                      <span className={`${styles.dot} ${styles[STATUS_DOT_CLASS[status]]}`} />
                      {getStatusLabel(status)}
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
            <h3>{editingTable ? t('tables.editTableTitle') : t('tables.addTable')}</h3>
            <form onSubmit={handleFormSubmit}>
              <div className={styles.formGroup}>
                <label>{t('tables.nameLabel')}</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className={styles.inputField}
                  placeholder={t('tables.namePlaceholder')}
                  autoFocus
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label>{t('tables.sectionLabel')}</label>
                <input
                  type="text"
                  value={formSection}
                  onChange={e => setFormSection(e.target.value)}
                  className={styles.inputField}
                  placeholder={t('tables.sectionPlaceholder')}
                />
              </div>
              <div className={styles.formGroup}>
                <label>{t('tables.capacityFormLabel')}</label>
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
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={formSaving} className={`${styles.btn} ${styles.btnPrimary}`} style={{ flex: 1 }}>
                  {formSaving ? t('tables.saving') : t('tables.save')}
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
            <h3>{t('tables.openShiftBtn')}</h3>
            <form onSubmit={handleOpenShift}>
              <div className={styles.formGroup}>
                <label>{t('sales.openingCashLabel')}</label>
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
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={openingShift} className={`${styles.btn} ${styles.btnPrimary}`} style={{ flex: 1 }}>
                  {openingShift ? t('tables.openingShift') : t('tables.openShiftSubmit')}
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
                <h3 className={styles.modalTitle}><LockIcon size={18} /> {t('tables.closeShiftModalTitle')}</h3>
                <p>{t('sales.closeShiftModalDesc')}</p>
                <form onSubmit={handleCloseShift}>
                  <div className={styles.formGroup}>
                    <label className={styles.labelIcon}><CashIcon size={14} /> {t('sales.actualCashLabel')}</label>
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
                      {t('common.cancel')}
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
                      {closingShift ? t('common.verifying') : t('sales.closeShiftButton')}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <h3 className={styles.zReportTitle}><DashboardIcon size={18} /> {t('sales.zReportTitle')}</h3>
                <div className={styles.zReportBox}>
                  <div className={styles.zReportRow}>
                    <span>{t('sales.zStart')}</span>
                    <strong>{Number(zReport.start ?? 0).toFixed(2)} ₾</strong>
                  </div>
                  <div className={styles.zReportRow}>
                    <span>{t('sales.zReceiptCount')}</span>
                    <strong>{zReport.receiptCount ?? 0}</strong>
                  </div>
                  <div className={styles.zReportRow}>
                    <span>{t('sales.zExpected')}</span>
                    <strong>{Number(zReport.expected ?? 0).toFixed(2)} ₾</strong>
                  </div>
                  <div className={styles.zReportRow}>
                    <span>{t('sales.zActual')}</span>
                    <strong>{Number(zReport.actual ?? 0).toFixed(2)} ₾</strong>
                  </div>
                  {/* 🩹 FIX (06.09.2026) — HoReCa STEP 4: ჯამური tip ცვლაზე. */}
                  {Number(zReport.tipTotal ?? 0) > 0 && (
                    <div className={styles.zReportRow}>
                      <span>{t('sales.zTipTotal')}</span>
                      <strong>{Number(zReport.tipTotal ?? 0).toFixed(2)} ₾</strong>
                    </div>
                  )}
                  <hr className={styles.zReportDivider} />
                  <div
                    className={`${styles.zReportRow} ${Number(zReport.difference ?? 0) < 0 ? styles.zReportNegative : styles.zReportPositive}`}
                  >
                    <span>{t('sales.zDifference')}</span>
                    <strong>{Number(zReport.difference ?? 0).toFixed(2)} ₾</strong>
                  </div>
                </div>
                <button type="button" onClick={closeCloseShiftModal} className={`${styles.btn} ${styles.btnPrimary}`} style={{ width: '100%' }}>
                  {t('common.close')}
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
