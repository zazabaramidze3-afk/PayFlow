import * as React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// 🖥️ Roadmap STEP 2.3 (FIX) — RegisterGuard აღარ ხვევს მთელ App-ს root-იდან.
// Login-ისა და Admin/Manager პანელის დაბლოკვამ (roadmap-ის თავდაპირველი
// მოთხოვნის სიტყვასიტყვითმა წაკითხვამ) რეალურად ჩაკეტა თავად მენეჯერიც —
// ვერავინ ვერ ლოგინდებოდა კოდის დასადასტურებლად ("ქათამი-კვერცხის" პრობლემა).
// Device Pairing კონცეპტუალურადაც მხოლოდ ფიზიკურ სალაროებს (POS ტერმინალებს)
// ეხება — არა back-office წვდომას. ახლა RegisterGuard მხოლოდ Sales (POS)
// გვერდს ეხვევა, მოლარის ლოგინის შემდეგ (იხ. App.tsx). Login და Admin/Manager
// მარშრუტები საერთოდ არ არიან დამოკიდებული სალაროს დაწყვილებაზე.
// 🎨 გლობალური დიზაინ სისტემა (SCSS reset, ცვლადები, ანიმაციები) —
// index.tsx-შია შემოტანილი, რომ ერთხელ ჩატვირთვისთანავე მთელ აპს მოედოს.
import './styles/global.scss';
// 🖨 Roadmap ეტაპი 7 — გლობალური ბეჭდვის სტილები (@media print).
// განზრახ index.tsx-შია შემოტანილი (არა კონკრეტულ page-ში), რომ ერთხელ
// ჩატვირთვისთანავე ყველა გვერდზე მოქმედებდეს — ჩეკიც, Z-Report-იც,
// მომავალში სხვა ბეჭდვადი შაბლონებიც იმავე წესებს გამოიყენებენ.
import './print.css';
// 📴 Roadmap STEP 3 — Service Worker რეგისტრაცია (Workbox Precaching) +
// Persistent Storage API. აპლიკაციის ჩატვირთვისთანავე ერთხელ ეშვება.
import { initServiceWorker, requestPersistentStorage } from './pwa';

initServiceWorker();
// 🔕 განზრახ "და-გარეშედ" (fire-and-forget) — მომხმარებელს დამატებითი
// ბლოკავი UI/permission-prompt არ სჭირდება; ბრაუზერების უმეტესობა ამ
// გადაწყვეტილებას ჩუმად, საკუთარი ჰევრისტიკით იღებს (Chrome-ზე მაგ.
// "site engagement"-ზე დაყრდნობით), ცალკე მომხმარებლის confirm-ის გარეშე.
void requestPersistentStorage();

const container = document.getElementById('root');
if (!container) throw new Error('Failed to find the root element');
const root = ReactDOM.createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
