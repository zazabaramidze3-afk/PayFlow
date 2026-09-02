// ==========================================
// 🕐 audit_logs.created_at (TEXT, timezone-marker გარეშე) — Asia/Tbilisi
// საჩვენებელ ფორმატში კონვერტაცია
// ==========================================
// ⚠️ FIX (02.09.2026): backend/migrations/003_add_audit_logs.sql-ში
// created_at TEXT column-ია, DEFAULT TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD
// HH24:MI:SS') — ეს Postgres session-ის default timezone-შია (Render-ის
// ამ ინსტანციაზე UTC), მაგრამ zone-marker გარეშე მარტივ ტექსტად ინახება.
// GET /audit-logs (auth.ts) და /audit-logs/export (audit-logs.ts) ამ
// მნიშვნელობას უცვლელად უბრუნებდნენ frontend-ს/CSV-ს — Tbilisi-ს
// მომხმარებელს UTC დრო უჩვენებოდა Tbilisi-დ მონიშნული (production-ზე
// ~4 საათით offset). PDF export-ის იგივე კატეგორიის bug-ის (commit
// f7e15e7, "გენერირების თარიღი") pattern-ის მიხედვით — timeZone:
// 'Asia/Tbilisi' — მაგრამ აქ read-time კონვერტაციაა (არა write-time),
// რომ უკვე დაწერილი ისტორიული row-ებიც სწორად გამოჩნდეს, ცალკე
// migration/backfill-ის გარეშე.
//
// შენახვის ფორმატი (UTC storage) განზრახ უცვლელი რჩება — მხოლოდ
// საჩვენებელი/საექსპორტო ფენა კონვერტირდება, sortability/chronological
// ORDER BY-ს რომ არაფერი დააკლდეს.
export function formatTbilisiTimestamp(rawUtcText: string | null | undefined): string {
  if (!rawUtcText) return '';

  // "YYYY-MM-DD HH:MM:SS" (Postgres TO_CHAR-ის ფორმატი) → ISO 8601 UTC,
  // ცალსახა 'Z'-ით, რომ Date-მა ის UTC-დ (და არა ბრაუზერის/სერვერის
  // ლოკალურ დროდ) აღიქვას.
  const isoUtc = `${rawUtcText.trim().replace(' ', 'T')}Z`;
  const parsed = new Date(isoUtc);

  if (Number.isNaN(parsed.getTime())) {
    // უცნობი/მოულოდნელი ფორმატი — fail-safe: ორიგინალი მნიშვნელობა
    // (ცუდი დროც კი) სჯობს გატეხილ UI-ს.
    return rawUtcText;
  }

  // 'sv-SE' locale toLocaleString-ით ზუსტად "YYYY-MM-DD HH:MM:SS" აბრუნებს
  // ერთი გამოძახებით — იგივე ფორმატი, რაც audit_logs.created_at-ს აქვს
  // ახლა, უბრალოდ სწორი (Asia/Tbilisi) საათით.
  return parsed.toLocaleString('sv-SE', { timeZone: 'Asia/Tbilisi' });
}
