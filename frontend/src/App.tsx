import { useState, useEffect, lazy, Suspense } from 'react';
import Login from './pages/Login';
// 🏢 Multi-Tenant SaaS STEP 3 (Roadmap "23.08.2026") — კომპანიის
// self-service რეგისტრაცია. Login-ივით *არ* არის lazy (მსუბუქი გვერდია,
// ავტორიზაციამდე გამოსაჩენად, დაყოვნების გარეშე).
import Register from './pages/Register';
// 🖥️ Roadmap STEP 2.3 (FIX) — Device Pairing მხოლოდ POS (Sales) გვერდს
// იცავს, არა Login-ს ან Admin/Manager პანელს (იხ. კომენტარი ქვემოთ,
// currentPage === 'sales' branch-თან).
import RegisterGuard from './components/RegisterGuard';
import axios from 'axios';

// 1. შემოგვაქვს ტოსტერის კონტეინერი
import { Toaster } from 'react-hot-toast';
// 📴 Roadmap STEP 5 — Background Sync Engine. App.tsx-ის root-ში იტვირთება
// (არა Sales.tsx-ში) განზრახ — Offline queue-ს სინქრონიზაცია მაშინაც უნდა
// გაგრძელდეს, როცა მოლარემ POS-იდან სხვა გვერდზე გადაინაცვლა (თუმცა
// პრაქტიკაში cashier როლს მხოლოდ Sales გვერდი აქვს — მომავალში როლების
// გაფართოებაზეც კი ეს ადგილი სწორი რჩება).
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { useTheme } from './hooks/useTheme';
import { useBackgroundSyncEngine } from './sync/backgroundSync';
import styles from './App.module.scss';

// ==========================================================
// 🌍 API Base URL (PLAN - Backend Migration to Render, 31.08.2026)
// ==========================================================
// production-ში (Vercel) აქამდე frontend-ის ყველა API request
// რელატიური იყო ('/api/...') — საკმარისი იყო, სანამ backend იმავე
// Vercel origin-ზე მუშაობდა (@vercel/node serverless function).
// Render-ზე გადატანის შემდეგ backend სხვა origin-ზეა, ამიტომ
// production-ს absolute URL სჭირდება. VITE_API_URL build-ის დროს
// შედის (Vite env var, იხ. frontend/.env.example) — თუ არ არის
// დაყენებული (ლოკალური dev, სადაც vite.config.ts-ის proxy /api-ს
// localhost:5000-ზე აგზავნის), baseURL ცარიელი string რჩება და
// ძველი, რელატიური ქცევა უცვლელად გრძელდება.
axios.defaults.baseURL = import.meta.env.VITE_API_URL || '';

// ==========================================================
// 🚧 Roadmap-ის მიღმა (12.08) — Route-level code-splitting
// ==========================================================
// Dashboard/Products/UsersManagement (+ მათი დამოკიდებულებები, მაგ.
// recharts/gsap ExecutiveDashboard.tsx-ში) admin/manager-ონლი გვერდებია —
// cashier-ს ეს JS არასდროს არ სჭირდება, მაგრამ static import-ით ეს ყველაფერი
// ერთ, საერთო bundle-ში ხვდებოდა (dist/assets/index-*.js ~877KB). React.lazy()
// + Suspense (ქვემოთ, .content-ის შემოხვევა) ცალკე chunk-ებად გამოყოფს
// თითოეულ გვერდს — ბრაუზერი მხოლოდ მაშინ ჩამოტვირთავს, როცა მომხმარებელი
// რეალურად ნავიგირებს იქ. Sales.tsx-ც lazy-ია (თუმცა cashier-ისთვის ეს
// თითქმის ყოველთვის საჭიროა) — მარტივი, ერთგვაროვანი პატერნისთვის ოთხივე
// role-გვერდი ერთნაირად მუშავდება. Login კი განზრახ *არ* არის lazy — ის
// ყოველთვის პირველი რაც ჩანს ავტორიზაციამდე, დაყოვნების გარეშე უნდა
// გამოჩნდეს.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Products = lazy(() => import('./pages/Products'));
const Sales = lazy(() => import('./pages/Sales'));
const UsersManagement = lazy(() => import('./pages/UsersManagement'));

