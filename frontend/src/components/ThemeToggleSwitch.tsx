import type { Theme } from '../hooks/useTheme';
import styles from './ThemeToggleSwitch.module.scss';
import { SunIcon, MoonIcon } from './Icons';

// ==========================================
// 🎨 ThemeToggleSwitch — Dark/Light გადამრთველი (pill/switch სტილი)
// ==========================================
// მომხმარებლის მოთხოვნით (06.09.2026) emoji-ის ნაცვლად — შავი/თეთრი
// pill-ტრეკი (ნაცვლად ცისფერი/navy-სი) და მინიმალისტური SVG აიკონები
// (Icons.tsx-იდან) thumb-ის შიგნით.
// FIX (06.09.2026, მე-2 რაუნდი): "ხისტი" ერთჯერადი icon-swap-ის
// ნაცვლად — ორივე აიკონი (☀️/🌙) მუდმივად დარენდერებულია thumb-ში,
// ერთმანეთზე გადაფარებული, და opacity/rotate/scale-ით არბილებდება
// crossfade (SCSS-ში), ნაცვლად React-ის conditional unmount/remount-ისა,
// რომელსაც transition საერთოდ არ ჰქონდა — thumb-ის სრიალიც უფრო
// დაბალანსებული cubic-bezier-ითაა (არა linear/ease, spring-ის გარეშე).
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
      <span className={styles.thumb}>
        <span className={styles.thumbIconSun}>
          <SunIcon size={12} />
        </span>
        <span className={styles.thumbIconMoon}>
          <MoonIcon size={12} />
        </span>
      </span>
    </button>
  );
}

export default ThemeToggleSwitch;
