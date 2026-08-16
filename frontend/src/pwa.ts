import { registerSW } from 'virtual:pwa-register';
import toast from 'react-hot-toast';

// ==========================================
// 📴 Roadmap STEP 3 — Service Worker რეგისტრაცია + Persistent Storage
// ==========================================
// ეს ფაილი index.tsx-იდან იმპორტდება (side-effect-ისთვის — თავად არაფერს
// არ export-ავს კომპონენტისთვის საჭირო). ორ პასუხისმგებლობას ითავსებს:
//
//   1) registerSW() — Workbox-ის მიერ build-ის დროს გენერირებული Service
//      Worker-ის რეგისტრაცია (vite.config.ts-ის injectRegister: false-ის
//      გამო ხელით ვაკეთებთ, ავტომატური <script> ინექციის ნაცვლად), რომ
//      onOfflineReady/onNeedRefresh მომენტებზე react-hot-toast-ით
//      ვაცნობოთ მოლარეს/ადმინს.
//   2) requestPersistentStorage() — Persistent Storage API-ს გამოძახება,
//      რომ ბრაუზერმა დისკის სივრცის დეფიციტისას ავტომატურად არ წაშალოს
//      ჩვენი IndexedDB-ში (Dexie, Roadmap STEP 4) დაგროვილი offline_receipts/
//      cached_products — ეს oფლაინ გაყიდვების დაკარგვის რისკს შეამცირებდა.

// 🛠️ production build-ის გარეთ (dev server) `virtual:pwa-register` მოდული
// no-op ფუნქციას აბრუნებს (vite.config.ts-ის devOptions.enabled: false-ის
// გამო) — registerSW-ის გამოძახება dev-ში უსაფრთხოა, უბრალოდ არაფერს
// არ აკეთებს.
export function initServiceWorker(): void {
  registerSW({
    immediate: true,
    onOfflineReady() {
      toast.success('აპლიკაცია მზადაა ოფლაინ რეჟიმში მუშაობისთვის 📴', { duration: 4000 });
    },
    onNeedRefresh() {
      // 🔄 registerType: 'autoUpdate' (vite.config.ts) უკვე ავტომატურად
      // აქტიურებს ახალ ვერსიას ყველა ღია ჩანართზე — აქ მხოლოდ ვაცნობებთ
      // მომხმარებელს, რომ განახლდა (ხელით refresh საჭირო არ არის POS-ის
      // შეუფერხებლად გასაგრძელებლად).
      toast('PayFlow განახლდა უახლეს ვერსიამდე ✅', { duration: 3000 });
    },
    onRegisterError(error) {
      console.error('Service Worker-ის რეგისტრაცია ჩავარდა:', error);
    },
  });
}

// ==========================================
// 💾 Persistent Storage API — Roadmap STEP 3.3
// ==========================================
// ბრაუზერს (განსაკუთრებით მობილურზე/დაბალი დისკის სივრცის დროს) შეუძლია
// "best-effort" საცავი (IndexedDB-ის ჩათვლით) ავტომატურად, გაფრთხილების
// გარეშე გაასუფთაოს, თუ storage.persist()-ით არ არის მონიშნული როგორც
// "persistent" — რაც ჩვენს შემთხვევაში ნიშნავს ჯერ დაუსინქრონებელი
// offline_receipts-ის (ნამდვილი ფულადი გაყიდვების!) დაკარგვის რისკს.
//
// ეს ფუნქცია best-effort-ია: ზოგიერთ ბრაუზერში/კონტექსტში (მაგ. Private/
// Incognito, ან permission-ის მოლოდინში) შეიძლება false დაბრუნდეს ან API
// საერთოდ არ არსებობდეს — ორივე შემთხვევაში აპლიკაცია მაინც ჩვეულებრივად
// მუშაობს, უბრალოდ დისკის სივრცის დეფიციტის რისკის ქვეშ რჩება.
export async function requestPersistentStorage(): Promise<boolean> {
  if (!('storage' in navigator) || !('persist' in navigator.storage)) {
    console.warn('Persistent Storage API ამ ბრაუზერში მხარდაუჭერელია.');
    return false;
  }

  try {
    const alreadyPersisted = await navigator.storage.persisted();
    if (alreadyPersisted) return true;

    const granted = await navigator.storage.persist();
    if (!granted) {
      console.warn('ბრაუზერმა უარყო Persistent Storage მოთხოვნა — ლოკალური მონაცემები დისკის დეფიციტისას შეიძლება წაიშალოს.');
    }
    return granted;
  } catch (error) {
    console.error('Persistent Storage მოთხოვნა ჩავარდა:', error);
    return false;
  }
}
