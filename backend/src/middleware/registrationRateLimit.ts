import { Request } from 'express';

// ==========================================
// Company Self-Registration — Rate Limiting (Spam/Abuse დაცვა)
// ==========================================
// POST /api/organizations/register ავტორიზაციის გარეშეა ხელმისაწვდომი
// (თავად ორგანიზაცია/ადმინი ჯერ არ არსებობს, ვინ დაარეგისტრირებდა) —
// ანუ ინტერნეტიდან ნებისმიერს შეუძლია მასზე მიმართვა. `managerPinRateLimit.ts`-ის
// იგივე მარტივი in-memory Map პატერნი (ცალკე npm დამოკიდებულების გარეშე,
// single-instance backend-ის საკმარისი), მაგრამ განსხვავებული სემანტიკით:
//
//   - `managerPinRateLimit` მხოლოდ **წარუმატებელ** მცდელობებს ითვლის
//     (brute-force PIN-ის წინააღმდეგ) — წარმატებაზე ითვლადი ნულდება.
//   - ეს ითვლის **ყველა** მცდელობას (წარმატებულსაც) — ერთი IP-დან ბევრი
//     ორგანიზაციის ზედიზედ შექმნა (spam/abuse) თავისთავად საეჭვოა,
//     წარმატებული ყოფნა მას "უწყინარს" არ ხდის.
//
// გასაღები მხოლოდ IP-ია (არა "IP:userId", როგორც PIN-ის შემთხვევაში) —
// ავტორიზაციამდე user-id საერთოდ არ არსებობს.

interface AttemptRecord {
  count: number;
  windowStartedAt: number;
}

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 60 * 1000; // 1 საათი

const attempts = new Map<string, AttemptRecord>();

export function getRegistrationRateLimitKey(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function checkRegistrationRateLimit(key: string): { limited: boolean; retryAfterSeconds: number } {
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

export function registerRegistrationAttempt(key: string): void {
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || now - record.windowStartedAt > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStartedAt: now });
    return;
  }

  record.count += 1;
}
