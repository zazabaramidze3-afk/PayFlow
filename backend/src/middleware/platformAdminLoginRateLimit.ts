import { Request } from 'express';

// ==========================================
// Platform Admin Login — Rate Limiting (Brute-Force დაცვა) — STEP 8
// ==========================================
// `managerPinRateLimit.ts`-ის იგივე in-memory Map პატერნი (single-instance
// backend-ისთვის საკმარისი, ცალკე npm დამოკიდებულების გარეშე) — ითვლის
// მხოლოდ **წარუმატებელ** მცდელობებს (წარმატებაზე ითვლადი ნულდება, იხ.
// `clearPlatformAdminAttempts`). გასაღები "IP:email" წყვილია (არა მხოლოდ
// IP) — ერთი NAT-ის უკან მყოფმა ერთმა superadmin-მა (მაგ. არასწორი
// პაროლის ხელახლა-ხელახლა ცდით) მეორე, სხვა ანგარიშის მქონე კოლეგა არ
// დაბლოკოს. ეს ენდპოინტი პლატფორმის ყველაზე ძლიერი ანგარიშის (ყველა
// კომპანიაზე წვდომა) login-ია — brute-force-ის საწინააღმდეგო დაცვა
// განსაკუთრებით მნიშვნელოვანია.

interface AttemptRecord {
  failedCount: number;
  firstFailedAt: number;
}

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 წუთი

const failedAttempts = new Map<string, AttemptRecord>();

export function getPlatformAdminRateLimitKey(req: Request, email: string): string {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return `${ip}:${email.toLowerCase()}`;
}

export function checkPlatformAdminRateLimit(key: string): { limited: boolean; retryAfterSeconds: number } {
  const record = failedAttempts.get(key);
  if (!record) return { limited: false, retryAfterSeconds: 0 };

  const elapsed = Date.now() - record.firstFailedAt;
  if (elapsed > WINDOW_MS) {
    failedAttempts.delete(key);
    return { limited: false, retryAfterSeconds: 0 };
  }

  if (record.failedCount >= MAX_ATTEMPTS) {
    return { limited: true, retryAfterSeconds: Math.ceil((WINDOW_MS - elapsed) / 1000) };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

export function registerPlatformAdminFailedAttempt(key: string): void {
  const now = Date.now();
  const record = failedAttempts.get(key);

  if (!record || now - record.firstFailedAt > WINDOW_MS) {
    failedAttempts.set(key, { failedCount: 1, firstFailedAt: now });
    return;
  }

  record.failedCount += 1;
}

export function clearPlatformAdminAttempts(key: string): void {
  failedAttempts.delete(key);
}
