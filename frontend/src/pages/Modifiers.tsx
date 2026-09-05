// frontend/src/pages/Modifiers.tsx
//
// 🧩 HoReCa Module STEP 3.1 — მოდიფაიერების მართვის პანელი (Roadmap
// "03.09.2026", STEP 3, migration 021). Admin/manager-ონლი გვერდი
// (App.tsx-ის ნავიგაციაშიც ასე ჩანს — Tables.tsx-ის `canManage`-ის
// მსგავსი გეითი, ოღონდ აქ prop საერთოდ არ სჭირდება, გვერდი მთლიანად
// მართვისთვისაა).
//
// Tables.tsx-ის იგივე პატერნი: ლოკალური toast (არა react-hot-toast),
// ConfirmModal წაშლის დადასტურებისთვის, "➕ ახალი ჯგუფი" ღილაკი მოდალით.
// ჯგუფის ბარათში ინლაინ ჩანს ოფციების სია + "➕ ოფცია" ინლაინ ფორმა.
//
// ამ გვერდზე პროდუქტზე მიბმა **არ** ხდება — ეს Products.tsx-ის
// რედაქტირების ფორმაშია (PUT /modifiers/products/:id), რადგან იქაც
// უკვე არსებობს პროდუქტის რედაქტირების კონტექსტი.

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import styles from './Modifiers.module.scss';
import ConfirmModal from '../components/ConfirmModal';
import { ModifierGroupWithOptions, ModifierOption, ModifierSelectionType } from '../lib/horecaTypes';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; }

const SELECTION_LABEL: Record<ModifierSelectionType, string> = {
  single: 'ერთი არჩევანი',
  multiple: 'რამდენიმე არჩევანი',
};

