import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

// ⚠️ db.ts-ის იგივე კონვენცია — ეს სკრიპტი `./db`-ს განზრახ არ იყენებს
// (რომ production DATABASE_URL-ზე pool საერთოდ არ შეიქმნას), ამიტომ
// dotenv.config() აქ ცალკე, პირდაპირაა საჭირო.
dotenv.config();

// ==========================================
// Neon branch-ზე migration-ის უსაფრთხო ტესტირება (Roadmap "23.08.2026",
// item #10 "Neon branch-ის მომზადება" — 24.08.2026-ის სესიაში
// განხორციელებული ავტომატიზაცია)
// ==========================================
// გაშვება: npm run test-migration -- 016_xxx.sql [--keep]
// (backend/ ფოლდერიდან, **საკუთარი ტერმინალიდან** — არა Claude-ის
// device_bash-ის sandbox-იდან, რადგან იმ გარემოს Neon API
// (api.neon.tech/console.neon.tech)-თან ქსელური წვდომა არ აქვს
// (გადამოწმებულია 24.08.2026-ის სესიაში — ორივე მხრიდან, cloud
// sandbox-იდანაც და device_bash-იდანაც, timeout/no-network).
//
// რას აკეთებს:
//   1. ქმნის დროებით Neon branch-ს production branch-იდან — Neon-ის
//      copy-on-write branching, მყისიერი, production-ის მონაცემებს/
//      performance-ს არ ეხება.
//   2. უშვებს მითითებულ ერთ migration ფაილს ამ ახალ branch-ზე (migrate.ts-ის
//      მსგავსად, უბრალოდ ერთი კონკრეტული ფაილისთვის — branch უკვე
//      production-ის მთელ schema-ს/history-ს შეიცავს, ამიტომ ყველა
//      წინა migration ხელახლა გაშვება არც საჭიროა და არც სასურველი).
//   3. sanity-შემოწმებას უკეთებს (public schema-ს ცხრილების სია).
//   4. შლის დროებით branch-ს (თუ --keep არ გადმოეცა — მაშინ connection
//      string-ს ბეჭდავს, რომ ხელით ჩაუღრმავდეთ, მაგ. TEST_DATABASE_URL-ად
//      გამოსაყენებლად `vitest run tests/isolation`-თან ერთად).
//
// საჭირო env ცვლადები (backend/.env-ში დაამატეთ — **არასდროს git-ში,
// არასდროს chat-ში**; root .gitignore-ის მიხედვით .env უკვე დაცულია,
// 16.08.2026-ის secrets-leak incident-ის შემდეგ .history/-იც):
//   NEON_API_KEY     — console.neon.tech → Account settings → API keys
//                       (project-scoped key რეკომენდებულია, არა
//                       account-wide — key-ის შექმნისას აირჩიეთ project).
//   NEON_PROJECT_ID  — console.neon.tech → Project settings → General →
//                       "Project ID" (**არა** "payflow-db" display-სახელი,
//                       Neon-ის შიდა id, ჰგავს "misty-recipe-12345678"-ს).
//   NEON_PARENT_BRANCH — production branch-ის სახელი Neon-ში (default: "production",
//                       roadmap-ის production-ინციდენტის სექციაში ნახსენები
//                       branch-ის სახელით).
// ==========================================

const NEON_API_BASE = 'https://console.neon.tech/api/v2';

interface NeonBranch {
  id: string;
  name: string;
  default: boolean;
}

interface NeonOperation {
  id: string;
  status: string;
  action: string;
}

interface NeonDatabase {
  name: string;
  owner_name: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ გარემოს ცვლადი ${name} არ არის დაყენებული backend/.env-ში.`);
    console.error('   იხ. ამ ფაილის (test-migration-on-branch.ts) თავსართის კომენტარი საჭირო ცვლადების სიით.');
    process.exit(1);
  }
  return value;
}

async function neonFetch<T>(apiKey: string, urlPath: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${NEON_API_BASE}${urlPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Neon API შეცდომა (${res.status} ${urlPath}): ${bodyText}`);
  }
  return bodyText ? (JSON.parse(bodyText) as T) : ({} as T);
}

