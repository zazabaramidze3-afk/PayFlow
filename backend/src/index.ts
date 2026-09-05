// ⚠️ Sentry-ის ინიციალიზაცია — უნდა დარჩეს ყველაზე პირველ import-ად,
// სანამ express/cors/pg და დანარჩენი module-ები ჩაიტვირთება (იხ. instrument.ts).
import './instrument';
import * as Sentry from '@sentry/node';

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// ⚠️ FIX: აქ ადრე იქმნებოდა მეორე, დამოუკიდებელი Pool იმავე ბაზასთან
// (SSL ლოგიკაც განსხვავებული ჰქონდა db.ts-ისგან). ეს ორი ცალ-ცალკე
// connection pool იყო მიზეზი, რის გამოც ზოგიერთი route (რომელიც db.ts-ს
// იყენებდა, მაგ. checkShift.ts) სხვანაირად იქცეოდა, ვიდრე დანარჩენები.
// ახლა ერთი, საერთო pool გვაქვს — ყველა ფაილი მას იზიარებს.
import pool from './db';

// მარშრუტების (Routes) შემოტანა
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import salesRoutes from './routes/sales';
import auditLogsRoutes from './routes/audit-logs';
import dashboardRoutes from './routes/dashboard';
// 🖥️ Device Pairing & Activation (Roadmap STEP 2.2) — Multi-POS Register-ების მართვა
import registersRoutes from './routes/registers';
// 🔔 Stock Deficit Notifications (Roadmap STEP 5) — Background Sync Engine-ის
// Manager Dashboard ბეჯი/პანელი.
import notificationsRoutes from './routes/notifications';
// 🏢 Multi-Tenant SaaS STEP 3 (Roadmap "23.08.2026") — კომპანიის
// self-service რეგისტრაცია (POST /organizations/register).
import organizationsRoutes from './routes/organizations';
// 🛡️ Multi-Tenant SaaS STEP 8 (Roadmap "24.08.2026") — Superadmin Panel
// (ორგანიზაციების platform-wide მართვა, ცალკე auth-მექანიზმით).
import platformAdminRoutes from './routes/platformAdmin';
// 🍽️ HoReCa Module STEP 1 (Roadmap "03.09.2026", migration 019) — Tables +
// Orders. ორივე route-ფაილი `requireBusinessType('horeca')`-ს უკან დგას,
// ამიტომ Retail org-ებზე ეს მონტაჟი ეფექტს არ ახდენს.
import tablesRoutes from './routes/tables';
import ordersRoutes from './routes/orders';
import kitchenRoutes from './routes/kitchen';
// 🧩 HoReCa Module STEP 3.1 (Roadmap "03.09.2026", migration 021) —
// მოდიფაიერები. იგივე `requireBusinessType('horeca')` გუარდი.
import modifiersRoutes from './routes/modifiers';

dotenv.config();

const app = express();

// ==========================================
//  🔒 CORS Allowlist (Roadmap STEP 0 / ცვლილება #7)
// ==========================================
// ⚠️ FIX: ადრე app.use(cors()) ყოველ origin-ს უშვებდა — ნებისმიერ საიტს
// შეეძლო API-სთან პირდაპირი მიმართვა. ახლა მხოლოდ ცნობილი origin-ები.
//
// შენიშვნა: frontend თავად production-დან '/api/...' (რელატიური path)
// მისამართებს იყენებს — ეს ინჰერენტულად same-origin request-ია,
// CORS მასზე საერთოდ არ მოქმედებს. ეს allowlist იცავს backend-ს
// მესამე მხარის საიტებიდან პირდაპირი (cross-origin) request-ებისგან
// და უჭერს მხარს ლოკალურ დეველოპმენტს (Vite dev server production
// API-სთან) და preview-დან production-ზე ხელით ტესტვას.
const ALLOWED_ORIGINS = [
  'https://pay-flow-coral.vercel.app',
  'https://pay-flow-zet3.vercel.app',
  // ⚠️ frontend/vite.config.ts-ში server.port === 3000 (არა Vite-ის
  // default 5173) — ეს ზუსტად ის port-ია, საიდანაც dev-ში frontend
  // მუშაობს. 5173 დამატებულია მხოლოდ fallback-ად, თუ port-კონფიგი
  // მომავალში შეიცვლება.
  'http://localhost:3000',
  'http://localhost:5173',
];

// ⚠️ Vercel ყოველ deployment-ს (production თუ preview) ავტომატურად
// აძლევს საკუთარ უნიკალურ domain-ს VERCEL_URL-ში (მაგ. preview-ისთვის
// "payflow-git-<branch>-<hash>-<team>.vercel.app" — წინასწარ არაპროგნო-
// ზირებადი). ამის გარეშე frontend-ის საკუთარი "/api/..." request-იც კი
// (თუნდაც სრულად same-origin) ჩვენივე origin-check-ს "ჩავარდებოდა",
// რადგან preview-ის URL არასდროს იქნებოდა ჩვენს hardcoded სიაში.
if (process.env.VERCEL_URL) {
  ALLOWED_ORIGINS.push(`https://${process.env.VERCEL_URL}`);
}

