
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import styles from './UsersManagement.module.scss';

interface UserPermission {
  // 🆔 UUID მიგრაცია (Roadmap STEP 1) — users.id ბექენდზე ახლა UUID
  // string-ია, აღარ არის SERIAL INTEGER.
  id: string;
  username: string;
  role: 'admin' | 'manager' | 'cashier';
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
  target_role: 'admin' | 'manager' | 'cashier' | null;
}

// 🖥️ Roadmap STEP 2.2 — GET /api/registers-ის row ფორმა (backend/src/types.ts-ის
// Register ინტერფეისის ზუსტი ანალოგი).
interface RegisterInfo {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

// 🔐 ჩეკბოქს-toggle action-ების ქართული ლეიბლები — ცალკე ობიექტად, რომ ახალი
// უფლების დამატებისას (Roadmap-ის შემდეგი ეტაპები) მხოლოდ აქ დაემატოს ერთი
// ხაზი, ternary-ების გაბმის ნაცვლად.
const PERMISSION_TOGGLE_LABELS: Record<string, string> = {
  'history-access': 'ისტორიის ნახვის უფლება',
  'discount-access': 'ფასდაკლების უფლება',
  'void-access': 'ჩეკის გაუქმების უფლება',
  'clear-cart-access': 'კალათის გასუფთავების უფლება',
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
  const actorName = log.actor_name ?? 'უცნობი';
  const targetName = log.target_name ?? 'უცნობი';

  switch (log.action) {
    case 'history-access':
    case 'discount-access':
    case 'void-access':
    case 'clear-cart-access': {
      const permissionLabel = PERMISSION_TOGGLE_LABELS[log.action] ?? log.action;
      const turnedOn = log.new_value === 'true';
      return (
        <>
          <strong>{actorName}</strong>-მა შეცვალა <strong>{targetName}</strong>-ის {permissionLabel}:{' '}
          <span className={turnedOn ? styles.turnedOn : styles.turnedOff}>
            {turnedOn ? 'ჩართო' : 'გამორთო'}
          </span>
        </>
      );
    }
    // 🔑 მენეჯერმა დაადასტურა ერთჯერადი ფასდაკლების override მოლარისთვის
    // (POST /api/auth/verify-manager-pin წარმატება).
    case 'manager-pin-override':
      return (
        <>
          🔑 <strong>მენეჯერმა</strong> (ID: {log.actor_id ?? '—'}) დაადასტურა ფასდაკლების ერთჯერადი უფლება სალაროზე
          {' '}— მოლარე: <strong>{targetName}</strong>
        </>
      );
    // 🔑 override token რეალურად გამოყენებული იყო checkout-ზე
    // (POST /api/payments-ის წარმატებული commit). new_value ფორმატია "payment:<id>".
    case 'manager-pin-override-used': {
      const paymentId = log.new_value?.startsWith('payment:') ? log.new_value.slice('payment:'.length) : (log.new_value ?? '—');
      return (
        <>
          ✅ მენეჯერის PIN-კოდით წარმატებით გატარდა გადახდა <strong>#{paymentId}</strong>
          {' '}(მოლარე: <strong>{targetName}</strong>)
        </>
      );
    }
    // 🚫 მენეჯერის PIN-ით რეალურად გაუქმდა უკვე გატარებული ჩეკი
    // (POST /api/payments/:id/void-ის წარმატება, Roadmap ეტაპი 4).
    // new_value ფორმატია "payment:<id>" — sales.ts-ის writeAuditLog-ის ანალოგიით.
    case 'void-receipt-override': {
      const paymentId = log.new_value?.startsWith('payment:') ? log.new_value.slice('payment:'.length) : (log.new_value ?? '—');
      return (
        <>
          🚫 მენეჯერის PIN-კოდით გაუქმდა ჩეკი <strong>#{paymentId}</strong>
          {' '}(მოლარე: <strong>{targetName}</strong>)
        </>
      );
    }
    // 🧺 მენეჯერის PIN-ით გასუფთავდა მთელი აქტიური კალათა POS ეკრანზე
    // (POST /api/cart/confirm-override, Roadmap ეტაპი 5).
    case 'clear-cart-override':
      return (
        <>
          🧺 მენეჯერის PIN-კოდით გასუფთავდა აქტიური კალათა
          {' '}(მოლარე: <strong>{targetName}</strong>)
        </>
      );
    // 🧺 მენეჯერის PIN-ით წაიშალა კონკრეტული პროდუქტი კალათიდან
    // (POST /api/cart/confirm-override, Roadmap ეტაპი 5). new_value შეიცავს
    // წაშლილი პროდუქტის სახელს, თუ frontend-მა გადასცა (Sales.tsx-ის detail).
    case 'remove-item-override':
      return (
        <>
          🧺 მენეჯერის PIN-კოდით წაიშალა პროდუქტი
          {log.new_value && log.new_value !== 'confirmed' ? <> — <strong>{log.new_value}</strong></> : null}
          {' '}კალათიდან (მოლარე: <strong>{targetName}</strong>)
        </>
      );
    // 🔑 ADMIN-მა დაუყენა/შეუცვალა მენეჯერს PIN (PUT /api/users/:id/pin).
    case 'manager-pin-update':
      return (
        <>
          <strong>{actorName}</strong>-მა შეცვალა <strong>{targetName}</strong>-ის მენეჯერის PIN-კოდი
        </>
      );
    default:
      return (
        <>
          <strong>{actorName}</strong>-მა შეცვალა <strong>{targetName}</strong>-ის უფლება ({log.action}): {log.new_value ?? '—'}
        </>
      );
  }
}

interface UsersManagementProps {
  currentUserRole?: 'admin' | 'manager' | 'cashier';
}

export default function UsersManagement({ currentUserRole }: UsersManagementProps) {
  const [users, setUsers] = useState<UserPermission[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'manager' | 'cashier'>('cashier');
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
      showToast('მომხმარებლების ჩატვირთვა ჩავარდა', 'error');
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
      setPairError('კოდი უნდა შედგებოდეს ზუსტად 6 ციფრისგან!');
      return;
    }
    if (pairTarget === 'existing' && !pairRegisterId) {
      setPairError('აირჩიეთ არსებული სალარო!');
      return;
    }
    if (pairTarget === 'new' && pairNewName.trim().length === 0) {
      setPairError('შეიყვანეთ ახალი სალაროს სახელი!');
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
      showToast('სალარო წარმატებით დაწყვილდა!', 'success');
      closePairModal();
    } catch (error: unknown) {
      const serverMessage = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      setPairError(serverMessage || 'დაწყვილება ვერ მოხერხდა');
    } finally {
      setPairLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.trim().length < 4) {
      showToast('პაროლი უნდა შედგებოდეს მინიმუმ 4 სიმბოლოსგან!', 'error');
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
      showToast('მომხმარებელი წარმატებით დაემატა!', 'success');
    } catch (error: any) {
      showToast(error.response?.data?.error || 'მომხმარებლის დამატება ჩაიშალა', 'error');
    }
  };

