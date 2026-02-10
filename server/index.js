import express from 'express';
import dotenv from 'dotenv';
import { initScheduler, digestState, runDailyDigest } from './scheduler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => res.redirect('/health'));

app.get('/run-digest', async (req, res) => {
  const token = req.query.token;
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ status: 'started' });
  try {
    await runDailyDigest();
  } catch (error) {
    console.error('[API] Digest trigger failed:', error.message);
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    ...digestState
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nSignal server running on port ${PORT}`);
  console.log(`  GET /health — check digest state\n`);
  initScheduler();
});
