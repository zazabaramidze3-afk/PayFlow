import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
// შემოგვაქვს მზა PostgreSQL პული ძირითადი ფაილიდან
import { db } from '../index'; 

const router = Router();

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
    req.user = user as { id: number; role: string; username: string };
    next();
  });
};

// 🔓 LOGIN ენდპოინტი (ავტორიზაცია)
router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  try {
    // PostgreSQL-ში ვიყენებთ db.query-ს და $1 პარამეტრს
    const result = await db.query(
      `SELECT id, name AS username, password_hash, role, status FROM users WHERE LOWER(name) = LOWER($1) LIMIT 1`, 
      [username?.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა!' });
    }

    const user = result.rows[0];

    if (user.status === 'inactive' || user.status === 'დაბლოკილი') {
      return res.status(403).json({ error: 'მომხმარებელი აქტიური არ არის!' });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordCorrect) {
      return res.status(401).json({ error: 'არასწორი პაროლი!' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role }, 
      process.env.JWT_SECRET || 'super-secret-key', 
      { expiresIn: '1d' }
    );

    res.json({ 
      token, 
      user: { id: user.id, username: user.username, role: user.role, status: user.status } 
    });

  } catch (err: any) {
    res.status(500).json({ error: 'სერვერის შეცდომა: ' + err.message });
  }
});

// ➕ ახალი მომხმარებლის რეგისტრაცია
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
    // 3. პაროლის ჰეშირება
    const hashedPassword = await bcrypt.hash(password, 10);

    // 4. ბაზაში ჩაწერა (PostgreSQL სინტაქსით და RETURNING id-ით)
    const query = `
      INSERT INTO users (name, password_hash, role, status) 
      VALUES ($1, $2, $3, 'active') 
      RETURNING id
    `;
    
    const result = await db.query(query, [username.trim(), hashedPassword, role]);
    const newUserId = result.rows[0].id;

    res.status(201).json({
      success: true,
      message: 'მომხმარებელი წარმატებით დაემატა!',
      user: {
        id: newUserId,
        username, 
        role,
        status: 'active'
      }
    });

  } catch (err: any) {
    if (err.message && err.message.includes('unique')) {
      return res.status(400).json({ error: 'ეს მომხმარებლის სახელი უკვე დაკავებულია!' });
    }
    res.status(500).json({ error: 'ბაზის შეცდომა: ' + err.message });
  }
});

// იუზერების წაკითხვა
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT id, name AS username, role, status FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// როლის/სტატუსის შეცვლა
router.put('/users/:id', authenticateToken, async (req: CustomRequest, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'მხოლოდ ადმინისთვის!' });
  const { role, status } = req.body;
  
  try {
    await db.query('UPDATE users SET role = $1, status = $2 WHERE id = $3', [role, status, req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// პაროლის შეცვლა
router.put('/users/:id/password', authenticateToken, async (req: CustomRequest, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'მხოლოდ ადმინისთვის!' });
  const { newPassword } = req.body;
  if (!newPassword || newPassword.trim().length < 4) return res.status(400).json({ error: 'მინიმუმ 4 სიმბოლო!' });

  try {
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedNewPassword, req.params.id]);
    res.json({ success: true, message: 'პაროლი შეიცვალა!' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// წაშლა (Soft Delete)
router.delete('/users/:id', authenticateToken, async (req: CustomRequest, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'მხოლოდ ადმინისთვის!' });
  if (Number(req.params.id) === req.user?.id) return res.status(400).json({ error: 'საკუთარ თავს ვერ წაშლით!' });

  try {
    await db.query("UPDATE users SET status = 'inactive' WHERE id = $1", [req.params.id]);
    res.json({ success: true, message: 'მომხმარებელი გახდა პასიური!' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