// Neon-ის branch-შექმნის/წაშლის ოპერაციები ასინქრონულია (running →
// finished) — ვპოლინგავთ, სანამ ყველა არ დასრულდება, თორემ endpoint-ი
// ჯერ არ იქნება connection-ისთვის მზად.
async function waitForOperations(apiKey: string, projectId: string, operations: NeonOperation[]): Promise<void> {
  for (const op of operations) {
    let status = op.status;
    let attempts = 0;
    const maxAttempts = 60; // 60 × 2წმ = 2წთ ჭერი ერთ ოპერაციაზე
    while (status !== 'finished' && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const check = await neonFetch<{ operation: NeonOperation }>(
        apiKey,
        `/projects/${projectId}/operations/${op.id}`
      );
      status = check.operation.status;
      attempts++;
      if (status === 'failed' || status === 'error') {
        throw new Error(`Neon ოპერაცია ${op.id} (${op.action}) ჩავარდა: ${status}`);
      }
    }
    if (status !== 'finished') {
      throw new Error(`Neon ოპერაცია ${op.id} (${op.action}) ვერ დასრულდა ${maxAttempts * 2}წმ-ში.`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const migrationFile = args.find((a) => !a.startsWith('--'));

  const migrationsDir = path.resolve(__dirname, '../migrations');

  if (!migrationFile) {
    console.error('გამოყენება: npm run test-migration -- <migration-ფაილის-სახელი.sql> [--keep]');
    const available = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    console.error(`ხელმისაწვდომი migration-ები: ${available.join(', ')}`);
    process.exit(1);
  }

  const migrationPath = path.join(migrationsDir, migrationFile);
  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ ფაილი ვერ მოიძებნა: ${migrationPath}`);
    process.exit(1);
  }
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  const apiKey = requireEnv('NEON_API_KEY');
  const projectId = requireEnv('NEON_PROJECT_ID');
  const parentBranchName = process.env.NEON_PARENT_BRANCH ?? 'production';

  console.log(`\n🔍 ვეძებ parent branch-ს: "${parentBranchName}"...`);
  const { branches } = await neonFetch<{ branches: NeonBranch[] }>(apiKey, `/projects/${projectId}/branches`);
  const parentBranch = branches.find((b) => b.name === parentBranchName) ?? branches.find((b) => b.default);
  if (!parentBranch) {
    console.error(
      `❌ ვერ ვიპოვე ვერც "${parentBranchName}" და ვერც default branch. ხელმისაწვდომი branch-ები: ${branches
        .map((b) => b.name)
        .join(', ')}`
    );
    process.exit(1);
  }
  console.log(`✅ Parent branch: ${parentBranch.name} (${parentBranch.id})`);

  const branchName = `migration-test-${migrationFile.replace('.sql', '')}-${Date.now()}`;
  console.log(`\n🌿 ვქმნი დროებით branch-ს: "${branchName}"...`);

  const createResult = await neonFetch<{ branch: NeonBranch; operations: NeonOperation[] }>(
    apiKey,
    `/projects/${projectId}/branches`,
    {
      method: 'POST',
      body: JSON.stringify({
        branch: { parent_id: parentBranch.id, name: branchName },
        endpoints: [{ type: 'read_write' }],
      }),
    }
  );
  const branchId = createResult.branch.id;
  console.log(`✅ Branch შეიქმნა: ${branchId}, ველოდები endpoint-ის მზადყოფნას...`);
  await waitForOperations(apiKey, projectId, createResult.operations);

  let exitCode = 0;
  let connectionUri: string | null = null;

  try {
    console.log('\n🔑 ვიღებ connection string-ს...');
    const { databases } = await neonFetch<{ databases: NeonDatabase[] }>(
      apiKey,
      `/projects/${projectId}/branches/${branchId}/databases`
    );
    if (databases.length === 0) {
      throw new Error('ამ branch-ს არცერთი database არ ჰყავს.');
    }
    const database = databases[0];

    const { uri } = await neonFetch<{ uri: string }>(
      apiKey,
      `/projects/${projectId}/connection_uri?branch_id=${branchId}&database_name=${encodeURIComponent(
        database.name
      )}&role_name=${encodeURIComponent(database.owner_name)}`
    );
    connectionUri = uri;

    console.log(`\n▶ ვუშვებ migration-ს: ${migrationFile} ...`);
    // ⚠️ db.ts-ის იგივე SSL კონვენცია — Neon ყოველთვის SSL-ს მოითხოვს.
    const pool = new Pool({ connectionString: uri, ssl: { rejectUnauthorized: false } });
    try {
      await pool.query(sql);
      console.log(`✅ Migration წარმატებით შესრულდა branch "${branchName}"-ზე.`);

      console.log('\n🧪 sanity-შემოწმება (public schema-ს ცხრილების სია)...');
      const tables = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
      );
      console.log(`   ${tables.rows.length} ცხრილი: ${tables.rows.map((r) => r.table_name).join(', ')}`);
    } finally {
      await pool.end();
    }
  } catch (err: unknown) {
    exitCode = 1;
    const message = err instanceof Error ? err.message : 'უცნობი შეცდომა';
    console.error(`\n❌ Migration-ის ტესტირება ჩავარდა: ${message}`);
  }

  if (keep) {
    console.log(`\n⚠️  --keep გადმოეცა — branch "${branchName}" (${branchId}) დარჩება.`);
    if (connectionUri) {
      console.log('   Connection string (ხელით შემოწმებისთვის, ან TEST_DATABASE_URL-ად isolation-ტესტებისთვის):');
      console.log(`   ${connectionUri}`);
    }
    console.log('   ხელით წაშალეთ Neon console-ის Branches ტაბიდან, როცა აღარ დაგჭირდებათ.');
  } else {
    console.log(`\n🧹 ვშლი დროებით branch-ს "${branchName}"...`);
    try {
      await neonFetch(apiKey, `/projects/${projectId}/branches/${branchId}`, { method: 'DELETE' });
      console.log('✅ Branch წაშლილია.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'უცნობი შეცდომა';
      console.error(`⚠️  Branch-ის წაშლა ჩავარდა — ხელით წაშალეთ Neon console-იდან (branch: ${branchName}): ${message}`);
    }
  }

  process.exit(exitCode);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('მოულოდნელი შეცდომა:', message);
  process.exit(1);
});
