import express from 'express';
import http from 'http';
import dotenv from 'dotenv';
import { initScheduler, digestState, runDailyDigest } from './scheduler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => res.redirect('/health'));

app.get('/run-digest', (req, res) => {
  const token = req.query.token;
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Respond immediately so cron-job.org sees a clean 200 (it has a 30s timeout).
  // The pipeline runs in the background with self-pings to keep Replit Autoscale alive.
  res.json({ status: 'started', time: new Date().toISOString() });

  // Self-ping /health every 10s to prevent Replit Autoscale from scaling to zero
  // while the pipeline runs (~40-120s).
  const keepAlive = setInterval(() => {
    http.get(`http://localhost:${PORT}/health`, (r) => r.resume()).on('error', () => {});
  }, 10000);

  runDailyDigest()
    .catch(error => console.error('[API] Digest trigger failed:', error.message))
    .finally(() => clearInterval(keepAlive));
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