  const handleRoleChange = async (id: string, currentStatus: string, newRole: 'admin' | 'manager' | 'cashier') => {
    try {
      await axios.put(`/api/users/${id}`, { role: newRole, status: currentStatus });
      setUsers(users.map(user => user.id === id ? { ...user, role: newRole } : user));
      showToast('უფლებები წარმატებით განახლდა!', 'success');
    } catch (error) {
      showToast('ბაზაში შენახვა ჩავარდა', 'error');
    }
  };

  const toggleStatus = async (user: UserPermission) => {
    const nextStatus = user.status === 'ა ქ ტ ი უ რ ი ' ? 'და ბ ლო კ ი ლი ' : 'ა ქ ტ ი უ რ ი ';
    try {
      await axios.put(`/api/users/${user.id}`, { role: user.role, status: nextStatus });
      setUsers(users.map(u => u.id === user.id ? { ...u, status: nextStatus } : u));
      showToast(`სტატუსი შეიცვალა: ${nextStatus}`, 'success');
    } catch (error) {
      showToast('სტატუსის შეცვლა ჩავარდა', 'error');
    }
  };

  const loadAuditLogs = async () => {
    setHistoryLoading(true);
    try {
      const response = await axios.get('/api/audit-logs');
      setHistoryLogs(response.data);
    } catch (error) {
      console.error(error);
      showToast('ისტორიის ჩატვირთვა ჩავარდა', 'error');
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
      showToast('ლოგების არქივი წარმატებით გადმოიწერა!', 'success');
    } catch (error) {
      console.error(error);
      showToast('ექსპორტი ჩავარდა', 'error');
    }
  };

