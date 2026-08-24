import { Request } from 'express';

// ==========================================
// GET /organizations/resolve/:slug — Rate Limiting
// ==========================================
// registrationRateLimit.ts-ის იგივე in-memory Map პატერნი, ცალკე
// მოდულად, რომ ორმა endpoint-მა (register/resolve) ცალკე ბიუჯეტი
// გამოიყენოს — წინააღმდეგ შემთხვევაში slug-ის enumeration-ის
// მცდელობებმა შეიძლება ლეგიტიმური registration-ის rate-limit-იც
// ამოწუროს (ორივე ერთსა და იმავე Map-ს რომ იზიარებდეს).
//
// ეს endpoint საჯაროა (login-ის 1-ლი საფეხური — slug-ის დადასტურება),
// მაგრამ enumeration-ის (რომელი კომპანიის slug-ები არსებობს) რისკის
// შესამცირებლად mild rate-limit მაინც გვჭირდება. Registration-ზე
// ნაკლებად მკაცრი (20/სთ, არა 5/სთ) — ეს მხოლოდ read-only lookup-ია.

interface AttemptRecord {
  count: number;
  windowStartedAt: number;
}

const MAX_ATTEMPTS = 20;
const WINDOW_MS = 60 * 60 * 1000; // 1 საათი

const attempts = new Map<string, AttemptRecord>();

export function getOrgResolveRateLimitKey(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function checkOrgResolveRateLimit(key: string): { limited: boolean; retryAfterSeconds: number } {
  const record = attempts.get(key);
  if (!record) return { limited: false, retryAfterSeconds: 0 };

  const elapsed = Date.now() - record.windowStartedAt;
  if (elapsed > WINDOW_MS) {
    attempts.delete(key);
    return { limited: false, retryAfterSeconds: 0 };
  }

  if (record.count >= MAX_ATTEMPTS) {
    return { limited: true, retryAfterSeconds: Math.ceil((WINDOW_MS - elapsed) / 1000) };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

export function registerOrgResolveAttempt(key: string): void {
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || now - record.windowStartedAt > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStartedAt: now });
    return;
  }

  record.count += 1;
}