// =======================================================
// 🛡️ AXIOS INTERCEPTOR — ავტომატური ტოკენის მიბმა
// =======================================================
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// თუ ბექენდმა ტოკენი უარყო, ვასუფთავებთ localStorage-ს
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const message: string = error.response?.data?.error || '';
    // 🔧 FIX (02.09.2026, Render migration — JWT_SECRET rotation-ის შემდეგ
    // აღმოჩენილი ხარვეზი) — "სალაროს ტოკენი" (register-pairing token,
    // registerAuth.ts-ის requireRegister) ცალკე უნდა დამუშავდეს user-ის
    // auth token-ისგან. ორივე error message შეიცავს სიტყვას "ტოკენი",
    // მაგრამ სალაროს pairing-ის ვადაგასვლა/rotation არ ნიშნავს, რომ
    // user-ის session-იც არავალიდურია — საჭიროა მხოლოდ ამ კონკრეტული
    // მოწყობილობის ხელახალი დაწყვილება, არა სრული logout.
    if (status === 403 && message.includes('სალაროს ტოკენი')) {
      localStorage.removeItem('payflow_register_id');
      localStorage.removeItem('payflow_register_token');
      window.dispatchEvent(new Event('register:pairing-required'));
    } else if (status === 401 || (status === 403 && message.includes('ტოკენი'))) {
      localStorage.removeItem('token');
      window.dispatchEvent(new Event('auth:session-expired'));
    }
    return Promise.reject(error);
  }
);

interface UserPermission {
  // 🆔 UUID მიგრაცია (Roadmap STEP 1) — users.id ბექენდზე ახლა UUID
  // string-ია, აღარ არის SERIAL INTEGER.
  id: string;
  username: string;
  role: 'admin' | 'manager' | 'cashier';
  status: 'აქტიური' | 'დაბლოკილი';
}

