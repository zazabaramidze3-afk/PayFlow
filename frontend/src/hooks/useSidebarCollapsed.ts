import { useCallback, useEffect, useState } from 'react';

// ==========================================
// 🧭 useSidebarCollapsed — Desktop Sidebar Icon-Only Collapse Hook
// ==========================================
// useTheme.ts-ის იდენტური კონვენცია (per-device UI preference,
// localStorage-ში ინახება — არა backend/DB-ში, რადგან ეს device-ზეა
// დამოკიდებული პრეფერენსი, არა user-ის account-მონაცემი: ერთ მოწყობილობაზე
// შეიძლება მოსახერხებელი იყოს collapsed, მეორეზე — expanded). Mobile-ზე
// sidebar-ის ჩვენება/დამალვა ცალკე `mobileNavOpen` state-ითაა (App.tsx,
// სრული overlay-სლაიდი) — ეს hook მხოლოდ Desktop-ის icon-only "rail"
// რეჟიმს მართავს (Windows Task Manager-ის ტიპის collapse).
// ==========================================

const STORAGE_KEY = 'payflow_sidebar_collapsed';

function readInitialCollapsed(): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

interface UseSidebarCollapsedResult {
  collapsed: boolean;
  toggleCollapsed: () => void;
}

export function useSidebarCollapsed(): UseSidebarCollapsedResult {
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // localStorage მიუწვდომელია (მაგ. პრივატული რეჟიმი) — collapse/expand
      // მაინც მუშაობს მიმდინარე სესიაში, უბრალოდ არ შენახება შემდეგისთვის.
    }
  }, [collapsed]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  return { collapsed, toggleCollapsed };
}
