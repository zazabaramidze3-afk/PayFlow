import { ReactNode } from 'react';
import styles from './BrandLogo.module.scss';
import { isStandalonePwa } from '../lib/displayMode';

// ==========================================
// 🟣 BrandLogo — "PayFlow" ლოგო პულსირებადი "active" წერტილით
// ==========================================
// Login/Register ბარათების სათაურში გამოიყენება (landing გვერდს საკუთარი,
// იგივე სტილის წერტილი აქვს). `children` — ლოგოს ტექსტი (ბრენდის სახელი).
// წერტილი წმინდა დეკორაციაა (`aria-hidden`), ამიტომ screen reader მხოლოდ
// ტექსტს კითხულობს.
//
// 🏠 ლოგო დაჭერადია და საჯარო landing გვერდზე (`/landing`) აბრუნებს —
// UX: ავტორიზაციის/რეგისტრაციის გვერდზე მთავარზე დასაბრუნებელი გზა უნდა იყოს.
// დაინსტალირებულ PWA-ში (POS ტერმინალი) landing არ გამოიყენება, ამიტომ იქ
// ლოგო უბრალო (არა-დაჭერადი) ტექსტია.

interface BrandLogoProps {
  children: ReactNode;
}

export default function BrandLogo({ children }: BrandLogoProps) {
  const content = (
    <>
      <span className={styles.dot} aria-hidden="true" />
      {children}
    </>
  );

  if (isStandalonePwa()) {
    return <span className={styles.logo}>{content}</span>;
  }

  return (
    <a href="/landing" className={`${styles.logo} ${styles.link}`}>
      {content}
    </a>
  );
}
