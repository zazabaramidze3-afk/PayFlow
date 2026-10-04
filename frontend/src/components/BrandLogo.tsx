import { ReactNode } from 'react';
import styles from './BrandLogo.module.scss';

// ==========================================
// 🟣 BrandLogo — "PayFlow" ლოგო პულსირებადი "active" წერტილით
// ==========================================
// Login/Register ბარათების სათაურში გამოიყენება (landing გვერდს საკუთარი,
// იგივე სტილის წერტილი აქვს). `children` — ლოგოს ტექსტი (ბრენდის სახელი).
// წერტილი წმინდა დეკორაციაა (`aria-hidden`), ამიტომ screen reader მხოლოდ
// ტექსტს კითხულობს.

interface BrandLogoProps {
  children: ReactNode;
}

export default function BrandLogo({ children }: BrandLogoProps) {
  return (
    <span className={styles.logo}>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </span>
  );
}
