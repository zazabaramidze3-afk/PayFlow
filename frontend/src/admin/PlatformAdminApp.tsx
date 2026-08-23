import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import PlatformAdminLogin from './PlatformAdminLogin';
import PlatformAdminDashboard from './PlatformAdminDashboard';
import { PLATFORM_ADMIN_TOKEN_KEY } from '../lib/platformAdminApi';

// ==========================================================
// 🛡️ PlatformAdminApp — Superadmin პანელის root კომპონენტი (Roadmap STEP 8)
// ==========================================================
// App.tsx-ისგან სრულად დამოუკიდებელი root — არც router, არც state
// არ ეზიარება ტენანტის აპლიკაციას. index.tsx მას მხოლოდ /admin
// pathname-ზე dynamic import()-ით ტვირთავს (იხ. index.tsx-ის კომენტარი),
// რომ App.tsx-ის module-level axios interceptor საერთოდ არ ჩაირთოს.
export default function PlatformAdminApp() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    () => !!localStorage.getItem(PLATFORM_ADMIN_TOKEN_KEY)
  );

  useEffect(() => {
    // platformAdminApi.ts-ის response interceptor 401/403-ზე ტოკენს
    // შლის და ამ event-ს აგზავნის — აქ ვისმენთ, რომ UI-იც სინქრონულად
    // login ეკრანზე დაბრუნდეს (გვერდის ხელახლა-ჩატვირთვის გარეშე).
    const handleSessionExpired = () => setIsAuthenticated(false);
    window.addEventListener('platform-admin:session-expired', handleSessionExpired);
    return () => window.removeEventListener('platform-admin:session-expired', handleSessionExpired);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem(PLATFORM_ADMIN_TOKEN_KEY);
    setIsAuthenticated(false);
  };

  return (
    <>
      <Toaster position="top-center" />
      {isAuthenticated ? (
        <PlatformAdminDashboard onLogout={handleLogout} />
      ) : (
        <PlatformAdminLogin onLoginSuccess={() => setIsAuthenticated(true)} />
      )}
    </>
  );
}
