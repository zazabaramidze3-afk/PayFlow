import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // ==========================================
    // 📴 Roadmap STEP 3 — PWA & Service Worker (Offline Mode)
    // ==========================================
    // Workbox Precaching: `index.html`, ყველა build-ის js/css bundle და UI
    // გრაფიკა (icons) წინასწარ ინახება Service Worker-ის Cache Storage-ში
    // build-ის დროს (`vite build`-ის შემდეგ), რომ payflow.ge მთლიანად
    // ჩაიტვირთოს ინტერნეტის გარეშეც (HTTPS-ზე — Service Worker-ები მხოლოდ
    // HTTPS/localhost-ზე მუშაობს ბრაუზერის უსაფრთხოების პოლიტიკით).
    //
    // ⚠️ განზრახ *არ* გვაქვს `workbox.runtimeCaching` კონფიგურაცია
    // `/api/*` route-ებისთვის — ბექენდის მონაცემები (products, payments,
    // shifts) საკუთარი, უფრო ცხადი Offline სტრატეგიით იმართება: Dexie.js
    // (`cached_products`/`offline_receipts`, Roadmap STEP 4) + Background
    // Sync (STEP 5). Workbox-ის "generic" HTTP cache API პასუხებზე
    // დამატებით ფენად რომ დაგვედო, ორმაგი (და ერთმანეთთან
    // შეუთანხმებელი/მოძველებული) წყარო გვექნებოდა იმავე მონაცემისთვის.
    VitePWA({
      registerType: 'autoUpdate',
      // 🔧 injectRegister: false — SW-ის რეგისტრაციას ხელით ვიძახებთ
      // src/pwa.ts-დან (virtual:pwa-register), რომ იმავე ადგილას
      // (registerSW-ის onOfflineReady/onNeedRefresh callback-ებში) გვქონდეს
      // კონტროლი toast-ების/refresh-ლოგიკის თავსებადობაზე react-hot-toast-თან,
      // ვიდრე plugin-ის ავტომატურად ინექცირებულ <script>-ს დავეყრდნოთ.
      injectRegister: false,
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'PayFlow — POS & Inventory',
        short_name: 'PayFlow',
        description: 'PayFlow — Offline-Ready POS (Point of Sale) & Inventory Management სისტემა',
        theme_color: '#2563EB',
        background_color: '#F8F9FA',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 🗂️ Core Frontend Assets — HTML/JS/CSS bundle-ები + UI გრაფიკა
        // (icons/fonts) — ყველა hashed build output ფაილი ავტომატურად
        // ხვდება dist/-ში `vite build`-ის შემდეგ.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf}'],
        // ძველი (წინა deploy-ის) Cache Storage ჩანაწერები ავტომატურად
        // იშლება ახალი SW-ის აქტივაციისას — დისკზე "მკვდარი" ვერსიები არ
        // გროვდება.
        cleanupOutdatedCaches: true,
        // ახალი SW ვერსია დაუყოვნებლივ აქტიურდება ყველა ღია ჩანართზე
        // (registerType: 'autoUpdate'-ის შესაბამისად) — მოლარემ ხელით
        // "განახლების" ღილაკზე დაჭერა არ უნდა დასჭირდეს POS-ის გამოსაყენებლად.
        clientsClaim: true,
        skipWaiting: true,
        // 3MB-მდე ჯამური bundle ზომაზეც (recharts/gsap/exceljs/pdfkit-ის
        // გამო) რომ Precaching არ ჩაიშალოს Workbox-ის default 2MB
        // per-file ლიმიტზე.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // 🩹 FIX (16.08) — Workbox-ის default ქცევა ნებისმიერ "navigation"
        // request-ს (window.open/სრული გვერდის გახსნა — ზუსტად ასეთია Excel/
        // PDF export ღილაკები Dashboard.tsx-ში) გადაჭერს და SPA-ის cache-ში
        // მდებარე index.html-ს (app shell) აბრუნებს ნაცვლად ქსელში გაშვებისა,
        // თუ navigateFallbackDenylist ცხადად არ გამორიცხავს გარკვეულ paths-ს.
        // ამის გარეშე /api/payments/export/excel|pdf ვერასდროს აღწევდა
        // ბექენდამდე — Service Worker პირდაპირ დაშბორდს (ანალიტიკის ტაბს)
        // აბრუნებდა ჩამოტვირთვის ნაცვლად. ყველა /api/* route (არა მხოლოდ
        // export) აქ განზრახ გამორიცხულია, რომ მომავალშიც არცერთი ბექენდ
        // endpoint-ი არ "გაიტაცოს" SW-მა.
        navigateFallbackDenylist: [/^\/api\//],
      },
      // 🛠️ დეველოპმენტში (vite dev server) SW განზრახ გამორთულია — მხოლოდ
      // production build-ს (`vite build` → `vite preview`/რეალურ deploy-ს)
      // აქვს Offline-ის საჭიროება, dev-ში კი ძველი ქეშის "წებება" HMR-ს
      // ხშირად აფუჭებს.
      devOptions: {
        enabled: false,
      },
    }),
  ],
  css: {
    // 🎨 Dart Sass-ის თანამედროვე (არა legacy) API — გამორთავს "legacy-js-api"
    // deprecation warning-ს ტერმინალში. SCSS ფაილებში @use გამოიყენება @import-ის
    // ნაცვლად ამავე მიზეზით.
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
