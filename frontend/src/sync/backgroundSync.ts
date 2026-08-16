import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import {
  getSyncableOfflineReceipts,
  markReceiptsSyncing,
  markReceiptSynced,
  markReceiptFailed,
  countPendingOfflineReceipts,
  countFailedOfflineReceipts,
  resetStuckSyncingReceipts,
} from '../db/offlineDb';

// ==========================================
// 🔄 Roadmap STEP 5 — Background Sync Worker
// ==========================================
// ერთადერთი პასუხისმგებელი მოდული, რომელიც Dexie-ის (Roadmap STEP 4.1)
// offline_receipts queue-ს POST /api/payments/sync-offline-ისკენ აგზავნის.
// ორ ნაწილად იყოფა:
//
//   • syncOfflineReceipts() — სუფთა (React-გარეშე) ლოგიკა: წაკითხვა →
//     'syncing' → POST → პასუხის მიხედვით Dexie-ს განახლება. ცალკე
//     ტესტვადი/გამოძახებადია React-ის lifecycle-ისგან დამოუკიდებლად.
//   • useBackgroundSyncEngine() — React hook, რომელიც App.tsx-ში ერთხელ
//     იტვირთება (Sales.tsx-ის კონკრეტულ route-ზე კი არა) და მართავს,
//     როდის გაეშვას syncOfflineReceipts() — window 'online' event-ზე
//     დაუყოვნებლივ, mount-ზეც ერთხელ, შემდეგ პერიოდულად (retry), სანამ
//     queue არ დაცარიელდება.

// 🔀 backend/src/types.ts-ის OfflineSyncResult-ის ფრონტენდის მხარის
// ასლი — ცალკე პაკეტი backend/frontend-ს შორის არ არსებობს, ამიტომ
// ეს ტიპი აქ დუბლირებულია (ველების ფორმა backend-ის routes/sales.ts-ს
// უნდა ემთხვეოდეს ცალსახად).
interface OfflineSyncItemResult {
  id: string;
  status: 'synced' | 'duplicate' | 'failed';
  error?: string;
  hadStockDeficit?: boolean;
}

interface OfflineSyncResponse {
  results: OfflineSyncItemResult[];
}

export interface SyncRunSummary {
  attempted: number;
  synced: number;
  duplicate: number;
  failed: number;
  deficits: number;
}

const EMPTY_SUMMARY: SyncRunSummary = { attempted: 0, synced: 0, duplicate: 0, failed: 0, deficits: 0 };

// 🔒 მოდულის დონის მიუტექსი — Worker-ის ორმაგი (ერთდროული) გაშვების
// თავიდან ასაცილებლად (მაგ. 'online' event და periodic interval ერთდროულად
// გაეშვება). React state-ის ნაცვლად უბრალო module-scope flag საკმარისია,
// რადგან ეს ფუნქცია React-ის lifecycle-ისგან დამოუკიდებლადაც შეიძლება
// გამოძახებულ იქნას.
let isSyncRunning = false;

