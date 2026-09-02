/// <reference types="vite/client" />
// 📴 Roadmap STEP 3 — `virtual:pwa-register` მოდულის ტიპები (registerSW),
// რომელსაც src/pwa.ts იყენებს Service Worker-ის ხელით დასარეგისტრირებლად.
/// <reference types="vite-plugin-pwa/client" />

// 🌍 VITE_API_URL — PLAN - Backend Migration to Render (31.08.2026).
// strict-mode-ში `import.meta.env.VITE_API_URL` წინააღმდეგ შემთხვევაში
// `any`-ზე დაიყვანება (vite/client-ის default `ImportMetaEnv`) — ეს
// augmentation ტიპს string-ზე ამკვიდრებს (App.tsx, lib/platformAdminApi.ts).
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}
