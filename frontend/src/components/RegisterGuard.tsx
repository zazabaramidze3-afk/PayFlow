import { useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import axios from 'axios';
import styles from './RegisterGuard.module.scss';

// ==========================================
// 🖥️ RegisterGuard — Roadmap STEP 2.3 (Frontend Register Guard)
// ==========================================
// ⚠️ FIX: თავდაპირველად ეს კომპონენტი root-იდან (index.tsx) მთელ App-ს
// ეხვეოდა, Login-ის ჩათვლითაც — რაც პრაქტიკაში მენეჯერს/ადმინსაც კეტავდა
// გარეთ ("ქათამი-კვერცხის" პრობლემა: კოდის დასადასტურებლად login საჭიროა,
// login კი დაწყვილებამდე არ იტვირთებოდა). Device Pairing კონცეპტუალურადაც
// მხოლოდ ფიზიკურ სალაროებს (POS ტერმინალებს) ეხება — არა back-office
// წვდომას. ახლა ეს კომპონენტი მხოლოდ App.tsx-ის Sales (POS) branch-ს
// ეხვევა, მოლარის ლოგინის შემდეგ. Login და Admin/Manager მარშრუტები
// (Dashboard, Products, Users Control) საერთოდ არ არიან დამოკიდებული
// სალაროს დაწყვილებაზე — ისინი ნებისმიერ (დაუწყვილებელ) მოწყობილობაზეც
// ჩვეულებრივად იტვირთება.
//
// ორი მდგომარეობიდან ერთ-ერთს აჩვენებს:
//
//   1) Unpaired (localStorage-ში payflow_register_id/payflow_register_token
//      არ არსებობს) — POS (Sales) ეკრანის ნაცვლად ჩნდება 6-ნიშნა Activation
//      Code, რომელსაც მოლარე მენეჯერს/ადმინს უკარნახებს (მათ კი, სისტემაში
//      Users Control პანელიდან შესვლის შემდეგ, შეუძლიათ დაადასტურონ) —
//      Polling-ით (3წმ-იანი ინტერვალით) ელოდება დადასტურებას.
//
//   2) Paired — payflow_register_id/payflow_register_token localStorage-ში
//      უკვე დაცულია. ეს ორივე მნიშვნელობა ავტომატურად ერთვის ყოველ
//      Axios-მოთხოვნას (X-Register-Id/X-Register-Token headers), და
//      POS ეკრანი ჩვეულებრივად იტვირთება.
//
// ⚠️ registerAuth middleware (ბექენდზე) მაინც ამოწმებს ტოკენის ვალიდურობასა
// და registers.is_active-ს ყოველ დაცულ request-ზე ცალკე (POST /shifts/open,
// POST /payments) — RegisterGuard მხოლოდ frontend-ის "კარიბჭეა", არა
// უსაფრთხოების ერთადერთი ბარიერი.

const REGISTER_ID_KEY = 'payflow_register_id';
const REGISTER_TOKEN_KEY = 'payflow_register_token';
const POLL_INTERVAL_MS = 3000;

// 🔌 ერთხელ, მოდულის ჩატვირთვისთანავე რეგისტრირდება (App.tsx-ის token
// interceptor-ის იგივე კონვენციით) — ყოველ მოთხოვნაზე localStorage-დან
// ფრეშად კითხულობს, ამიტომ არც React state-თან სინქრონიზაცია სჭირდება და
// არც დაწყვილების შემდეგ გვერდის ხელახლა ჩატვირთვა.
axios.interceptors.request.use(
  (config) => {
    const registerId = localStorage.getItem(REGISTER_ID_KEY);
    const registerToken = localStorage.getItem(REGISTER_TOKEN_KEY);
    if (registerId && registerToken) {
      config.headers['X-Register-Id'] = registerId;
      config.headers['X-Register-Token'] = registerToken;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

function hasStoredPairing(): boolean {
  return Boolean(localStorage.getItem(REGISTER_ID_KEY) && localStorage.getItem(REGISTER_TOKEN_KEY));
}

// 🖥️ Roadmap STEP 4.2 — Sales.tsx-ს (Offline Checkout Handler) პირდაპირ
// სჭირდება ამ ფიზიკური Register-ის UUID, რომ offline_receipts-ის (Dexie)
// ყოველ ჩანაწერს მიაბას — ტოკენივით ცალკე axios interceptor-ის მეშვეობით
// კი არა, header-ებში "დამალული" ჩეკის შენახვისას ხელმისაწვდომი უნდა იყოს.
export function getStoredRegisterId(): string | null {
  return localStorage.getItem(REGISTER_ID_KEY);
}

interface PairingStatusResponse {
  status: 'pending' | 'confirmed' | 'expired';
  registerId?: string;
  registerToken?: string;
}

interface RegisterGuardProps {
  children: ReactNode;
}

export default function RegisterGuard({ children }: RegisterGuardProps) {
  const [isPaired, setIsPaired] = useState<boolean>(() => hasStoredPairing());
  const [code, setCode] = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);
  // 🧹 StrictMode-ის double-effect/re-mount-ისთვის — ძველი Polling-ი
  // "შერეული" ახალთან რომ არ დარჩეს.
  const isMountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const generateCode = useCallback(async () => {
    stopPolling();
    setLoadingCode(true);
    setErrorMsg(null);

    try {
      const response = await axios.post('/api/registers/generate-code');
      if (!isMountedRef.current) return;

      const newCode: string = response.data.code;
      setCode(newCode);
      setLoadingCode(false);

      pollTimerRef.current = window.setInterval(async () => {
        try {
          const statusResponse = await axios.get<PairingStatusResponse>(
            `/api/registers/pairing-status/${newCode}`
          );
          if (!isMountedRef.current) return;

          const data = statusResponse.data;

          if (data.status === 'confirmed' && data.registerId && data.registerToken) {
            stopPolling();
            localStorage.setItem(REGISTER_ID_KEY, data.registerId);
            localStorage.setItem(REGISTER_TOKEN_KEY, data.registerToken);
            setIsPaired(true);
          } else if (data.status === 'expired') {
            stopPolling();
            generateCode();
          }
        } catch {
          // 🌐 ქსელური/დროებითი შეცდომა Polling-ის ერთ ციკლზე — ეკრანს არ
          // ვცვლით, უბრალოდ შემდეგ ინტერვალზე ისევ ვცდით.
        }
      }, POLL_INTERVAL_MS);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setLoadingCode(false);
      setErrorMsg(
        err.response?.data?.error || 'კოდის გენერირება ვერ მოხერხდა — შეამოწმეთ ინტერნეტ კავშირი და სცადეთ ხელახლა'
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopPolling]);

  useEffect(() => {
    isMountedRef.current = true;
    if (!isPaired) {
      generateCode();
    }
    return () => {
      isMountedRef.current = false;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaired]);

  if (isPaired) {
    return <>{children}</>;
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.brandRow}>
          <span className={styles.brandDot} />
          <span className={styles.brandTitle}>PayFlow</span>
        </div>

        <h1 className={styles.title}>სალაროს დაწყვილება საჭიროა</h1>
        <p className={styles.subtitle}>
          ეს მოწყობილობა ჯერ არ არის დაკავშირებული არცერთ სალაროსთან. გადასცით ქვემოთ
          მოცემული კოდი მენეჯერს ან ადმინისტრატორს — მან უნდა დაადასტუროს ის Users
          Control პანელიდან.
        </p>

        {loadingCode && <div className={styles.loadingText}>კოდის გენერირება...</div>}

        {errorMsg && (
          <div className={styles.errorBox}>
            <span>{errorMsg}</span>
            <button type="button" className={styles.retryBtn} onClick={generateCode}>
              ხელახლა სცადეთ
            </button>
          </div>
        )}

        {code && !loadingCode && !errorMsg && (
          <>
            <div className={styles.code} aria-label="აქტივაციის კოდი">
              {code}
            </div>
            <div className={styles.waitingRow}>
              <span className={styles.spinner} />
              ველოდებით დადასტურებას...
            </div>
          </>
        )}
      </div>
    </div>
  );
}
