import { useTranslation } from 'react-i18next';
import styles from './LanguageSwitcher.module.scss';
import { persistLanguage, SupportedLanguage } from '../i18n';
import { GlobeIcon } from './Icons';

// ==========================================
// 🌍 LanguageSwitcher — მინიმალისტური globe-toggle
// ==========================================
// FIX (10.09.2026, მომხმარებლის მოთხოვნით): ორსეგმენტიანი "GE | EN"
// pill (რომელიც sidebar/mobile-topbar-ში ცუდად ეტეოდა) შეიცვალა ერთი
// წრიული ღილაკით — მინიმალისტური globe SVG (Icons.tsx) + მიმდინარე
// ენის მოკლე კოდი პატარა ტექსტად გვერდით. დაჭერაზე ენა უბრალოდ
// გადაერთვება მეორეზე (ka<->en).
//
// UPDATE (11.09.2026, მომხმარებლის მოთხოვნით): dropdown-ვერსია
// გამოცდილი იყო (sidebar-ზე ზემოთ, mobile-ზე გვერდულად გახსნის
// placement-ებით), მაგრამ sidebar-ის "up" placement viewport-ის
// თავზე იჭრებოდა/ილეწებოდა ვიწრო ეკრანებზე — მომხმარებელმა მარტივი
// toggle-ის დაბრუნება ამჯობინა. Globe SVG-იც შეიცვალა უფრო
// დეტალური, grid-ხაზებიანი ვერსიით (Icons.tsx), ღილაკის pill/border
// ფონი მოხსნილია — "შიშველი" icon+კოდი, მომხმარებლის მოწოდებული
// რეფერენსის მიხედვით.
//
// `onChange` optional prop: Login/Register-ზე (ავტორიზაციამდე) DB-კონტექსტი
// არ არსებობს — მხოლოდ localStorage-ში ინახება. App.tsx-ის sidebar-ში კი
// `onChange`-ით PATCH /api/me/language-საც იძახებს (per-user DB-ში
// შესანახად, Roadmap "Multi-language support" STEP 1).
// ==========================================

interface LanguageSwitcherProps {
  className?: string;
  onChange?: (language: SupportedLanguage) => void;
}

// ბეჯის/tooltip-ის ენის კოდი განზრახ არ თარგმნება (`t()`-ის ნაცვლად
// ფიქსირებული მასივი) — ყოველთვის ლათინური "GE"/"EN" უნდა დარჩეს,
// მიუხედავად იმისა, ინტერფეისი ქართულადაა თუ ინგლისურად.
const LANG_CODE: Record<SupportedLanguage, string> = { ka: 'GE', en: 'EN' };

function LanguageSwitcher({ className, onChange }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation();
  const current = (i18n.language?.split('-')[0] as SupportedLanguage) || 'ka';
  const next: SupportedLanguage = current === 'ka' ? 'en' : 'ka';

  const handleToggle = () => {
    void i18n.changeLanguage(next);
    persistLanguage(next);
    onChange?.(next);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`${styles.langSwitch} ${className ?? ''}`}
      aria-label={t('language.label')}
      title={LANG_CODE[next]}
    >
      <GlobeIcon size={16} />
      <span className={styles.langCode}>{LANG_CODE[current]}</span>
    </button>
  );
}

export default LanguageSwitcher;
