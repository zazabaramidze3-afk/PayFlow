// frontend/src/pages/Settings.tsx
//
// ⚙️ ორგანიზაციის Settings გვერდი (Roadmap "HoReCa Open Items -
// 06.09.2026.md", #3 "Tips-ის განაწილება" — "setting-infrastructure"
// ეტაპი). Admin/manager-ონლი, Modifiers.tsx/Ingredients.tsx-ის იგივე
// lazy/businessType-გეითინგის პატერნით (App.tsx).
//
// ჯერჯერობით მხოლოდ ერთი პარამეტრია: tip_distribution_mode
// ('individual' | 'pooled', migration 026). Register.tsx-ის
// businessType-სეგმენტირებული radiogroup-ის იგივე UI-პატერნი.
//
// ⚠️ სქოუფი: ეს გვერდი მხოლოდ პარამეტრს ინახავს (`PATCH
// /organizations/me`). ფაქტობრივი "pooled" გადანაწილების ალგორითმი
// (shift-close-ზე ჯამური tip-ის თანაბარი დაყოფა აქტიურ ვეითერებზე)
// განზრახ არ არის აქ — ცალკე, მომავალი ეტაპის ამოცანაა. checkout-ის
// (`sales.ts`) ლოგიკა ამ გვერდის შენახვის შემდეგაც უცვლელი რჩება.

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import styles from './Settings.module.scss';
import { SettingsIcon } from '../components/Icons';

type TipDistributionMode = 'individual' | 'pooled';
type ToastType = 'success' | 'error';
interface ToastItem { id: number; message: string; type: ToastType; }

interface OrganizationMeResponse {
  businessType: 'retail' | 'horeca';
  tipDistributionMode: TipDistributionMode;
}

export default function Settings() {
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [tipDistributionMode, setTipDistributionMode] = useState<TipDistributionMode>('individual');
  const [savedMode, setSavedMode] = useState<TipDistributionMode>('individual');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const getErrorMessage = (error: unknown): string | undefined =>
    axios.isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined;

  const fetchSettings = useCallback(async () => {
    try {
      const response = await axios.get<OrganizationMeResponse>('/api/organizations/me');
      setTipDistributionMode(response.data.tipDistributionMode);
      setSavedMode(response.data.tipDistributionMode);
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'პარამეტრების ჩატვირთვა ვერ მოხერხდა', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const isDirty = tipDistributionMode !== savedMode;

  const handleSave = async () => {
    if (!isDirty || saving) return;
    setSaving(true);
    try {
      const response = await axios.patch<{ success: boolean; tipDistributionMode: TipDistributionMode }>(
        '/api/organizations/me',
        { tipDistributionMode }
      );
      setSavedMode(response.data.tipDistributionMode);
      showToast('პარამეტრი შენახულია', 'success');
    } catch (error: unknown) {
      showToast(getErrorMessage(error) || 'შენახვა ვერ მოხერხდა', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className={styles.container}>იტვირთება...</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.topPanel}>
        <div>
          <h2><SettingsIcon size={18} /> პარამეტრები</h2>
          <small>ორგანიზაციის ბიზნეს-დონის პარამეტრები</small>
        </div>
      </div>

      <div className={styles.card}>
        <h3>💰 Tips-ის განაწილება</h3>
        <p className={styles.hint}>
          განსაზღვრეთ, როგორ ნაწილდება checkout-ზე მიღებული tip —
          ინდივიდუალურად (ვინც checkout გაატარა, მას ეკუთვნის) თუ საერთო
          (pooled — ცვლის ბოლოს თანაბრად ნაწილდება აქტიურ ვეითერებზე).
        </p>

        <div className={styles.segmentedGroup} role="radiogroup" aria-label="Tips-ის განაწილება">
          <button
            type="button"
            role="radio"
            aria-checked={tipDistributionMode === 'individual'}
            onClick={() => setTipDistributionMode('individual')}
            className={`${styles.segmentedBtn} ${tipDistributionMode === 'individual' ? styles.segmentedBtnActive : ''}`}
          >
            👤 ინდივიდუალური
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={tipDistributionMode === 'pooled'}
            onClick={() => setTipDistributionMode('pooled')}
            className={`${styles.segmentedBtn} ${tipDistributionMode === 'pooled' ? styles.segmentedBtnActive : ''}`}
          >
            🤝 საერთო (Pooled)
          </button>
        </div>

        <p className={styles.hint}>
          {tipDistributionMode === 'pooled'
            ? '⚠️ ეს პარამეტრი ჯერჯერობით მხოლოდ არჩევანს ინახავს — ფაქტობრივი გადანაწილების ალგორითმი მომავალ ეტაპზეა დაგეგმილი, checkout-ის ლოგიკა ჯერ არ იცვლება.'
            : 'ამჟამინდელი (და ნაგულისხმევი) ქცევა — checkout-ზე მთელი tip იმ ვეითერს/მოლარეს ეკუთვნის, ვინც checkout გაატარა.'}
        </p>

        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary} ${styles.saveBtn}`}
          disabled={!isDirty || saving}
          onClick={handleSave}
        >
          {saving ? 'ინახება...' : 'შენახვა'}
        </button>
      </div>

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
                background: t.type === 'success' ? '#16a34a' : '#dc2626',
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
