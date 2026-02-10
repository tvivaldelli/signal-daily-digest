import express from 'express';
import dotenv from 'dotenv';
import { initScheduler, digestState } from './scheduler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => res.redirect('/health'));

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
