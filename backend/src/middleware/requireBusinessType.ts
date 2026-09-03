import { Response, NextFunction } from 'express';
import { CustomRequest } from '../routes/auth';
import { withOrgContext } from '../db';
import { BusinessType } from '../types';

// ==========================================
// 🍽️ HoReCa Module STEP 1 — business_type გუარდი (Roadmap "03.09.2026")
// ==========================================
// requireRole.ts-ის (`requireAnyRole`) ანალოგიური, ცალკე გამოსაყენებელი
// middleware — `routes/tables.ts`/`routes/orders.ts`-ის ყველა ენდპოინტი
// ამის უკან დგას, რომ Retail org-ს (business_type === 'retail') საერთოდ
// არ ჰქონდეს წვდომა HoReCa-ს resource-ებზე.
//
// ⚠️ განზრახ **ფრეშ DB-ჩანაწერიდან** ვამოწმებთ (JWT-ში business_type არ
// გვინახავს) — ისევე, როგორც `sales.ts`-ის `can_use_discount` შემოწმება
// ("ვამოწმებთ ბაზიდან სვეჟ მნიშვნელობას (არა JWT-ს), რომ ადმინის მიერ
// უფლების მომენტალურად გამორთვა დაუყოვნებლივ ეფექტური იყოს"). ეს ასევე
// გვაზოგებს `auth.ts`-ის login/JWT-payload-ის ცვლილებას (რამდენიმე
// jwt.sign-გამოძახება) — STEP 1-ის scope-ს არ სცდება.
export function requireBusinessType(...allowed: BusinessType[]) {
  return async (req: CustomRequest, res: Response, next: NextFunction) => {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: 'ავტორიზაცია აუცილებელია' });
    }

    try {
      const businessType = await withOrgContext(organizationId, async (client) => {
        const result = await client.query<{ business_type: BusinessType }>(
          'SELECT business_type FROM organizations WHERE id = $1',
          [organizationId]
        );
        return result.rows[0]?.business_type ?? null;
      });

      if (!businessType || !allowed.includes(businessType)) {
        return res.status(403).json({ error: 'ეს ფუნქცია თქვენი ორგანიზაციის ტიპისთვის ხელმისაწვდომი არ არის' });
      }

      next();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'უცნობი შეცდომა';
      res.status(500).json({ error: message });
    }
  };
}
