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

dotenv.config();

const app = express();
app.use(cors());
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
