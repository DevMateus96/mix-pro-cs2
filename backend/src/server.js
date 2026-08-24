import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { pool } from './db.js';

const app = express();
const port = Number(process.env.PORT || 3000);

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin(origin, callback) {
    // Permite ferramentas sem Origin, como health checks e testes.
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origem não autorizada pelo CORS'));
  }
}));
app.use(express.json({ limit: '25mb' }));
app.use(morgan('tiny'));

app.get('/', (_req, res) => {
  res.json({ name: 'MIX PRO API', status: 'online' });
});

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(503).json({ ok: false });
  }
});

app.get('/api/state', async (_req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT data, version, updated_at FROM app_state WHERE id = 1'
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Estado ainda não criado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.put('/api/state', async (req, res, next) => {
  try {
    if (!req.body?.data || typeof req.body.data !== 'object' || Array.isArray(req.body.data)) {
      return res.status(400).json({ message: 'data deve ser um objeto' });
    }

    const expectedVersion =
      req.body.version === null || req.body.version === undefined
        ? null
        : Number(req.body.version);

    let query;
    let params;

    if (Number.isFinite(expectedVersion)) {
      query = `
        UPDATE app_state
        SET data = $1,
            version = version + 1,
            updated_at = NOW()
        WHERE id = 1 AND version = $2
        RETURNING data, version, updated_at
      `;
      params = [req.body.data, expectedVersion];
    } else {
      query = `
        INSERT INTO app_state (id, data, version, updated_at)
        VALUES (1, $1, 1, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          data = EXCLUDED.data,
          version = app_state.version + 1,
          updated_at = NOW()
        RETURNING data, version, updated_at
      `;
      params = [req.body.data];
    }

    const result = await pool.query(query, params);

    if (!result.rowCount) {
      return res.status(409).json({
        message: 'Conflito: os dados foram alterados por outra sessão. Recarregue a página.'
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: 'Erro interno do servidor' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`MIX PRO API iniciada na porta ${port}`);
});
