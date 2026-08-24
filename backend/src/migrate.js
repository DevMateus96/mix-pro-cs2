import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { pool } from './db.js';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const sql=await fs.readFile(path.resolve(__dirname,'../../database/001_init.sql'),'utf8');
await pool.query(sql); console.log('Migração concluída.'); await pool.end();
