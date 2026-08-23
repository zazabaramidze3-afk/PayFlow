import { Router, Response } from 'express';
// შემოგვაქვს მზა PostgreSQL პული ძირითადი ფაილიდან
import { db } from '../index';
import { authenticateToken, CustomRequest } from './auth';

const router = Router();

// 📤 აუდიტის ლოგების ექსპორტი CSV ფორმატში — მხოლოდ ADMIN-ისთვის.
// უსაფრთხოების ღონისძიებაა: სრული გასუფთავებამდე (DELETE /api/audit-logs)
// ადმინს შეუძლია აქედან წინასწარ ჩამოტვირთოს არქივი. ცალკე router-ია
// (auth.ts-ის GET/DELETE /audit-logs-ისგან განსხვავებით), roadmap-ის
// მოთხოვნისამებრ.
router.get('/audit-logs/export', authenticateToken, async (req: CustomRequest, res: Response) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'მხოლოდ ადმინისტრატორს აქვს ისტორიის ექსპორტის უფლება!' });
  }

  try {
    // 🏢 Multi-Tenant SaaS STEP 2 (Roadmap "23.08.2026") — `WHERE
    // al.organization_id = $1` დაემატა, იგივე მიზეზით, რაც auth.ts-ის
    // GET/DELETE /audit-logs-ს.
    const result = await db.query(
      `SELECT
         al.id,
         al.action,
         al.new_value,
         al.created_at,
         actor.name AS actor_name,
         target.name AS target_name
       FROM audit_logs al
       LEFT JOIN users actor ON actor.id = al.actor_id
       LEFT JOIN users target ON target.id = al.target_id
       WHERE al.organization_id = $1
       ORDER BY al.created_at DESC`,
      [req.user?.organizationId]
    );

    // CSV-ს სტანდარტული escaping — მძიმე, ბრჭყალი ან newline რომ
    // შემთხვევით არ დაშალოს სვეტების სტრუქტურა.
    const escape = (value: string): string =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

    // 🔑 Manager PIN Override-ის action ტიპებს (manager-pin-override,
    // manager-pin-override-used, manager-pin-update) ძველი ბინარული
    // ternary ("history-access" თუ არადა ავტომატურად "ფასდაკლების
    // უფლება") არასწორად ჰღებავდა — UsersManagement.tsx-ის
    // renderAuditLogLine-ის იგივე მიდგომა, აქაც explicit switch.
    // 🧾 void-access/clear-cart-access (Roadmap ეტაპი 4/5 checkbox toggle-ები)
    // და void-receipt-override/clear-cart-override/remove-item-override
    // (Manager PIN Override-ის ფაქტობრივი გამოყენება) დაემატა — იგივე ნაკრები,
    // რასაც UsersManagement.tsx-ის renderAuditLogLine აჩვენებს ეკრანზე.
    const actionLabel = (action: string): string => {
      switch (action) {
        case 'history-access': return 'ისტორიის ნახვის უფლება';
        case 'discount-access': return 'ფასდაკლების უფლება';
        case 'void-access': return 'ჩეკის გაუქმების უფლება';
        case 'clear-cart-access': return 'კალათის გასუფთავების უფლება';
        case 'manager-pin-override': return 'მენეჯერის PIN Override (დადასტურება)';
        case 'manager-pin-override-used': return 'მენეჯერის PIN Override (გამოყენება — ფასდაკლება)';
        case 'void-receipt-override': return 'მენეჯერის PIN Override (ჩეკის გაუქმება)';
        case 'clear-cart-override': return 'მენეჯერის PIN Override (კალათის გასუფთავება)';
        case 'remove-item-override': return 'მენეჯერის PIN Override (პროდუქტის წაშლა)';
        case 'manager-pin-update': return 'მენეჯერის PIN-კოდის ცვლილება';
        default: return action;
      }
    };

    const detailsLabel = (action: string, newValue: string | null): string => {
      switch (action) {
        case 'history-access':
        case 'discount-access':
        case 'void-access':
        case 'clear-cart-access':
          return newValue === 'true' ? 'ჩართო' : 'გამორთო';
        case 'manager-pin-override':
          return 'დადასტურდა';
        case 'manager-pin-override-used':
        case 'void-receipt-override':
          return newValue?.startsWith('payment:') ? `გადახდა #${newValue.slice('payment:'.length)}` : (newValue ?? '—');
        case 'clear-cart-override':
          return 'კალათა გასუფთავდა';
        case 'remove-item-override':
          return newValue && newValue !== 'confirmed' ? `პროდუქტი: ${newValue}` : 'დადასტურდა';
        case 'manager-pin-update':
          return 'განახლდა';
        default:
          return newValue ?? '—';
      }
    };

    const header = ['ID', 'მომხმარებელი', 'მოქმედება', 'თარიღი', 'დეტალები'].join(',');

    const rows = result.rows.map((log) => {
      // "მომხმარებელი" სვეტში ერთდროულად ვინახავთ ვინც შეცვალა და
      // ვისზეც შეიცვალა — ცალკე Actor/Target სვეტები roadmap-ში
      // მოთხოვნილი არ იყო.
      const userCell = `${log.actor_name ?? 'უცნობი'} → ${log.target_name ?? 'უცნობი'}`;
      return [
        log.id,
        escape(userCell),
        escape(actionLabel(log.action)),
        escape(log.created_at ?? ''),
        escape(detailsLabel(log.action, log.new_value)),
      ].join(',');
    });

    // UTF-8 BOM — რომ Excel-მა ქართული ტექსტი გახსნისას სწორად აჩვენოს
    // (მის გარეშე ხშირად "იტამაშება" ლათინურ ასოებში გადაყვანილ ნაგავად).
    const BOM = '﻿';
    const csvContent = BOM + [header, ...rows].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=audit-logs-export.csv');
    res.send(csvContent);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
