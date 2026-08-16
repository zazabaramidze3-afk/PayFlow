import { Router, Response } from 'express';
// შემოგვაქვს მზა PostgreSQL პული ძირითადი ფაილიდან
import { db } from '../index';
import { authenticateToken, CustomRequest } from './auth';
import { requireAnyRole } from '../middleware/requireRole';

const router = Router();

// ==========================================
// 📊 Executive Dashboard — Roadmap ეტაპი 6
// ==========================================
// GET /api/dashboard/stats — ერთი ენდპოინტი ოთხივე ბლოკის მონაცემით (დღევანდელი
// სტატისტიკა, აქტიური ცვლები, ტოპ 5 პროდუქტი, თვის დღიური დინამიკა), რომ
// ფრონტენდმა დეშბორდის ჩატვირთვისას ერთი round-trip-ით მიიღოს ყველაფერი,
// ოთხი ცალკეული request-ის ნაცვლად.
//
// 🛡️ წვდომა: authenticateToken + requireAnyRole('admin', 'manager') — cashier-ს
// ანალიტიკაზე წვდომა არ აქვს (იხ. middleware/requireRole.ts).
//
// ⚠️ is_voided = false ყოველ შემოსავლის/ჩეკის ქვერიში — გაუქმებული ჩეკები
// არსად უნდა ერთვებოდეს "რეალურ" ციფრებს. იგივე პრინციპია, რაც Dashboard.tsx-ის
// "საერთო შემოსავალი"-სა და PUT /shifts/close-ის ადრინდელ FIX-ებშია (Roadmap
// ეტაპი 4-ის ბაგების გასწორება).
//
// ⚠️ payments.created_at TEXT სვეტია (არა timestamptz — იხ. migrations/001-ის
// კომენტარი), ფორმატით 'YYYY-MM-DD HH24:MI:SS'. ეს ფორმატი ლექსიკოგრაფიულად
// თარიღების მიხედვით სორტირებადია (ზუსტად ISO-სავით), ამიტომ >=/</TO_CHAR
// შედარებები უსაფრთხოდ მუშაობს ქვემოთ — იგივე მიდგომა, რასაც sales.ts-ის
// buildPaymentsFilterQuery იყენებს from/to ფილტრებისთვის.
//
// 📅 დიზაინის გადაწყვეტილება: "დღევანდელი" სტატისტიკის ბლოკი (revenue/
// receiptCount/averageReceipt) მკაცრად დღევანდელ დღეზეა შემოსაზღვრული (spec-ის
// მოთხოვნით). ტოპ 5 პროდუქტი და დღიური დინამიკა კი — "მიმდინარე თვე" scope-შია:
// მხოლოდ "დღეს" ტოპ-პროდუქტებისთვის ზედმეტად მწირი/მერყევი იქნებოდა, all-time კი
// არასდროს იცვლება და ნაკლებად "executive" სურათს იძლევა — თვის scope ორივეს
// შორის საუკეთესო ბალანსია.
router.get(
  '/dashboard/stats',
  authenticateToken,
  requireAnyRole('admin', 'manager'),
  async (req: CustomRequest, res: Response) => {
    try {
      // 1️⃣ დღევანდელი რეალური შემოსავალი + ჩეკების რაოდენობა + საშუალო ჩეკი
      const todayResult = await db.query(
        `SELECT
           COALESCE(SUM(total_amount), 0) AS revenue,
           COUNT(*) AS receipt_count,
           COALESCE(AVG(total_amount), 0) AS average_receipt
         FROM payments
         WHERE is_voided = false
           AND created_at >= TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
           AND created_at < TO_CHAR(CURRENT_DATE + INTERVAL '1 day', 'YYYY-MM-DD')`
      );

      // 2️⃣ აქტიური (ღია) ცვლების რაოდენობა — მთელი სისტემის მასშტაბით
      const activeShiftsResult = await db.query(
        `SELECT COUNT(*) AS active_shifts FROM shifts WHERE status = 'open'`
      );

      // 💰 Roadmap ეტაპი 8 — დღევანდელი გადახდები, დაშლილი მეთოდის მიხედვით
      // (ნაღდი/ბარათი/შერეული). იგივე "დღეს" scope-ია, რაც todayResult-ს აქვს
      // ზემოთ — ეს არის იმ ერთი "დღევანდელი შემოსავალის" ჯამის დაშლა სამ
      // ცალკეულ ბარათად, არა ცალკე Z-Report-ის ტიპის სალაროში ფაქტობრივად
      // არსებული ნაღდის გამოთვლა (ის PUT /shifts/close-შია, ცვლის scope-ით).
      const paymentBreakdownResult = await db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0) AS cash_total,
           COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total_amount ELSE 0 END), 0) AS card_total,
           COALESCE(SUM(CASE WHEN payment_method = 'split' THEN total_amount ELSE 0 END), 0) AS split_total,
           COUNT(*) FILTER (WHERE payment_method = 'cash') AS cash_count,
           COUNT(*) FILTER (WHERE payment_method = 'card') AS card_count,
           COUNT(*) FILTER (WHERE payment_method = 'split') AS split_count
         FROM payments
         WHERE is_voided = false
           AND created_at >= TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
           AND created_at < TO_CHAR(CURRENT_DATE + INTERVAL '1 day', 'YYYY-MM-DD')`
      );

      // 🚫 Roadmap ეტაპი 8 — დღევანდელი გაუქმებული ჩეკები: რაოდენობა და ჯამური
      // თანხა (total_amount, ანუ რამდენი ღირდა გაუქმებამდე — ეს არ ერთვება
      // ზემოთა todayResult/paymentBreakdown ჯამებში, რადგან იქ is_voided = false).
      const voidedResult = await db.query(
        `SELECT
           COALESCE(SUM(total_amount), 0) AS voided_total,
           COUNT(*) AS voided_count
         FROM payments
         WHERE is_voided = true
           AND created_at >= TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
           AND created_at < TO_CHAR(CURRENT_DATE + INTERVAL '1 day', 'YYYY-MM-DD')`
      );

      // 3️⃣ ტოპ 5 პროდუქტი მიმდინარე თვეში, რაოდენობის მიხედვით დალაგებული
      // (შემოსავალიც ერთვის — ფრონტენდს Bar Chart-ისთვის ორივე შეიძლება დასჭირდეს)
      const topProductsResult = await db.query(
        `SELECT
           pr.id,
           pr.name,
           SUM(pi.quantity) AS total_quantity,
           SUM(pi.quantity * pi.price) AS total_revenue
         FROM payment_items pi
         JOIN payments p ON pi.payment_id = p.id
         JOIN products pr ON pi.product_id = pr.id
         WHERE p.is_voided = false
           AND p.created_at >= TO_CHAR(date_trunc('month', CURRENT_DATE), 'YYYY-MM-DD')
           AND p.created_at < TO_CHAR(date_trunc('month', CURRENT_DATE) + INTERVAL '1 month', 'YYYY-MM-DD')
         GROUP BY pr.id, pr.name
         ORDER BY total_quantity DESC
         LIMIT 5`
      );

      // 4️⃣ მიმდინარე თვის დღიური დინამიკა — 0-შევსებული სერია თვის დასაწყისიდან
      // დღემდე (generate_series + LEFT JOIN), რომ Line Chart-ს არ ჰქონდეს
      // ხარვეზი გაყიდვის-გარეშე დღეებზე.
      const dailyTrendResult = await db.query(
        `SELECT
           TO_CHAR(d, 'YYYY-MM-DD') AS day,
           COALESCE(SUM(p.total_amount), 0) AS revenue,
           COUNT(p.id) AS receipt_count
         FROM generate_series(date_trunc('month', CURRENT_DATE), CURRENT_DATE::timestamp, interval '1 day') AS d
         LEFT JOIN payments p
           ON p.created_at >= TO_CHAR(d, 'YYYY-MM-DD')
           AND p.created_at < TO_CHAR(d + interval '1 day', 'YYYY-MM-DD')
           AND p.is_voided = false
         GROUP BY d
         ORDER BY d ASC`
      );

      res.json({
        today: {
          revenue: Number(todayResult.rows[0].revenue),
          receiptCount: Number(todayResult.rows[0].receipt_count),
          averageReceipt: Number(todayResult.rows[0].average_receipt),
        },
        activeShifts: Number(activeShiftsResult.rows[0].active_shifts),
        paymentBreakdown: {
          cash: { total: Number(paymentBreakdownResult.rows[0].cash_total), count: Number(paymentBreakdownResult.rows[0].cash_count) },
          card: { total: Number(paymentBreakdownResult.rows[0].card_total), count: Number(paymentBreakdownResult.rows[0].card_count) },
          split: { total: Number(paymentBreakdownResult.rows[0].split_total), count: Number(paymentBreakdownResult.rows[0].split_count) },
        },
        voided: {
          total: Number(voidedResult.rows[0].voided_total),
          count: Number(voidedResult.rows[0].voided_count),
        },
        topProducts: topProductsResult.rows.map((row) => ({
          id: row.id,
          name: row.name,
          totalQuantity: Number(row.total_quantity),
          totalRevenue: Number(row.total_revenue),
        })),
        dailyTrend: dailyTrendResult.rows.map((row) => ({
          day: row.day,
          revenue: Number(row.revenue),
          receiptCount: Number(row.receipt_count),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