// 🔄 ერთი სრული სინქრონიზაციის ციკლი. თუ queue ცარიელია ან სინქრონიზაცია
// უკვე მიმდინარეობს, EMPTY_SUMMARY/null ბრუნდება — მოსაცდელი არაფერია.
export async function syncOfflineReceipts(): Promise<SyncRunSummary> {
  // 🌐 FIX: ადრე ეს ფუნქცია მთლიანად useNetworkStatus-ის heartbeat-ზე
  // (GET /api/health) იყო დამოკიდებული "isOnline" გარე პარამეტრის სახით —
  // თუ ეს ერთი, ცალკე endpoint ერთხელაც ვერ მიიღწა (ქსელის დროებითი
  // ჭიმვა/CORS/სხვა გარემო-სპეციფიკური მიზეზი), Worker სამუდამოდ
  // იბლოკებოდა, თუნდაც POST /payments/sync-offline რეალურად
  // ხელმისაწვდომი ყოფილიყო. ახლა ამის ნაცვლად პირდაპირ navigator.onLine-ს
  // ვამოწმებთ (Sales.tsx-ის handleOfflineCheckout-ის იგივე კონვენცია) —
  // სინქრონიზაციის ცდის ერთადერთი "ჭეშმარიტების წყარო" თავად POST
  // request-ის წარმატება/ჩავარდნაა, არა ცალკე heartbeat-ის შედეგი.
  if (!navigator.onLine) return EMPTY_SUMMARY;

  if (isSyncRunning) return EMPTY_SUMMARY;
  isSyncRunning = true;

  try {
    const receipts = await getSyncableOfflineReceipts();
    if (receipts.length === 0) return EMPTY_SUMMARY;

    const ids = receipts.map((r) => r.id);
    await markReceiptsSyncing(ids);

    // 🧾 backend/src/types.ts-ის OfflineSyncReceiptPayload-ის ზუსტი ფორმა —
    // syncStatus/createdAtLocal/syncError/lastAttemptAt (Dexie-სპეციფიკური
    // ველები) არ იგზავნება, ბექენდს არც სჭირდება.
    const payload = {
      receipts: receipts.map((r) => ({
        id: r.id,
        shiftId: r.shiftId,
        registerId: r.registerId,
        cashierId: r.cashierId,
        items: r.items,
        subtotalAmount: r.subtotalAmount,
        discountType: r.discountType,
        discountValue: r.discountValue,
        totalAmount: r.totalAmount,
        paymentMethod: r.paymentMethod,
        splits: r.splits,
        cashReceived: r.cashReceived,
        createdAt: r.createdAt,
      })),
    };

    let response;
    try {
      // 🌐 FIX: ფარდობითი '/api/...' ნაცვლად აბსოლუტური URL — ამ პროექტის
      // დანარჩენ page-ების (Sales.tsx, Dashboard.tsx, Products.tsx,
      // ExecutiveDashboard.tsx-ის loadStats) იგივე, დადასტურებულად
      // მომუშავე კონვენცია. `npm run preview`-ზე (ან სხვა non-Vite-dev
      // გარემოში) ფარდობითი გზა ბექენდის ნაცვლად frontend static
      // server-ს მიემართებოდა და 404/HTML-ს აბრუნებდა — ეს იყო STEP 5-ის
      // "საერთოდ არაფერი არ სინქრონდება" ბაგის ძირითადი მიზეზი.
      response = await axios.post<OfflineSyncResponse>('http://localhost:5000/api/payments/sync-offline', payload);
    } catch {
      // 🌐 მთელი batch request ჩავარდა (ქსელი ისევ გაწყდა request-ის
      // შესრულებამდე, ან 401/500) — ყველა 'syncing'-ად მონიშნული ჩანაწერი
      // 'failed'-ად ვბრუნდებით, რომ შემდეგ ციკლზე ისევ საცდელი დარჩეს
      // (მუდმივად 'syncing'-ში "გაჭედვის" ნაცვლად).
      await Promise.all(
        ids.map((id) => markReceiptFailed(id, 'სინქრონიზაციის მოთხოვნა ჩავარდა — ხელახლა განხორციელდება'))
      );
      return { ...EMPTY_SUMMARY, attempted: ids.length, failed: ids.length };
    }

    const summary: SyncRunSummary = { ...EMPTY_SUMMARY, attempted: ids.length };

    for (const result of response.data.results) {
      if (result.status === 'synced' || result.status === 'duplicate') {
        await markReceiptSynced(result.id);
        if (result.status === 'synced') summary.synced += 1;
        else summary.duplicate += 1;
        if (result.hadStockDeficit) summary.deficits += 1;
      } else {
        await markReceiptFailed(result.id, result.error || 'უცნობი შეცდომა სინქრონიზაციისას');
        summary.failed += 1;
      }
    }

    return summary;
  } finally {
    isSyncRunning = false;
  }
}

// ⏱️ რამდენ ხანში სცადოს Worker-მა ხელახლა (periodic retry), სანამ queue
// არ დაცარიელდება. window 'online' event-ი (მყისიერი) ამას ავსებს, არა
// ცვლის — ეს ინტერვალი "უსაფრთხოების ბადეა" იმ შემთხვევებისთვისაც, როცა
// ბრაუზერმა 'online' საერთოდ არ გამოსცა (მაგ. captive portal-იდან
// გამოსვლა navigator.onLine-ს არ ცვლის ყოველთვის სანდოდ).
const RETRY_INTERVAL_MS = 20_000;