// ⚠️ Vercel-ს ასევე აქვს "branch alias" domain (*-git-<branch>-*.vercel.app),
// რომელიც ერთი და იმავე branch-ის ყველა redeploy-ს შორის სტაბილურად
// უცვლელი რჩება (განსხვავებით VERCEL_URL-ისგან, რომელიც ყოველ redeploy-ზე
// იცვლება). ამის გარეშე branch-alias URL-ზე login CORS-ს ჩავარდებოდა.
if (process.env.VERCEL_BRANCH_URL) {
  ALLOWED_ORIGINS.push(`https://${process.env.VERCEL_BRANCH_URL}`);
}

app.use(
  cors({
    origin(origin, callback) {
      // curl/Postman/server-to-server მოთხოვნებს Origin header არ აქვს —
      // დაშვებულია (ბრაუზერის CORS-ს ეს შემთხვევები არც ეხება).
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origin "${origin}" დაშვებული არ არის`));
    },
  })
);
app.use(express.json());

// სხვა ფაილებისთვის თავსებადობის შესანარჩუნებლად (ექსპორტი db სახელით)
export const db = pool;

// ==========================================
//  ბაზის სტრუქტურა (Schema)
// ==========================================
// ⚠️ Production-Ready Migration (Roadmap ეტაპი 1.5.1): აპლიკაცია
// ჩართვისას აღარაფერს წერს/ქმნის ბაზაში — არც ცხრილებს (ძველი
// initDB()) და აღარც დეფოლტ იუზერებს (ძველი seedDefaultUsers()).
// ბაზაში უკვე ნამდვილი, ხელით შექმნილი მომხმარებლები ზის
// (pgAdmin-ით დადასტურებულია), ამიტომ ავტო-სიდირების ლოგიკას
// აღარანაირი დანიშნულება არ აქვს და მთლიანად წაშლილია — რომ
// სერვერის ყოველი გადატვირთვა შემთხვევით არაფერს არ გადააწეროს.
//
// ბაზის სტრუქტურის ერთადერთი წყარო არის backend/migrations/*.sql.
// ახალი environment-ის (local/staging/prod) გასამართად, სერვერის
// გაშვებამდე გაუშვით:  npm run migrate   (იხ. src/migrate.ts),
// ან ხელით, ფაილების ნომრების მიხედვით (001, 002, 003, 004...)
// pgAdmin-ში. მომხმარებლების შექმნა ხდება მხოლოდ UI-დან
// (POST /api/users) ან პირდაპირ ბაზაში — აპლიკაციის კოდი აღარ
// ეხება users ცხრილის მონაცემებს გაშვებისას.

// ==========================================
//  🔗 მარშრუტების ინტეგრაცია (Middleware)
// ==========================================
app.use('/api', authRoutes);
app.use('/api', productRoutes);
app.use('/api', salesRoutes);
app.use('/api', auditLogsRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', registersRoutes);
app.use('/api', notificationsRoutes);
app.use('/api', organizationsRoutes);
app.use('/api', platformAdminRoutes);
app.use('/api', tablesRoutes);
app.use('/api', ordersRoutes);
app.use('/api', kitchenRoutes);
app.use('/api', modifiersRoutes);

// ==========================================
//  🛰️ Sentry Error Handler (Roadmap STEP 0 / ცვლილება #7)
// ==========================================
// უნდა დარჩეს ყველა route/controller-ის შემდეგ და ნებისმიერი
// custom error-handling middleware-ის წინ (ჯერჯერობით ასეთი არ გვაქვს).
Sentry.setupExpressErrorHandler(app);

// ==========================================
// 💓 GET /api/health — Roadmap STEP 5 (useNetworkStatus hook)
// ==========================================
// ავტორიზაციის/ბაზის გარეშე, განზრახ "მსუბუქი" endpoint — frontend-ის
// useNetworkStatus hook-ს (frontend/src/hooks/useNetworkStatus.ts) 10
// წამიან heartbeat-ად სჭირდება ნამდვილი backend-თან კავშირის დადგენა
// (navigator.onLine მხოლოდ ბრაუზერის/ოპერაციული სისტემის ლოკალურ ქსელ-
// ინტერფეისის მდგომარეობას ასახავს — captive portal-ის/wifi-ს "ჩხირკედელი"
// კავშირის დროსაც true-ს აჩვენებს). ავტორიზაცია აქ განზრახ არ მოწმდება —
// heartbeat-ის ერთადერთი დანიშნულებაა "სერვერი პასუხობს თუ არა",
// მოძველებული/ჯერ არ განახლებული ტოკენითაც კი.
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 ბექენდ სერვერი წარმატებით ჩაირთო პორტზე ${PORT}`));
export default app;
