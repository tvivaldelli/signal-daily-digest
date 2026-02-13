import express from 'express';
import http from 'http';
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

  // Track connection state so we don't crash writing to a closed socket
  // after cron-job.org disconnects at its 30-second timeout.
  let connectionOpen = true;
  res.on('close', () => { connectionOpen = false; });
  res.on('error', () => { connectionOpen = false; });

  const safeWrite = (msg) => {
    if (!connectionOpen) return;
    try { res.write(msg); } catch (e) { connectionOpen = false; }
  };

  // Two keep-alive mechanisms:
  // 1. Write to chunked response (works while cron-job.org is connected)
  // 2. Self-ping /health to generate fresh inbound requests, preventing
  //    Replit Autoscale from scaling to zero after cron-job.org disconnects
  const keepAlive = setInterval(() => {
    safeWrite('.\n');
    http.get(`http://localhost:${PORT}/health`, (r) => r.resume()).on('error', () => {});
  }, 10000);

  try {
    await runDailyDigest();
    clearInterval(keepAlive);
    if (connectionOpen) {
      res.end(`completed ${digestState.articleCount} articles, email: ${digestState.emailStatus}\n`);
    }
  } catch (error) {
    clearInterval(keepAlive);
    console.error('[API] Digest trigger failed:', error.message);
    if (connectionOpen) {
      res.end(`failed: ${error.message}\n`);
    }
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