export interface BackgroundSyncEngineState {
  isSyncing: boolean;
  // 📴 Dexie-ში ჯერ კიდევ დარჩენილი ('pending' + 'failed') ჩეკების
  // რაოდენობა — App.tsx-ს/POS ეკრანს შეუძლია ამის მიხედვით პატარა
  // "N ჩეკი ელოდება სინქრონიზაციას" ინდიკატორი აჩვენოს.
  pendingCount: number;
}

// ⚙️ App.tsx-ში ერთხელ იტვირთება (route-ისგან დამოუკიდებლად — Sales.tsx-ს
// მხოლოდ POS-ის დროს ვნახულობთ, მაგრამ Offline queue-ს სინქრონიზაცია
// მაშინაც უნდა გაგრძელდეს, როცა მოლარემ სხვა გვერდზე გადაინაცვლა).
//
// 🌐 FIX: ეს hook ადრე გარედან (App.tsx-იდან) მიღებულ `isOnline`
// boolean-ს (useNetworkStatus-ის heartbeat-ის შედეგი) სჭირდებოდა
// გასაშვებად — ერთი გარეგანი დამოკიდებულების ჩავარდნას მთელი Worker-ი
// აჩერებდა. ახლა hook დამოუკიდებელია: თავად უსმენს window-ის
// 'online' event-ს (ბრაუზერის ჩაშენებული, ყოველთვის სანდო სიგნალი) და
// თავადვე ინახავს პერიოდულ retry-ინტერვალს. "ნამდვილად online ვართ თუ
// არა" კითხვაზე პასუხს POST /payments/sync-offline-ის საკუთარი
// წარმატება/ჩავარდნა იძლევა (syncOfflineReceipts-ის შიგნით), არა
// ცალკე გარეგანი heartbeat-შემოწმება.
export function useBackgroundSyncEngine(): BackgroundSyncEngineState {
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPendingCount = useCallback(async () => {
    const [pending, failed] = await Promise.all([countPendingOfflineReceipts(), countFailedOfflineReceipts()]);
    setPendingCount(pending + failed);
  }, []);

  const runSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const summary = await syncOfflineReceipts();

      if (summary.attempted > 0) {
        const successCount = summary.synced + summary.duplicate;
        if (successCount > 0) {
          toast.success(`✅ ${successCount} ოფლაინ ჩეკი წარმატებით დასინქრონდა`, { duration: 4000 });
        }
        if (summary.deficits > 0) {
          toast(
            `⚠️ ${summary.deficits} სინქრონიზებულ ჩეკზე მარაგის დეფიციტი აღმოჩნდა — იხილეთ Manager Dashboard`,
            { duration: 6000, icon: '⚠️' }
          );
        }
        if (summary.failed > 0) {
          toast.error(`${summary.failed} ოფლაინ ჩეკის სინქრონიზაცია ვერ მოხერხდა — ავტომატურად ხელახლა სცდება`, {
            duration: 5000,
          });
        }
      }

      await refreshPendingCount();
    } finally {
      setIsSyncing(false);
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    const attempt = () => void runSync();
    let cancelled = false;

    window.addEventListener('online', attempt);

    // 🩹 FIX: mount-ზე ჯერ resetStuckSyncingReceipts() — თუ წინა გვერდის
    // ჩატვირთვაზე reload/tab-closure POST-ის შუაში მოხდა, ჩანაწერი
    // 'syncing'-ად "ჩარჩა" (იხ. offlineDb.ts-ის კომენტარი) და
    // getSyncableOfflineReceipts მას ვერასდროს დაინახავდა ხელახალი
    // მცდელობისთვის. ეს reset-ი გარანტირებულად პირველი runSync-ის (`attempt()`
    // ქვემოთ) წინ სრულდება, რომ queue-ს ხედვა უკვე გასწორებული ჰქონდეს.
    void (async () => {
      await resetStuckSyncingReceipts();
      if (cancelled) return;
      await refreshPendingCount();
      // 🚀 mount-ზეც ერთხელ ვცდით (არა მხოლოდ 'online' event-ზე) — თუ
      // გვერდი refresh-და უკვე online მდგომარეობაში, pending queue-ს
      // 20-წამიან პირველ ინტერვალამდე არ უნდა დაველოდოთ.
      attempt();
    })();

    const intervalId = window.setInterval(attempt, RETRY_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener('online', attempt);
      window.clearInterval(intervalId);
    };
  }, [runSync, refreshPendingCount]);

  return { isSyncing, pendingCount };
}
