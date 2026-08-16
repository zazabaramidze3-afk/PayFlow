import { Request, Response, NextFunction } from 'express';
import pool from '../db';

export interface CustomRequest extends Request {
    // 🆔 UUID მიგრაცია (Roadmap STEP 1, migration 009) — user.id/activeShiftId
    // ახლა UUID string-ია, აღარ არის SERIAL INTEGER.
    user?: { id: string; role: string; username: string };
    activeShiftId?: string;
    // 🖥️ Roadmap STEP 2 — registerAuth middleware-ის მიერ დასეტილი,
    // "მხოლოდ ერთი აქტიური Shift Per Register" წესისთვის (sales.ts).
    registerId?: string;
}

// დავამატეთ async, რადგან Postgres-თან მუშაობისთვის ვიყენებთ აზინქრონულ await სინტაქსს
export async function checkActiveShift(req: CustomRequest, res: Response, next: NextFunction) {
    const cashierId = req.user?.id; 

    if (!cashierId) {
        return res.status(401).json({ message: "ავტორიზაცია აუცილებელია" });
    }

    try {
        // SQLite-ის db.get-ის ნაცვლად ვიყენებთ pool.query-ს
        // Postgres-ში პარამეტრებისთვის გამოიყენება $1, $2 და ა.შ. (და არა კითხვის ნიშნები)
        const result = await pool.query(
            `SELECT id FROM shifts WHERE cashier_id = $1 AND status = 'open'`,
            [cashierId]
        );

        // Postgres-ში შედეგები ყოველთვის ინახება result.rows მასივში
        if (result.rows.length === 0) {
            return res.status(400).json({ message: "გაყიდვის შესასრულებლად აუცილებელია ცვლის გახსნა!" });
        }

        // მასივის პირველი ელემენტიდან ვიღებთ id-ს
        req.activeShiftId = result.rows[0].id;
        next();
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
}