export default function Modifiers() {
  const [groups, setGroups] = useState<ModifierGroupWithOptions[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  // ✏️ ჯგუფის დამატება/რედაქტირების მოდალი
  const [showGroupModal, setShowGroupModal] = useState<boolean>(false);
  const [editingGroup, setEditingGroup] = useState<ModifierGroupWithOptions | null>(null);
  const [groupName, setGroupName] = useState<string>('');
  const [groupSelectionType, setGroupSelectionType] = useState<ModifierSelectionType>('single');
  const [groupIsRequired, setGroupIsRequired] = useState<boolean>(false);
  const [groupSaving, setGroupSaving] = useState<boolean>(false);

  // ➕ ინლაინ "ახალი ოფცია" ფორმა — ერთდროულად მხოლოდ ერთი ჯგუფისთვის
  // ღიაა (`addingOptionForGroupId`), Tables.tsx-ის showFormModal-ის
  // მსგავსი "ერთი აქტიური ფორმა" პრინციპით.
  const [addingOptionForGroupId, setAddingOptionForGroupId] = useState<string | null>(null);
  const [optionName, setOptionName] = useState<string>('');
  const [optionPriceDelta, setOptionPriceDelta] = useState<string>('');
  const [optionSaving, setOptionSaving] = useState<boolean>(false);

  // ✏️ ოფციის ინლაინ რედაქტირება
  const [editingOption, setEditingOption] = useState<ModifierOption | null>(null);
  const [editOptionName, setEditOptionName] = useState<string>('');
  const [editOptionPriceDelta, setEditOptionPriceDelta] = useState<string>('');

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const getErrorMessage = (error: unknown): string | undefined =>
    axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;

  const fetchGroups = useCallback(async () => {
    try {
      const response = await axios.get<ModifierGroupWithOptions[]>('/api/modifiers/groups');
      setGroups(response.data);
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'ჯგუფების ჩატვირთვა ვერ მოხერხდა', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  // ==========================================
  // 🧩 ჯგუფის CRUD
  // ==========================================
  const openCreateGroupModal = () => {
    setEditingGroup(null);
    setGroupName('');
    setGroupSelectionType('single');
    setGroupIsRequired(false);
    setShowGroupModal(true);
  };

  const openEditGroupModal = (group: ModifierGroupWithOptions) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setGroupSelectionType(group.selection_type);
    setGroupIsRequired(group.is_required);
    setShowGroupModal(true);
  };

  const closeGroupModal = () => {
    setShowGroupModal(false);
    setEditingGroup(null);
  };

  const handleGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) {
      showToast('ჯგუფის სახელი სავალდებულოა', 'error');
      return;
    }

    setGroupSaving(true);
    const payload = {
      name: groupName.trim(),
      selectionType: groupSelectionType,
      isRequired: groupIsRequired,
    };

    try {
      if (editingGroup) {
        await axios.put(`/api/modifiers/groups/${editingGroup.id}`, payload);
        showToast('ჯგუფი განახლდა', 'success');
      } else {
        await axios.post('/api/modifiers/groups', payload);
        showToast('ჯგუფი დაემატა', 'success');
      }
      closeGroupModal();
      fetchGroups();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'შენახვა ვერ მოხერხდა', 'error');
    } finally {
      setGroupSaving(false);
    }
  };

  // 🩹 Tables.tsx-ის იგივე "confirmModal" პატერნი (window.confirm()-ის
  // ნაცვლად), ორივესთვის (ჯგუფის და ოფციის წაშლა) ერთი state.
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(
    null
  );
  const closeConfirmModal = () => setConfirmModal(null);

  const performDeleteGroup = async (group: ModifierGroupWithOptions) => {
    try {
      await axios.delete(`/api/modifiers/groups/${group.id}`);
      showToast('ჯგუფი წაიშალა', 'success');
      fetchGroups();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'წაშლა ვერ მოხერხდა', 'error');
    }
  };

  const handleDeleteGroup = (group: ModifierGroupWithOptions) => {
    setConfirmModal({
      title: '🗑️ ჯგუფის წაშლა',
      message: `წავშალოთ ჯგუფი "${group.name}"? (თუ უკვე გამოყენებულია არსებულ შეკვეთაში, წაშლა შეუძლებელი იქნება)`,
      onConfirm: () => {
        closeConfirmModal();
        void performDeleteGroup(group);
      },
    });
  };

  // ==========================================
  // ➕ ოფციის CRUD (ინლაინ, ჯგუფის ბარათში)
  // ==========================================
  const openAddOption = (groupId: string) => {
    setEditingOption(null);
    setAddingOptionForGroupId(groupId);
    setOptionName('');
    setOptionPriceDelta('');
  };

  const closeAddOption = () => {
    setAddingOptionForGroupId(null);
    setOptionName('');
    setOptionPriceDelta('');
  };

  const handleAddOptionSubmit = async (e: React.FormEvent, groupId: string) => {
    e.preventDefault();
    if (!optionName.trim()) {
      showToast('ოფციის სახელი სავალდებულოა', 'error');
      return;
    }

    setOptionSaving(true);
    try {
      await axios.post(`/api/modifiers/groups/${groupId}/options`, {
        name: optionName.trim(),
        priceDelta: optionPriceDelta.trim() === '' ? 0 : Number(optionPriceDelta),
      });
      showToast('ოფცია დაემატა', 'success');
      closeAddOption();
      fetchGroups();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'დამატება ვერ მოხერხდა', 'error');
    } finally {
      setOptionSaving(false);
    }
  };

  const startEditOption = (option: ModifierOption) => {
    setAddingOptionForGroupId(null);
    setEditingOption(option);
    setEditOptionName(option.name);
    setEditOptionPriceDelta(String(option.price_delta));
  };

  const cancelEditOption = () => {
    setEditingOption(null);
    setEditOptionName('');
    setEditOptionPriceDelta('');
  };

  const handleEditOptionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOption) return;
    if (!editOptionName.trim()) {
      showToast('ოფციის სახელი სავალდებულოა', 'error');
      return;
    }

    setOptionSaving(true);
    try {
      await axios.put(`/api/modifiers/options/${editingOption.id}`, {
        name: editOptionName.trim(),
        priceDelta: editOptionPriceDelta.trim() === '' ? 0 : Number(editOptionPriceDelta),
      });
      showToast('ოფცია განახლდა', 'success');
      cancelEditOption();
      fetchGroups();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'განახლება ვერ მოხერხდა', 'error');
    } finally {
      setOptionSaving(false);
    }
  };

  const performDeleteOption = async (option: ModifierOption) => {
    try {
      await axios.delete(`/api/modifiers/options/${option.id}`);
      showToast('ოფცია წაიშალა', 'success');
      fetchGroups();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'წაშლა ვერ მოხერხდა', 'error');
    }
  };

  const handleDeleteOption = (option: ModifierOption) => {
    setConfirmModal({
      title: '🗑️ ოფციის წაშლა',
      message: `წავშალოთ ოფცია "${option.name}"?`,
      onConfirm: () => {
        closeConfirmModal();
        void performDeleteOption(option);
      },
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.topPanel}>
        <div>
          <h2>🧩 მოდიფაიერები</h2>
          <small>ჯგუფები (მაგ. "მოხარშვის ხარისხი", "დანამატები") + ოფციები — მიბმა კონკრეტულ პროდუქტზე ხდება Products გვერდზე, რედაქტირებისას</small>
        </div>
        <button onClick={openCreateGroupModal} className={`${styles.btn} ${styles.btnPrimary}`}>
          ➕ ახალი ჯგუფი
        </button>
      </div>

      {loading ? (
        <div className={styles.emptyState}>იტვირთება...</div>
      ) : groups.length === 0 ? (
        <div className={styles.emptyState}>
          მოდიფაიერების ჯგუფები ჯერ არ არის დამატებული. დააჭირეთ "➕ ახალი ჯგუფი"-ს ზემოთ.
        </div>
      ) : (
        <div className={styles.groupList}>
          {groups.map(group => (
            <div key={group.id} className={styles.groupCard}>
              <div className={styles.groupHeader}>
                <div className={styles.groupTitleRow}>
                  <span className={styles.groupName}>{group.name}</span>
                  <span className={group.selection_type === 'single' ? styles.badgeSingle : styles.badgeMultiple}>
                    {SELECTION_LABEL[group.selection_type]}
                  </span>
                  {group.is_required && <span className={styles.badgeRequired}>სავალდებულო</span>}
                </div>
                <div className={styles.groupActions}>
                  <button className={styles.iconBtn} onClick={() => openEditGroupModal(group)} aria-label="რედაქტირება">✏️</button>
                  <button className={styles.iconBtn} onClick={() => handleDeleteGroup(group)} aria-label="წაშლა">🗑️</button>
                </div>
              </div>

              {group.options.length === 0 ? (
                <p className={styles.noOptions}>ოფციები ჯერ არ არის დამატებული.</p>
              ) : (
                <div className={styles.optionsList}>
                  {group.options.map(option =>
                    editingOption?.id === option.id ? (
                      <form key={option.id} onSubmit={handleEditOptionSubmit} className={styles.optionRow}>
                        <input
                          type="text"
                          value={editOptionName}
                          onChange={e => setEditOptionName(e.target.value)}
                          className={styles.inputField}
                          style={{ flex: 2 }}
                          autoFocus
                        />
                        <input
                          type="number"
                          step="0.01"
                          value={editOptionPriceDelta}
                          onChange={e => setEditOptionPriceDelta(e.target.value)}
                          className={styles.inputField}
                          style={{ flex: 1 }}
                          placeholder="0.00"
                        />
                        <div className={styles.optionActions}>
                          <button type="submit" disabled={optionSaving} className={styles.iconBtn} aria-label="შენახვა">✅</button>
                          <button type="button" onClick={cancelEditOption} className={styles.iconBtn} aria-label="გაუქმება">✖️</button>
                        </div>
                      </form>
                    ) : (
                      <div key={option.id} className={styles.optionRow}>
                        <span className={styles.optionName}>{option.name}</span>
                        <span className={styles.optionDelta}>
                          {option.price_delta > 0 ? `+${option.price_delta.toFixed(2)} ₾` : option.price_delta < 0 ? `${option.price_delta.toFixed(2)} ₾` : '0.00 ₾'}
                        </span>
                        <div className={styles.optionActions}>
                          <button className={styles.iconBtn} onClick={() => startEditOption(option)} aria-label="რედაქტირება">✏️</button>
                          <button className={styles.iconBtn} onClick={() => handleDeleteOption(option)} aria-label="წაშლა">🗑️</button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}

              {addingOptionForGroupId === group.id ? (
                <form onSubmit={e => handleAddOptionSubmit(e, group.id)} className={styles.optionRow} style={{ marginTop: '10px' }}>
                  <input
                    type="text"
                    value={optionName}
                    onChange={e => setOptionName(e.target.value)}
                    className={styles.inputField}
                    style={{ flex: 2 }}
                    placeholder="ოფციის დასახელება"
                    autoFocus
                    required
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={optionPriceDelta}
                    onChange={e => setOptionPriceDelta(e.target.value)}
                    className={styles.inputField}
                    style={{ flex: 1 }}
                    placeholder="ფასის ცვლილება (₾)"
                  />
                  <div className={styles.optionActions}>
                    <button type="submit" disabled={optionSaving} className={styles.iconBtn} aria-label="დამატება">✅</button>
                    <button type="button" onClick={closeAddOption} className={styles.iconBtn} aria-label="გაუქმება">✖️</button>
                  </div>
                </form>
              ) : (
                <button onClick={() => openAddOption(group.id)} className={styles.addOptionBtn}>
                  ➕ ოფციის დამატება
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showGroupModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBody}>
            <h3>{editingGroup ? '✏️ ჯგუფის რედაქტირება' : '➕ ახალი ჯგუფი'}</h3>
            <form onSubmit={handleGroupSubmit}>
              <div className={styles.formGroup}>
                <label>სახელი</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={e => setGroupName(e.target.value)}
                  className={styles.inputField}
                  placeholder="მოხარშვის ხარისხი / დანამატები..."
                  autoFocus
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label>არჩევანის ტიპი</label>
                <select
                  value={groupSelectionType}
                  onChange={e => setGroupSelectionType(e.target.value as ModifierSelectionType)}
                  className={styles.inputField}
                >
                  <option value="single">ერთი არჩევანი (მაგ. medium/well done)</option>
                  <option value="multiple">რამდენიმე არჩევანი (მაგ. + ყველი, + ბეკონი)</option>
                </select>
              </div>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={groupIsRequired}
                  onChange={e => setGroupIsRequired(e.target.checked)}
                />
                სავალდებულოა (item-ის დამატებამდე უნდა აირჩეს)
              </label>
              <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                <button type="button" onClick={closeGroupModal} className={`${styles.btn} ${styles.btnSecondary}`} style={{ flex: 1 }}>
                  გაუქმება
                </button>
                <button type="submit" disabled={groupSaving} className={`${styles.btn} ${styles.btnPrimary}`} style={{ flex: 1 }}>
                  {groupSaving ? 'ინახება...' : 'შენახვა'}
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
