import type { Theme } from '../hooks/useTheme';
import styles from './ThemeToggleSwitch.module.scss';

// ==========================================
// 🎨 ThemeToggleSwitch — Dark/Light გადამრთველი (pill/switch სტილი)
// ==========================================
// მომხმარებლის მოთხოვნით (02.09.2026) მარტივი icon-ღილაკის ნაცვლად —
// სრული switch-ი: ცისფერი/მუქი navy ტრეკი + თეთრი thumb, რომელიც
// მარცხნივ/მარჯვნივ სრიალებს, ორივე ბოლოში ☀️/🌙 აიკონით. ერთი
// გაზიარებული კომპონენტია App.tsx-ის ორივე ადგილისთვის (sidebar
// desktop-ზე, mobileTopbar მობილურზე) — დუბლირების თავიდან ასაცილებლად.
// ==========================================

interface ThemeToggleSwitchProps {
  theme: Theme;
  onToggle: () => void;
  className?: string;
}

function ThemeToggleSwitch({ theme, onToggle, className }: ThemeToggleSwitchProps) {
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`${styles.switchTrack} ${isDark ? styles.switchTrackDark : ''} ${className ?? ''}`}
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'ღია თემაზე გადართვა' : 'მუქ თემაზე გადართვა'}
      title={isDark ? 'ღია რეჟიმი' : 'მუქი რეჟიმი'}
    >
      <span className={styles.iconSun} aria-hidden="true">☀️</span>
      <span className={styles.iconMoon} aria-hidden="true">🌙</span>
      <span className={styles.thumb} />
    </button>
  );
}

export default ThemeToggleSwitch;
