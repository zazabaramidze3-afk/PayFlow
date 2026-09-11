import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ka from './locales/ka.json';
import en from './locales/en.json';

// ==========================================
// 🌍 Multi-language support STEP 1 — i18next setup
// ==========================================
// Storage: `users.language` DB-ში ინახება (per-user, migration 027) —
// ეს არის "წყარო-ჭეშმარიტება" login-ის შემდეგ (App.tsx-ის
// GET /api/me session-restore-ზე ფრეშად კითხულობს, businessType-ის
// იგივე "not from JWT" პრინციპით).
//
// ავტორიზაციამდე (Login/Register გვერდი) DB-კონტექსტი ჯერ არ არსებობს —
// მანამდე localStorage-ს ვეყრდნობით (`useTheme`-ის იგივე pattern),
// და login-ის შემდეგ DB-ის მნიშვნელობა თავისუფლად გადაწერს.
// ==========================================

export type SupportedLanguage = 'ka' | 'en';

// 🌍 LanguageSwitcher-ის dropdown-ი (11.09.2026) ამ მასივიდან აგენერირებს
// ვარიანტების სიას — ახალი ენის დამატებისას (მომავალში) მხოლოდ აქ და
// `resources`-ში დამატება საკმარისია, dropdown ავტომატურად აღიქვამს.
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['ka', 'en'];

const STORAGE_KEY = 'payflow_language';

function readInitialLanguage(): SupportedLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ka' || stored === 'en') return stored;
  } catch {
    // 🛟 localStorage მიუწვდომელია (private-mode და ა.შ.) — 'ka'
    // ნაგულისხმევად რჩება, კრიტიკული არაფერია.
  }
  return 'ka';
}

export function persistLanguage(language: SupportedLanguage): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // non-critical — მიმდინარე სესიაში ენა მაინც შეიცვლება.
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    ka: { translation: ka },
    en: { translation: en },
  },
  lng: readInitialLanguage(),
  fallbackLng: 'ka',
  interpolation: {
    escapeValue: false, // React თავად აქცევს escape-ს — i18next-ს არ სჭირდება
  },
});

export default i18n;
