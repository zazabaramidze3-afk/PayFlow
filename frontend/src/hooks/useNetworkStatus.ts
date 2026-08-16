import { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';

// ==========================================
// 📡 Roadmap STEP 5 — useNetworkStatus Hook
// ==========================================
// navigator.onLine მხოლოდ ბრაუზერის/ოპერაციული სისტემის ლოკალურ ქსელ-
// ინტერფეისის მდგომარეობას ასახავს — wifi-ს "ჩხირკედელი"/captive portal
// კავშირის დროსაც (ინტერნეტს რეალურად ვერ სწვდები) true-ს აჩვენებს. ეს
// ჰუკი ორ წყაროს აერთიანებს:
//
//   1) window 'online'/'offline' event-ები — მყისიერი, უფასო სიგნალი
//      ნებისმიერი მდგომარეობის ცვლილებაზე.
//   2) 10-წამიანი heartbeat — GET /api/health (backend/src/index.ts,
//      ავტორიზაციის გარეშე, "მსუბუქი" endpoint), რომელიც ნამდვილად
//      ამოწმებს, სწვდება თუ არა ბექენდს. ამის გარეშე 'online' event
//      მარტო საკმარისი არ იქნებოდა Background Sync Worker-ის (STEP 5.2)
//      გასაშვებად — captive portal-ის შემთხვევაში POST /payments/
//      sync-offline წარუმატებლად ჩავარდებოდა ისევ და ისევ.
//
// ეფექტური isOnline მხოლოდ მაშინ არის true, თუ ორივე პირობა სრულდება —
// ბრაუზერიც და ბოლო heartbeat-იც დადებითია.
export interface NetworkStatus {
  isOnline: boolean;
  // 🕐 ბოლო წარმატებული heartbeat-ის დრო (epoch ms) — Background Sync
  // Worker-ს შეუძლია ამის მიხედვით გადაწყვიტოს, სინქრონიზაცია საჭიროა თუ
  // ახლახან ისედაც მოხერხდა.
  lastVerifiedAt: number | null;
  // 🔁 გარედან იძულებითი ხელახალი შემოწმებისთვის (მაგ. Worker-მა POST-ი
  // წარმატებით გაატარა და მაშინვე სურს დარწმუნდეს, კავშირი კვლავ ცოცხალია).
  checkNow: () => Promise<boolean>;
}

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

export function useNetworkStatus(): NetworkStatus {
  const [browserOnline, setBrowserOnline] = useState<boolean>(navigator.onLine);
  const [serverReachable, setServerReachable] = useState<boolean>(navigator.onLine);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<number | null>(null);

  // 🧹 unmount-ის შემდეგ დაგვიანებული heartbeat-ის პასუხმა state აღარ
  // უნდა შეცვალოს (React-ის "state update on unmounted component" warning).
  const isMountedRef = useRef(true);

  const pingHealth = useCallback(async (): Promise<boolean> => {
    if (!navigator.onLine) {
      if (isMountedRef.current) setServerReachable(false);
      return false;
    }

    try {
      // 🌐 FIX: აბსოლუტური URL (ფარდობითი '/api/health'-ის ნაცვლად) — ამ
      // პროექტის დანარჩენი, დადასტურებულად მომუშავე page-ების იგივე
      // კონვენცია (Sales.tsx, Dashboard.tsx, Products.tsx). იხ.
      // frontend/src/sync/backgroundSync.ts-ის იგივე FIX-ის კომენტარი.
      await axios.get('/api/health', {
        timeout: HEARTBEAT_TIMEOUT_MS,
        // 🚫 Authorization/X-Register-* headers-ს App.tsx/RegisterGuard.tsx-ის
        // interceptor-ები ისედაც ავტომატურად ურთავს — /api/health-ს ისინი
        // არ სჭირდება, მაგრამ არც ეშლება (endpoint ავტორიზაციას არ ამოწმებს).
      });
      if (isMountedRef.current) {
        setServerReachable(true);
        setLastVerifiedAt(Date.now());
      }
      return true;
    } catch {
      if (isMountedRef.current) setServerReachable(false);
      return false;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    const handleOnline = () => {
      setBrowserOnline(true);
      // 🔁 ბრაუზერმა "დაბრუნდი კავშირი" თქვა — არ ველოდებით შემდეგ
      // 10-წამიან ტიკს, მაშინვე ვამოწმებთ რეალურ სწვდომას.
      void pingHealth();
    };
    const handleOffline = () => {
      setBrowserOnline(false);
      setServerReachable(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    void pingHealth();
    const intervalId = window.setInterval(() => {
      void pingHealth();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.clearInterval(intervalId);
    };
  }, [pingHealth]);

  return {
    isOnline: browserOnline && serverReachable,
    lastVerifiedAt,
    checkNow: pingHealth,
  };
}
