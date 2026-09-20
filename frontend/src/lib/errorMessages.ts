// frontend/src/lib/errorMessages.ts
//
// 🌍 Backend Error-Message i18n STEP 1 (Roadmap "10.09.2026", pilot) —
// ერთიანი, გაზიარებული helper backend-ის error-პასუხების i18n-თვის.
// ანაცვლებს თითოეულ გვერდზე დუბლირებულ ლოკალურ `getErrorMessage`-ს
// (Ingredients.tsx/Modifiers.tsx/OrderScreen.tsx/Settings.tsx-ში
// დამოუკიდებლად გამეორებული, ხან მხოლოდ `{error}`-ის, ხან
// `{error} ?? {message}`-ის წაკითხვით — იხ. OrderScreen.tsx-ის
// 04.09.2026 კომენტარი checkShift.ts-ის `{message}`-shape-ის შესახებ).
//
// მუშაობის პრინციპი (roadmap-ში დამტკიცებული "Error codes" არქიტექტურა):
//  1. Backend-ის error-პასუხს თუ აქვს ცნობილი `code` და შესაბამის
//     `errors.<code>` key-ს რეალურად აქვს თარგმანი i18n resource-ში —
//     ვაბრუნებთ ამ თარგმნილ, კონკრეტულ ტექსტს.
//  2. სხვა ნებისმიერ შემთხვევაში (route ჯერ არ არის მიგრირებული `code`-ზე,
//     ან `code` მოვიდა, მაგრამ შესაბამისი key ჯერ არ გვაქვს დამატებული) —
//     ვაბრუნებთ ზარისმხრივ (per-action) fallback key-ის თარგმანს.
//
// განზრახ **არასდროს** ვაბრუნებთ backend-ის დაუთარგმნელ raw ტექსტს
// პირდაპირ — სწორედ ეს იყო roadmap-ში დაფიქსირებული
// "specific-but-untranslated" ბაგი (Ingredients.tsx/Settings.tsx/
// KitchenDisplay.tsx). ახალი route-ების `code`-ზე მიგრაციასთან ერთად
// კონკრეტული შეტყობინებებიც თანდათან ბრუნდება, უკვე თარგმნილი.
//
// Module-level (არა-hook) კოდია — i18n singleton-ს (`i18n.t()`) იყენებს,
// ROADMAP-ის იმავე კონვენციით (`import i18n from '../i18n'`).

import axios from 'axios';
import i18n from '../i18n';

interface BackendErrorPayload {
  error?: string;
  message?: string;
  code?: string;
}

/**
 * Backend axios error-ს თარგმნილ, მომხმარებლისთვის საჩვენებელ ტექსტად
 * გარდაქმნის. `fallbackKey` — i18n key ამ კონკრეტული ქმედების (save/
 * delete/restock და ა.შ.) ზოგადი "ჩავარდა"-შეტყობინებისთვის, რომელიც
 * გამოიყენება, თუ `code` არ მოსულა ან უცნობია.
 */
export function resolveErrorMessage(error: unknown, fallbackKey: string): string {
  if (axios.isAxiosError<BackendErrorPayload>(error)) {
    const code = error.response?.data?.code;
    if (code) {
      const translationKey = `errors.${code}`;
      if (i18n.exists(translationKey)) {
        return i18n.t(translationKey);
      }
    }
  }
  return i18n.t(fallbackKey);
}
