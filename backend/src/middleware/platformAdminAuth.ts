import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';

// ==========================================
// 🛡️ Platform Admin (Superadmin) ავტორიზაცია — Multi-Tenant SaaS STEP 8
// ==========================================
// ცალსახად ცალკე auth-მექანიზმი, `auth.ts`-ის `authenticateToken`-ისგან
// (ჩვეულებრივი org-ის მომხმარებლების auth) სრულად დამოუკიდებელი — ცალკე
// JWT payload-ფორმა, ცალკე verify-ფუნქცია, ცალკე Express Request-ინტერფეისი
// (`platformAdmin`, არა `user`). ეს STEP 8-ის გადაწყვეტილების წერტილის
// პირდაპირი შედეგია: platform_admins ცალკე ცხრილშია, organization_id არ
// გააჩნია (იხ. migration 015-ის თავსართი) — ჩვეულებრივი, tenant-scoped
// route-ების auth-ის გაზიარებამ შემთხვევით cross-tenant წვდომის რისკი
// შეიძლება შეექმნა (მაგ. `req.user.role === 'admin'`-ის ერთი გამოტოვებული
// შემოწმება ერთ org-ს კი არა, ყველა org-ს გაუღებდა კარს). ცალკე `type`
// claim-ი (`platform-admin-auth`) დამატებით იცავს იმისგან, რომ ჩვეულებრივი
// org-ის admin-ის ტოკენმა ეს route-ები ვერ გაიაროს, თუნდაც იმავე
// JWT_SECRET-ით იყოს ხელმოწერილი — `authenticateToken`-ს ეს `type` ველი
// საერთოდ არ აქვს/არ ამოწმებს, ამიტომ ორივე მიმართულებით ურთიერთშეღწევადობა
// გამორიცხულია.

const PLATFORM_ADMIN_TOKEN_TYPE = 'platform-admin-auth';

export interface PlatformAdminRequest extends Request {
  platformAdmin?: { id: string; name: string; email: string };
}

export interface PlatformAdminTokenPayload {
  type: typeof PLATFORM_ADMIN_TOKEN_TYPE;
  id: string;
  name: string;
  email: string;
}

const getSecret = (): string => process.env.JWT_SECRET || 'super-secret-key';

// ⏳ 12 საათი — ჩვეულებრივი org-ის session-ის 1 დღეზე (auth.ts) მოკლე,
// განზრახ: superadmin ტოკენს პლატფორმის ყველა კომპანიაზე წვდომა აქვს,
// ამიტომ მოპარვის/გაჟონვის შემთხვევაში საზიანო ფანჯარა უფრო ვიწროა.
const PLATFORM_ADMIN_TOKEN_TTL = '12h';

export function signPlatformAdminToken(admin: { id: string; name: string; email: string }): string {
  return jwt.sign(
    {
      type: PLATFORM_ADMIN_TOKEN_TYPE,
      id: admin.id,
      name: admin.name,
      email: admin.email,
    } satisfies PlatformAdminTokenPayload,
    getSecret(),
    { expiresIn: PLATFORM_ADMIN_TOKEN_TTL }
  );
}

export function authenticatePlatformAdmin(req: PlatformAdminRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'წვდომა უარყოფილია, ტოკენი არ არსებობს!' });
  }

  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(token, getSecret());
  } catch {
    return res.status(403).json({ error: 'ტოკენი არავალიდურია!' });
  }

  if (typeof decoded !== 'object' || decoded === null || (decoded as JwtPayload).type !== PLATFORM_ADMIN_TOKEN_TYPE) {
    return res.status(403).json({ error: 'ტოკენი არავალიდურია!' });
  }

  const payload = decoded as unknown as PlatformAdminTokenPayload;
  req.platformAdmin = { id: payload.id, name: payload.name, email: payload.email };
  next();
}
