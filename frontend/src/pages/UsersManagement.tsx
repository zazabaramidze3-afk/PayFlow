
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import styles from './UsersManagement.module.scss';
import { KeyIcon, TrashIcon, LockIcon, UnlockIcon, PinIcon } from '../components/Icons';

interface UserPermission {
  // 🆔 UUID მიგრაცია (Roadmap STEP 1) — users.id ბექენდზე ახლა UUID
  // string-ია, აღარ არის SERIAL INTEGER.
  id: string;
  username: string;
  role: 'admin' | 'manager' | 'cashier' | 'waiter';
  status: 'ა ქ ტ ი უ რ ი ' | 'და ბ ლო კ ი ლი ';
  can_view_history: boolean;
  can_use_discount: boolean;
  // 🧾 Roadmap ეტაპი 4/5 — DEFAULT false-ია ბაზაში (დესტრუქციული მოქმედებები),
  // ამიტომ, განსხვავებით can_view_history-სგან, ახალ/არსებულ ყველა მომხმარებელს
  // საწყისად გამორთული აქვს, სანამ ადმინი/მენეჯერი აქედან არ ჩართავს.
  can_void_receipt: boolean;
  can_clear_cart: boolean;
  // ბაზის DEFAULT true-ის წყალობით ყველა მომხმარებელს (ახალსაც და
  // უკვე არსებულსაც) აქვს ეს ველი — GET /users ყოველთვის აბრუნებს.
  requires_password_reset: boolean;
  // 🔑 Manager PIN Override (Roadmap ეტაპი 2) — მხოლოდ ბულეანი დროშაა
  // ("დაყენებულია თუ არა"), PIN-ის bcrypt ჰეში backend-იდან არასდროს
  // არ ბრუნდება (იხ. GET /api/users-ის SELECT ბექენდზე).
  has_manager_pin: boolean;
}

type ToastType = 'success' | 'error';
interface ToastItem { id: number; message: string; type: ToastType; }

interface AuditLogEntry {
  // 🆔 UUID მიგრაცია (Roadmap STEP 1) — audit_logs.id/actor_id ბექენდზე
  // ახლა UUID string-ია, აღარ არის SERIAL INTEGER.
  id: string;
  action: string;
  // 🔑 Manager PIN Override ლოგებისთვის საჭირო — actor_name-ის გარდა spec
  // ცალსახად "ID: X" ფორმატს ითხოვს (იხ. renderAuditLogLine).
  actor_id: string | null;
  new_value: string | null;
  created_at: string;
  actor_name: string | null;
  target_name: string | null;
  target_role: 'admin' | 'manager' | 'cashier' | 'waiter' | null;
}

