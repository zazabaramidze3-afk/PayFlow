// backend/tests/isolation/schema.ts
//
// STEP 1 (`organizations` ცხრილი + `organization_id` backfill) ჯერ არ
// არის გატარებული. ეს helper-ი runtime-ზე ამოწმებს, უკვე გატარებულია
// თუ არა — მის მიხედვით tenant-isolation.test.ts ირჩევს, ორ-org რეალურ
// შემოწმებებს გაუშვას თუ ერთი-org ტრივიალურ smoke ტესტებს
// (Roadmap "16.08.2026", ცვლილება #3).

import { Pool } from 'pg';

export interface SchemaCapabilities {
  /** `organizations` ცხრილი არსებობს (STEP 1 migration გატარებულია). */
  readonly hasOrganizations: boolean;
  /** `users.organization_id` სვეტი არსებობს (STEP 1 backfill დასრულებულია). */
  readonly hasUserOrgColumn: boolean;
  /** ორივე პირობა ერთად — მხოლოდ ამის დროს აქვს აზრი ორ-org ტესტებს. */
  readonly multiTenantReady: boolean;
}

export async function tableExists(pool: Pool, tableName: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return result.rows[0]?.exists ?? false;
}

export async function columnExists(pool: Pool, tableName: string, columnName: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [tableName, columnName]
  );
  return result.rows[0]?.exists ?? false;
}

export async function detectSchemaCapabilities(pool: Pool): Promise<SchemaCapabilities> {
  const hasOrganizations = await tableExists(pool, 'organizations');
  const hasUserOrgColumn = await columnExists(pool, 'users', 'organization_id');

  return {
    hasOrganizations,
    hasUserOrgColumn,
    multiTenantReady: hasOrganizations && hasUserOrgColumn,
  };
}
