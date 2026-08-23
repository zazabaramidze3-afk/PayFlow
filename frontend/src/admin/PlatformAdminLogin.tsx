import { useState } from 'react';
import axios from 'axios';
import platformAdminApi, { PLATFORM_ADMIN_TOKEN_KEY } from '../lib/platformAdminApi';
import styles from './PlatformAdminLogin.module.scss';

interface PlatformAdminLoginProps {
  onLoginSuccess: () => void;
}

export default function PlatformAdminLogin({ onLoginSuccess }: PlatformAdminLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('გთხოვთ შეავსოთ ყველა ველი!');
      return;
    }

    setLoading(true);
    try {
      const response = await platformAdminApi.post('/api/platform-admin/login', {
        email: email.trim(),
        password,
      });
      localStorage.setItem(PLATFORM_ADMIN_TOKEN_KEY, response.data.token);
      onLoginSuccess();
    } catch (err: unknown) {
      const message =
        axios.isAxiosError(err) && err.response?.data?.error
          ? (err.response.data.error as string)
          : 'შესვლა ჩავარდა — სცადეთ თავიდან';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <h2 className={styles.title}>🛡️ PayFlow</h2>
        <p className={styles.subtitle}>Superadmin პანელი</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@payflow.com"
              className={styles.input}
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>პაროლი</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={styles.input}
            />
          </div>

          {error && <p className={styles.error}>⚠️ {error}</p>}

          <button type="submit" disabled={loading} className={styles.submitBtn}>
            {loading ? 'შედით...' : 'შესვლა'}
          </button>
        </form>
      </div>
    </div>
  );
}
