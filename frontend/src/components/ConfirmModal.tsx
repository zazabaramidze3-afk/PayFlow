// frontend/src/components/ConfirmModal.tsx
//
// 🧾 გაზიარებული დადასტურების მოდალი — Sales.tsx-ის/Products.tsx-ის
// "confirmModal პატერნის" (voidConfirm state + custom overlay) ანარეკლი,
// მხოლოდ გატანილი ცალკე კომპონენტად, რომ Tables.tsx-მაც და OrderScreen.tsx-მაც
// ერთი და იგივე კოდი გამოიყენონ ნაცვლად დუბლირებისა (ორივე ახალი HoReCa
// ფაილია — Retail-ის Sales.tsx/Products.tsx კვლავ საკუთარ, ლოკალურ
// voidConfirm-ს იყენებს, უცვლელად).
//
// 🩹 FIX (04.09.2026) — მანამდე HoReCa გვერდებზე ბრაუზერის ნატიური
// `window.confirm()` გამოიყენებოდა (მაგ. "გავაუქმოთ მთელი შეკვეთა?"),
// რაც დიზაინთან შეუსაბამო, ბრაუზერზე დამოკიდებული პოპაპია. ახლა ყველგან
// იგივე სტილიზებული მოდალია, რაც Retail POS-შია.

import styles from './ConfirmModal.module.scss';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'დიახ',
  cancelLabel = 'გაუქმება',
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBody}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className={styles.actions}>
          <button type="button" onClick={onCancel} className={`${styles.btn} ${styles.btnSecondary}`}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`${styles.btn} ${danger ? styles.btnDanger : styles.btnPrimary}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
