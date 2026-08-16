-- ==========================================
-- Migration 003: Audit Logs
-- ==========================================
-- აუდიტის ლოგების ცხრილი — ვინ, ვის და როდის შეუცვალა უფლება
-- (can_view_history toggle და სხვა). აქამდე ეს ცხრილი მხოლოდ
-- index.ts-ის initDB()-ის მიერ იქმნებოდა ავტომატურად ყოველ
-- სერვერის სტარტზე — ახლა ოფიციალურ მიგრაციაშია გატანილი.
--
-- IF NOT EXISTS-ის წყალობით უსაფრთხოა გაშვება მაშინაც, თუ
-- ცხრილი უკვე არსებობს (ძველი initDB()-ის მიერ შექმნილი).
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  target_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  new_value TEXT,
  created_at TEXT DEFAULT TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
);

COMMIT;
