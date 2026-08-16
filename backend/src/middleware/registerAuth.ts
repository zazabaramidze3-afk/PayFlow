import { Response, NextFunction, Request } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import pool from '../db';

// ==========================================
// 🖥️ Register (ფიზიკური სალარო) ავტორიზაცია — Roadmap STEP 2
// ==========================================
// RegisterGuard.tsx (frontend) წარმატებული Pairing-ის შემდეგ ინახავს
// localStorage-ში `payflow_register_id`-ს და `payflow_register_token`-ს
// და მათ ავტომატურად ურთავს ყოველ API მოთხოვნას, როგორც HTTP header-ებს:
//   X-Register-Id:    <registers.id (UUID)>
//   X-Register-Token: <ეს JWT>
//
// ეს middleware ამოწმებს ორივეს ერთად (headers-ის registerId ცალსახად
// უნდა ემთხვეოდეს JWT-ში ხელმოწერილს — "მოპარული" token სხვა
// register-ის ID-ით ვერ ჩაივლის), და ცოცხალ registers.is_active
// მნიშვნელობასაც ბაზიდან (არა JWT-ს "დამახსოვრებული" მდგომარეობით) —
// რომ ადმინის მიერ Register-ის დეაქტივაცია მომენტალურად ამოქმედდეს,
// მანამდე გაცემული ტოკენების ხელახლა გაცემის გარეშეც.
//
// გამოიყენება STEP 2.1-ის მოთხოვნით — "მხოლოდ ერთი აქტიური Shift Per
// Register" წესს სჭირდება იცოდეს, რომელ ფიზიკურ Register-ზეა მოთხოვნა
// გაკეთებული (იხ. routes/sales.ts POST /shifts/open).

export interface RegisterAwareRequest extends Request {
  registerId?: string;
}

const REGISTER_TOKEN_TYPE = 'register-auth';

// ⏳ Pairing ერთხელ დამტკიცებული ფიზიკური მოწყობილობისთვის განზრახ
// გრძელვადიანია (არა 5-წუთიანი Manager Override-ის მსგავსად) — თერმინალი
// ხელახლა არ უნდა ითხოვდეს დაწყვილებას ყოველ გადატვირთვაზე. ფაქტობრივი
// "გამორთვა" registers.is_active = false-ით ხდება, არა ტოკენის ვადის
// ამოწურვით.
const REGISTER_TOKEN_TTL = '3650d';

const getSecret = (): string => process.env.JWT_SECRET || 'super-secret-key';

export interface RegisterTokenPayload {
  type: typeof REGISTER_TOKEN_TYPE;
  registerId: string;
}

export function signRegisterToken(registerId: string): string {
  return jwt.sign(
    { type: REGISTER_TOKEN_TYPE, registerId } satisfies RegisterTokenPayload,
    getSecret(),
    { expiresIn: REGISTER_TOKEN_TTL }
  );
}

function verifyRegisterToken(token: string): RegisterTokenPayload | null {
  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(token, getSecret());
  } catch {
    return null;
  }

  if (typeof decoded !== 'object' || decoded === null) return null;

  const { type, registerId } = decoded;
  if (type !== REGISTER_TOKEN_TYPE || typeof registerId !== 'string' || registerId.length === 0) {
    return null;
  }

  return { type, registerId };
}

// 🛡️ მკაცრი გუარდი — headers არასავალდებულოა/არავალიდურია → 401.
// გამოსაყენებელია STEP 2.1-ის Shift/Payment route-ებზე, სადაც register_id
// ცალსახად აუცილებელია (ახალი shift-ის გახსნა, ჩეკის გატარება).
export async function requireRegister(req: RegisterAwareRequest, res: Response, next: NextFunction) {
  const registerIdHeader = req.headers['x-register-id'];
  const registerTokenHeader = req.headers['x-register-token'];

  const registerId = typeof registerIdHeader === 'string' ? registerIdHeader : undefined;
  const registerToken = typeof registerTokenHeader === 'string' ? registerTokenHeader : undefined;

  if (!registerId || !registerToken) {
    return res.status(401).json({ error: 'სალაროს იდენტიფიკაცია ვერ მოიძებნა — საჭიროა მოწყობილობის დაწყვილება (Device Pairing)!' });
  }

  const payload = verifyRegisterToken(registerToken);
  if (!payload || payload.registerId !== registerId) {
    return res.status(403).json({ error: 'სალაროს ტოკენი არავალიდურია!' });
  }

  try {
    const result = await pool.query<{ id: string; is_active: boolean }>(
      'SELECT id, is_active FROM registers WHERE id = $1',
      [registerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ეს სალარო აღარ არსებობს ბაზაში!' });
    }

    if (result.rows[0].is_active !== true) {
      return res.status(403).json({ error: 'ეს სალარო დეაქტივირებულია — მიმართეთ ადმინისტრატორს!' });
    }

    req.registerId = registerId;
    next();
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
