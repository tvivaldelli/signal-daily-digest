# Signal Daily Digest

AI-powered daily email digest delivering mortgage industry intelligence and product management content. Headless backend pipeline — no web frontend.

## Architecture

- **Runtime:** Node.js (ES Modules) + Express on port 3001
- **Database:** SQLite via better-sqlite3, stored at `~/.local/share/signal-digest/articles.db`
- **AI:** Claude Sonnet (claude-sonnet-4-6, fallback to claude-sonnet-4-5) via Anthropic SDK
- **Email:** Resend (from `onboarding@resend.dev`, free tier)
- **Archive:** Append-only JSONL at `server/data/signal-archive.jsonl`

## Deployment

Runs on a **Hetzner VPS** (Tailscale IP: `100.99.202.60`) as a **systemd user service** under the `nanobot` user.

```
~/.config/systemd/user/signal-digest.service
```

**Key commands:**
```bash
systemctl --user status signal-digest
systemctl --user restart signal-digest
journalctl --user -u signal-digest -f
```

Node is managed via nvm — the service file uses the absolute path (`/home/nanobot/.nvm/versions/node/v22.22.0/bin/node`). If node is upgraded, update `ExecStart` in the service file.

Lingering is enabled (`loginctl enable-linger nanobot`) so the service runs without an active SSH session.

## Scheduling

Internal `node-cron` handles all scheduling (no external cron entry needed since systemd keeps the process alive):

- **Daily digest:** 6:30 AM ET (`30 6 * * *`)
- **Article cleanup:** Sunday midnight ET — deletes articles older than 90 days

An external cron-job.org trigger may still point at the old Replit URL as a legacy fallback. It can be removed once VPS stability is confirmed.

## Daily Pipeline Flow

1. **Fetch** — `rssFetcher.js` parses 15 RSS feeds from `sources.json` (mortgage news, product management, competitor Seeking Alpha feeds, YouTube channels). `newsroomScraper.js` scrapes 7 competitor newsrooms via Cheerio.
2. **Store** — Articles upserted into SQLite `articles` table. Deduplication on `link` (UNIQUE constraint).
3. **Query** — Pull articles from last 24 hours.
4. **Analyze** — Single Claude API call generates structured digest: top insights, competitive signals, worth-reading links. 180s timeout, retry with model fallback.
5. **Email** — HTML email via Resend to `DIGEST_EMAIL`.
6. **Archive** — Append digest JSON to JSONL file. On Fridays, generates weekly summary from last 5 archived digests.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Pipeline status JSON (last run, article count, next scheduled run, errors) |
| GET | `/run-digest?token=SECRET` | Manual trigger (auth via `CRON_SECRET` query param) |
| GET | `/read/:id` | Article reader page (linked from digest emails) |

## Environment Variables

Defined in `server/.env` (loaded by dotenv). Template at `server/.env.example`.

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API for insight generation |
| `RESEND_API_KEY` | Resend email delivery |
| `DIGEST_EMAIL` | Recipient email address |
| `CRON_SECRET` | Auth token for `/run-digest` endpoint |
| `APP_URL` | Base URL for reader links in emails (`http://100.99.202.60:3001`) |

## File Structure

```
server/
  index.js            — Express server + endpoints
  db.js               — SQLite (better-sqlite3) — articles table, CRUD ops
  scheduler.js        — node-cron jobs + pipeline orchestration
  rssFetcher.js       — RSS parsing + YouTube enrichment
  newsroomScraper.js  — Cheerio scrapers for 7 competitor newsrooms
  insightsGenerator.js — Claude API integration
  emailSender.js      — Resend email builder + sender
  archiver.js         — JSONL append/read for digest archive
  sources.json        — RSS feed configuration (15 sources)
  data/signal-archive.jsonl — Digest archive
```

## Rules

- **No web frontend.** This is a headless pipeline. The only UI is the email digest.
- **Don't touch digest logic** (insightsGenerator, emailSender, rssFetcher, newsroomScraper, scheduler pipeline) without explicit instruction.
- **Don't add `pg` or PostgreSQL.** The database was migrated to SQLite — that's intentional.
- Secrets live in `server/.env` — never commit this file.
