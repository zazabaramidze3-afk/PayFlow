// backend/src/constants/errorCodes.ts
//
// 🌍 Backend Error-Message i18n STEP 1 (Roadmap "10.09.2026", pilot) —
// სტაბილური, ენისგან დამოუკიდებელი კოდები backend-ის შეცდომის
// პასუხებისთვის. დამატებითია (additive) — არსებული ქართული `error`
// ველი უცვლელი რჩება ყველა response-ში (backward compatibility ჯერ
// არარეფაქტორებული endpoint-ებისთვის); `code` მხოლოდ ემატება.
// Frontend-ის `resolveErrorMessage()` (frontend/src/lib/errorMessages.ts)
// `code`-ს `errors.<code>` i18n key-ზე გადაასქემატებს.
//
// კონვენცია: `<ENTITY>_<REASON>`, ყველა UPPER_SNAKE_CASE. ახალი route-ის
// მიგრაციისას ახალი კოდი აქ ემატება და პარალელურად `errors.*`
// namespace-ს `ka.json`/`en.json`-ში (frontend/src/i18n/locales/).
export const ErrorCodes = {
  PRODUCT_DUPLICATE_NAME: 'PRODUCT_DUPLICATE_NAME',
  PRODUCT_DUPLICATE_BARCODE: 'PRODUCT_DUPLICATE_BARCODE',
  INGREDIENT_DUPLICATE_NAME: 'INGREDIENT_DUPLICATE_NAME',
  INGREDIENT_IN_USE: 'INGREDIENT_IN_USE',
  // STEP 2 — modifiers.ts
  MODIFIER_GROUP_INVALID_INPUT: 'MODIFIER_GROUP_INVALID_INPUT',
  MODIFIER_GROUP_NOT_FOUND: 'MODIFIER_GROUP_NOT_FOUND',
  MODIFIER_GROUP_IN_USE: 'MODIFIER_GROUP_IN_USE',
  MODIFIER_GROUP_IDS_INVALID: 'MODIFIER_GROUP_IDS_INVALID',
  MODIFIER_OPTION_NAME_REQUIRED: 'MODIFIER_OPTION_NAME_REQUIRED',
  MODIFIER_OPTION_NEGATIVE_PRICE: 'MODIFIER_OPTION_NEGATIVE_PRICE',
  MODIFIER_OPTION_NOT_FOUND: 'MODIFIER_OPTION_NOT_FOUND',
  MODIFIER_OPTION_IN_USE: 'MODIFIER_OPTION_IN_USE',
  PRODUCT_INVALID_ID: 'PRODUCT_INVALID_ID',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
