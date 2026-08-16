import jwt, { JwtPayload } from 'jsonwebtoken';
import { randomUUID } from 'crypto';

// ==========================================
// Manager PIN Override — მოკლევადიანი JWT ტოკენი
// ==========================================
// POST /api/auth/verify-manager-pin წარმატებაზე გასცემს ამ ტოკენს (5 წუთის
// ვადით), ფრონტენდი ინახავს მხოლოდ React state-ში (არა localStorage-ში —
// ერთჯერადი, მიმდინარე ტრანზაქციისთვისაა) და POST /api/payments-ზე
// X-Manager-Override: Bearer <token> ჰედერით ატარებს. ბექენდი (sales.ts)
// ამოწმებს, რომ:
//   1) ხელმოწერა/ვადა ვალიდურია (JWT_SECRET, 5 წთ),
//   2) type === 'manager-override' (ჩვეულებრივი login ტოკენი ვერ ჩაანაცვლებს),
//   3) cashierId ემთხვევა request-ის ავტორიზებულ userId-ს (სხვა სესიაზე
//      "მოპარული" header ვერ გამოიყენება),
//   4) ტოკენი ჯერ არ არის მოხმარებული (single-use — "ერთჯერადი" მოთხოვნის
//      გარანტია, არა მხოლოდ frontend state-ზე დაყრდნობით).

// 🆔 UUID მიგრაცია (Roadmap STEP 1, migration 009) — managerId/cashierId
// ახლა UUID string-ია (users.id-ის ტიპის შესაბამისად), აღარ არის
// SERIAL INTEGER.
export interface ManagerOverridePayload {
  type: 'manager-override';
  managerId: string;
  managerUsername: string;
  role: 'manager';
  cashierId: string;
  jti: string;
}

const OVERRIDE_TTL_SECONDS = 5 * 60; // 5 წუთი

const getSecret = (): string => process.env.JWT_SECRET || 'super-secret-key';

export function signManagerOverrideToken(payload: {
  managerId: string;
  managerUsername: string;
  cashierId: string;
}): { token: string; expiresInSeconds: number } {
  const jti = randomUUID();
  const token = jwt.sign(
    {
      type: 'manager-override',
      managerId: payload.managerId,
      managerUsername: payload.managerUsername,
      role: 'manager',
      cashierId: payload.cashierId,
    },
    getSecret(),
    { expiresIn: OVERRIDE_TTL_SECONDS, jwtid: jti }
  );
  return { token, expiresInSeconds: OVERRIDE_TTL_SECONDS };
}

// "Bearer <token>" → "<token>". null თუ ჰედერი არ არსებობს/არასწორი ფორმატისაა.
export function extractBearerToken(headerValue: string | string[] | undefined): string | null {
  if (typeof headerValue !== 'string') return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// 🔁 Single-use enforcement — jti-ების Set-ი, ვისაც უკვე გამოიყენეს
// (payments.ts წარმატებული checkout-ის შემდეგ იძახებს consumeOverrideToken-ს).
// 5 წუთის (+ მარაგი) შემდეგ ავტომატურად იშლება, რომ Set უსასრულოდ არ იზრდებოდეს.
const consumedTokenIds = new Set<string>();

export function isOverrideTokenConsumed(jti: string): boolean {
  return consumedTokenIds.has(jti);
}

export function consumeOverrideToken(jti: string): void {
  consumedTokenIds.add(jti);
  setTimeout(() => consumedTokenIds.delete(jti), (OVERRIDE_TTL_SECONDS + 30) * 1000).unref();
}

// ვალიდაცია + სტრუქტურული შემოწმება — "any"-ის ნაცვლად runtime type guard-ები.
// jsonwebtoken-ის JwtPayload-ს აქვს [key: string]: any ინდექს-სიგნატურა
// (ბიბლიოთეკის საკუთარი ტიპია, ჩვენი კოდი აქ არსად წერს "any"-ს ხელით).
export function verifyManagerOverrideToken(token: string): ManagerOverridePayload | null {
  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(token, getSecret());
  } catch {
    return null; // ვადაგასული, გაყალბებული ან უსწორო ხელმოწერის ტოკენი
  }

  if (typeof decoded !== 'object' || decoded === null) return null;

  const { type, managerId, managerUsername, role, cashierId, jti } = decoded;

  if (
    type !== 'manager-override' ||
    typeof managerId !== 'string' ||
    typeof managerUsername !== 'string' ||
    role !== 'manager' ||
    typeof cashierId !== 'string' ||
    typeof jti !== 'string'
  ) {
    return null;
  }

  if (isOverrideTokenConsumed(jti)) return null;

  return { type, managerId, managerUsername, role, cashierId, jti };
}