// =======================================================
// 🔄 SESSION RESTORE — ტოკენის ამოკითხვა
// =======================================================
function getUserFromStoredToken(): UserPermission | null {
  const token = localStorage.getItem('token');
  if (!token) return null;

  try {
    const payloadBase64 = token.split('.')[1];
    const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));

    if (payload.exp && Date.now() >= payload.exp * 1000) {
      localStorage.removeItem('token');
      return null;
    }

    return {
      id: payload.id,
      username: payload.username,
      role: payload.role,
      status: 'აქტიური',
    };
  } catch {
    localStorage.removeItem('token');
    return null;
  }
}

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState<UserPermission | null>(() => getUserFromStoredToken());
  const isLoggedIn = !!currentUser;
  // 🏢 Multi-Tenant SaaS STEP 3 — router არ გვაქვს, ამიტომ Login ⇄ Register
  // გადართვა უბრალო state-ტოგლითაა (მხოლოდ isLoggedIn === false-ისას აქტუალური).
  const [showRegister, setShowRegister] = useState(false);
  // 📱 მობილურზე Sidebar ნაგულისხმევად დამალულია — ჰამბურგერ ღილაკით იხსნება.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const handleSessionExpired = () => setCurrentUser(null);
    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth:session-expired', handleSessionExpired);
  }, []);

  // ==========================================
  // 📴 Roadmap STEP 5 — Background Sync Engine
  // ==========================================
  // 🌐 FIX: useBackgroundSyncEngine აღარ არის დამოკიდებული
  // useNetworkStatus-ის ცალკე heartbeat-ზე (GET /api/health) — Worker
  // თავად, დამოუკიდებლად უსმენს window-ის 'online' event-ს და საკუთარი
  // POST-ის შედეგით წყვეტს, რეალურად online არის თუ არა. useNetworkStatus
  // მაინც გამოძახებულია (მომავალში UI ინდიკატორისთვის სასარგებლო), მაგრამ
  // sync-ის გაშვებას აღარ ბლოკავს, თუ ეს ცალკე heartbeat request ჩავარდა.
  useNetworkStatus();
  useBackgroundSyncEngine();
  const { theme, toggleTheme } = useTheme();

  // ავტორიზაცია ბეკენდის SQL ბაზის მეშვეობით
  // 🏢 Multi-Tenant SaaS — `users.name` per-org unique გახდა (migration 016,
  // Roadmap "24.08.2026") — Login.tsx-ის ორსაფეხურიანი ფლოუდან (slug-ის
  // წინასწარი resolve-ის შემდეგ) ახლა `slug`-იც მოსდის, POST /login-საც
  // სჭირდება, რომ ცალსახად იცოდეს, რომელ org-ში ეძებოს user.
  const handleLoginAttempt = async (
    slug: string,
    username: string,
    password: string,
    // 🆔 UUID მიგრაცია (Roadmap STEP 1) — users.id ახლა UUID string-ია.
    callback: (result: { error?: string; requiresPasswordReset?: boolean; userId?: string }) => void
  ) => {
    try {
      const response = await axios.post('/api/login', { slug, username, password });
      const { token, user, requiresPasswordReset } = response.data;

      // 🔐 თუ საწყისი პაროლის შეცვლაა საჭირო, სესიას ჯერ არ ვამყარებთ —
      // ტოკენს არ ვინახავთ და დეშბორდზეც არ გადავდივართ. Login ფორმა
      // თავად აჩვენებს inline პაროლის განახლების ფორმას (Login.tsx),
      // და მხოლოდ /api/auth/reset-password-initial-ის წარმატების
      // შემდეგ ვამყარებთ სესიას (იხ. handlePasswordResetComplete).
      if (requiresPasswordReset) {
        callback({ requiresPasswordReset: true, userId: user.id });
        return;
      }

      // ვინახავთ ტოკენს ბრაუზერში
      localStorage.setItem('token', token);

      setCurrentUser(user);
      setCurrentPage(user.role === 'cashier' ? 'sales' : 'dashboard');
      callback({});
    } catch (error: any) {
      if (error.response && error.response.data.error) {
        callback({ error: error.response.data.error });
      } else {
        callback({ error: 'სერვერთან კავშირი ვერ დამყარდა!' });
      }
    }
  };

  // 🔐 საწყისი პაროლის განახლების დასრულების შემდეგ ბექენდი აბრუნებს
  // ჩვეულებრივ login-ტოკენს — ამ ეტაპზე ვამყარებთ სესიას ისე,
  // როგორც ჩვეულებრივი შესვლისას.
  const handlePasswordResetComplete = (token: string, user: any) => {
    localStorage.setItem('token', token);
    setCurrentUser(user);
    setCurrentPage(user.role === 'cashier' ? 'sales' : 'dashboard');
  };

  // 🏢 Multi-Tenant SaaS STEP 3 — რეგისტრაცია auto-login-ით მთავრდება
  // (POST /organizations/register იგივე login-ტოკენს აბრუნებს) — ზუსტად
  // იგივე სესიის დამყარების პატერნი, რაც handlePasswordResetComplete-შია.
  const handleRegisterSuccess = (token: string, user: any) => {
    localStorage.setItem('token', token);
    setCurrentUser(user);
    setShowRegister(false);
    setCurrentPage(user.role === 'cashier' ? 'sales' : 'dashboard');
  };

  // სისტემიდან გამოსვლის ფუნქცია
  const handleLogout = () => {
    localStorage.removeItem('token'); 
    setCurrentUser(null);
  };

  if (!isLoggedIn) {
    if (showRegister) {
      return (
        <Register
          onRegisterSuccess={handleRegisterSuccess}
          onNavigateToLogin={() => setShowRegister(false)}
        />
      );
    }
    return (
      <Login
        onLoginAttempt={handleLoginAttempt}
        onPasswordResetComplete={handlePasswordResetComplete}
        onNavigateToRegister={() => setShowRegister(true)}
      />
    );
  }

  const userRole = currentUser?.role;
  const isAdminOrManager = userRole === 'admin' || userRole === 'manager';

  const navigateTo = (page: string) => {
    setCurrentPage(page);
    setMobileNavOpen(false);
  };

  return (
    <div className={styles.appShell}>
      {/* 2. ჩავსვით ტოსტერის კომპონენტი, რომელიც ეკრანზე ზედა ცენტრში გამოაჩენს შეტყობინებებს */}
      <Toaster position="top-center" reverseOrder={false} />

      {/* 📱 მობილური ზედა ზოლი — ჰამბურგერ ღილაკით + თემის toggle მარჯვნივ */}
      <div className={styles.mobileTopbar}>
        <button
          className={styles.hamburgerBtn}
          onClick={() => setMobileNavOpen(o => !o)}
          aria-label="მენიუს გახსნა"
        >
          {mobileNavOpen ? '✕' : '☰'}
        </button>
        <span className={styles.brandTitle}>PayFlow</span>
        <button
          type="button"
          onClick={toggleTheme}
          className={styles.themeToggleIcon}
          aria-label={theme === 'dark' ? 'ღია თემაზე გადართვა' : 'მუქ თემაზე გადართვა'}
          title={theme === 'dark' ? 'ღია რეჟიმი' : 'მუქი რეჟიმი'}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>

      {/* 📱 მობილურზე Sidebar-ის მიღმა მუქი overlay, დახურვისთვის */}
      {mobileNavOpen && (
        <div className={styles.sidebarOverlay} onClick={() => setMobileNavOpen(false)} />
      )}

      {/* Sidebar მენიუ */}
      <div className={`${styles.sidebar} ${mobileNavOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarTop}>
          <div className={styles.brand}>
            <span className={styles.brandGroup}>
              <span className={styles.brandDot} />
              <span className={styles.brandTitle}>PayFlow</span>
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              className={styles.themeToggleIcon}
              aria-label={theme === 'dark' ? 'ღია თემაზე გადართვა' : 'მუქ თემაზე გადართვა'}
              title={theme === 'dark' ? 'ღია რეჟიმი' : 'მუქი რეჟიმი'}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
          <p className={styles.userMeta}>
            {currentUser?.username} · {userRole}
          </p>
          <ul className={styles.nav}>
            {isAdminOrManager && (
              <>
                <li
                  onClick={() => navigateTo('dashboard')}
                  className={`${styles.navItem} ${currentPage === 'dashboard' ? styles.active : ''}`}
                >
                  📊 Dashboard
                </li>
                <li
                  onClick={() => navigateTo('products')}
                  className={`${styles.navItem} ${currentPage === 'products' ? styles.active : ''}`}
                >
                  📦 Products
                </li>
              </>
            )}
            {userRole === 'cashier' && (
              <li
                onClick={() => navigateTo('sales')}
                className={`${styles.navItem} ${currentPage === 'sales' ? styles.active : ''}`}
              >
                🛒 Sales (POS)
              </li>
            )}
            {isAdminOrManager && (
              <li
                onClick={() => navigateTo('users_control')}
                className={`${styles.navItem} ${styles.navDivider} ${styles.navAccent} ${currentPage === 'users_control' ? styles.active : ''}`}
              >
                👥 Users Control
              </li>
            )}
          </ul>
        </div>
        <button onClick={handleLogout} className={styles.logoutBtn}>🚪 სისტემიდან გამოსვლა</button>
      </div>

      {/* ძირითადი კონტენტი */}
      <div className={styles.content}>
        {/* 🚧 Suspense — React.lazy()-ით დაშლილი გვერდების chunk-ის
            ჩამოტვირთვის ხანმოკლე ფანჯარაში ჩანს (dist-ში ეს chunk
            ცალკე ფაილია, პირველივე ვიზიტზე ერთხელ იტვირთება). */}
        <Suspense fallback={<div className={styles.pageLoadingFallback}>იტვირთება...</div>}>
          {currentPage === 'dashboard' && isAdminOrManager && <Dashboard />}
          {currentPage === 'products' && isAdminOrManager && <Products />}
          {/* 🖥️ Device Pairing (Roadmap STEP 2) — მხოლოდ POS/Sales გვერდზეა
              საჭირო (ფიზიკური სალარო). Admin/Manager პანელი (Dashboard,
              Products, Users Control) ამაზე დამოკიდებული არასდროს არ ყოფილა,
              და Login-იც უკვე ცალკეა (isLoggedIn === false branch ზემოთ) —
              ასე მენეჯერს/ადმინს ნებისმიერ მოწყობილობაზე შეუძლია შესვლა და
              კოდის დადასტურება Users Control პანელიდან, დაწყვილების გარეშეც. */}
          {currentPage === 'sales' && userRole === 'cashier' && (
            <RegisterGuard>
              <Sales />
            </RegisterGuard>
          )}
          {currentPage === 'users_control' && isAdminOrManager && <UsersManagement currentUserRole={userRole} />}
        </Suspense>
      </div>
    </div>
  );
}

export default App;
