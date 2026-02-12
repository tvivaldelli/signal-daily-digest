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

  // Stream response to keep connection alive on Replit Autoscale.
  // cron-job.org gets an immediate 200, and periodic keep-alive writes
  // prevent Replit from scaling to zero before the pipeline finishes.
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Transfer-Encoding': 'chunked',
  });
  res.write('started\n');

  const keepAlive = setInterval(() => res.write('.\n'), 10000);

  try {
    await runDailyDigest();
    clearInterval(keepAlive);
    res.end(`completed ${digestState.articleCount} articles, email: ${digestState.emailStatus}\n`);
  } catch (error) {
    clearInterval(keepAlive);
    console.error('[API] Digest trigger failed:', error.message);
    res.end(`failed: ${error.message}\n`);
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
