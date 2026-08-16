import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// ⚠️ FIX: ადრე ssl: true იყო დაფიქსირებული უპირობოდ, რაც ლოკალურ
// PostgreSQL-თან (SSL გარეშე) კავშირს ამტვრევდა. ახლა იგივე პირობითი
// ლოგიკა გვაქვს, რასაც index.ts იყენებდა — ერთი წყარო სიმართლისთვის.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('❌ მოულოდნელი შეცდომა PostgreSQL pool-ში:', err);
});

export default pool;
