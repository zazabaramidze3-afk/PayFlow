// backend/src/utils/sendInternalError.ts
//
// 🌍 Backend Error-Message i18n — 500-იანი შეცდომების ერთიანი დამუშავება
// (Roadmap "10.09.2026", "⏳ ცალკე ფენა" — გენერიკული 500-ები).
//
// აქამდე ყოველი route-ის catch-ბლოკი მომხმარებელს უშუალოდ `err.message`-ს
// უბრუნებდა (ხშირად PostgreSQL-ის ტექნიკურ ტექსტს, მაგ. constraint-ის ან
// ცხრილის სახელით) — რაც (1) თარგმნას არ ექვემდებარება და (2) ბაზის
// სტრუქტურის შესახებ ზედმეტ ინფორმაციას ამჟღავნებს.
//
// ახლა: დეტალი მხოლოდ სერვერის ლოგში (+ Sentry-ში) ინახება, კლიენტს კი
// ზოგადი, `INTERNAL_ERROR` კოდიანი პასუხი მიდის, რომელსაც ფრონტენდი
// ორ ენაზე თარგმნის (`errors.INTERNAL_ERROR`).

import { Response } from 'express';
import * as Sentry from '@sentry/node';
import { ErrorCodes } from '../constants/errorCodes';

export function sendInternalError(res: Response, err: unknown, context: string): Response {
  console.error(`❌ ${context} ჩავარდა:`, err);
  Sentry.captureException(err, { tags: { route: context } });
  // თუ პასუხი უკვე იგზავნება (მაგ. Excel/PDF stream-ის შუაში), სტატუსის შეცვლა
  // აღარ შეიძლება — ვტოვებთ როგორც არის.
  if (res.headersSent) return res;
  return res.status(500).json({
    error: 'სერვერის შეცდომა — სცადეთ ხელახლა',
    code: ErrorCodes.INTERNAL_ERROR,
  });
}
