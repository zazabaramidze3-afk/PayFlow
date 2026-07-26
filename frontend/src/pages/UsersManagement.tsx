import { useState, useEffect } from 'react';
import axios from 'axios';

interface UserPermission {
  id: number;
  username: string;
  role: 'admin' | 'manager' | 'cashier';
  status: 'აქტიური' | 'დაბლოკილი';
}

export default function UsersManagement() {
  const [users, setUsers] = useState<UserPermission[]>([]);

  // ახალი მომხმარებლის დამატების სტეიტები (State)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'manager' | 'cashier'>('cashier');

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/users');
      setUsers(response.data);
    } catch (error) {
      console.error('მომხმარებლების ჩატვირთვა ჩავარდა', error);
    }
  };
  // ➕ ახალი მომხმარებლის შექმნა და გაგზავნა ბაზაში
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword.trim().length < 4) {
      alert('პაროლი უნდა შედგებოდეს მინიმუმ 4 სიმბოლოსგან!');
      return;
    }

    try {
      await axios.post('http://localhost:5000/api/users', {
        username: newUsername,
        password: newPassword,
        role: newRole
      });

      setNewUsername('');
      setNewPassword('');
      setNewRole('cashier');
      setIsModalOpen(false);

      loadUsers();
      alert('მომხმარებელი წარმატებით დაემატა!');
    } catch (error: any) {
      alert(error.response?.data?.error || 'მომხმარებლის დამატება ჩაიშალა');
    }
  };

  const handleRoleChange = async (id: number, currentStatus: string, newRole: 'admin' | 'manager' | 'cashier') => {
    try {
      await axios.put(`http://localhost:5000/api/users/${id}`, { role: newRole, status: currentStatus });
      setUsers(users.map(user => user.id === id ? { ...user, role: newRole } : user));
      alert(`უფლებები წარმატებით განახლდა SQL ბაზაში!`);
    } catch (error) {
      alert('ბაზაში შენახვა ჩავარდა');
    }
  };

  const toggleStatus = async (user: UserPermission) => {
    const nextStatus = user.status === 'აქტიური' ? 'დაბლოკილი' : 'აქტიური';
    try {
      await axios.put(`http://localhost:5000/api/users/${user.id}`, { role: user.role, status: nextStatus });
      setUsers(users.map(u => u.id === user.id ? { ...u, status: nextStatus } : u));
    } catch (error) {
      alert('სტატუსის შეცვლა ჩავარდა');
    }
  };

  // 🔑 პაროლის შეცვლის ფუნქცია
  const handlePasswordChange = async (id: number, username: string) => {
    const newPassword = prompt(`შეიყვანეთ ახალი პაროლი მომხმარებლისთვის [ ${username} ]:`);
    
    if (newPassword === null) return;
    if (newPassword.trim().length < 4) {
      alert('პაროლი უნდა შედგებოდეს მინიმუმ 4 სიმბოლოსგან!');
      return;
    }

    try {
      const response = await axios.put(`http://localhost:5000/api/users/${id}/password`, { newPassword });
      alert(response.data.message || 'პაროლი წარმატებით შეიცვალა!');
    } catch (error: any) {
      alert(error.response?.data?.error || 'პაროლის შეცვლა ჩავარდა');
    }
  };

  // 🗑️ მომხმარებლის წაშლის ფუნქცია
  const handleDeleteUser = async (id: number, username: string) => {
    const confirmDelete = window.confirm(`დარწმუნებული ხართ, რომ გსურთ მომხმარებლის [ ${username} ] სამუდამოდ წაშლა?`);
    
    if (!confirmDelete) return;

    try {
      const response = await axios.delete(`http://localhost:5000/api/users/${id}`);
      setUsers(users.filter(user => user.id !== id));
      alert(response.data.message || 'მომხმარებელი წაიშალა!');
    } catch (error: any) {
      alert(error.response?.data?.error || 'წაშლა ვერ მოხერხდა');
    }
  };
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', position: 'relative' }}>
      
      {/* ჰედერი და დამატების ახალი ღილაკი */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h2 style={{ color: '#1e293b', margin: 0 }}>👥 მომხმარებლების უფლებების კონტროლი (SQLite ბაზა)</h2>
        <button 
          onClick={() => setIsModalOpen(true)}
          style={{
            background: '#3b82f6', color: '#fff', border: 'none',
            padding: '10px 18px', borderRadius: '6px', cursor: 'pointer',
            fontWeight: 'bold', fontSize: '14px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }}
        >
          ➕ ახალი მომხმარებელი
        </button>
      </div>
      
      <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '30px' }}>
        ცვლილებები ინახება მყარად სერვერზე და არ იშლება ქეშის გასუფთავებისას.
      </p>

      {/* მომხმარებლების ცხრილი */}
      <div style={{ background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ backgroundColor: '#f1f5f9', color: '#475569' }}>
              <th style={{ padding: '16px 20px' }}>მომხმარებელი</th>
              <th style={{ padding: '16px 20px' }}>მიმდინარე როლი</th>
              <th style={{ padding: '16px 20px' }}>უფლებების შეცვლა</th>
              <th style={{ padding: '16px 20px' }}>სტატუსი</th>
              <th style={{ padding: '16px 20px', textAlign: 'center' }}>მოქმედებები</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: '16px 20px', fontWeight: 'bold', color: '#0f172a' }}>{user.username}</td>
                <td style={{ padding: '16px 20px' }}>
                  <span style={{
                    background: user.role === 'admin' ? '#fee2e2' : user.role === 'manager' ? '#fef9c3' : '#dcfce7',
                    color: user.role === 'admin' ? '#991b1b' : user.role === 'manager' ? '#854d0e' : '#166534',
                    padding: '4px 8px', borderRadius: '4px', fontSize: '13px', fontWeight: 'bold'
                  }}>
                    {user.role.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <select 
                    value={user.role} 
                    disabled={user.username === 'admin'}
                    onChange={(e) => handleRoleChange(user.id, user.status, e.target.value as any)}
                    style={{ padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none' }}
                  >
                    <option value="admin">ADMIN (სრული წვდომა)</option>
                    <option value="manager">MANAGER</option>
                    <option value="cashier">CASHIER</option>
                  </select>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <button 
                    disabled={user.username === 'admin'}
                    onClick={() => toggleStatus(user)}
                    style={{
                      background: user.status === 'აქტიური' ? '#10b981' : '#ef4444',
                      color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: user.username === 'admin' ? 'not-allowed' : 'pointer', fontWeight: 'bold'
                    }}
                  >
                    {user.status}
                  </button>
                </td>
                <td style={{ padding: '16px 20px', textAlign: 'center' }}>
                  <button
                    onClick={() => handlePasswordChange(user.id, user.username)}
                    style={{
                      background: '#3b82f6', color: '#fff', border: 'none', padding: '6px 10px',
                      borderRadius: '4px', cursor: 'pointer', marginRight: '8px', fontWeight: 'bold', fontSize: '12px'
                    }}
                    title="პაროლის შეცვლა"
                  >
                    🔑 პაროლი
                  </button>
                  <button
                    disabled={user.username === 'admin'}
                    onClick={() => handleDeleteUser(user.id, user.username)}
                    style={{
                      background: user.username === 'admin' ? '#94a3b8' : '#dc2626', 
                      color: '#fff', border: 'none', padding: '6px 10px',
                      borderRadius: '4px', cursor: user.username === 'admin' ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '12px'
                    }}
                    title="მომხმარებლის წაშლა"
                  >
                    🗑️ წაშლა
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ახალი მომხმარებლის მოდალური ფანჯარა */}
      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center',
          alignItems: 'center', zIndex: 1000
        }}>
          <div style={{ background: '#fff', padding: '30px', borderRadius: '8px', width: '380px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 20px 0', color: '#1e293b', fontSize: '18px' }}>➕ ახალი მომხმარებლის რეგისტრაცია</h3>
            
            <form onSubmit={handleCreateUser}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 'bold', color: '#475569' }}>მომხმარებლის სახელი</label>
                <input 
                  type="text" 
                  value={newUsername} 
                  onChange={e => setNewUsername(e.target.value)}
                  placeholder="მაგ. nika_cashier"
                  required 
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 'bold', color: '#475569' }}>საწყისი პაროლი</label>
                <input 
                  type="password" 
                  value={newPassword} 
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="მინიმუმ 4 სიმბოლო"
                  required 
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 'bold', color: '#475569' }}>როლი (Role)</label>
                <select 
                  value={newRole} 
                  onChange={e => setNewRole(e.target.value as any)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none', background: '#fff' }}
                >
                  <option value="cashier">CASHIER (მოლარე)</option>
                  <option value="manager">MANAGER (მენეჯერი)</option>
                  <option value="admin">ADMIN (ადმინისტრატორი)</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  style={{ background: '#94a3b8', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  გაუქმება
                </button>
                <button 
                  type="submit" 
                  style={{ background: '#10b981', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  დამატება
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