  // 🗑 ისტორიის სრული გასუფთავება — მხოლოდ ADMIN-ისთვის (ღილაკიც
  // მხოლოდ ადმინს უჩნდება, მაგრამ ბექენდიც ცალკე ამოწმებს როლს).
  const performClearHistory = async () => {
    try {
      const response = await axios.delete('/api/audit-logs');
      setHistoryLogs([]);
      showToast(response.data.message || 'ისტორია წარმატებით გასუფთავდა!', 'success');
    } catch (error: any) {
      showToast(error.response?.data?.error || 'ისტორიის გასუფთავება ჩავარდა', 'error');
    }
  };

  const handleClearHistory = () => {
    setConfirmModal({
      show: true,
      message: 'დარწმუნებული ხართ, რომ გსურთ მთელი აუდიტის ისტორიის სამუდამოდ წაშლა? ეს მოქმედება შეუქცევადია.',
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
      showToast(`ისტორიის წვდომა: ${nextValue ? 'ჩაირთო' : 'გამოირთო'}`, 'success');
      // 🕘 თუ History პანელი ღიაა, სისტემაში ახლადჩაწერილი ლოგი მაშინვე უნდა
      // გამოჩნდეს — თორემ პანელი მხოლოდ გახსნისას იტვირთება ერთხელ და
      // ძველ, "გაყინულ" მდგომარეობას აჩვენებს.
      if (showHistory) loadAuditLogs();
    } catch (error) {
      console.error(error);
      showToast('წვდომის შეცვლა ჩავარდა', 'error');
    }
  };

  const toggleDiscountAccess = async (u: UserPermission) => {
    const nextValue = !u.can_use_discount;
    try {
      await axios.put(`/api/users/${u.id}/discount-access`, {
        can_use_discount: nextValue
      });
      setUsers(users.map(userItem => userItem.id === u.id ? { ...userItem, can_use_discount: nextValue } : userItem));
      showToast(`ფასდაკლების უფლება: ${nextValue ? 'ჩაირთო' : 'გამოირთო'}`, 'success');
      if (showHistory) loadAuditLogs();
    } catch (error) {
      console.error(error);
      showToast('წვდომის შეცვლა ჩავარდა', 'error');
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
      showToast(`ჩეკის გაუქმების უფლება: ${nextValue ? 'ჩაირთო' : 'გამოირთო'}`, 'success');
      if (showHistory) loadAuditLogs();
    } catch (error) {
      console.error(error);
      showToast('წვდომის შეცვლა ჩავარდა', 'error');
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
      showToast(`კალათის გასუფთავების უფლება: ${nextValue ? 'ჩაირთო' : 'გამოირთო'}`, 'success');
      if (showHistory) loadAuditLogs();
    } catch (error) {
      console.error(error);
      showToast('წვდომის შეცვლა ჩავარდა', 'error');
    }
  };

  const openPasswordModal = (id: string, username: string) => {
    setPasswordModal({ show: true, userId: id, username, value: '' });
  };

  const submitPasswordChange = async () => {
    const { userId, username, value } = passwordModal;
    if (!userId) return;
    if (value.trim().length < 4) {
      showToast('პაროლი უნდა შედგებოდეს მინიმუმ 4 სიმბოლოსგან!', 'error');
      return;
    }
    try {
      const response = await axios.put(`/api/users/${userId}/password`, { newPassword: value });
      showToast(response.data.message || `პაროლი შეიცვალა [ ${username} ]-სთვის!`, 'success');
      setPasswordModal({ show: false, userId: null, username: '', value: '' });
    } catch (error: any) {
      showToast(error.response?.data?.error || 'პაროლის შეცვლა ჩავარდა', 'error');
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
      setPinModal(prev => ({ ...prev, error: 'PIN-კოდი უნდა შედგებოდეს ზუსტად 4 ციფრისგან!' }));
      return;
    }
    try {
      const response = await axios.put(`/api/users/${userId}/pin`, { pin: value });
      showToast(response.data.message || `PIN-კოდი დაყენდა [ ${username} ]-სთვის!`, 'success');
      closePinModal();
      loadUsers(); // has_manager_pin ცხრილში განახლდეს (Set → Change ღილაკის ტექსტი)
    } catch (error: unknown) {
      // "any"-ის ნაცვლად axios.isAxiosError ტიპის დამცველი — Clean Architecture წესი.
      const serverMessage = axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;
      setPinModal(prev => ({ ...prev, error: serverMessage || 'PIN-კოდის შენახვა ჩავარდა' }));
    }
  };

  const performDelete = async (id: string, username: string) => {
    try {
      const response = await axios.delete(`/api/users/${id}`);
      setUsers(users.filter(user => user.id !== id));
      showToast(response.data.message || `მომხმარებელი [ ${username} ] წაიშალა!`, 'success');
    } catch (error: any) {
      showToast(error.response?.data?.error || 'წაშლა ვერ მოხერხდა', 'error');
    }
  };

  const handleDeleteUser = (id: string, username: string) => {
    setConfirmModal({
      show: true,
      message: `დარწმუნებული ხართ, რომ გსურთ მომხმარებლის [ ${username} ] სამუდამოდ წაშლა?`,
      onConfirm: () => performDelete(id, username),
    });
  };

  const closeConfirmModal = () => setConfirmModal({ show: false, message: '', onConfirm: null, requireExportConfirmation: false });

  // მენეჯერს მხოლოდ cashier როლის მომხმარებლების ნახვა შეუძლია — ადმინი და სხვა მენეჯერები დამალულია
  const visibleUsers = currentUserRole === 'manager' ? users.filter(u => u.role === 'cashier') : users;

  // ისტორიის ჩანართშიც იგივე წესი — მენეჯერს მხოლოდ cashier-ებთან დაკავშირებული ცვლილებები უნდა ანახოს
  const visibleHistoryLogs = currentUserRole === 'manager' ? historyLogs.filter(l => l.target_role === 'cashier') : historyLogs;

  const roleBadgeClass = (role: UserPermission['role']) =>
    role === 'admin' ? styles.roleBadgeAdmin : role === 'manager' ? styles.roleBadgeManager : styles.roleBadgeCashier;

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
        <h2 className={styles.heading}>👥 მომხმარებლების უფლებების კონტროლი (PostgreSQL ბაზა)</h2>
        <div className={styles.headerActions}>
          <button onClick={toggleHistoryPanel} className={`${styles.historyBtn} ${showHistory ? styles.active : ''}`}>
            🕘 History
          </button>
          {/* 🖥️ Roadmap STEP 2.2 — ახალი/დაუწყვილებელი POS ტერმინალის
              6-ნიშნა კოდის დადასტურება (admin/manager, backend: POST
              /api/registers/pair). */}
          <button onClick={openPairModal} className={styles.historyBtn}>
            🖥️ სალაროს დაწყვილება
          </button>
          <button onClick={() => setIsModalOpen(true)} className={styles.addBtn}>
            ➕ ახალი მომხმარებელი
          </button>
        </div>
      </div>

      {/* 🕘 უფლებების ცვლილებების ისტორია (Audit Log) — მოიცავს როგორც ისტორიის
          ნახვის, ისე ფასდაკლების უფლების toggle-ებს */}
      {showHistory && (
        <div className={styles.historyPanel}>
          <div className={styles.historyPanelHeader}>
            <h3>🕘 უფლებების ცვლილებების ისტორია</h3>
            {/* 📤 ექსპორტი + 🗑 წითელი გასუფთავების ღილაკი — მხოლოდ ADMIN-ს
                უჩნდება (Roadmap ეტაპი 1.5.2). ექსპორტი განზრახ დგას წაშლის
                გვერდით, რომ გასუფთავებამდე არქივის აღება ბუნებრივი ნაბიჯი იყოს. */}
            {currentUserRole === 'admin' && visibleHistoryLogs.length > 0 && (
              <div className={styles.historyPanelActions}>
                <button onClick={handleExportLogs} className={styles.exportLogsBtn} title="ლოგების გადმოწერა CSV ფორმატში">
                  ⬇ ლოგების ექსპორტი (CSV)
                </button>
                <button onClick={handleClearHistory} className={styles.clearHistoryBtn} title="მთელი ისტორიის სამუდამოდ წაშლა">
                  🗑 ისტორიის გასუფთავება
                </button>
              </div>
            )}
          </div>
          {historyLoading ? (
            <p className={styles.historyEmpty}>იტვირთება...</p>
          ) : visibleHistoryLogs.length === 0 ? (
            <p className={styles.historyEmpty}>ჩანაწერები არ მოიძებნა.</p>
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
        ცვლილებები ინახება მყარად სერვერზე და არ იშლება ქეშის გასუფთავებისას.
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
              <span className={styles.cardRowLabel}>უფლებების შეცვლა</span>
              <select
                value={user.role}
                disabled={user.username === 'admin'}
                onChange={(e) => handleRoleChange(user.id, user.status, e.target.value as any)}
                className={styles.roleSelect}
              >
                <option value="admin">ADMIN (სრული წვდომა)</option>
                <option value="manager">MANAGER</option>
                <option value="cashier">CASHIER</option>
              </select>
            </div>

            <div className={styles.cardRow}>
              <span className={styles.cardRowLabel}>ისტორიის ნახვა</span>
              <input
                type="checkbox"
                checked={user.can_view_history}
                disabled={user.username === 'admin'}
                onChange={() => toggleHistoryAccess(user)}
                className={styles.checkbox}
              />
            </div>

            <div className={styles.cardRow}>
              <span className={styles.cardRowLabel}>ფასდაკლების უფლება</span>
              <input
                type="checkbox"
                checked={!!user.can_use_discount}
                disabled={user.username === 'admin'}
                onChange={() => toggleDiscountAccess(user)}
                className={styles.checkbox}
              />
            </div>

            <div className={styles.cardRow}>
              <span className={styles.cardRowLabel}>ჩეკის გაუქმება</span>
              <input
                type="checkbox"
                checked={!!user.can_void_receipt}
                disabled={user.username === 'admin'}
                onChange={() => toggleVoidAccess(user)}
                className={styles.checkbox}
              />
            </div>

            <div className={styles.cardRow}>
              <span className={styles.cardRowLabel}>კალათის გასუფთავება</span>
              <input
                type="checkbox"
                checked={!!user.can_clear_cart}
                disabled={user.username === 'admin'}
                onChange={() => toggleClearCartAccess(user)}
                className={styles.checkbox}
              />
            </div>

            <div className={styles.cardRow}>
              <span className={styles.cardRowLabel}>სტატუსი</span>
              <button
                disabled={user.username === 'admin'}
                onClick={() => toggleStatus(user)}
                className={`${styles.statusBtn} ${user.status === 'ა ქ ტ ი უ რ ი ' ? styles.statusActive : styles.statusBlocked}`}
              >
                {user.status}
              </button>
            </div>

            <div className={styles.cardActions}>
              <button onClick={() => openPasswordModal(user.id, user.username)} className={`${styles.actionBtn} ${styles.actionBtnPassword}`} title="პაროლის შეცვლა">
                🔑 პაროლი
              </button>
              {user.role === 'manager' && (
                <button
                  onClick={() => openPinModal(user.id, user.username)}
                  className={`${styles.actionBtn} ${user.has_manager_pin ? styles.actionBtnPin : styles.actionBtnPinSet}`}
                  title={user.has_manager_pin ? 'PIN-კოდის შეცვლა' : 'PIN-კოდის დაყენება'}
                >
                  🔢 {user.has_manager_pin ? 'PIN შეცვლა' : 'PIN დაყენება'}
                </button>
              )}
              <button
                disabled={user.username === 'admin'}
                onClick={() => handleDeleteUser(user.id, user.username)}
                className={`${styles.actionBtn} ${styles.actionBtnDelete}`}
                title="მომხმარებლის წაშლა"
              >
                🗑 წაშლა
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
              <th>მომხმარებელი</th>
              <th>მიმდინარე როლი</th>
              <th>უფლებების შეცვლა</th>
              <th>ისტორიის ნახვა</th>
              <th>ფასდაკლების უფლება</th>
              <th>ჩეკის გაუქმება</th>
              <th>კალათის გასუფთავება</th>
              <th>სტატუსი</th>
              <th style={{ textAlign: 'center' }}>მოქმედებები</th>
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
                    disabled={user.username === 'admin'}
                    onChange={(e) => handleRoleChange(user.id, user.status, e.target.value as any)}
                    className={styles.roleSelect}
                  >
                    <option value="admin">ADMIN (სრული წვდომა)</option>
                    <option value="manager">MANAGER</option>
                    <option value="cashier">CASHIER</option>
                  </select>
                </td>

                {/* Checkbox ისტორიის მართვისთვის */}
                <td>
                  <input
                    type="checkbox"
                    checked={user.can_view_history}
                    disabled={user.username === 'admin'}
                    onChange={() => toggleHistoryAccess(user)}
                    className={styles.checkbox}
                  />
                </td>

                {/* Checkbox ფასდაკლების უფლების მართვისთვის */}
                <td>
                  <input
                    type="checkbox"
                    checked={!!user.can_use_discount}
                    disabled={user.username === 'admin'}
                    onChange={() => toggleDiscountAccess(user)}
                    className={styles.checkbox}
                  />
                </td>

                {/* Checkbox ჩეკის გაუქმების უფლების მართვისთვის (Roadmap ეტაპი 4) */}
                <td>
                  <input
                    type="checkbox"
                    checked={!!user.can_void_receipt}
                    disabled={user.username === 'admin'}
                    onChange={() => toggleVoidAccess(user)}
                    className={styles.checkbox}
                  />
                </td>

                {/* Checkbox კალათის გასუფთავების უფლების მართვისთვის (Roadmap ეტაპი 5) */}
                <td>
                  <input
                    type="checkbox"
                    checked={!!user.can_clear_cart}
                    disabled={user.username === 'admin'}
                    onChange={() => toggleClearCartAccess(user)}
                    className={styles.checkbox}
                  />
                </td>

                <td>
                  <button
                    disabled={user.username === 'admin'}
                    onClick={() => toggleStatus(user)}
                    className={`${styles.statusBtn} ${user.status === 'ა ქ ტ ი უ რ ი ' ? styles.statusActive : styles.statusBlocked}`}
                  >
                    {user.status}
                  </button>
                </td>
                <td>
                  <div className={styles.rowActions}>
                    <button onClick={() => openPasswordModal(user.id, user.username)} className={`${styles.actionBtn} ${styles.actionBtnPassword}`} title="პაროლის შეცვლა">
                      🔑 პაროლი
                    </button>
                    {/* 🔑 Manager PIN Override (Roadmap ეტაპი 2) — მხოლოდ MANAGER როლისთვის ჩანს,
                        ტექსტი დამოკიდებულია იმაზე, უკვე დაყენებულია თუ არა PIN. */}
                    {user.role === 'manager' && (
                      <button
                        onClick={() => openPinModal(user.id, user.username)}
                        className={`${styles.actionBtn} ${user.has_manager_pin ? styles.actionBtnPin : styles.actionBtnPinSet}`}
                        title={user.has_manager_pin ? 'PIN-კოდის შეცვლა' : 'PIN-კოდის დაყენება'}
                      >
                        🔢 {user.has_manager_pin ? 'PIN შეცვლა' : 'PIN დაყენება'}
                      </button>
                    )}
                    <button
                      disabled={user.username === 'admin'}
                      onClick={() => handleDeleteUser(user.id, user.username)}
                      className={`${styles.actionBtn} ${styles.actionBtnDelete}`}
                      title="მომხმარებლის წაშლა"
                    >
                      🗑 წაშლა
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
            <h3 className={styles.modalTitle}>➕ ახალი მომხმარებლის რეგისტრაცია</h3>
            <form onSubmit={handleCreateUser}>
              <div className={styles.field}>
                <label className={styles.label}>მომხმარებლის სახელი</label>
                <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="მაგ. nika_cashier" required className={styles.fullInput} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>საწყისი პაროლი</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="მინიმუმ 4 სიმბოლო" required className={styles.fullInput} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>როლი (Role)</label>
                <select value={newRole} onChange={e => setNewRole(e.target.value as any)} className={styles.fullInput}>
                  <option value="cashier">CASHIER (მოლარე)</option>
                  <option value="manager">MANAGER (მენეჯერი)</option>
                  <option value="admin">ADMIN (ადმინისტრატორი)</option>
                </select>
              </div>
              <div className={styles.modalActions}>
                <button type="button" onClick={() => setIsModalOpen(false)} className={styles.cancelBtn}>გაუქმება</button>
                <button type="submit" className={styles.saveBtnGreen}>დამატება</button>
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
            <h3 className={styles.modalTitle}>🖥️ სალაროს დაწყვილება</h3>
            <p className={styles.modalSubtitle}>
              შეიყვანეთ 6-ნიშნა კოდი, რომელიც მოლარეს ეკრანზე უჩანს ახალ/დაუწყვილებელ სალაროზე.
            </p>
            <form onSubmit={submitPairCode}>
              <div className={styles.field}>
                <label className={styles.label}>აქტივაციის კოდი</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  value={pairCode}
                  onChange={e => setPairCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="მაგ. 042817"
                  maxLength={6}
                  required
                  className={styles.fullInput}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>სალარო</label>
                <select
                  value={pairTarget}
                  onChange={e => setPairTarget(e.target.value as 'existing' | 'new')}
                  className={styles.fullInput}
                >
                  <option value="new">➕ ახალი სალაროს შექმნა</option>
                  <option value="existing" disabled={registersList.length === 0}>
                    არსებულ სალაროზე მიბმა{registersList.length === 0 ? ' (ჯერ არცერთი არ არსებობს)' : ''}
                  </option>
                </select>
              </div>

              {pairTarget === 'new' ? (
                <div className={styles.field}>
                  <label className={styles.label}>ახალი სალაროს სახელი</label>
                  <input
                    type="text"
                    value={pairNewName}
                    onChange={e => setPairNewName(e.target.value)}
                    placeholder="მაგ. Register #2 / Express Counter"
                    required
                    className={styles.fullInput}
                  />
                </div>
              ) : (
                <div className={styles.field}>
                  <label className={styles.label}>აირჩიეთ სალარო</label>
                  <select
                    value={pairRegisterId}
                    onChange={e => setPairRegisterId(e.target.value)}
                    className={styles.fullInput}
                  >
                    <option value="">— აირჩიეთ —</option>
                    {registersList.map(r => (
                      <option key={r.id} value={r.id} disabled={!r.is_active}>
                        {r.name}{!r.is_active ? ' (დეაქტივირებული)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {pairError && <p className={styles.errorText}>{pairError}</p>}

              <div className={styles.modalActions}>
                <button type="button" onClick={closePairModal} className={styles.cancelBtn}>გაუქმება</button>
                <button type="submit" disabled={pairLoading || pairCode.length !== 6} className={styles.saveBtnGreen}>
                  {pairLoading ? 'დადასტურება...' : 'დაწყვილება'}
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
            <h3 className={styles.modalTitle}>🔑 პაროლის შეცვლა</h3>
            <p className={styles.modalSubtitle}>მომხმარებლისთვის: <strong>{passwordModal.username}</strong></p>
            <div className={styles.field}>
              <label className={styles.label}>ახალი პაროლი</label>
              <input
                type="password"
                autoFocus
                value={passwordModal.value}
                onChange={e => setPasswordModal(prev => ({ ...prev, value: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') submitPasswordChange(); }}
                placeholder="მინიმუმ 4 სიმბოლო"
                className={styles.fullInput}
              />
            </div>
            <div className={styles.modalActions}>
              <button type="button" onClick={() => setPasswordModal({ show: false, userId: null, username: '', value: '' })} className={styles.cancelBtn}>გაუქმება</button>
              <button type="button" onClick={submitPasswordChange} className={styles.saveBtn}>შენახვა</button>
            </div>
          </div>
        </div>
      )}

      {/* 🔑 მენეჯერის PIN-კოდის დაყენების/შეცვლის მოდალი (Roadmap ეტაპი 2) */}
      {pinModal.show && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>🔑 მენეჯერის PIN-კოდი</h3>
            <p className={styles.modalSubtitle}>მომხმარებლისთვის: <strong>{pinModal.username}</strong></p>
            <div className={styles.field} style={{ marginBottom: '10px' }}>
              <label className={styles.label}>ახალი PIN-კოდი (4 ციფრი)</label>
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
              <button type="button" onClick={closePinModal} className={styles.cancelBtn}>გაუქმება</button>
              <button type="button" onClick={submitPinChange} disabled={pinModal.value.length !== 4} className={styles.saveBtnPurple}>შენახვა</button>
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
                ⚠ გასაგრძელებლად ჯერ გადმოწერეთ ლოგების არქივი (CSV) — ღილაკი გააქტიურდება ექსპორტის შემდეგ.
              </p>
            )}

            <div className={styles.confirmActions}>
              <button type="button" onClick={closeConfirmModal} className={styles.cancelBtn}>გაუქმება</button>
              <button
                type="button"
                disabled={confirmModal.requireExportConfirmation && !hasExportedHistory}
                onClick={() => { confirmModal.onConfirm?.(); closeConfirmModal(); }}
                className={styles.actionBtnDelete + ' ' + styles.actionBtn}
                style={{ padding: '8px 20px', fontSize: '14px' }}
              >
                დიახ, წაშალე
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
