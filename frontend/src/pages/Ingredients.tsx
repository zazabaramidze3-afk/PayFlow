// frontend/src/pages/Ingredients.tsx
//
// 🍲 HoReCa Module STEP 3.2 — ინგრედიენტების (ნედლეულის) მართვის პანელი
// (Roadmap "03.09.2026", STEP 3.2, migration 022). Admin/manager-ონლი
// გვერდი — Modifiers.tsx-ის იგივე პატერნი: ლოკალური toast (არა
// react-hot-toast), ConfirmModal წაშლის დადასტურებისთვის, "➕ ახალი
// ინგრედიენტი" ღილაკი მოდალით, ინლაინ მარაგის შევსების (restock) ფორმა.
//
// ამ გვერდზე კონკრეტულ პროდუქტზე რეცეპტის მიბმა **არ** ხდება — ეს
// Products.tsx-ის რედაქტირების ფორმაშია (PUT /products/:id/recipe),
// Modifiers.tsx-ის მიბმის იგივე პრინციპით.

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import styles from './Ingredients.module.scss';
import ConfirmModal from '../components/ConfirmModal';
import { Ingredient } from '../lib/horecaTypes';
import { EditIcon, TrashIcon, CheckIcon, XIcon, RestockIcon } from '../components/Icons';
import { useTranslation } from 'react-i18next';

type ToastType = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; }

const LOW_STOCK_THRESHOLD = 5;

