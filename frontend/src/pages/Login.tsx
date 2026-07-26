import { useState } from 'react';

interface LoginProps {
  onLoginAttempt: (username: string, password: string, callback: (err: string) => void) => void;
}

export default function Login({ onLoginAttempt }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return setError('გთხოვთ შეავსოთ ყველა ველი!');

    // ვუგზავნით მონაცემებს App.tsx-ს შესამოწმებლად
    onLoginAttempt(username, password, (errorMessage) => {
      if (errorMessage) {
        setError(errorMessage); // თუ არის შეცდომა (მაგ. დაბლოკილია), გამოვაჩენთ ერორს
      }
    });
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f1f5f9', fontFamily: 'sans-serif' }}>
      <div style={{ background: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px' }}>
        <h2 style={{ textTransform: 'uppercase', letterSpacing: '1px', textAlign: 'center', color: '#1e293b', marginBottom: '10px' }}>ProjectPay</h2>
        <p style={{ textAlign: 'center', color: '#64748b', fontSize: '14px', marginBottom: '30px' }}>სისტემაში შესვლა</p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '14px', color: '#475569', fontWeight: 'bold' }}>მომხმარებელი</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin, manager ან cashier" style={inputStyle} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '14px', color: '#475569', fontWeight: 'bold' }}>პაროლი</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="ჩაწერეთ 1234" style={inputStyle} />
          </div>

          {error && <p style={{ color: '#ef4444', fontSize: '14px', margin: 0, fontWeight: 'bold' }}>⚠️ {error}</p>}

          <button type="submit" style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '12px', borderRadius: '6px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', marginTop: '10px' }}>შესვლა</button>
        </form>
      </div>
    </div>
  );
}

const inputStyle = { padding: '12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '14px', boxSizing: 'border-box' as const };
