import axios from 'axios';

// ==========================================================
// 🛡️ Superadmin Panel (Roadmap STEP 8) — ცალკე axios instance
// ==========================================================
// App.tsx-ს module-level-ზე უკვე რეგისტრირებული აქვს გლობალური
// axios.interceptors.request.use(...), რომელიც ყველა request-ს
// ტენანტის 'token'-ს (localStorage) აბამს Authorization header-ად.
// Superadmin-ის API calls-ს სულ სხვა ტოკენი სჭირდება
// (payflow_platform_admin_token) და სულ სხვა auth-მექანიზმია
// (platform_admins ცხრილი, არა users) — ამიტომ საერთო `axios`
// default instance-ის ნაცვლად საკუთარი, დამოუკიდებელი instance
// გვაქვს, რომელსაც App.tsx-ის გლობალური interceptor-ები საერთოდ არ
// ეხება (ისინი მხოლოდ default axios-ზეა დარეგისტრირებული).
//
// ასევე index.tsx-ში App.tsx საერთოდ არ იმპორტდება /admin
// მარშრუტზე (React.lazy()) — ასე რომ App.tsx-ის module-level
// interceptor-ის კოდი /admin-ზე საერთოდ არ სრულდება.

export const PLATFORM_ADMIN_TOKEN_KEY = 'payflow_platform_admin_token';

// VITE_API_URL — იხ. App.tsx-ის იგივე კომენტარი (PLAN - Backend
// Migration to Render, 31.08.2026). ეს ცალკე axios instance-ია
// (App.tsx-ის `axios.defaults.baseURL` მას არ ეხება, იხ. ფაილის
// თავში კომენტარი), ამიტომ baseURL აქაც ცალკე უნდა მიეთითოს.
const platformAdminApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
});

platformAdminApi.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem(PLATFORM_ADMIN_TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 401/403 — ტოკენი ვადაგასულია ან არასწორია: ვასუფთავებთ და UI-ს
// ვატყობინებთ, რომ ხელახლა login-ია საჭირო (PlatformAdminApp-ი ამ
// event-ს უსმენს და login ეკრანზე აბრუნებს).
platformAdminApi.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      localStorage.removeItem(PLATFORM_ADMIN_TOKEN_KEY);
      window.dispatchEvent(new Event('platform-admin:session-expired'));
    }
    return Promise.reject(error);
  }
);

export default platformAdminApi;
