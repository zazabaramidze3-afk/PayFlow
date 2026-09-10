import { useTranslation } from 'react-i18next';
import styles from './LanguageSwitcher.module.scss';
import { persistLanguage, SupportedLanguage } from '../i18n';

// ==========================================
// 🌍 LanguageSwitcher — ქარ/EN pill-გადამრთველი
// ==========================================
// ThemeToggleSwitch-ის იგივე მსუბუქი, controlled-by-hook პატერნი, მაგრამ
// 2 ტექსტური ვარიანტით (არა binary icon-crossfade) — ორზე მეტი ენის
// დამატებისას (მომავალში) კომპონენტი უცვლელად მუშაობს, `LANGUAGES`
// მასივის გაფართოებით საკმარისია.
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

const LANGUAGES: ReadonlyArray<{ code: SupportedLanguage; labelKey: string }> = [
  { code: 'ka', labelKey: 'language.ka' },
  { code: 'en', labelKey: 'language.en' },
];

function LanguageSwitcher({ className, onChange }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation();
  const current = (i18n.language?.split('-')[0] as SupportedLanguage) || 'ka';

  const handleSelect = (code: SupportedLanguage) => {
    if (code === current) return;
    void i18n.changeLanguage(code);
    persistLanguage(code);
    onChange?.(code);
  };

  return (
    <div className={`${styles.langSwitch} ${className ?? ''}`} role="group" aria-label={t('language.label')}>
      {LANGUAGES.map(({ code, labelKey }) => (
        <button
          key={code}
          type="button"
          onClick={() => handleSelect(code)}
          className={`${styles.langOption} ${current === code ? styles.langOptionActive : ''}`}
          aria-pressed={current === code}
        >
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}

export default LanguageSwitcher;
