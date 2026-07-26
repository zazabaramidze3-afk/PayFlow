import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products'; 
import Sales from './pages/Sales'; 
import Login from './pages/Login'; 
import UsersManagement from './pages/UsersManagement';
import axios from 'axios';

// =======================================================
// 🛡️ AXIOS INTERCEPTOR — ავტომატური ტოკენის მიბმა
// =======================================================
// ეს კოდი ყოველი მოთხოვნის გაგზავნის წინ ამოწმებს localStorage-ს
// და თუ ტოკენი არსებობს, ავტომატურად ამატებს მას Authorization ჰედერში [12].
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

// თუ ბექენდმა ტოკენი უარყო (ვადა გაუვიდა, დაბლოკილია და ა.შ.), ვასუფთავებთ
// localStorage-ს, რომ UI არ დარჩეს "დალოგინებული", მაგრამ მოთხოვნები ჩავარდეს.
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const message: string = error.response?.data?.error || '';
    // 401 = ტოკენი საერთოდ არ გაიგზავნა/არ არსებობს.
    // 403 + "ტოკენი..." = კონკრეტულად invalid/expired token (authenticateToken middleware-დან).
    // ჩვეულებრივი როლის დაბლოკვის 403-ები (მაგ. "მხოლოდ ადმინისთვის!") არ უნდა
    // იწვევდეს გამოსვლას — ტოკენი მაშინ სავსებით ვალიდურია, უბლოკავს მხოლოდ როლი.
    if (status === 401 || (status === 403 && message.includes('ტოკენი'))) {
      localStorage.removeItem('token');
      window.dispatchEvent(new Event('auth:session-expired'));
    }
    return Promise.reject(error);
  }
);

interface UserPermission {
  id: number;
  username: string;
  role: 'admin' | 'manager' | 'cashier';
  status: 'აქტიური' | 'დაბლოკილი';
}

// =======================================================
// 🔄 SESSION RESTORE — ტოკენის ამოკითხვა და გახსნის ვადის შემოწმება
// =======================================================
// JWT-ის payload-ის (id, username, role) წამოღება localStorage-ში დარჩენილი
// ტოკენიდან, გვერდის refresh-ის შემდეგ ავტორიზაციის ხელახლა აღსადგენად.
// (ეს მხოლოდ UI-ის მდგომარეობის აღდგენისთვისაა — რეალურ დაცვას მაინც
// ბექენდის authenticateToken middleware უზრუნველყოფს ყოველ request-ზე.)
function getUserFromStoredToken(): UserPermission | null {
  const token = localStorage.getItem('token');
  if (!token) return null;

  try {
    const payloadBase64 = token.split('.')[1];
    const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));

    // ვადაგასული ტოკენი — ვასუფთავებთ და ვთვლით, რომ სესია აღარ არსებობს
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
    // ტოკენი დაზიანებულია/არასწორი ფორმატისაა
    localStorage.removeItem('token');
    return null;
  }
}

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState<UserPermission | null>(() => getUserFromStoredToken());
  const isLoggedIn = !!currentUser;

  useEffect(() => {
    const handleSessionExpired = () => setCurrentUser(null);
    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth:session-expired', handleSessionExpired);
  }, []);

  // ავტორიზაცია ბეკენდის SQL ბაზის მეშვეობით
  const handleLoginAttempt = async (username: string, password: string, callback: (err: string) => void) => {
    try {
      const response = await axios.post('http://localhost:5000/api/login', { username, password });
      
      // ბექენდიდან ახლა აბრუნებს ობიექტს { token, user }
      const { token, user } = response.data;

      // ვინახავთ ტოკენს ბრაუზერში, რათა ინტერცეპტორმა გამოიყენოს
      localStorage.setItem('token', token);

      setCurrentUser(user);
      setCurrentPage(user.role === 'cashier' ? 'sales' : 'dashboard');
      callback('');
    } catch (error: any) {
      if (error.response && error.response.data.error) {
        callback(error.response.data.error);
      } else {
        callback('სერვერთან კავშირი ვერ დამყარდა!');
      }
    }
  };

  // სისტემიდან გამოსვლის ფუნქცია
  const handleLogout = () => {
    localStorage.removeItem('token'); // ვშლით ტოკენს მეხსიერებიდან
    setCurrentUser(null);
  };

  if (!isLoggedIn) {
    return <Login onLoginAttempt={handleLoginAttempt} />;
  }

  const userRole = currentUser?.role;
  const isAdminOrManager = userRole === 'admin' || userRole === 'manager';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      {/* Sidebar მენიუ */}
      <div style={{ width: '250px', backgroundColor: '#1e293b', color: '#fff', padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '5px', color: '#38bdf8' }}>ProjectPay</h2>
          <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '30px', textTransform: 'uppercase' }}>
            მომხმარებელი: {currentUser?.username} ({userRole})
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {isAdminOrManager && (
              <>
                <li onClick={() => setCurrentPage('dashboard')} style={{ padding: '12px 15px', cursor: 'pointer', borderRadius: '6px', backgroundColor: currentPage === 'dashboard' ? '#334155' : 'transparent', marginBottom: '8px' }}>📊 Dashboard</li>
                <li onClick={() => setCurrentPage('products')} style={{ padding: '12px 15px', cursor: 'pointer', borderRadius: '6px', backgroundColor: currentPage === 'products' ? '#334155' : 'transparent', marginBottom: '8px' }}>📦 Products</li>
              </>
            )}
            {userRole === 'cashier' && (
              <li onClick={() => setCurrentPage('sales')} style={{ padding: '12px 15px', cursor: 'pointer', borderRadius: '6px', backgroundColor: currentPage === 'sales' ? '#334155' : 'transparent' }}>🛒 Sales (POS)</li>
            )}
            {userRole === 'admin' && (
              <li onClick={() => setCurrentPage('users_control')} style={{ padding: '12px 15px', cursor: 'pointer', borderRadius: '6px', backgroundColor: currentPage === 'users_control' ? '#334155' : 'transparent', marginTop: '15px', borderTop: '1px solid #475569', color: '#fbbf24' }}>👥 Users Control</li>
            )}
          </ul>
        </div>
        <button onClick={handleLogout} style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', width: '100%' }}>🚪 სისტემიდან გამოსვლა</button>
      </div>

      {/* ძირითადი კონტენტი */}
      <div style={{ flex: 1, backgroundColor: '#f8fafc', padding: '20px' }}>
        {currentPage === 'dashboard' && isAdminOrManager && <Dashboard />}
        {currentPage === 'products' && isAdminOrManager && <Products />}
        {currentPage === 'sales' && userRole === 'cashier' && <Sales />}
        {currentPage === 'users_control' && userRole === 'admin' && <UsersManagement />}
      </div>
    </div>
  );
}

export default App;
