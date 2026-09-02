import { useCallback, useEffect, useState } from 'react';

// ==========================================
// 🎨 useTheme — Dark/Light Mode-ის მართვის Hook
// ==========================================
// index.html-ის inline script უკვე ადგენს <html data-theme="..."> ატრიბუტს
// React-ის mount-მდე (FOUC-ის თავიდან ასაცილებლად), ასე რომ საწყისი მდგომარეობა
// აქედან იკითხება — არა localStorage/matchMedia-დან თავიდან. React Context
// საჭირო არ არის: თემა გადადის სუფთა CSS custom properties-ის (--color-*)
// მეშვეობით, რომლებიც ავტომატურად ვრცელდება მთელ DOM-ზე, prop-ის
// გადმოცემის გარეშე.
// ==========================================

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'payflow_theme';

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') {
    return 'light';
  }
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'dark' : 'light';
}

interface UseThemeResult {
  theme: Theme;
  toggleTheme: () => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage მიუწვდომელია (მაგ. პრივატული რეჟიმი) — თემა მაინც
      // მუშაობს მიმდინარე სესიაში, უბრალოდ არ შენახება შემდეგისთვის.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme };
}
