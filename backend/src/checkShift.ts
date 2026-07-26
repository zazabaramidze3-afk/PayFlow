import { Request, Response, NextFunction } from 'express';
import sqlite3 from 'sqlite3';
import path from 'path';

// ⚡ ადრე გამოიყენებოდა './database.sqlite' — ეს ფარდობითი გზა process.cwd()-ის
// მიმართ აღიწერება (საიდანაც გაუშვებ node/ts-node-ს), და არა ამ ფაილის საკუთარი
// მდებარეობის მიმართ. index.ts, auth.ts და sales.ts ყველა path.resolve(__dirname, ...)-ს
// იყენებს, რომ ყოველთვის ერთი და იგივე database.sqlite ფაილი გაიხსნას, მიუხედავად
// საიდან იქნება გაშვებული სერვერი. checkShift.ts (backend/src/checkShift.ts) index.ts-ის
// გვერდით დგას, ამიტომ იგივე '../database.sqlite' გამოსახულებას ვიყენებთ.
const db = new sqlite3.Database(path.resolve(__dirname, '../database.sqlite'));

export interface CustomRequest extends Request {
    user?: { id: number; role: string; username: string };
    activeShiftId?: number;
}

export function checkActiveShift(req: CustomRequest, res: Response, next: NextFunction) {
    const cashierId = req.user?.id; 

    if (!cashierId) {
        return res.status(401).json({ message: "ავტორიზაცია აუცილებელია" });
    }

    db.get(
        `SELECT id FROM shifts WHERE cashier_id = ? AND status = 'open'`,
        [cashierId],
        (err, row: { id: number } | undefined) => {
            if (err) return res.status(500).json({ error: err.message });
            
            if (!row) {
                return res.status(400).json({ message: "გაყიდვის შესასრულებლად აუცილებელია ცვლის გახსნა!" });
            }

            req.activeShiftId = row.id;
            next();
        }
    );
}
