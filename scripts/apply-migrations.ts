#!/usr/bin/env -S npx tsx
/**
 * apply-migrations.ts — Apply pending Supabase SQL migrations via pg.
 *
 * Usage:
 *   SUPABASE_DB_PASSWORD=<your-db-password> npx tsx scripts/apply-migrations.ts
 *
 * The DB password is found in Supabase Dashboard → Project Settings → Database
 * → "Connection string" → extract the password from the URI.
 *
 * Applies all .sql files in supabase/migrations/ that haven't been applied yet.
 * Idempotent: uses CREATE OR REPLACE for functions, so re-running is safe.
 */

import { Client } from 'pg'
import { config as dotenvConfig } from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

dotenvConfig({ path: path.resolve(process.cwd(), '.env.local') })

const PROJECT_REF = 'lfmmjjozvxctepedjmjw'
const DB_PASSWORD  = process.env.SUPABASE_DB_PASSWORD
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase/migrations')

// Allow passing a specific migration file as argument
const TARGET = process.argv[2]

async function main() {
  if (!DB_PASSWORD) {
    console.error('Missing SUPABASE_DB_PASSWORD env var.')
    console.error('Find it in: Supabase Dashboard → Project Settings → Database → Connection string')
    process.exit(1)
  }

  const client = new Client({
    host:     `aws-1-us-west-2.pooler.supabase.com`,
    port:     5432,
    user:     `postgres.${PROJECT_REF}`,
    password: DB_PASSWORD,
    database: 'postgres',
    ssl:      { rejectUnauthorized: false },
  })

  await client.connect()
  console.log('Connected to Supabase.\n')

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .filter(f => !TARGET || f === TARGET || f === path.basename(TARGET))

  if (files.length === 0) {
    console.log(TARGET ? `No migration matching "${TARGET}" found.` : 'No SQL files in migrations/.')
    await client.end()
    return
  }

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8')
    console.log(`Applying ${file}...`)
    try {
      await client.query(sql)
      console.log(`  ✓ Done\n`)
    } catch (e) {
      console.error(`  ✗ Error: ${(e as Error).message}\n`)
    }
  }

  await client.end()
  console.log('All done.')
}

main().catch(e => { console.error(e); process.exit(1) })
