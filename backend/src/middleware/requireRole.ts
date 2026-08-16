import { Response, NextFunction } from 'express';
import { CustomRequest } from '../routes/auth';

// ==========================================
// 🛡️ ზოგადი როლის-გუარდი middleware — Roadmap ეტაპი 6
// ==========================================
// აქამდე ყველა route ad-hoc, დუბლირებული ხაზით ამოწმებდა როლს პირდაპირ
// (მაგ. `if (req.user?.role !== 'admin') return res.status(403)...` sales.ts-ში,
// auth.ts-ში). ერთ როლზე მეტის დაშვება საჭირო გახდა Executive Dashboard-ისთვის
// (admin ᲓᲐ manager), ამიტომ ეს გამოტანილია ცალკე, გამოსაყენებელ middleware-ად —
// ახალი route-ების დამატებისას აღარ სჭირდება ლოგიკის გამეორება.
//
// გამოყენება: router.get('/path', authenticateToken, requireAnyRole('admin', 'manager'), handler)
// ⚠️ ყოველთვის authenticateToken-ის ᲨᲔᲛᲓᲔᲒ უნდა დაერთოს — თავად ეს middleware
// მხოლოდ req.user-ს ეყრდნობა და მას არ ავსებს.
export function requireAnyRole(...allowedRoles: string[]) {
  return (req: CustomRequest, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'ამ რესურსზე წვდომა არ გაქვთ!' });
    }
    next();
  };
}
