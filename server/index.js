import express from 'express';
import dotenv from 'dotenv';
import { initScheduler, digestState, runDailyDigest } from './scheduler.js';
import { getArticleById } from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.get('/', (req, res) => res.redirect('/health'));

app.get('/run-digest', (req, res) => {
  const token = req.query.token;
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Keep the response open until the pipeline completes. This prevents Replit
  // Autoscale (Cloud Run) from killing the container — it considers the request
  // active until res.end() is called. cron-job.org will disconnect at its ~30s
  // timeout, but that's fine; Cloud Run still tracks the server-side response.
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.write(`started: ${new Date().toISOString()}\n`);

  // Swallow write errors when the client (cron-job.org) disconnects early
  res.on('error', () => {});

  runDailyDigest()
    .then(() => {
      try { res.end(`done: ${new Date().toISOString()}\n`); } catch (e) { /* client gone */ }
    })
    .catch(error => {
      console.error('[API] Digest trigger failed:', error.message);
      try { res.end(`error: ${error.message}\n`); } catch (e) { /* client gone */ }
    });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    ...digestState
  });
});

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.get('/read/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).send('Invalid article ID');

  const article = await getArticleById(id);
  if (!article) return res.status(404).send('Article not found');

  const dateStr = article.pubDate
    ? new Date(article.pubDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  const bodyContent = article.contentHtml
    || `<p>${escapeHtml(article.originalContent || article.summary || '')}</p>`;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(article.title)} — Signal</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #f7f7f7; font-family: Georgia, 'Times New Roman', serif; color: #1e293b; line-height: 1.7; }
    .header { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #e5e5e5; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; z-index: 10; }
    .header-brand { font-size: 18px; font-weight: 700; letter-spacing: -0.5px; color: #1e293b; text-decoration: none; }
    .header-link { font-size: 13px; color: #2563eb; text-decoration: none; }
    .header-link:hover { text-decoration: underline; }
    .article { max-width: 680px; margin: 0 auto; padding: 40px 24px 80px; }
    .meta { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: #64748b; margin-bottom: 8px; }
    h1 { font-size: 28px; font-weight: 700; line-height: 1.3; margin-bottom: 24px; letter-spacing: -0.5px; }
    .body { font-size: 17px; }
    .body p { margin-bottom: 16px; }
    .body img { max-width: 100%; height: auto; border-radius: 6px; margin: 16px 0; }
    .body a { color: #2563eb; }
    .body blockquote { border-left: 3px solid #e5e5e5; padding-left: 16px; color: #64748b; margin: 16px 0; }
    .footer { max-width: 680px; margin: 0 auto; padding: 24px; border-top: 1px solid #e5e5e5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: #94a3b8; text-align: center; }
    .footer a { color: #2563eb; text-decoration: none; }
  </style>
</head>
<body>
  <div class="header">
    <span class="header-brand">Signal</span>
    <a class="header-link" href="${escapeHtml(article.link)}" target="_blank" rel="noopener">View original &rarr;</a>
  </div>
  <article class="article">
    <div class="meta">${escapeHtml(article.source)}${dateStr ? ' &mdash; ' + escapeHtml(dateStr) : ''}</div>
    <h1>${escapeHtml(article.title)}</h1>
    <div class="body">${bodyContent}</div>
  </article>
  <div class="footer">
    <a href="${escapeHtml(article.link)}" target="_blank" rel="noopener">Read on ${escapeHtml(article.source)} &rarr;</a>
  </div>
</body>
</html>`);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nSignal server running on port ${PORT}`);
  console.log(`  GET /health — check digest state\n`);
  initScheduler();
});