export default function Ingredients() {
  const { t } = useTranslation();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  // ✏️ ინგრედიენტის დამატება/რედაქტირების მოდალი
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null);
  const [name, setName] = useState<string>('');
  const [unit, setUnit] = useState<string>('');
  const [stock, setStock] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  // 📥 ინლაინ მარაგის შევსება (restock) — ერთდროულად მხოლოდ ერთი
  // ინგრედიენტისთვის ღიაა (Modifiers.tsx-ის "ერთი აქტიური ინლაინ ფორმა" პრინციპი).
  const [restockingId, setRestockingId] = useState<string | null>(null);
  const [restockQty, setRestockQty] = useState<string>('');
  const [restockSaving, setRestockSaving] = useState<boolean>(false);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const getErrorMessage = (error: unknown): string | undefined =>
    axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;

  const fetchIngredients = useCallback(async () => {
    try {
      const response = await axios.get<Ingredient[]>('/api/ingredients');
      setIngredients(response.data);
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || t('ingredients.toasts.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchIngredients();
  }, [fetchIngredients]);

  // ==========================================
  // 🍲 ინგრედიენტის CRUD
  // ==========================================
  const openCreateModal = () => {
    setEditingIngredient(null);
    setName('');
    setUnit('');
    setStock('');
    setShowModal(true);
  };

  const openEditModal = (ingredient: Ingredient) => {
    setEditingIngredient(ingredient);
    setName(ingredient.name);
    setUnit(ingredient.unit);
    setStock(String(ingredient.stock));
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingIngredient(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !unit.trim()) {
      showToast(t('ingredients.toasts.nameUnitRequired'), 'error');
      return;
    }
    // 🩹 STEP 3.1-ის იგივე არაუარყოფითობის წესი (Modifiers.tsx-ის
    // price_delta-ს ანალოგიით) — მარაგი არასდროს არ უნდა იყოს უარყოფითი.
    const parsedStock = stock.trim() === '' ? 0 : Number(stock);
    if (!Number.isFinite(parsedStock) || parsedStock < 0) {
      showToast(t('ingredients.toasts.stockNegative'), 'error');
      return;
    }

    setSaving(true);
    const payload = { name: name.trim(), unit: unit.trim(), stock: parsedStock };

    try {
      if (editingIngredient) {
        await axios.put(`/api/ingredients/${editingIngredient.id}`, payload);
        showToast(t('ingredients.toasts.updated'), 'success');
      } else {
        await axios.post('/api/ingredients', payload);
        showToast(t('ingredients.toasts.added'), 'success');
      }
      closeModal();
      fetchIngredients();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || t('modifiers.toasts.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // 🩹 Modifiers.tsx-ის იგივე "confirmModal" პატერნი (window.confirm()-ის ნაცვლად).
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(
    null
  );
  const closeConfirmModal = () => setConfirmModal(null);

  const performDelete = async (ingredient: Ingredient) => {
    try {
      await axios.delete(`/api/ingredients/${ingredient.id}`);
      showToast(t('ingredients.toasts.deleted'), 'success');
      fetchIngredients();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || t('modifiers.toasts.deleteFailed'), 'error');
    }
  };

  const handleDelete = (ingredient: Ingredient) => {
    setConfirmModal({
      title: t('ingredients.confirmModal.deleteTitle'),
      message: t('ingredients.confirmModal.deleteMessage', { name: ingredient.name }),
      onConfirm: () => {
        closeConfirmModal();
        void performDelete(ingredient);
      },
    });
  };

  // ==========================================
  // 📥 მარაგის შევსება (Restock)
  // ==========================================
  const openRestock = (id: string) => {
    setRestockingId(id);
    setRestockQty('');
  };

  const closeRestock = () => {
    setRestockingId(null);
    setRestockQty('');
  };

  const handleRestockSubmit = async (e: React.FormEvent, ingredientId: string) => {
    e.preventDefault();
    const qty = Number(restockQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast(t('ingredients.toasts.qtyMustBePositive'), 'error');
      return;
    }

    setRestockSaving(true);
    try {
      await axios.patch(`/api/ingredients/${ingredientId}/restock`, { quantityToAdd: qty });
      showToast(t('ingredients.toasts.stockUpdated'), 'success');
      closeRestock();
      fetchIngredients();
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || t('ingredients.toasts.stockUpdateFailed'), 'error');
    } finally {
      setRestockSaving(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.topPanel}>
        <div>
          <h2>{t('ingredients.pageTitle')}</h2>
          <small>{t('ingredients.pageSubtitle')}</small>
        </div>
        <button onClick={openCreateModal} className={`${styles.btn} ${styles.btnPrimary}`}>{t('ingredients.addBtn')}</button>
      </div>

      {loading ? (
        <div className={styles.emptyState}>{t('nav.loading')}</div>
      ) : ingredients.length === 0 ? (
        <div className={styles.emptyState}>
          {t('ingredients.noIngredientsEmptyState')}
        </div>
      ) : (
        <div className={styles.ingredientList}>
          {ingredients.map(ingredient => (
            <div key={ingredient.id} className={styles.ingredientCard}>
              <div className={styles.ingredientMain}>
                <span className={styles.ingredientName}>{ingredient.name}</span>
                <span className={styles.unitBadge}>{ingredient.unit}</span>
                <span className={ingredient.stock <= LOW_STOCK_THRESHOLD ? styles.stockLow : styles.stockOk}>
                  {ingredient.stock} {ingredient.unit}
                </span>
                {ingredient.stock === 0 ? (
                  <span className={`${styles.stockTag} ${styles.stockTagOut}`}>{t('ingredients.stockOutTag')}</span>
                ) : ingredient.stock <= LOW_STOCK_THRESHOLD ? (
                  <span className={`${styles.stockTag} ${styles.stockTagLow}`}>{t('ingredients.stockLowTag')}</span>
                ) : null}
              </div>
              <div className={styles.ingredientActions}>
                <button className={styles.iconBtn} onClick={() => openRestock(ingredient.id)} aria-label={t('ingredients.restockAria')}><RestockIcon /></button>
                <button className={styles.iconBtn} onClick={() => openEditModal(ingredient)} aria-label={t('common.edit')}><EditIcon /></button>
                <button className={styles.iconBtn} onClick={() => handleDelete(ingredient)} aria-label={t('common.delete')}><TrashIcon /></button>
              </div>

              {restockingId === ingredient.id && (
                <form onSubmit={e => handleRestockSubmit(e, ingredient.id)} className={styles.restockRow}>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={restockQty}
                    onChange={e => { const v = Number(e.target.value); if (v >= 0 || e.target.value === '') setRestockQty(e.target.value); }}
                    className={styles.inputField}
                    placeholder={t('ingredients.restockPlaceholder', { unit: ingredient.unit })}
                    autoFocus
                    required
                  />
                  <div className={styles.optionActions}>
                    <button type="submit" disabled={restockSaving} className={styles.iconBtn} aria-label={t('modifiers.addOptionAria')}><CheckIcon /></button>
                    <button type="button" onClick={closeRestock} className={styles.iconBtn} aria-label={t('common.cancel')}><XIcon /></button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBody}>
            <h3>{editingIngredient ? t('ingredients.editTitle') : t('ingredients.addBtn')}</h3>
            <form onSubmit={handleSubmit}>
              <div className={styles.formGroup}>
                <label>{t('modifiers.nameLabel')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className={styles.inputField}
                  placeholder={t('ingredients.namePlaceholder')}
                  autoFocus
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label>{t('ingredients.unitLabel')}</label>
                <input
                  type="text"
                  value={unit}
                  onChange={e => setUnit(e.target.value)}
                  className={styles.inputField}
                  placeholder={t('ingredients.unitPlaceholder')}
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label>{t('ingredients.initialStockLabel')}</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={stock}
                  onChange={e => { const v = Number(e.target.value); if (v >= 0 || e.target.value === '') setStock(e.target.value); }}
                  className={styles.inputField}
                  placeholder="0"
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                <button type="button" onClick={closeModal} className={`${styles.btn} ${styles.btnSecondary}`} style={{ flex: 1 }}>{t('common.cancel')}</button>
                <button type="submit" disabled={saving} className={`${styles.btn} ${styles.btnPrimary}`} style={{ flex: 1 }}>
                  {saving ? t('products.savingEllipsis') : t('tables.save')}
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
