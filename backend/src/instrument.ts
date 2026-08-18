// backend/src/instrument.ts
//
// Sentry-ს ინიციალიზაცია — ეს ფაილი უნდა დარჩეს ყველაზე პირველ import-ად
// index.ts-ში, სანამ express/cors/pg და დანარჩენი module-ები ჩაიტვირთება.
// ასე Sentry ასწრებს ამ module-ების ავტომატურ ინსტრუმენტირებას
// (მაგ. pg query-ების breadcrumb-ებად ჩაწერას error-ის კონტექსტში).
//
// Roadmap: "ROADMAP - Multi-Tenant SaaS - 16.08.2026.md", ცვლილება #7 —
// STEP 0-ის გვერდით, STEP 1-მდე (multi-tenant migration-ის წინ).
import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';

dotenv.config();

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',

  // Tracing/Performance (APM) განზრახ გამორთულია — STEP 0-ის მიზანია
  // მხოლოდ Error Monitoring, არა სრული performance tracing.
  tracesSampleRate: 0,

  // ⚠️ PayFlow ფინანსურ მონაცემებთან მუშაობს (გადახდები, ჩეკები,
  // მომხმარებლების მონაცემები) — request body-ები და user PII
  // (IP, email) Sentry-ზე default-ად არ იგზავნება.
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },
});
