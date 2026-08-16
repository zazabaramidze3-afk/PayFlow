import { Request } from 'express';

// ==========================================
// Manager PIN — Rate Limiting (Brute-Force დაცვა)
// ==========================================
// 4-ციფრიანი PIN-კოდი მხოლოდ 10 000 კომბინაციაა, ამიტომ
// POST /api/auth/verify-manager-pin აუცილებლად საჭიროებს მცდელობების
// შეზღუდვას. სპეციალური npm პაკეტის (express-rate-limit) დამატების
// ნაცვლად მარტივი in-memory Map-ი გვყოფნის — single-instance backend-ია
// (იხ. index.ts/db.ts), გარე dependency აქ ზედმეტია.
//
// გასაღები = "IP:userId" წყვილი (არა მხოლოდ IP), რადგან ენდპოინტი
// authenticateToken-ის მიღმაა — ასე თითოეული დალოგინებული მოლარის
// სესია ცალ-ცალკე იზღუდება და ერთი ქეშირიდან (მაგ. საერთო router-ის
// უკან) მომუშავე რამდენიმე მოლარე ერთმანეთს არ ბლოკავს.
//
// ითვლის მხოლოდ წარუმატებელ მცდელობებს — წარმატებული PIN-ის
// შეყვანისთანავე ითვლადი უნდა განულდეს (იხ. clearAttempts).

interface AttemptRecord {
  failedCount: number;
  firstFailedAt: number;
}

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 წუთი

const failedAttempts = new Map<string, AttemptRecord>();

// 🆔 UUID მიგრაცია — userId ახლა UUID string-ია (users.id-ის ტიპის შესაბამისად).
export function getRateLimitKey(req: Request, userId: string | undefined): string {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return `${ip}:${userId ?? 'anon'}`;
}

export function checkRateLimit(key: string): { limited: boolean; retryAfterSeconds: number } {
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

export function registerFailedAttempt(key: string): void {
  const now = Date.now();
  const record = failedAttempts.get(key);

  if (!record || now - record.firstFailedAt > WINDOW_MS) {
    failedAttempts.set(key, { failedCount: 1, firstFailedAt: now });
    return;
  }

  record.failedCount += 1;
}

export function clearAttempts(key: string): void {
  failedAttempts.delete(key);
}