// 🖥️ Roadmap STEP 2.2 — GET /api/registers-ის row ფორმა (backend/src/types.ts-ის
// Register ინტერფეისის ზუსტი ანალოგი).
interface RegisterInfo {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

// 🔐 ჩეკბოქს-toggle action-ების i18n key-ების რუკა — ცალკე ობიექტად, რომ ახალი
// უფლების დამატებისას (Roadmap-ის შემდეგი ეტაპები) მხოლოდ აქ დაემატოს ერთი
// ხაზი, ternary-ების გაბმის ნაცვლად. ტექსტი კი i18n.t()-ით გამოითვლება
// გამოძახებისას (არა მოდულის ჩატვირთვისას), რომ ენის გადართვაზე რეაგირება იყოს.
const PERMISSION_LABEL_KEYS: Record<string, string> = {
  'history-access': 'usersManagement.permissionLabels.historyAccess',
  'discount-access': 'usersManagement.permissionLabels.discountAccess',
  'void-access': 'usersManagement.permissionLabels.voidAccess',
  'clear-cart-access': 'usersManagement.permissionLabels.clearCartAccess',
};

// 📜 თითოეული აუდიტ-ლოგის action-ისთვის ცალკე ქართული ტექსტი/ფერი.
// ძველი ბინარული ternary (history-access / "ყველაფერი დანარჩენი = discount-access")
// იყო რეალური ბაგის მიზეზი — Manager PIN Override-ის ახალი action ტიპები
// ("manager-pin-override", "manager-pin-override-used", "manager-pin-update")
// მასში ტყუილად "ფასდაკლების უფლება: გამორთო/ჩართო" ტექსტად გამოსახულიყო,
// რადგან new_value მათთვის არასდროს არის ლიტერალურად "true". ახალი action
// ტიპის დამატებისას აქ ცალკე "case" დაემატოს — არასდროს ჩავარდეს
// დადუმებულად default-ში.
function renderAuditLogLine(log: AuditLogEntry) {
  const actorName = log.actor_name ?? i18n.t('usersManagement.auditLog.unknownActor');
  const targetName = log.target_name ?? i18n.t('usersManagement.auditLog.unknownActor');

  switch (log.action) {
    case 'history-access':
    case 'discount-access':
    case 'void-access':
    case 'clear-cart-access': {
      const permissionLabelKey = PERMISSION_LABEL_KEYS[log.action];
      const permissionLabel = permissionLabelKey ? i18n.t(permissionLabelKey) : log.action;
      const turnedOn = log.new_value === 'true';
      return (
        <>
          {i18n.t('usersManagement.auditLog.changedPermission', { actor: actorName, target: targetName, permission: permissionLabel })}{' '}
          <span className={turnedOn ? styles.turnedOn : styles.turnedOff}>
            {turnedOn ? i18n.t('usersManagement.toggleState.on') : i18n.t('usersManagement.toggleState.off')}
          </span>
        </>
      );
    }
    // 🔑 მენეჯერმა დაადასტურა ერთჯერადი ფასდაკლების override მოლარისთვის
    // (POST /api/auth/verify-manager-pin წარმატება).
    case 'manager-pin-override':
      return (
        <>{i18n.t('usersManagement.auditLog.managerPinOverride', { actorId: log.actor_id ?? '—', target: targetName })}</>
      );
    // 🔑 override token რეალურად გამოყენებული იყო checkout-ზე
    // (POST /api/payments-ის წარმატებული commit). new_value ფორმატია "payment:<id>".
    case 'manager-pin-override-used': {
      const paymentId = log.new_value?.startsWith('payment:') ? log.new_value.slice('payment:'.length) : (log.new_value ?? '—');
      return (
        <>{i18n.t('usersManagement.auditLog.managerPinOverrideUsed', { paymentId, target: targetName })}</>
      );
    }
    // 🚫 მენეჯერის PIN-ით რეალურად გაუქმდა უკვე გატარებული ჩეკი
    // (POST /api/payments/:id/void-ის წარმატება, Roadmap ეტაპი 4).
    // new_value ფორმატია "payment:<id>" — sales.ts-ის writeAuditLog-ის ანალოგიით.
    case 'void-receipt-override': {
      const paymentId = log.new_value?.startsWith('payment:') ? log.new_value.slice('payment:'.length) : (log.new_value ?? '—');
      return (
        <>{i18n.t('usersManagement.auditLog.voidReceiptOverride', { paymentId, target: targetName })}</>
      );
    }
    // 🧺 მენეჯერის PIN-ით გასუფთავდა მთელი აქტიური კალათა POS ეკრანზე
    // (POST /api/cart/confirm-override, Roadmap ეტაპი 5).
    case 'clear-cart-override':
      return (
        <>{i18n.t('usersManagement.auditLog.clearCartOverride', { target: targetName })}</>
      );
    // 🧺 მენეჯერის PIN-ით წაიშალა კონკრეტული პროდუქტი კალათიდან
    // (POST /api/cart/confirm-override, Roadmap ეტაპი 5). new_value შეიცავს
    // წაშლილი პროდუქტის სახელს, თუ frontend-მა გადასცა (Sales.tsx-ის detail).
    case 'remove-item-override':
      return (
        <>
          {log.new_value && log.new_value !== 'confirmed'
            ? i18n.t('usersManagement.auditLog.removeItemOverrideWithItem', { item: log.new_value, target: targetName })
            : i18n.t('usersManagement.auditLog.removeItemOverride', { target: targetName })}
        </>
      );
    // 🔑 ADMIN-მა დაუყენა/შეუცვალა მენეჯერს PIN (PUT /api/users/:id/pin).
    case 'manager-pin-update':
      return (
        <>{i18n.t('usersManagement.auditLog.managerPinUpdate', { actor: actorName, target: targetName })}</>
      );
    default:
      return (
        <>{i18n.t('usersManagement.auditLog.defaultAction', { actor: actorName, target: targetName, action: log.action, value: log.new_value ?? i18n.t('usersManagement.auditLog.unknownValue') })}</>
      );
  }
}

interface UsersManagementProps {
  currentUserRole?: 'admin' | 'manager' | 'cashier' | 'waiter';
  // 🍽 HoReCa STEP 4 (Roadmap "03.09.2026", migration 023) — WAITER
  // როლის dropdown-ის ჩვენება მხოლოდ HoReCa org-ში აქვს აზრი (Retail-ს
  // მიმტანის კონცეფცია საერთოდ არ სჭირდება).
  businessType?: 'retail' | 'horeca' | null;
}

export default function UsersManagement({ currentUserRole, businessType }: UsersManagementProps) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserPermission[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'manager' | 'cashier' | 'waiter'>('cashier');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLogs, setHistoryLogs] = useState<AuditLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    message: string;
    onConfirm: (() => void) | null;
    // 🔒 მხოლოდ "ისტორიის გასუფთავების" დასტურზე ვრთავთ — "მომხმარებლის
    // წაშლის" დასტურს არ ეხება.
    requireExportConfirmation?: boolean;
  }>({
    show: false,
    message: '',
    onConfirm: null,
    requireExportConfirmation: false,
  });

  // 📤 მართავს "დიახ, წაშალე" ღილაკის Disable/Enable მდგომარეობას
  // ისტორიის გასუფთავების დასტურის ფანჯარაში — true ხდება მხოლოდ მას
  // შემდეგ, რაც ადმინმა მინიმუმ ერთხელ ჩამოტვირთა CSV არქივი.
  const [hasExportedHistory, setHasExportedHistory] = useState(false);

  // 🖥️ Roadmap STEP 2.2 — Device Pairing დადასტურების პანელი. მოლარის
  // დაუწყვილებელ ტერმინალზე (RegisterGuard.tsx) გამოსახული 6-ნიშნა კოდი
  // აქედან დასტურდება — POST /api/registers/pair.
  const [isPairModalOpen, setIsPairModalOpen] = useState(false);
  const [registersList, setRegistersList] = useState<RegisterInfo[]>([]);
  const [pairCode, setPairCode] = useState('');
  const [pairTarget, setPairTarget] = useState<'existing' | 'new'>('new');
  const [pairRegisterId, setPairRegisterId] = useState('');
  const [pairNewName, setPairNewName] = useState('');
  const [pairLoading, setPairLoading] = useState(false);
  const [pairError, setPairError] = useState('');

  const [passwordModal, setPasswordModal] = useState<{ show: boolean; userId: string | null; username: string; value: string }>({
    show: false,
    userId: null,
    username: '',
    value: '',
  });

  // 🔑 მენეჯერის PIN-კოდის დაყენება/შეცვლა (Roadmap ეტაპი 2) — password-ის
  // მოდალის ანალოგიური სტრუქტურა, error ცალკე ინახება (inline ვალიდაცია).
  const [pinModal, setPinModal] = useState<{ show: boolean; userId: string | null; username: string; value: string; error: string }>({
    show: false,
    userId: null,
    username: '',
    value: '',
    error: '',
  });

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const response = await axios.get('/api/users');
      setUsers(response.data);
    } catch (error) {
      console.error(error);
      showToast(t('usersManagement.toasts.loadUsersFailed'), 'error');
    }
  };

  // 🖥️ Roadmap STEP 2.2 — უკვე დაწყვილებული სალაროების სია (Pairing მოდალის
  // "არსებულ სალაროზე მიბმა" dropdown-ისთვის).
  const loadRegisters = async () => {
    try {
      const response = await axios.get<RegisterInfo[]>('/api/registers');
      setRegistersList(response.data);
    } catch (error) {
      console.error(error);
      // 🔕 ჩუმად — ეს სია მხოლოდ დამხმარეა (dropdown), მისი ჩატვირთვის
      // ჩავარდნა არ უნდა შეაფერხოს მთავარი "მომხმარებლების" გვერდის მუშაობა.
    }
  };

  const openPairModal = () => {
    setPairCode('');
    setPairTarget('new');
    setPairRegisterId('');
    setPairNewName('');
    setPairError('');
    setIsPairModalOpen(true);
    loadRegisters();
  };

  const closePairModal = () => setIsPairModalOpen(false);

  const submitPairCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(pairCode)) {
      setPairError(t('usersManagement.pairModal.errors.codeLength'));
      return;
    }
    if (pairTarget === 'existing' && !pairRegisterId) {
      setPairError(t('usersManagement.pairModal.errors.selectExisting'));
      return;
    }
    if (pairTarget === 'new' && pairNewName.trim().length === 0) {
      setPairError(t('usersManagement.pairModal.errors.enterNewName'));
      return;
    }

    setPairLoading(true);
    setPairError('');
    try {
      await axios.post('/api/registers/pair', {
        code: pairCode,
        registerId: pairTarget === 'existing' ? pairRegisterId : undefined,
        newRegisterName: pairTarget === 'new' ? pairNewName.trim() : undefined,
      });
      showToast(t('usersManagement.toasts.pairSuccess'), 'success');
      closePairModal();
    } catch (error: unknown) {
      const serverMessage = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      setPairError(serverMessage || t('usersManagement.pairModal.errors.pairFailed'));
    } finally {
      setPairLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.trim().length < 4) {
      showToast(t('login.passwordTooShort'), 'error');
      return;
    }
    try {
      await axios.post('/api/users', {
        username: newUsername,
        password: newPassword,
        role: newRole
      });
      setNewUsername('');
      setNewPassword('');
      setNewRole('cashier');
      setIsModalOpen(false);
      loadUsers();
      showToast(t('usersManagement.toasts.createUserSuccess'), 'success');
    } catch (error: any) {
      showToast(error.response?.data?.error || t('usersManagement.toasts.createUserFailed'), 'error');
    }
  };

  const handleRoleChange = async (id: string, currentStatus: string, newRole: 'admin' | 'manager' | 'cashier' | 'waiter') => {
    try {
      await axios.put(`/api/users/${id}`, { role: newRole, status: currentStatus });
      setUsers(users.map(user => user.id === id ? { ...user, role: newRole } : user));
      showToast(t('usersManagement.toasts.roleUpdated'), 'success');
    } catch (error) {
      showToast(t('usersManagement.toasts.saveFailed'), 'error');
    }
  };

  const toggleStatus = async (user: UserPermission) => {
    // ⚠️ nextStatus არის backend-ის data-value (Georgian-with-spaces literal),
    // API-ს იგივე უცვლელი ფორმით ეგზავნება — ითარგმნება მხოლოდ ეკრანზე
    // ნაჩვენები ლეიბლი (nextStatusLabel), თვითონ მონაცემი არასდროს.
    const nextStatus = user.status === 'ა ქ ტ ი უ რ ი ' ? 'და ბ ლო კ ი ლი ' : 'ა ქ ტ ი უ რ ი ';
    const nextStatusLabel = nextStatus === 'ა ქ ტ ი უ რ ი ' ? t('usersManagement.status.activeLabel') : t('usersManagement.status.blockedLabel');
    try {
      await axios.put(`/api/users/${user.id}`, { role: user.role, status: nextStatus });
      setUsers(users.map(u => u.id === user.id ? { ...u, status: nextStatus } : u));
      showToast(t('usersManagement.toasts.statusChanged', { status: nextStatusLabel }), 'success');
    } catch (error) {
      showToast(t('usersManagement.toasts.statusChangeFailed'), 'error');
    }
  };

  const loadAuditLogs = async () => {
    setHistoryLoading(true);
    try {
      const response = await axios.get('/api/audit-logs');
      setHistoryLogs(response.data);
    } catch (error) {
      console.error(error);
      showToast(t('usersManagement.toasts.historyLoadFailed'), 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistoryPanel = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next) loadAuditLogs();
  };

  // 📤 ლოგების ექსპორტი CSV ფორმატში — უსაფრთხოების ღონისძიება
  // გასუფთავებამდე. axios-ს (არა უბრალო <a href>-ს) ვიყენებთ, რომ
  // interceptor-მა ავტომატურად მიაბას Authorization header — ჩვეულებრივი
  // ბმულით ბრაუზერის ნავიგაცია ტოკენს ვერ გაატანდა და 401 დაგვიბრუნდებოდა.
  const handleExportLogs = async () => {
    try {
      const response = await axios.get('/api/audit-logs/export', {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'audit-logs-export.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setHasExportedHistory(true);
      showToast(t('usersManagement.toasts.exportSuccess'), 'success');
    } catch (error) {
      console.error(error);
      showToast(t('usersManagement.toasts.exportFailed'), 'error');
    }
  };

  // 🗑 ისტორიის სრული გასუფთავება — მხოლოდ ADMIN-ისთვის (ღილაკიც
  // მხოლოდ ადმინს უჩნდება, მაგრამ ბექენდიც ცალკე ამოწმებს როლს).
  const performClearHistory = async () => {
    try {
      const response = await axios.delete('/api/audit-logs');
      setHistoryLogs([]);
      showToast(response.data.message || t('usersManagement.toasts.historyClearedDefault'), 'success');
    } catch (error: any) {
      showToast(error.response?.data?.error || t('usersManagement.toasts.historyClearFailed'), 'error');
    }
  };

  const handleClearHistory = () => {
    setConfirmModal({
      show: true,
      message: t('usersManagement.confirmModal.clearHistoryMessage'),
      onConfirm: performClearHistory,
      requireExportConfirmation: true,
    });
  };

  const toggleHistoryAccess = async (u: UserPermission) => {
    const nextValue = !u.can_view_history;
    try {
      await axios.put(`/api/users/${u.id}/history-access`, {
        can_view_history: nextValue
      });
      setUsers(users.map(userItem => userItem.id === u.id ? { ...userItem, can_view_history: nextValue } : userItem));
      showToast(t('usersManagement.toasts.historyAccessChanged', { state: nextValue ? t('usersManagement.toggleState.on') : t('usersManagement.toggleState.off') }), 'success');
      // 🕘 თუ History პანელი ღიაა, სისტემაში ახლადჩაწერილი ლოგი მაშინვე უნდა
      // გამოჩნდეს — თორემ პანელი მხოლოდ გახსნისას იტვირთება ერთხელ და
      // ძველ, "გაყინულ" მდგომარეობას აჩვენებს.
      if (showHistory) loadAuditLogs();
    } catch (error) {
      console.error(error);
      showToast(t('usersManagement.toasts.accessChangeFailed'), 'error');
    }
  };

  const toggleDiscountAccess = async (u: UserPermission) => {
    const nextValue = !u.can_use_discount;
    try {
      await axios.put(`/api/users/${u.id}/discount-access`, {
        can_use_discount: nextValue
      });
      setUsers(users.map(userItem => userItem.id === u.id ? { ...userItem, can_use_discount: nextValue } : userItem));
      showToast(t('usersManagement.toasts.discountAccessChanged', { state: nextValue ? t('usersManagement.toggleState.on') : t('usersManagement.toggleState.off') }), 'success');
      if (showHistory) loadAuditLogs();
    } catch (error) {
      console.error(error);
      showToast(t('usersManagement.toasts.accessChangeFailed'), 'error');
    }
  };

  // 🧾 can_void_receipt toggle (Roadmap ეტაპი 4) — toggleDiscountAccess-ის ზუსტი ანალოგი.
  const toggleVoidAccess = async (u: UserPermission) => {
    const nextValue = !u.can_void_receipt;
    try {
      await axios.put(`/api/users/${u.id}/void-access`, {
        can_void_receipt: nextValue
      });
      setUsers(users.map(userItem => userItem.id === u.id ? { ...userItem, can_void_receipt: nextValue } : userItem));
      showToast(t('usersManagement.toasts.voidAccessChanged', { state: nextValue ? t('usersManagement.toggleState.on') : t('usersManagement.toggleState.off') }), 'success');
      if (showHistory) loadAuditLogs();
    } catch (error) {
      console.error(error);
      showToast(t('usersManagement.toasts.accessChangeFailed'), 'error');
    }
  };

  // 🧺 can_clear_cart toggle (Roadmap ეტაპი 5) — იგივე პატერნი.
  const toggleClearCartAccess = async (u: UserPermission) => {
    const nextValue = !u.can_clear_cart;
    try {
      await axios.put(`/api/users/${u.id}/clear-cart-access`, {
        can_clear_cart: nextValue
      });
      setUsers(users.map(userItem => userItem.id === u.id ? { ...userItem, can_clear_cart: nextValue } : userItem));
      showToast(t('usersManagement.toasts.clearCartAccessChanged', { state: nextValue ? t('usersManagement.toggleState.on') : t('usersManagement.toggleState.off') }), 'success');
      if (showHistory) loadAuditLogs();
    } catch (error) {
      console.error(error);
      showToast(t('usersManagement.toasts.accessChangeFailed'), 'error');
    }
  };

  const openPasswordModal = (id: string, username: string) => {
    setPasswordModal({ show: true, userId: id, username, value: '' });
  };

  const submitPasswordChange = async () => {
    const { userId, username, value } = passwordModal;
    if (!userId) return;
    if (value.trim().length < 4) {
      showToast(t('login.passwordTooShort'), 'error');
      return;
    }
    try {
      const response = await axios.put(`/api/users/${userId}/password`, { newPassword: value });
      showToast(response.data.message || t('usersManagement.toasts.passwordChangedDefault', { username }), 'success');
      setPasswordModal({ show: false, userId: null, username: '', value: '' });
    } catch (error: any) {
      showToast(error.response?.data?.error || t('usersManagement.toasts.passwordChangeFailed'), 'error');
    }
  };

  // 🔑 Manager PIN Override (Roadmap ეტაპი 2) — PIN-ის დაყენება/შეცვლა
  // მხოლოდ MANAGER როლის მომხმარებლისთვის, PUT /api/users/:id/pin
  // ბექენდზეც ცალკე ამოწმებს, რომ actor ADMIN-ია და target MANAGER-ია.
  const openPinModal = (id: string, username: string) => {
    setPinModal({ show: true, userId: id, username, value: '', error: '' });
  };

  const closePinModal = () => setPinModal({ show: false, userId: null, username: '', value: '', error: '' });

  const submitPinChange = async () => {
    const { userId, username, value } = pinModal;
    if (!userId) return;
    if (!/^\d{4}$/.test(value)) {
      setPinModal(prev => ({ ...prev, error: t('usersManagement.pinModal.errorLength') }));
      return;
    }
    try {
      const response = await axios.put(`/api/users/${userId}/pin`, { pin: value });
      showToast(response.data.message || t('usersManagement.toasts.pinSetDefault', { username }), 'success');
      closePinModal();
      loadUsers(); // has_manager_pin ცხრილში განახლდეს (Set → Change ღილაკის ტექსტი)
    } catch (error: unknown) {
      // "any"-ის ნაცვლად axios.isAxiosError ტიპის დამცველი — Clean Architecture წესი.
      const serverMessage = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      setPinModal(prev => ({ ...prev, error: serverMessage || t('usersManagement.toasts.pinSaveFailed') }));
    }
  };

  const performDelete = async (id: string, username: string) => {
    try {
      const response = await axios.delete(`/api/users/${id}`);
      setUsers(users.filter(user => user.id !== id));
      showToast(response.data.message || t('usersManagement.toasts.deleteUserDefault', { username }), 'success');
    } catch (error: any) {
      showToast(error.response?.data?.error || t('usersManagement.toasts.deleteUserFailed'), 'error');
    }
  };

  const handleDeleteUser = (id: string, username: string) => {
    setConfirmModal({
      show: true,
      message: t('usersManagement.confirmModal.deleteUserMessage', { username }),
      onConfirm: () => performDelete(id, username),
    });
  };

  const closeConfirmModal = () => setConfirmModal({ show: false, message: '', onConfirm: null, requireExportConfirmation: false });

  // მენეჯერს მხოლოდ cashier როლის მომხმარებლების ნახვა შეუძლია — ადმინი და სხვა მენეჯერები დამალულია
  const visibleUsers = currentUserRole === 'manager' ? users.filter(u => u.role === 'cashier' || u.role === 'waiter') : users;

  // ისტორიის ჩანართშიც იგივე წესი — მენეჯერს მხოლოდ cashier-ებთან დაკავშირებული ცვლილებები უნდა ანახოს
  const visibleHistoryLogs = currentUserRole === 'manager' ? historyLogs.filter(l => l.target_role === 'cashier' || l.target_role === 'waiter') : historyLogs;

  const roleBadgeClass = (role: UserPermission['role']) =>
    role === 'admin' ? styles.roleBadgeAdmin : role === 'manager' ? styles.roleBadgeManager : role === 'waiter' ? styles.roleBadgeWaiter : styles.roleBadgeCashier;

  return (
    <div className={styles.page}>
      {/* Toast კონტეინერი */}
      <div className={styles.toastContainer}>
        {toasts.map(toast => (
          <div key={toast.id} className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
            <span>{toast.type === 'success' ? '✅' : '⚠'}</span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      {/* ჰედერი და დამატების ახალი ღილაკი */}
      <div className={styles.header}>
        <h2 className={styles.heading}>{t('usersManagement.pageTitle')}</h2>
        <div className={styles.headerActions}>
          <button onClick={toggleHistoryPanel} className={`${styles.historyBtn} ${showHistory ? styles.active : ''}`}>
            {t('usersManagement.historyBtn')}
          </button>
          {/* 🖥️ Roadmap STEP 2.2 — ახალი/დაუწყვილებელი POS ტერმინალის
              6-ნიშნა კოდის დადასტურება (admin/manager, backend: POST
              /api/registers/pair). */}
          <button onClick={openPairModal} className={styles.historyBtn}>
            {t('usersManagement.pairRegisterBtn')}
          </button>
          <button onClick={() => setIsModalOpen(true)} className={styles.addBtn}>
            {t('usersManagement.addUserBtn')}
          </button>
        </div>
      </div>

      {/* 🕘 უფლებების ცვლილებების ისტორია (Audit Log) — მოიცავს როგორც ისტორიის
          ნახვის, ისე ფასდაკლების უფლების toggle-ებს */}
      {showHistory && (
        <div className={styles.historyPanel}>
          <div className={styles.historyPanelHeader}>
            <h3>{t('usersManagement.historyPanel.title')}</h3>
            {/* 📤 ექსპორტი + 🗑 წითელი გასუფთავების ღილაკი — მხოლოდ ADMIN-ს
                უჩნდება (Roadmap ეტაპი 1.5.2). ექსპორტი განზრახ დგას წაშლის
                გვერდით, რომ გასუფთავებამდე არქივის აღება ბუნებრივი ნაბიჯი იყოს. */}
            {currentUserRole === 'admin' && visibleHistoryLogs.length > 0 && (
              <div className={styles.historyPanelActions}>
                <button onClick={handleExportLogs} className={styles.exportLogsBtn} title={t('usersManagement.historyPanel.exportTooltip')}>
                  {t('usersManagement.historyPanel.exportBtn')}
                </button>
                <button onClick={handleClearHistory} className={styles.clearHistoryBtn} title={t('usersManagement.historyPanel.clearTooltip')}>
                  {t('usersManagement.historyPanel.clearBtn')}
                </button>
              </div>
            )}
          </div>
          {historyLoading ? (
            <p className={styles.historyEmpty}>{t('nav.loading')}</p>
          ) : visibleHistoryLogs.length === 0 ? (
            <p className={styles.historyEmpty}>{t('usersManagement.noEntriesFound')}</p>
          ) : (
            // 📏 ფიქსირებული სიმაღლე + ვერტიკალური სქროლი — ბევრმა ლოგმა
            // ცხრილი დაბლა რომ არ ჩააჩოჩოს. ბოლო ლოგები ზემოთაა
            // (ბექენდი უკვე ORDER BY id DESC აბრუნებს).
            <div className={styles.historyLogList}>
              {visibleHistoryLogs.map(log => (
                <div key={log.id} className={styles.historyLogRow}>
                  {renderAuditLogLine(log)}
                  <span className={styles.logTimestamp}>({log.created_at})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <p className={styles.subtitle}>
        {t('usersManagement.subtitleNote')}
      </p>

      {/* 📱 მომხმარებლების card view — მხოლოდ ≤640px-ზე ჩანს (CSS: .userCardList
          display:none ჩვეულებრივ, display:flex @include m.mobile-ში).
          Table-ის ზუსტად იგივე data/handler-ებია, უბრალოდ ვერტიკალურ,
          ლეიბლიან ბლოკებადაა გადაწყობილი — ჰორიზონტალური სქროლის მაგივრად. */}
      <div className={styles.userCardList}>
        {visibleUsers.map(user => (
          <div key={user.id} className={styles.userCard}>
            <div className={styles.userCardHeader}>
              <span className={styles.username}>{user.username}</span>
              <span className={roleBadgeClass(user.role)}>{user.role.toUpperCase()}</span>
            </div>

            <div className={styles.cardRow}>
              <span className={styles.cardRowLabel}>{t('usersManagement.columns.changePermissions')}</span>
              <select
                value={user.role}
                disabled={user.role === 'admin'}
                onChange={(e) => handleRoleChange(user.id, user.status, e.target.value as any)}
                className={styles.roleSelect}
              >
                <option value="admin">{t('usersManagement.roleOptions.adminFull')}</option>
                <option value="manager">{t('usersManagement.roleOptions.manager')}</option>
                <option value="cashier">{t('usersManagement.roleOptions.cashier')}</option>
                {businessType === 'horeca' && <option value="waiter">{t('usersManagement.roleOptions.waiterNamed')}</option>}
              </select>
            </div>

            <div className={styles.cardRow}>
              <span className={styles.cardRowLabel}>{t('usersManagement.columns.viewHistory')}</span>
              <input
                type="checkbox"
                checked={user.can_view_history}
                disabled={user.role === 'admin'}
                onChange={() => toggleHistoryAccess(user)}
                className={styles.checkbox}
              />
            </div>

            <div className={styles.cardRow}>
              <span className={styles.cardRowLabel}>{t('usersManagement.columns.discountAccess')}</span>
              <input
                type="checkbox"
                checked={!!user.can_use_discount}
                disabled={user.role === 'admin'}
                onChange={() => toggleDiscountAccess(user)}
                className={styles.checkbox}
              />
            </div>

            <div className={styles.cardRow}>
              <span className={styles.cardRowLabel}>{t('usersManagement.columns.voidReceipt')}</span>
              <input
                type="checkbox"
                checked={!!user.can_void_receipt}
                disabled={user.role === 'admin'}
                onChange={() => toggleVoidAccess(user)}
                className={styles.checkbox}
              />
            </div>

            <div className={styles.cardRow}>
              <span className={styles.cardRowLabel}>{t('usersManagement.columns.clearCart')}</span>
              <input
                type="checkbox"
                checked={!!user.can_clear_cart}
                disabled={user.role === 'admin'}
                onChange={() => toggleClearCartAccess(user)}
                className={styles.checkbox}
              />
            </div>

            <div className={styles.cardRow}>
              <span className={styles.cardRowLabel}>{t('usersManagement.columns.status')}</span>
              <button
                disabled={user.role === 'admin'}
                onClick={() => toggleStatus(user)}
                className={`${styles.statusIconBtn} ${user.status === 'ა ქ ტ ი უ რ ი ' ? styles.statusActive : styles.statusBlocked}`}
                title={user.status === 'ა ქ ტ ი უ რ ი ' ? t('usersManagement.statusTooltip.active') : t('usersManagement.statusTooltip.blocked')}
                aria-label={t('usersManagement.statusTooltip.changeAria')}
              >
                {user.status === 'ა ქ ტ ი უ რ ი ' ? <UnlockIcon size={15} /> : <LockIcon size={15} />}
              </button>
            </div>

            <div className={styles.cardActions}>
              <button onClick={() => openPasswordModal(user.id, user.username)} className={styles.iconBtn} title={t('usersManagement.actionsTooltip.changePassword')} aria-label={t('usersManagement.actionsTooltip.changePassword')}>
                <KeyIcon />
              </button>
              {user.role === 'manager' && (
                <button
                  onClick={() => openPinModal(user.id, user.username)}
                  className={styles.iconBtn}
                  title={user.has_manager_pin ? t('usersManagement.actionsTooltip.changePin') : t('usersManagement.actionsTooltip.setPin')}
                  aria-label={user.has_manager_pin ? t('usersManagement.actionsTooltip.changePin') : t('usersManagement.actionsTooltip.setPin')}
                >
                  <PinIcon />
                </button>
              )}
              <button
                disabled={user.role === 'admin'}
                onClick={() => handleDeleteUser(user.id, user.username)}
                className={styles.iconBtn}
                title={t('usersManagement.actionsTooltip.deleteUser')}
                aria-label={t('usersManagement.actionsTooltip.deleteUser')}
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 🖥 მომხმარებლების ცხრილი — desktop/tablet-ზე ჩანს (≤640px-ზე
          .tableWrapper-ს display:none ედება, ზემოთა card view ცვლის). */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('usersManagement.columns.username')}</th>
              <th>{t('usersManagement.columns.currentRole')}</th>
              <th>{t('usersManagement.columns.changePermissions')}</th>
              <th>{t('usersManagement.columns.viewHistory')}</th>
              <th>{t('usersManagement.columns.discountAccess')}</th>
              <th>{t('usersManagement.columns.voidReceipt')}</th>
              <th>{t('usersManagement.columns.clearCart')}</th>
              <th>{t('usersManagement.columns.status')}</th>
              <th style={{ textAlign: 'center' }}>{t('usersManagement.columns.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map(user => (
              <tr key={user.id}>
                <td className={styles.username}>{user.username}</td>
                <td>
                  <span className={roleBadgeClass(user.role)}>{user.role.toUpperCase()}</span>
                </td>
                <td>
                  <select
                    value={user.role}
                    disabled={user.role === 'admin'}
                    onChange={(e) => handleRoleChange(user.id, user.status, e.target.value as any)}
                    className={styles.roleSelect}
                  >
                    <option value="admin">{t('usersManagement.roleOptions.adminFull')}</option>
                    <option value="manager">{t('usersManagement.roleOptions.manager')}</option>
                    <option value="cashier">{t('usersManagement.roleOptions.cashier')}</option>
                    {businessType === 'horeca' && <option value="waiter">{t('usersManagement.roleOptions.waiterNamed')}</option>}
                  </select>
                </td>

                {/* Checkbox ისტორიის მართვისთვის */}
                <td>
                  <input
                    type="checkbox"
                    checked={user.can_view_history}
                    disabled={user.role === 'admin'}
                    onChange={() => toggleHistoryAccess(user)}
                    className={styles.checkbox}
                  />
                </td>

                {/* Checkbox ფასდაკლების უფლების მართვისთვის */}
                <td>
                  <input
                    type="checkbox"
                    checked={!!user.can_use_discount}
                    disabled={user.role === 'admin'}
                    onChange={() => toggleDiscountAccess(user)}
                    className={styles.checkbox}
                  />
                </td>

                {/* Checkbox ჩეკის გაუქმების უფლების მართვისთვის (Roadmap ეტაპი 4) */}
                <td>
                  <input
                    type="checkbox"
                    checked={!!user.can_void_receipt}
                    disabled={user.role === 'admin'}
                    onChange={() => toggleVoidAccess(user)}
                    className={styles.checkbox}
                  />
                </td>

                {/* Checkbox კალათის გასუფთავების უფლების მართვისთვის (Roadmap ეტაპი 5) */}
                <td>
                  <input
                    type="checkbox"
                    checked={!!user.can_clear_cart}
                    disabled={user.role === 'admin'}
                    onChange={() => toggleClearCartAccess(user)}
                    className={styles.checkbox}
                  />
                </td>

                <td>
                  <button
                    disabled={user.role === 'admin'}
                    onClick={() => toggleStatus(user)}
                    className={`${styles.statusIconBtn} ${user.status === 'ა ქ ტ ი უ რ ი ' ? styles.statusActive : styles.statusBlocked}`}
                    title={user.status === 'ა ქ ტ ი უ რ ი ' ? t('usersManagement.statusTooltip.active') : t('usersManagement.statusTooltip.blocked')}
                    aria-label={t('usersManagement.statusTooltip.changeAria')}
                  >
                    {user.status === 'ა ქ ტ ი უ რ ი ' ? <UnlockIcon size={15} /> : <LockIcon size={15} />}
                  </button>
                </td>
                <td>
                  <div className={styles.rowActions}>
                    <button onClick={() => openPasswordModal(user.id, user.username)} className={styles.iconBtn} title={t('usersManagement.actionsTooltip.changePassword')} aria-label={t('usersManagement.actionsTooltip.changePassword')}>
                      <KeyIcon />
                    </button>
                    {/* 🔑 Manager PIN Override (Roadmap ეტაპი 2) — მხოლოდ MANAGER როლისთვის ჩანს,
                        ტექსტი დამოკიდებულია იმაზე, უკვე დაყენებულია თუ არა PIN. */}
                    {user.role === 'manager' && (
                      <button
                        onClick={() => openPinModal(user.id, user.username)}
                        className={styles.iconBtn}
                        title={user.has_manager_pin ? t('usersManagement.actionsTooltip.changePin') : t('usersManagement.actionsTooltip.setPin')}
                        aria-label={user.has_manager_pin ? t('usersManagement.actionsTooltip.changePin') : t('usersManagement.actionsTooltip.setPin')}
                      >
                        <PinIcon />
                      </button>
                    )}
                    <button
                      disabled={user.role === 'admin'}
                      onClick={() => handleDeleteUser(user.id, user.username)}
                      className={styles.iconBtn}
                      title={t('usersManagement.actionsTooltip.deleteUser')}
                      aria-label={t('usersManagement.actionsTooltip.deleteUser')}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ახალი მომხმარებლის მოდალური ფანჯარა */}
      {isModalOpen && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>{t('usersManagement.createModal.title')}</h3>
            <form onSubmit={handleCreateUser}>
              <div className={styles.field}>
                <label className={styles.label}>{t('usersManagement.createModal.usernameLabel')}</label>
                <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder={t('usersManagement.createModal.usernamePlaceholder')} required className={styles.fullInput} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>{t('usersManagement.createModal.passwordLabel')}</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={t('login.newPasswordPlaceholder')} required className={styles.fullInput} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>{t('usersManagement.createModal.roleLabel')}</label>
                {/* 🔒 MANAGER-ს მხოლოდ CASHIER-ის დამატება შეუძლია (backend:
                    POST /api/users-ის იგივე შეზღუდვა, პრივილეგიის ესკალაციის
                    თავიდან ასაცილებლად) — dropdown-ი მხოლოდ ADMIN-ისთვის
                    ჩანს, MANAGER-ს როლი ფიქსირებული აქვს. */}
                {currentUserRole === 'manager' && businessType !== 'horeca' ? (
                  <input type="text" value={t('usersManagement.roleOptions.cashierNamed')} disabled className={styles.fullInput} />
                ) : currentUserRole === 'manager' ? (
                  // 🍽 HoReCa STEP 4 — manager-ს HoReCa org-ში CASHIER-ის გარდა
                  // WAITER-ის დამატებაც შეუძლია (ორივე staff-დონის როლია,
                  // იხ. backend/src/routes/auth.ts-ის იგივე შეზღუდვა), მაგრამ
                  // არა MANAGER/ADMIN — ესკალაცია კვლავ დაცულია.
                  <select
                    value={newRole === 'waiter' ? 'waiter' : 'cashier'}
                    onChange={e => setNewRole(e.target.value as 'cashier' | 'waiter')}
                    className={styles.fullInput}
                  >
                    <option value="cashier">{t('usersManagement.roleOptions.cashierNamed')}</option>
                    <option value="waiter">{t('usersManagement.roleOptions.waiterNamed')}</option>
                  </select>
                ) : (
                  <select
                    value={newRole}
                    onChange={e => setNewRole(e.target.value as 'admin' | 'manager' | 'cashier' | 'waiter')}
                    className={styles.fullInput}
                  >
                    <option value="cashier">{t('usersManagement.roleOptions.cashierNamed')}</option>
                    {businessType === 'horeca' && <option value="waiter">{t('usersManagement.roleOptions.waiterNamed')}</option>}
                    <option value="manager">{t('usersManagement.roleOptions.managerNamed')}</option>
                    <option value="admin">{t('usersManagement.roleOptions.adminNamed')}</option>
                  </select>
                )}
              </div>
              <div className={styles.modalActions}>
                <button type="button" onClick={() => setIsModalOpen(false)} className={styles.cancelBtn}>{t('common.cancel')}</button>
                <button type="submit" className={styles.saveBtnGreen}>{t('usersManagement.createModal.submitButton')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🖥️ Roadmap STEP 2.2 — სალაროს დაწყვილების დადასტურების მოდალი.
          მოლარის დაუწყვილებელ ტერმინალზე (RegisterGuard.tsx) ნაჩვენები
          6-ნიშნა კოდი აქედან მტკიცდება — POST /api/registers/pair. */}
      {isPairModalOpen && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>{t('usersManagement.pairModal.title')}</h3>
            <p className={styles.modalSubtitle}>
              {t('usersManagement.pairModal.subtitle')}
            </p>
            <form onSubmit={submitPairCode}>
              <div className={styles.field}>
                <label className={styles.label}>{t('usersManagement.pairModal.codeLabel')}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={pairCode}
                  onChange={e => setPairCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={t('usersManagement.pairModal.codePlaceholder')}
                  maxLength={6}
                  required
                  className={styles.fullInput}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>{t('usersManagement.pairModal.registerLabel')}</label>
                <select
                  value={pairTarget}
                  onChange={e => setPairTarget(e.target.value as 'existing' | 'new')}
                  className={styles.fullInput}
                >
                  <option value="new">{t('usersManagement.pairModal.createNewOption')}</option>
                  <option value="existing" disabled={registersList.length === 0}>
                    {t('usersManagement.pairModal.attachExistingOption')}{registersList.length === 0 ? t('usersManagement.pairModal.noneExistYetSuffix') : ''}
                  </option>
                </select>
              </div>

              {pairTarget === 'new' ? (
                <div className={styles.field}>
                  <label className={styles.label}>{t('usersManagement.pairModal.newRegisterNameLabel')}</label>
                  <input
                    type="text"
                    value={pairNewName}
                    onChange={e => setPairNewName(e.target.value)}
                    placeholder={t('usersManagement.pairModal.newRegisterNamePlaceholder')}
                    required
                    className={styles.fullInput}
                  />
                </div>
              ) : (
                <div className={styles.field}>
                  <label className={styles.label}>{t('usersManagement.pairModal.selectRegisterLabel')}</label>
                  <select
                    value={pairRegisterId}
                    onChange={e => setPairRegisterId(e.target.value)}
                    className={styles.fullInput}
                  >
                    <option value="">{t('usersManagement.pairModal.selectPlaceholder')}</option>
                    {registersList.map(r => (
                      <option key={r.id} value={r.id} disabled={!r.is_active}>
                        {r.name}{!r.is_active ? t('usersManagement.pairModal.deactivatedSuffix') : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {pairError && <p className={styles.errorText}>{pairError}</p>}

              <div className={styles.modalActions}>
                <button type="button" onClick={closePairModal} className={styles.cancelBtn}>{t('common.cancel')}</button>
                <button type="submit" disabled={pairLoading || pairCode.length !== 6} className={styles.saveBtnGreen}>
                  {pairLoading ? t('usersManagement.pairModal.confirmingButton') : t('usersManagement.pairModal.pairButton')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* პაროლის შეცვლის მოდალი */}
      {passwordModal.show && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>{t('usersManagement.passwordModal.title')}</h3>
            <p className={styles.modalSubtitle}>{t('usersManagement.forUserLabel')} <strong>{passwordModal.username}</strong></p>
            <div className={styles.field}>
              <label className={styles.label}>{t('usersManagement.passwordModal.newPasswordLabel')}</label>
              <input
                type="password"
                autoFocus
                value={passwordModal.value}
                onChange={e => setPasswordModal(prev => ({ ...prev, value: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') submitPasswordChange(); }}
                placeholder={t('login.newPasswordPlaceholder')}
                className={styles.fullInput}
              />
            </div>
            <div className={styles.modalActions}>
              <button type="button" onClick={() => setPasswordModal({ show: false, userId: null, username: '', value: '' })} className={styles.cancelBtn}>{t('common.cancel')}</button>
              <button type="button" onClick={submitPasswordChange} className={styles.saveBtn}>{t('tables.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* 🔑 მენეჯერის PIN-კოდის დაყენების/შეცვლის მოდალი (Roadmap ეტაპი 2) */}
      {pinModal.show && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>{t('usersManagement.pinModal.title')}</h3>
            <p className={styles.modalSubtitle}>{t('usersManagement.forUserLabel')} <strong>{pinModal.username}</strong></p>
            <div className={styles.field} style={{ marginBottom: '10px' }}>
              <label className={styles.label}>{t('usersManagement.pinModal.newPinLabel')}</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                autoFocus
                value={pinModal.value}
                onChange={e => setPinModal(prev => ({ ...prev, value: e.target.value.replace(/\D/g, '').slice(0, 4), error: '' }))}
                onKeyDown={e => { if (e.key === 'Enter') submitPinChange(); }}
                placeholder="••••"
                className={styles.pinInput}
              />
            </div>
            {pinModal.error && (
              <p className={styles.errorText}>{pinModal.error}</p>
            )}
            <div className={styles.modalActions}>
              <button type="button" onClick={closePinModal} className={styles.cancelBtn}>{t('common.cancel')}</button>
              <button type="button" onClick={submitPinChange} disabled={pinModal.value.length !== 4} className={styles.saveBtnPurple}>{t('tables.save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm მოდალი */}
      {confirmModal.show && (
        <div className={styles.overlay} style={{ zIndex: 1100 }}>
          <div className={styles.confirmModal}>
            <div className={styles.confirmIcon}>⚠</div>
            <p className={styles.confirmText}>{confirmModal.message}</p>

            {/* 🔒 დაცვა: ისტორიის გასუფთავებამდე ვთხოვთ ჯერ CSV არქივის
                ჩამოტვირთვას — "დიახ, წაშალე" ღილაკი Disable-ულია, სანამ
                ადმინი მინიმუმ ერთხელ არ დააჭერს ექსპორტს. */}
            {confirmModal.requireExportConfirmation && !hasExportedHistory && (
              <p className={styles.confirmWarning}>
                {t('usersManagement.confirmModal.exportRequiredWarning')}
              </p>
            )}

            <div className={styles.confirmActions}>
              <button type="button" onClick={closeConfirmModal} className={styles.cancelBtn}>{t('common.cancel')}</button>
              <button
                type="button"
                disabled={confirmModal.requireExportConfirmation && !hasExportedHistory}
                onClick={() => { confirmModal.onConfirm?.(); closeConfirmModal(); }}
                className={styles.actionBtnDelete + ' ' + styles.actionBtn}
                style={{ padding: '8px 20px', fontSize: '14px' }}
              >
                {t('usersManagement.confirmModal.confirmDeleteButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
