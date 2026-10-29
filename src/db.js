import mysql from 'mysql2/promise';
import fs from 'node:fs/promises';
import { config } from './config.js';

export function createPool() {
  return mysql.createPool({
    ...config.db,
    connectionLimit: 4,
    multipleStatements: true,
    dateStrings: true,
    charset: 'utf8mb4',
  });
}

export async function migrate(pool) {
  const sql = await fs.readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}
