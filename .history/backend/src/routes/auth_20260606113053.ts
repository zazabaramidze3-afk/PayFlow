import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import path from 'path';

const router = Router();
const db = new sqlite3.Database(path.resolve(__dirname, '../../database.sqlite'));

export interface CustomRequest extends Request {
    user?: { id: number; role: string; username: string };
}

// 🛡️ Middleware ტოკენის შესამოწმებლად
export const authenticateToken = (req: CustomRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'წვდომა უარყოფილია, ტოკენი არ არსებობს!' });

  const secretKey = process.env.JWT_SECRET || 'super-secret-key';
  jwt.verify(token, secretKey, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: 'ტოკენი არავალიდურია!' });
    req.user = user;
    next();
  });
};

// იუზერების წაკითხვა
router.get('/users', authenticateToken, (req, res) => {
  db.all("SELECT id, name AS username, role, status FROM users", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// როლის/სტატუსის შეცვლა
router.put('/users/:id', authenticateToken, (req: CustomRequest, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'მხოლოდ ადმინისთვის!' });
  const { role, status } = req.body;
  db.run(`UPDATE users SET role = ?, status = ? WHERE id = ?`, [role, status, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// პაროლის შეცვლა
router.put('/users/:id/password', authenticateToken, async (req: CustomRequest, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'მხოლოდ ადმინისთვის!' });
  const { newPassword } = req.body;
  if (!newPassword || newPassword.trim().length < 4) return res.status(400).json({ error: 'მინიმუმ 4 სიმბოლო!' });

  const hashedNewPassword = await bcrypt.hash(newPassword, 10);
  db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hashedNewPassword, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'პაროლი შეიცვალა!' });
  });
});

// წაშლა (Soft Delete)
router.delete('/users/:id', authenticateToken, (req: CustomRequest, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'მხოლოდ ადმინისთვის!' });
  if (Number(req.params.id) === req.user?.id) return res.status(400).json({ error: 'საკუთარ თავს ვერ წაშლით!' });

  db.run(`UPDATE users SET status = 'inactive' WHERE id = ?`, [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'მომხმარებელი გახდა პასიური!' });
  });
});

// ➕ ახალი მომხმარებლის რეგისტრაცია (ჩასვით 71-ე ხაზზე)
router.post('/users', authenticateToken, async (req: CustomRequest, res) => {
  const { username, password, role } = req.body;

  // 1. მიმდინარე მომხმარებლის როლის შემოწმება (მხოლოდ ადმინს შეუძლია იუზერის შექმნა)
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'მხოლოდ ადმინისტრატორს აქვს წვდომა!' });
  }

  // 2. ვალიდაცია
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'ყველა ველი სავალდებულოა!' });
  }

  if (password.trim().length < 4) {
    return res.status(400).json({ error: 'პაროლი უნდა იყოს მინიმუმ 4 სიმბოლო!' });
  }

  try {
    // 3. პაროლის ჰეშირება თქვენი სისტემის სტანდარტით
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. ბაზაში ჩაწერა (სვეტების დასახელება: password_hash და status)
    // სტატუსად ვწერთ 'აქტიური', რადგან თქვენი ფრონტენდი ამ მნიშვნელობას ელოდება მწვანე ღილაკისთვის
   const query = `INSERT INTO users (name, password_hash, role, status) VALUES (?, ?, ?, 'აქტიური')`;
    
    db.run(query, [username.trim(), hashedPassword, role], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'ეს მომხმარებლის სახელი უკვე დაკავებულია!' });
        }
        return res.status(500).json({ error: 'ბაზის შეცდომა: ' + err.message });
      }

      res.status(201).json({
        success: true,
        message: 'მომხმარებელი წარმატებით დაემატა!',
        user: {
          id: this.lastID,
          username, // Передаем как username, чтобы фронтенд правильно обновил стейт
          role,
          status: 'აქტიური'
        }
      });
    });

  } catch (error) {
    res.status(500).json({ error: 'სერვერის შეცდომა პაროლის დამუშავებისას' });
  }
});


// ლოგინი
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT id, name AS username, password_hash, role, status FROM users WHERE LOWER(name) = LOWER(?)`, [username?.trim()], async (err, user: any) => {
    if (err || !user) return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა!' });
    if (user.status === 'inactive' || user.status === 'დაბლოკილი') return res.status(403).json({ error: 'მომხმარებელი აქტიური არ არის!' });

    const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordCorrect) return res.status(401).json({ error: 'არასწორი პაროლი!' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET || 'super-secret-key', { expiresIn: '1d' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, status: user.status } });
  });
});

export default router;
